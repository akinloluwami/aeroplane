import type { Service } from "./schema.js";

function safeDockerIdentifier(value: string, fallback: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || fallback;
}

export function applicationDataVolumeName(serviceId: string) {
  return `aeroplane-app-data-${safeDockerIdentifier(serviceId, "service")}`;
}

export function applicationDataVolumeArg(serviceId: string, containerPath: string) {
  return `${applicationDataVolumeName(serviceId)}:${containerPath}`;
}

export function isValidApplicationVolumePath(value: string) {
  return value.startsWith("/")
    && value !== "/"
    && !value.includes(":")
    && !value.includes("\\")
    && value.split("/").slice(1).every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function applicationDataVolumeDockerArgs(service: Pick<Service, "id" | "persistentVolumePath">) {
  const containerPath = service.persistentVolumePath?.trim();
  return containerPath ? ["-v", applicationDataVolumeArg(service.id, containerPath)] : [];
}
