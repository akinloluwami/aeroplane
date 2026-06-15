import { spawn } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";

export type MonitoringSnapshot = {
  timestamp: string;
  cpu: {
    usagePercent: number;
    cores: number;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
  };
  disk: {
    usedBytes: number;
    totalBytes: number;
    mount: string;
  } | null;
  docker: {
    available: boolean;
    totalBytes: number;
    images: number;
    containers: number;
    volumes: number;
    buildCache: number;
  };
  blockIO: {
    readBytes: number;
    writeBytes: number;
  };
  networkIO: {
    inBytes: number;
    outBytes: number;
  };
};

type CommandResult = { ok: boolean; output: string };

function runCommand(command: string, args: string[], timeoutMs = 15000): Promise<CommandResult> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveCommand(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, output });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => finish({ ok: false, output }));
    child.on("close", (code) => finish({ ok: code === 0, output }));
  });
}

function parseSizeToBytes(value: string): number {
  const token = value.trim().split(/\s+/)[0]?.replace(/,/g, "") ?? "";
  const match = token.match(/^([\d.]+)\s*([a-z]+)?$/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;

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

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

async function sampleCpuUsage(sampleMs = 250): Promise<number> {
  const start = cpuTimes();
  await new Promise((r) => setTimeout(r, sampleMs));
  const end = cpuTimes();

  const totalDelta = end.total - start.total;
  const idleDelta = end.idle - start.idle;
  if (totalDelta <= 0) return 0;

  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.min(100, Math.max(0, Math.round(usage * 100) / 100));
}

async function getDiskMetric(): Promise<MonitoringSnapshot["disk"]> {
  const result = await runCommand("df", ["-P", "-B1", "/"], 10000);
  if (!result.ok) return null;

  const lines = result.output.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return null;

  const parts = lines[1].trim().split(/\s+/);
  if (parts.length < 6) return null;

  const totalBytes = Number(parts[1]);
  const usedBytes = Number(parts[2]);
  if (![totalBytes, usedBytes].every(Number.isFinite)) return null;

  return { totalBytes, usedBytes, mount: parts.slice(5).join(" ") };
}

async function getDockerDiskMetric(): Promise<MonitoringSnapshot["docker"]> {
  const empty = { available: false, totalBytes: 0, images: 0, containers: 0, volumes: 0, buildCache: 0 };
  const result = await runCommand("docker", [
    "system",
    "df",
    "--format",
    "{{.Type}}\t{{.Size}}"
  ]);
  if (!result.ok) return empty;

  let images = 0;
  let containers = 0;
  let volumes = 0;
  let buildCache = 0;

  for (const line of result.output.split("\n")) {
    const [type, size] = line.split("\t");
    if (!type || !size) continue;
    const bytes = parseSizeToBytes(size);
    const normalized = type.trim().toLowerCase();
    if (normalized.startsWith("images")) images += bytes;
    else if (normalized.startsWith("containers")) containers += bytes;
    else if (normalized.startsWith("local volumes") || normalized.startsWith("volumes")) volumes += bytes;
    else if (normalized.startsWith("build cache")) buildCache += bytes;
  }

  return {
    available: true,
    images,
    containers,
    volumes,
    buildCache,
    totalBytes: images + containers + volumes + buildCache
  };
}

async function getContainerIO(): Promise<{ blockIO: MonitoringSnapshot["blockIO"]; networkIO: MonitoringSnapshot["networkIO"] }> {
  const result = await runCommand("docker", [
    "stats",
    "--no-stream",
    "--format",
    "{{.BlockIO}}\t{{.NetIO}}"
  ]);

  const blockIO = { readBytes: 0, writeBytes: 0 };
  const networkIO = { inBytes: 0, outBytes: 0 };
  if (!result.ok) return { blockIO, networkIO };

  for (const line of result.output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [block, net] = trimmed.split("\t");
    if (block) {
      const [read, write] = block.split("/");
      blockIO.readBytes += parseSizeToBytes(read ?? "");
      blockIO.writeBytes += parseSizeToBytes(write ?? "");
    }
    if (net) {
      const [rx, tx] = net.split("/");
      networkIO.inBytes += parseSizeToBytes(rx ?? "");
      networkIO.outBytes += parseSizeToBytes(tx ?? "");
    }
  }

  return { blockIO, networkIO };
}

export async function collectMonitoringSnapshot(): Promise<MonitoringSnapshot> {
  const [usagePercent, disk, docker, io] = await Promise.all([
    sampleCpuUsage(),
    getDiskMetric(),
    getDockerDiskMetric(),
    getContainerIO()
  ]);

  const total = totalmem();
  return {
    timestamp: new Date().toISOString(),
    cpu: { usagePercent, cores: cpus().length },
    memory: { usedBytes: total - freemem(), totalBytes: total },
    disk,
    docker,
    blockIO: io.blockIO,
    networkIO: io.networkIO
  };
}
