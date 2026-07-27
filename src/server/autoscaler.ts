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

export function startAutoscalerWorker() {
  const INTERVAL_MS = 30000; // Check every 30 seconds

  console.log("Starting Aeroplane autoscaler worker...");

  // Tracks the last 5 CPU percentage readings per container
  const containerCpuHistory = new Map<string, number[]>();

  setInterval(async () => {
    try {
      // 1. Find all services that have autoscaling enabled and are running
      const enabledServices = await db.select()
        .from(services)
        .where(and(eq(services.autoscalingEnabled, true), eq(services.status, "deployed")));

      if (enabledServices.length === 0) return;

      // 2. Fetch docker stats
      const { stdout } = await execAsync("docker stats --no-stream --format \"{{json .}}\"");
      if (!stdout.trim()) return;

      const lines = stdout.trim().split("\n");
      const statsByContainer = new Map<string, { cpuPercent: number }>();
      const runningContainers: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const stat = JSON.parse(line);
          const cpu = parseCpuPercent(stat.CPUPerc);
          statsByContainer.set(stat.Name, { cpuPercent: cpu });
          runningContainers.push(stat.Name);
        } catch (err) {
          console.error("Failed to parse docker stats line:", err);
        }
      }

      let totalAllocatedCpus = 0;
      const currentLimits = new Map<string, number>();

      if (runningContainers.length > 0) {
        // Fetch limits for all running containers in one go
        const inspectCmd = `docker inspect --format="{{.Name}} {{.HostConfig.NanoCpus}}" ${runningContainers.join(" ")}`;
        try {
          const { stdout: inspectOut } = await execAsync(inspectCmd);
          for (const line of inspectOut.trim().split("\n")) {
            const parts = line.trim().split(" ");
            if (parts.length === 2) {
              const name = parts[0].replace("/", ""); // remove leading slash
              const nanoCpus = parseInt(parts[1], 10);
              const limit = nanoCpus > 0 ? nanoCpus / 1_000_000_000 : 0;
              totalAllocatedCpus += limit;
              currentLimits.set(name, limit);
            }
          }
        } catch (err) {
          console.error("Failed to inspect containers:", err);
        }
      }

      const TOTAL_HOST_CORES = os.cpus().length;
      const MAX_GLOBAL_CPU_LIMIT = TOTAL_HOST_CORES * 1.2; // 20% overprovisioning

      // 3. Evaluate each enabled service
      for (const service of enabledServices) {
        const activeDeployment = await db.query.deployments.findFirst({
          where: and(eq(deployments.serviceId, service.id), eq(deployments.status, "success")),
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
        const currentCpuLimit = limitVal ? (limitVal > 0 ? limitVal : null) : null;

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

        if (currentCpuLimit !== nextLimit) {
          console.log(`[Autoscaler] Updating ${containerName} (service: ${service.name}) CPU limit: ${currentCpuLimit} -> ${nextLimit} (Utilization was ${(currentUtilization * 100).toFixed(1)}%)`);
          try {
            await execAsync(`docker update --cpus="${nextLimit}" ${containerName}`);
          } catch (updateErr) {
            console.error(`[Autoscaler] Failed to update container ${containerName}:`, updateErr);
          }
        }
      }

      // Cleanup history for containers that are no longer running
      for (const key of containerCpuHistory.keys()) {
        if (!statsByContainer.has(key)) {
          containerCpuHistory.delete(key);
        }
      }

    } catch (err) {
      console.error("[Autoscaler] Error in autoscaler loop:", err);
    }
  }, INTERVAL_MS);
}
