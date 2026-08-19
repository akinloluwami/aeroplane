import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db.js";
import { projectGroups, services, type Service } from "./schema.js";

type DockerCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type RunDocker = (args: string[]) => Promise<unknown>;
type RunBufferedDocker = (args: string[]) => Promise<DockerCommandResult>;
type RuntimeNetworkService = Pick<Service, "id" | "projectId" | "slug">;

type ContainerInspect = {
  State?: {
    Running?: boolean;
  };
  NetworkSettings?: {
    Networks?: Record<string, unknown>;
  };
};

type NetworkInspect = {
  Containers?: Record<string, unknown>;
};

const maxDockerNetworkNameLength = 63;
const runtimeNetworkManagedLabel = "aeroplane.runtime-network";
const runtimeNetworkProjectLabel = "aeroplane.project-id";

function safeDockerNetworkPart(value: string, fallback: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "") || fallback;
}

function compactDockerNetworkName(value: string) {
  if (value.length <= maxDockerNetworkNameLength) return value;

  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  const prefixLength = maxDockerNetworkNameLength - hash.length - 1;
  const prefix = value.slice(0, prefixLength).replace(/[_.-]+$/g, "") || "network";
  return `${prefix}-${hash}`;
}

export function runtimeNetworkNameForProject(projectId: string) {
  const baseName = safeDockerNetworkPart(config.runtimeNetworkName, "aeroplane-runtime");
  const projectName = safeDockerNetworkPart(projectId, "project");
  return compactDockerNetworkName(`${baseName}-${projectName}`);
}

export function runtimeNetworkNameForService(service: Pick<Service, "projectId">) {
  return runtimeNetworkNameForProject(service.projectId);
}

function runtimeNetworkNamePrefix() {
  const baseName = safeDockerNetworkPart(config.runtimeNetworkName, "aeroplane-runtime");
  const maxPrefixLength = maxDockerNetworkNameLength - 9;
  return `${baseName.slice(0, maxPrefixLength).replace(/[_.-]+$/g, "")}-`;
}

export function runtimeNetworkArgs(service: Pick<Service, "projectId" | "slug">) {
  return ["--network", runtimeNetworkNameForService(service), "--network-alias", service.slug];
}

function parseContainerInspect(stdout: string): ContainerInspect | null {
  try {
    const parsed = JSON.parse(stdout) as ContainerInspect[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function parseNetworkInspect(stdout: string): NetworkInspect | null {
  try {
    const parsed = JSON.parse(stdout) as NetworkInspect[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function isDockerAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

function isDockerAddressPoolExhaustedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /all predefined address pools have been fully subnetted/i.test(message);
}

function isDockerNetworkNotFound(detail: string) {
  return /no such network|network .* not found/i.test(detail);
}

function runtimeNetworkCreateArgs(service: RuntimeNetworkService) {
  return [
    "network",
    "create",
    "--label",
    `${runtimeNetworkManagedLabel}=true`,
    "--label",
    `${runtimeNetworkProjectLabel}=${service.projectId}`,
    runtimeNetworkNameForService(service)
  ];
}

async function cleanupOrphanedProjectRuntimeNetworks(runBufferedDocker: RunBufferedDocker, log?: (line: string) => void) {
  const knownNetworkNames = new Set(
    db.select({ id: projectGroups.id }).from(projectGroups).all().map((project) => runtimeNetworkNameForProject(project.id))
  );
  const listed = await runBufferedDocker(["network", "ls", "--format", "{{.Name}}"]);
  if (listed.code !== 0) {
    log?.(`Could not inspect Docker networks while recovering address space: ${(listed.stderr || listed.stdout).trim()}`);
    return 0;
  }

  const prefix = runtimeNetworkNamePrefix();
  const candidates = listed.stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name.startsWith(prefix) && !knownNetworkNames.has(name));
  let removed = 0;

  for (const networkName of candidates) {
    const inspected = await runBufferedDocker(["network", "inspect", networkName]);
    if (inspected.code !== 0) continue;

    const containers = parseNetworkInspect(inspected.stdout)?.Containers ?? {};
    if (Object.keys(containers).length > 0) {
      log?.(`Skipping orphaned Docker project runtime network ${networkName} because it still has attached containers.`);
      continue;
    }

    const removal = await runBufferedDocker(["network", "rm", networkName]);
    if (removal.code === 0) {
      removed += 1;
      log?.(`Removed orphaned Docker project runtime network ${networkName}.`);
    }
  }

  return removed;
}

export async function removeProjectRuntimeNetwork({
  projectId,
  runBufferedDocker
}: {
  projectId: string;
  runBufferedDocker: RunBufferedDocker;
}) {
  const networkName = runtimeNetworkNameForProject(projectId);
  const result = await runBufferedDocker(["network", "rm", networkName]);
  if (result.code === 0) return;

  const detail = (result.stderr || result.stdout || `docker network rm exited with ${result.code}`).trim();
  if (isDockerNetworkNotFound(detail)) return;
  throw new Error(`Could not remove Docker project runtime network ${networkName}: ${detail}`);
}

async function inspectContainer(containerName: string, runBufferedDocker: RunBufferedDocker) {
  const inspected = await runBufferedDocker(["inspect", containerName]);
  if (inspected.code !== 0) return null;
  return parseContainerInspect(inspected.stdout);
}

async function connectContainerToRuntimeNetwork({
  networkName,
  service,
  containerName,
  runDocker,
  runBufferedDocker,
  log
}: {
  networkName: string;
  service: RuntimeNetworkService;
  containerName: string;
  runDocker: RunDocker;
  runBufferedDocker: RunBufferedDocker;
  log?: (line: string) => void;
}) {
  const container = await inspectContainer(containerName, runBufferedDocker);
  if (!container?.State?.Running) return;

  const networks = container.NetworkSettings?.Networks ?? {};
  if (networks[networkName]) return;

  try {
    await runDocker(["network", "connect", "--alias", service.slug, networkName, containerName]);
    log?.(`Connected existing container ${containerName} to project runtime network ${networkName}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Docker network connect failed";
    log?.(`Could not connect existing container ${containerName} to project runtime network ${networkName}: ${message}`);
  }
}

async function connectProjectContainersToRuntimeNetwork({
  projectId,
  networkName,
  containerNameForService,
  runDocker,
  runBufferedDocker,
  log
}: {
  projectId: string;
  networkName: string;
  containerNameForService: (serviceId: string) => string;
  runDocker: RunDocker;
  runBufferedDocker: RunBufferedDocker;
  log?: (line: string) => void;
}) {
  const projectServices = db.select().from(services).where(eq(services.projectId, projectId)).all();
  for (const projectService of projectServices) {
    await connectContainerToRuntimeNetwork({
      networkName,
      service: projectService,
      containerName: containerNameForService(projectService.id),
      runDocker,
      runBufferedDocker,
      log
    });
  }
}

export async function ensureProjectRuntimeNetwork({
  service,
  containerNameForService,
  runDocker,
  runBufferedDocker,
  log
}: {
  service: RuntimeNetworkService;
  containerNameForService: (serviceId: string) => string;
  runDocker: RunDocker;
  runBufferedDocker: RunBufferedDocker;
  log?: (line: string) => void;
}) {
  const networkName = runtimeNetworkNameForService(service);
  const existing = await runBufferedDocker(["network", "inspect", networkName]);
  if (existing.code !== 0) {
    log?.(`Creating Docker project runtime network ${networkName}.`);
    try {
      await runDocker(runtimeNetworkCreateArgs(service));
    } catch (error) {
      if (isDockerAlreadyExistsError(error)) {
        log?.(`Docker project runtime network ${networkName} already exists.`);
      } else if (isDockerAddressPoolExhaustedError(error)) {
        log?.("Docker network address pools are exhausted. Looking for orphaned Aeroplane project networks...");
        const removed = await cleanupOrphanedProjectRuntimeNetworks(runBufferedDocker, log);
        if (removed === 0) throw error;
        log?.(`Freed ${removed} orphaned Docker project network${removed === 1 ? "" : "s"}; retrying network creation.`);
        await runDocker(runtimeNetworkCreateArgs(service));
      } else {
        throw error;
      }
    }
  }

  await connectProjectContainersToRuntimeNetwork({
    projectId: service.projectId,
    networkName,
    containerNameForService,
    runDocker,
    runBufferedDocker,
    log
  });

  return networkName;
}
