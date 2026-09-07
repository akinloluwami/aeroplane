import type { MaintenanceCleanupTarget, SystemMaintenanceInfo } from "../../api";
import { formatBytes } from "../../lib/format";

export const safeCleanupTargets = [
  "docker-containers",
  "docker-networks",
  "docker-images",
  "docker-build-cache",
  "apt-cache",
  "journals",
  "build-artifacts"
] satisfies MaintenanceCleanupTarget[];

export function diskTone(percent: number) {
  if (percent >= 90) return "rose" as const;
  if (percent >= 80) return "amber" as const;
  return "teal" as const;
}

export function healthLabel(info: SystemMaintenanceInfo | null) {
  if (!info) return "Not checked";
  if (info.alerts.length > 0) return `${info.alerts.length} issue${info.alerts.length === 1 ? "" : "s"}`;
  return "Healthy";
}

export function pathMetric(info: SystemMaintenanceInfo | null, id: string) {
  return info?.paths.find((item) => item.id === id) ?? null;
}

export function dockerReclaimablePercent(info: SystemMaintenanceInfo | null) {
  if (!info?.disk) return 0;
  return Math.min(100, ((info.docker.reclaimableBytes || 0) / info.disk.totalBytes) * 100);
}

export function topDockerReclaimableRow(info: SystemMaintenanceInfo | null) {
  return [...(info?.docker.rows ?? [])]
    .filter((row) => (row.reclaimableBytes ?? 0) > 0)
    .sort((left, right) => (right.reclaimableBytes ?? 0) - (left.reclaimableBytes ?? 0))[0] ?? null;
}

export function dockerReclaimableDetail(info: SystemMaintenanceInfo | null) {
  if (!info?.docker.available) {
    return info?.docker.error ?? "Docker metrics unavailable.";
  }

  const topRow = topDockerReclaimableRow(info);
  if (!topRow) {
    return "Docker is not reporting any cleanup candidates right now.";
  }

  const amount = formatBytes(topRow.reclaimableBytes);
  const rowType = topRow.type.toLowerCase();

  if (rowType.includes("image")) {
    return `${amount} is image/layer data. Safe cleanup may leave layers that current services still reference.`;
  }

  if (rowType.includes("volume")) {
    return `${amount} is volume data. Volume cleanup is separate because persistent service or database data can live there.`;
  }

  if (rowType.includes("build")) {
    return `${amount} is build cache. Safe cleanup can usually clear that.`;
  }

  return `${amount} is from ${topRow.type.toLowerCase()}.`;
}
