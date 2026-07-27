import { exec } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db.js";
import { services, deployments } from "./schema.js";
import { eq, and } from "drizzle-orm";

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

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const stat = JSON.parse(line);
          const cpu = parseCpuPercent(stat.CPUPerc);
          statsByContainer.set(stat.Name, { cpuPercent: cpu });
        } catch (err) {
          console.error("Failed to parse docker stats line:", err);
        }
      }

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
        
        // Current limit inspection - docker inspect
        const inspectCmd = `docker inspect --format="{{.HostConfig.NanoCpus}}" ${containerName}`;
        let nanoCpus = 0;
        try {
          const { stdout: inspectOut } = await execAsync(inspectCmd);
          nanoCpus = parseInt(inspectOut.trim(), 10);
        } catch (err) {
          continue;
        }
        
        // 1 CPU = 1_000_000_000 NanoCpus. If 0, it means no limit.
        const currentCpuLimit = nanoCpus > 0 ? nanoCpus / 1_000_000_000 : null;

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
