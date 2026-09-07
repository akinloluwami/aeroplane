import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db.js";
import { services, type Service } from "./schema.js";

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

const maxDockerNetworkNameLength = 63;
const managedNetworkLabel = "io.aeroplane.managed=true";
const projectNetworkLabel = "io.aeroplane.project";
const projectNetworkSecondOctetStart = 64;
const projectNetworkSecondOctetCount = 64;
const projectNetworkCreationAttempts = 256;

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

export function runtimeNetworkArgs(service: Pick<Service, "projectId" | "slug">) {
  return ["--network", runtimeNetworkNameForService(service), "--network-alias", service.slug];
}

export function removeProjectRuntimeNetwork(projectId: string) {
  const networkName = runtimeNetworkNameForProject(projectId);
  return new Promise<void>((resolvePromise) => {
    const child = spawn("docker", ["network", "rm", networkName], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let errorOutput = "";

    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.on("error", () => resolvePromise());
    child.on("close", (code) => {
      if (code !== 0 && !/not found|no such network/i.test(errorOutput)) {
        console.warn(`Could not remove Docker project runtime network ${networkName}: ${errorOutput.trim()}`);
      }
      resolvePromise();
    });
  });
}

function parseContainerInspect(stdout: string): ContainerInspect | null {
  try {
    const parsed = JSON.parse(stdout) as ContainerInspect[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function isDockerAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

function isDockerSubnetConflictError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /pool overlaps|address.*already in use|overlap.*address space/i.test(message);
}

function projectNetworkSubnet(projectId: string, attempt: number) {
  const subnetCount = projectNetworkSecondOctetCount * 256;
  const seed = createHash("sha256").update(projectId).digest().readUInt16BE(0);
  const subnetIndex = (seed + attempt) % subnetCount;
  const secondOctet = projectNetworkSecondOctetStart + Math.floor(subnetIndex / 256);
  const thirdOctet = subnetIndex % 256;
  return `10.${secondOctet}.${thirdOctet}.0/24`;
}

async function createProjectRuntimeNetwork(service: RuntimeNetworkService, networkName: string, runDocker: RunDocker) {
  let lastConflict: unknown = null;

  for (let attempt = 0; attempt < projectNetworkCreationAttempts; attempt += 1) {
    try {
      await runDocker([
        "network",
        "create",
        "--driver",
        "bridge",
        "--subnet",
        projectNetworkSubnet(service.projectId, attempt),
        "--label",
        managedNetworkLabel,
        "--label",
        `${projectNetworkLabel}=${service.projectId}`,
        networkName
      ]);
      return;
    } catch (error) {
      if (!isDockerSubnetConflictError(error)) throw error;
      lastConflict = error;
    }
  }

  throw lastConflict ?? new Error(`Could not allocate a private subnet for ${networkName}`);
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
      // Explicit /24s avoid Docker's large automatic subnets and continue working when its default pools are exhausted.
      await createProjectRuntimeNetwork(service, networkName, runDocker);
    } catch (error) {
      if (!isDockerAlreadyExistsError(error)) {
        throw error;
      }
      log?.(`Docker project runtime network ${networkName} already exists.`);
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
