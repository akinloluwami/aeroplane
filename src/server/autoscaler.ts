import { exec } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db.js";
import { services, deployments } from "./schema.js";
import { eq, and } from "drizzle-orm";
import * as os from "node:os";

const execAsync = promisify(exec);

// Parse CPU percentage from docker stats, e.g. "0.00%" -> 0
function parseCpuPercent(cpuString: string): number {
  if (!cpuString) return 0;
  return parseFloat(cpuString.replace("%", ""));
}

function parseMemoryBytes(memString: string): number {
  if (!memString) return 0;
  let val = parseFloat(memString);
  if (memString.includes("KiB") || memString.includes("kB")) val *= 1024;
  else if (memString.includes("MiB") || memString.includes("MB")) val *= 1024 * 1024;
  else if (memString.includes("GiB") || memString.includes("GB")) val *= 1024 * 1024 * 1024;
  return val;
}

export function startAutoscalerWorker() {
  const INTERVAL_MS = 30000; // Check every 30 seconds

  console.log("Starting Aeroplane autoscaler worker...");

  // Tracks the last 5 CPU percentage readings per container
  const containerCpuHistory = new Map<string, number[]>();
  // Tracks the last 3 memory readings per container for scale-down trending
  const containerMemHistory = new Map<string, number[]>();
  // Tracks consecutive cycles below scale-down threshold
  const containerMemScaleDownCycles = new Map<string, number>();

  setInterval(async () => {
    try {
      // 1. Find all services that have autoscaling enabled and are running
      const enabledServices = await db.select()
        .from(services)
        .where(and(eq(services.autoscalingEnabled, true), eq(services.status, "active")));

      if (enabledServices.length === 0) return;

      // 2. Fetch docker stats
      const { stdout } = await execAsync("docker stats --no-stream --format \"{{json .}}\"");
      if (!stdout.trim()) return;

      const lines = stdout.trim().split("\n");
      const statsByContainer = new Map<string, { cpuPercent: number; memUsageBytes: number }>();
      const runningContainers: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const stat = JSON.parse(line);
          const cpu = parseCpuPercent(stat.CPUPerc);
          const mem = parseMemoryBytes(stat.MemUsage.split(" / ")[0]);
          statsByContainer.set(stat.Name, { cpuPercent: cpu, memUsageBytes: mem });
          runningContainers.push(stat.Name);
        } catch (err) {
          console.error("Failed to parse docker stats line:", err);
        }
      }

      let totalAllocatedCpus = 0;
      let totalAllocatedMem = 0;
      const currentLimits = new Map<string, { cpu: number; mem: number }>();

      if (runningContainers.length > 0) {
        // Fetch limits for all running containers in one go
        const inspectCmd = `docker inspect --format="{{.Name}} {{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}" ${runningContainers.join(" ")}`;
        try {
          const { stdout: inspectOut } = await execAsync(inspectCmd);
          for (const line of inspectOut.trim().split("\n")) {
            const parts = line.trim().split(" ");
            if (parts.length >= 3) {
              const name = parts[0].replace("/", ""); // remove leading slash
              const nanoCpus = parseInt(parts[1], 10);
              const memBytes = parseInt(parts[2], 10);
              const cpuLimit = nanoCpus > 0 ? nanoCpus / 1_000_000_000 : 0;
              const memLimit = memBytes > 0 ? memBytes : 0;
              totalAllocatedCpus += cpuLimit;
              totalAllocatedMem += memLimit;
              currentLimits.set(name, { cpu: cpuLimit, mem: memLimit });
            }
          }
        } catch (err) {
          console.error("Failed to inspect containers:", err);
        }
      }

      const TOTAL_HOST_CORES = os.cpus().length;
      const MAX_GLOBAL_CPU_LIMIT = TOTAL_HOST_CORES * 1.2; // 20% overprovisioning
      const TOTAL_HOST_MEM = os.totalmem();
      const MAX_GLOBAL_MEM_LIMIT = TOTAL_HOST_MEM * 0.9; // Leave 10% for OS

      // 3. Evaluate each enabled service
      for (const service of enabledServices) {
        const activeDeployment = await db.query.deployments.findFirst({
          where: and(eq(deployments.serviceId, service.id), eq(deployments.status, "running")),
          orderBy: (deployments, { desc }) => [desc(deployments.createdAt)]
        });

        if (!activeDeployment || !activeDeployment.containerName) continue;

        const containerName = activeDeployment.containerName;
        const stat = statsByContainer.get(containerName);
        if (!stat) continue;

        let history = containerCpuHistory.get(containerName) || [];
        history.push(stat.cpuPercent);
        if (history.length > 5) {
          history.shift();
        }
        containerCpuHistory.set(containerName, history);

        const currentCpuUsage = history.reduce((sum, val) => sum + val, 0) / history.length; // Average over the last 5 samples
        
        const limitVal = currentLimits.get(containerName);
        const currentCpuLimit = limitVal ? (limitVal.cpu > 0 ? limitVal.cpu : null) : null;

        // Configuration
        const minCpu = service.autoscalingMinCpu || 0.1;
        const maxCpu = service.autoscalingMaxCpu || 2.0;

        let nextLimit = currentCpuLimit || minCpu;

        // True CPU cores demand (100% = 1 core)
        const trueCpuDemand = currentCpuUsage / 100;

        // Current utilization relative to the allocated limit
        const currentUtilization = currentCpuLimit ? (trueCpuDemand / currentCpuLimit) : 0;
        
        // Target utilization: 60%
        const targetUtilization = 0.6;

        // Only scale if utilization is too high (>80%) or too low (<20%) to avoid jitter
        if (currentUtilization > 0.8 || currentUtilization < 0.2) {
          nextLimit = trueCpuDemand / targetUtilization;
          
          // Clamp to [minCpu, maxCpu]
          nextLimit = Math.max(minCpu, Math.min(maxCpu, nextLimit));
        }

        // Host-level headroom check (Hard allocation cap)
        const currentLimitResolved = currentCpuLimit || minCpu;
        if (nextLimit > currentLimitResolved) {
          // Scale-up scenario
          const requestedIncrease = nextLimit - currentLimitResolved;
          const headroom = Math.max(0, MAX_GLOBAL_CPU_LIMIT - totalAllocatedCpus);
          
          if (headroom === 0) {
            console.log(`[Autoscaler] Denied scale-up for ${containerName}. Host is fully allocated (${totalAllocatedCpus.toFixed(1)} / ${MAX_GLOBAL_CPU_LIMIT.toFixed(1)} CPUs)`);
            nextLimit = currentLimitResolved; // Cancel scale-up
          } else if (requestedIncrease > headroom) {
            console.log(`[Autoscaler] Clamping scale-up for ${containerName} due to host limits. Requested: +${requestedIncrease.toFixed(2)}, Available: +${headroom.toFixed(2)}`);
            nextLimit = currentLimitResolved + headroom; // Clamp scale-up to remaining headroom
          }
        }

        // Update running tally for subsequent projects in the loop
        if (nextLimit !== currentLimitResolved) {
          totalAllocatedCpus += (nextLimit - currentLimitResolved);
        }

        // Round to 2 decimals
        nextLimit = Math.round(nextLimit * 100) / 100;

        // Memory Autoscaling Logic
        const minMemBytes = (service.autoscalingMinMem || 256) * 1024 * 1024;
        const maxMemBytes = (service.autoscalingMaxMem || 2048) * 1024 * 1024;
        
        let memHistory = containerMemHistory.get(containerName) || [];
        memHistory.push(stat.memUsageBytes);
        if (memHistory.length > 3) {
          memHistory.shift();
        }
        containerMemHistory.set(containerName, memHistory);

        const currentMemLimit = limitVal && limitVal.mem > 0 ? limitVal.mem : minMemBytes;
        let nextMemLimit = currentMemLimit;
        
        // Target 60% utilization: newLimit = currentUsage / targetUtilization
        const targetMemUtilization = 0.6;
        const proposedMemLimit = stat.memUsageBytes / targetMemUtilization;

        // Is it a scale up?
        if (proposedMemLimit > currentMemLimit) {
          // Reset scale down cycles
          containerMemScaleDownCycles.set(containerName, 0);
          
          nextMemLimit = proposedMemLimit;
          // Clamp to max
          nextMemLimit = Math.min(maxMemBytes, nextMemLimit);
          
          // Host-level headroom check for memory
          const requestedIncrease = nextMemLimit - currentMemLimit;
          const headroom = Math.max(0, MAX_GLOBAL_MEM_LIMIT - totalAllocatedMem);
          if (headroom === 0) {
            console.log(`[Autoscaler] Denied memory scale-up for ${containerName}. Host memory fully allocated.`);
            nextMemLimit = currentMemLimit;
          } else if (requestedIncrease > headroom) {
            console.log(`[Autoscaler] Clamping memory scale-up for ${containerName} due to host limits.`);
            nextMemLimit = currentMemLimit + headroom;
          }
        } else {
          // Is it a scale down?
          // Check hybrid buffer
          const requiredBuffer = Math.max(0.20 * stat.memUsageBytes, 75 * 1024 * 1024); // 20% or 75MB
          if (stat.memUsageBytes + requiredBuffer < proposedMemLimit) {
            let scaleDownCycles = containerMemScaleDownCycles.get(containerName) || 0;
            scaleDownCycles++;
            containerMemScaleDownCycles.set(containerName, scaleDownCycles);
            
            if (scaleDownCycles >= 3) {
              // Check for upward trend
              let upwardTrend = false;
              if (memHistory.length === 3) {
                if (memHistory[2] > memHistory[1] && memHistory[1] > memHistory[0]) {
                  upwardTrend = true;
                }
              }
              
              if (!upwardTrend) {
                // Re-fetch current memory usage before issuing update
                try {
                  const { stdout: freshStats } = await execAsync(`docker stats --no-stream --format "{{json .}}" ${containerName}`);
                  if (freshStats.trim()) {
                    const freshStat = JSON.parse(freshStats.trim());
                    const freshMemBytes = parseMemoryBytes(freshStat.MemUsage.split(" / ")[0]);
                    
                    if (freshMemBytes + requiredBuffer < proposedMemLimit) {
                      nextMemLimit = proposedMemLimit;
                      nextMemLimit = Math.max(minMemBytes, nextMemLimit);
                    } else {
                      console.log(`[Autoscaler] Aborted memory scale-down for ${containerName}, fresh usage too high.`);
                    }
                  }
                } catch (err) {
                  console.error(`[Autoscaler] Failed to fetch fresh stats for ${containerName}:`, err);
                }
              } else {
                console.log(`[Autoscaler] Skipping memory scale-down for ${containerName} due to upward trend.`);
              }
            }
          } else {
            containerMemScaleDownCycles.set(containerName, 0);
          }
        }
        
        // Make sure memory is an integer
        nextMemLimit = Math.floor(nextMemLimit);

        if (nextLimit !== currentLimitResolved || nextMemLimit !== currentMemLimit) {
          console.log(`[Autoscaler] Updating ${containerName} CPU: ${currentCpuLimit} -> ${nextLimit}, MEM: ${currentMemLimit / 1024 / 1024}MB -> ${nextMemLimit / 1024 / 1024}MB`);
          try {
            await execAsync(`docker update --cpus="${nextLimit}" --memory="${nextMemLimit}b" --memory-swap="${nextMemLimit}b" ${containerName}`);
          } catch (updateErr) {
            console.error(`[Autoscaler] Failed to update container ${containerName}:`, updateErr);
          }
        }
      }

      // Cleanup history for containers that are no longer running
      for (const key of containerCpuHistory.keys()) {
        if (!statsByContainer.has(key)) {
          containerCpuHistory.delete(key);
          containerMemHistory.delete(key);
          containerMemScaleDownCycles.delete(key);
        }
      }

    } catch (err) {
      console.error("[Autoscaler] Error in autoscaler loop:", err);
    }
  }, INTERVAL_MS);
}
