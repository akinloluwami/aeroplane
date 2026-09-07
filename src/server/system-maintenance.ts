import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "./config.js";

export const maintenanceCleanupTargets = [
  "docker-containers",
  "docker-networks",
  "docker-images",
  "docker-build-cache",
  "docker-volumes",
  "apt-cache",
  "journals",
  "build-artifacts"
] as const;

export type MaintenanceCleanupTarget = (typeof maintenanceCleanupTargets)[number];

export type MaintenanceCommandResult = {
  label: string;
  ok: boolean;
  output: string;
};

export type MaintenanceDiskMetric = {
  mount: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
};

export type MaintenancePathMetric = {
  id: string;
  label: string;
  path: string;
  bytes: number | null;
  available: boolean;
  error: string | null;
};

export type MaintenanceDockerMetric = {
  type: string;
  totalCount: number | null;
  activeCount: number | null;
  sizeBytes: number | null;
  reclaimableBytes: number | null;
  rawSize: string;
  rawReclaimable: string;
};

export type MaintenanceHistoryPoint = {
  checkedAt: string;
  diskUsedPercent: number | null;
  dockerReclaimableBytes: number | null;
  buildArtifactsBytes: number | null;
};

export type SystemMaintenanceInfo = {
  checkedAt: string;
  disk: MaintenanceDiskMetric | null;
  docker: {
    available: boolean;
    error: string | null;
    rows: MaintenanceDockerMetric[];
    reclaimableBytes: number;
  };
  paths: MaintenancePathMetric[];
  history: MaintenanceHistoryPoint[];
  alerts: string[];
};

export type SystemMaintenanceCleanupResult = {
  ok: boolean;
  commands: MaintenanceCommandResult[];
  info: SystemMaintenanceInfo;
};

type CommandResult = {
  ok: boolean;
  code: number | null;
  output: string;
};

const historyPath = () => resolve(config.dataDir, "system-maintenance-history.json");

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function runCommand(command: string, args: string[], timeoutMs = 60000): Promise<CommandResult> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveCommand({ ...result, output: stripAnsi(result.output).trim() });
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, code: null, output: `${command} timed out after ${timeoutMs}ms\n${output}` });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ ok: false, code: null, output: error.message });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, code, output });
    });
  });
}

function parseSizeToBytes(value: string) {
  const token = value.trim().split(/\s+/)[0]?.replace(/,/g, "") ?? "";
  const match = token.match(/^([\d.]+)([a-z]+)?$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = (match[2] ?? "b").toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    k: 1000,
    kib: 1024,
    mb: 1000 ** 2,
    m: 1000 ** 2,
    mib: 1024 ** 2,
    gb: 1000 ** 3,
    g: 1000 ** 3,
    gib: 1024 ** 3,
    tb: 1000 ** 4,
    t: 1000 ** 4,
    tib: 1024 ** 4
  };

  return Math.round(amount * (multipliers[unit] ?? 1));
}

function parseDisk(output: string): MaintenanceDiskMetric | null {
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return null;

  const parts = lines[1].trim().split(/\s+/);
  if (parts.length < 6) return null;

  const totalBytes = Number(parts[1]);
  const usedBytes = Number(parts[2]);
  const availableBytes = Number(parts[3]);
  const usedPercent = Number(parts[4].replace("%", ""));

  if (![totalBytes, usedBytes, availableBytes, usedPercent].every(Number.isFinite)) {
    return null;
  }

  return {
    mount: parts.slice(5).join(" "),
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent
  };
}

function parseDockerDf(output: string) {
  const rows: MaintenanceDockerMetric[] = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [type, totalCount, activeCount, rawSize, rawReclaimable] = line.split("\t");
      return {
        type: type || "Unknown",
        totalCount: Number.isFinite(Number(totalCount)) ? Number(totalCount) : null,
        activeCount: Number.isFinite(Number(activeCount)) ? Number(activeCount) : null,
        sizeBytes: rawSize ? parseSizeToBytes(rawSize) : null,
        reclaimableBytes: rawReclaimable ? parseSizeToBytes(rawReclaimable) : null,
        rawSize: rawSize ?? "",
        rawReclaimable: rawReclaimable ?? ""
      };
    });

  return rows;
}

async function getPathMetric(id: string, label: string, path: string): Promise<MaintenancePathMetric> {
  if (!existsSync(path)) {
    return { id, label, path, bytes: null, available: false, error: null };
  }

  const result = await runCommand("du", ["-sb", path], 30000);
  if (!result.ok) {
    return { id, label, path, bytes: null, available: true, error: result.output || "Could not measure path" };
  }

  const bytes = Number(result.output.trim().split(/\s+/)[0]);
  return {
    id,
    label,
    path,
    bytes: Number.isFinite(bytes) ? bytes : null,
    available: true,
    error: null
  };
}

function buildAlerts(info: Omit<SystemMaintenanceInfo, "alerts" | "history">) {
  const alerts: string[] = [];

  if (info.disk?.usedPercent !== undefined && info.disk.usedPercent >= 90) {
    alerts.push(`Root disk is ${info.disk.usedPercent}% full.`);
  } else if (info.disk?.usedPercent !== undefined && info.disk.usedPercent >= 80) {
    alerts.push(`Root disk is getting full at ${info.disk.usedPercent}%.`);
  }

  if (info.docker.reclaimableBytes > 3 * 1000 ** 3) {
    alerts.push("Docker has more than 3 GB reclaimable.");
  }

  const buildArtifacts = info.paths.find((item) => item.id === "build-artifacts");
  if ((buildArtifacts?.bytes ?? 0) > 2 * 1000 ** 3) {
    alerts.push("Build artifacts are using more than 2 GB.");
  }

  return alerts;
}

async function readHistory() {
  try {
    const parsed = JSON.parse(await readFile(historyPath(), "utf8")) as MaintenanceHistoryPoint[];
    return Array.isArray(parsed) ? parsed.slice(-48) : [];
  } catch {
    return [];
  }
}

async function writeHistory(points: MaintenanceHistoryPoint[]) {
  try {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(historyPath(), `${JSON.stringify(points.slice(-48), null, 2)}\n`);
  } catch {
    // History is a nicety. Metrics should still load if the data dir is read-only or full.
  }
}

async function getBuildArtifactsBytes(paths: MaintenancePathMetric[]) {
  return paths.find((path) => path.id === "build-artifacts")?.bytes ?? null;
}

async function getDockerMetrics() {
  const result = await runCommand("docker", [
    "system",
    "df",
    "--format",
    "{{.Type}}\t{{.TotalCount}}\t{{.Active}}\t{{.Size}}\t{{.Reclaimable}}"
  ]);

  if (!result.ok) {
    return {
      available: false,
      error: result.output || "Docker is unavailable.",
      rows: [],
      reclaimableBytes: 0
    };
  }

  const rows = parseDockerDf(result.output);
  return {
    available: true,
    error: null,
    rows,
    reclaimableBytes: rows.reduce((total, row) => total + (row.reclaimableBytes ?? 0), 0)
  };
}

export async function getSystemMaintenanceInfo(): Promise<SystemMaintenanceInfo> {
  const checkedAt = new Date().toISOString();
  const [diskResult, docker, paths] = await Promise.all([
    runCommand("df", ["-P", "-B1", "/"], 20000),
    getDockerMetrics(),
    Promise.all([
      getPathMetric("data", "Aeroplane data", config.dataDir),
      getPathMetric("build-artifacts", "Build artifacts", resolve(config.dataDir, "builds")),
      getPathMetric("backups", "Database backups", resolve(config.dataDir, "backups")),
      getPathMetric("apt-cache", "APT cache", "/var/cache/apt"),
      getPathMetric("system-logs", "System logs", "/var/log")
    ])
  ]);

  const disk = diskResult.ok ? parseDisk(diskResult.output) : null;
  const base = {
    checkedAt,
    disk,
    docker,
    paths
  };
  const historyPoint: MaintenanceHistoryPoint = {
    checkedAt,
    diskUsedPercent: disk?.usedPercent ?? null,
    dockerReclaimableBytes: docker.reclaimableBytes,
    buildArtifactsBytes: await getBuildArtifactsBytes(paths)
  };
  const history = [...(await readHistory()), historyPoint].slice(-48);
  await writeHistory(history);

  return {
    ...base,
    history,
    alerts: buildAlerts(base)
  };
}

async function cleanupBuildArtifacts() {
  const buildsDir = resolve(config.dataDir, "builds");
  if (!existsSync(buildsDir)) {
    return { ok: true, output: "No build artifacts directory found." };
  }

  const entries = await readdir(buildsDir);
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of entries) {
    const entryPath = join(buildsDir, entry);
    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat || entryStat.mtimeMs > cutoffMs) continue;
    await rm(entryPath, { recursive: true, force: true });
    removed += 1;
  }

  return {
    ok: true,
    output: removed === 0 ? "No build artifacts older than 24 hours." : `Removed ${removed} old build artifact ${removed === 1 ? "directory" : "directories"}.`
  };
}

async function runCleanupTarget(target: MaintenanceCleanupTarget): Promise<MaintenanceCommandResult> {
  if (target === "build-artifacts") {
    const result = await cleanupBuildArtifacts();
    return { label: "Build artifacts", ok: result.ok, output: result.output };
  }

  const commands: Record<Exclude<MaintenanceCleanupTarget, "build-artifacts">, { label: string; command: string; args: string[]; timeoutMs?: number }> = {
    "docker-containers": {
      label: "Stopped Docker containers",
      command: "docker",
      args: ["container", "prune", "-f"]
    },
    "docker-networks": {
      label: "Unused Docker networks",
      command: "docker",
      args: ["network", "prune", "-f"]
    },
    "docker-images": {
      label: "Unused Docker images",
      command: "docker",
      args: ["image", "prune", "-af"],
      timeoutMs: 120000
    },
    "docker-build-cache": {
      label: "Docker build cache",
      command: "docker",
      args: ["builder", "prune", "-af"],
      timeoutMs: 120000
    },
    "docker-volumes": {
      label: "Unused Docker volumes",
      command: "docker",
      args: ["volume", "prune", "-f"],
      timeoutMs: 120000
    },
    "apt-cache": {
      label: "APT cache",
      command: "sh",
      args: ["-lc", "apt-get clean && rm -rf /var/lib/apt/lists/*"]
    },
    journals: {
      label: "System journals",
      command: "journalctl",
      args: ["--vacuum-size=100M"],
      timeoutMs: 120000
    }
  };

  const cleanup = commands[target];
  const result = await runCommand(cleanup.command, cleanup.args, cleanup.timeoutMs);

  return {
    label: cleanup.label,
    ok: result.ok,
    output: result.output || (result.ok ? "Done." : `Exited with ${result.code}`)
  };
}

export async function runSystemMaintenanceCleanup(targets: MaintenanceCleanupTarget[]): Promise<SystemMaintenanceCleanupResult> {
  const uniqueTargets = [...new Set(targets)];
  const commands: MaintenanceCommandResult[] = [];

  for (const target of uniqueTargets) {
    commands.push(await runCleanupTarget(target));
  }

  return {
    ok: commands.every((command) => command.ok),
    commands,
    info: await getSystemMaintenanceInfo()
  };
}
