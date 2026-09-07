import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, nowIso } from "./db.js";
import { services, envVars, projectGroups } from "./schema.js";
import { allocateHostPort } from "./deploy.js";
import { writeAndReloadCaddy } from "./caddy.js";
import { buildDatabaseConnectionUrl, defaultDatabasePort, generateDatabaseHostname, generatedDatabaseEnvVars, normalizeDatabaseType } from "./database-urls.js";
import { linkProjectAppDatabaseConnectionEnv, syncProjectDatabaseConnectionEnv } from "./database-service-linker.js";
import { initializeDatabaseBackupSettings } from "./database-backups.js";
import { isPostgresFamilyDatabase } from "./database-engine.js";
import { ensureDefaultDomainForService } from "./service-domains.js";
import { recordServiceImportSource } from "./service-import-sources.js";
import { getSystemSettings } from "./system-settings.js";
import { fetchRailwayGraphQL } from "./railway-graphql.js";
import { getRailwayServiceDomainInfo, importRailwayCustomDomains, railwayServiceTargetPort, type RailwayServiceDomainInfo } from "./railway-custom-domains.js";
import { DOCKER_IMAGE_REPO_URL, dockerImageRepoFullName, validateDockerImageReference } from "../shared/service-source.js";
import { createDefaultProjectEnvironments } from "./project-environments.js";

type GraphQLTypeRef = {
  kind?: string | null;
  name?: string | null;
  ofType?: GraphQLTypeRef | null;
};

type GraphQLField = {
  name: string;
  type?: GraphQLTypeRef | null;
};

type RailwayServiceSourceInfo = {
  repo?: string;
  image?: string;
  sourceType?: string;
  rootDirectory?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  staticOutput?: string;
};

type RailwayServiceKind = "git" | "database" | "docker-image" | "unsupported";

type RailwayServiceClassification = {
  kind: RailwayServiceKind;
  repoUrl?: string;
  repoFullName?: string;
  image?: string;
  dbType?: string;
  internalPort?: number;
  sourceLabel: string;
  unsupportedReason?: string;
};

type RailwayEnvironmentPreview = {
  id: string;
  name: string;
};

const optionalServiceInstanceFields = [
  "installCommand",
  "staticOutput",
  "outputDirectory",
  "publishDirectory"
] as const;

function unwrapGraphQLType(type?: GraphQLTypeRef | null): GraphQLTypeRef | null {
  let current = type ?? null;
  while (current?.ofType) {
    current = current.ofType;
  }
  return current;
}

function isScalarGraphQLField(field: GraphQLField) {
  const type = unwrapGraphQLType(field.type);
  return type?.kind === "SCALAR" || type?.kind === "ENUM";
}

async function getServiceInstanceFieldSet(token: string) {
  const query = `
    query ServiceInstanceFields {
      __type(name: "ServiceInstance") {
        fields {
          name
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  `;

  try {
    const data = await fetchRailwayGraphQL(token, query);
    const fields = (data?.__type?.fields ?? []) as GraphQLField[];
    return new Set(fields.filter(isScalarGraphQLField).map((field) => field.name));
  } catch {
    return new Set<string>();
  }
}

function optionalServiceInstanceSelection(fieldSet: Set<string>) {
  return optionalServiceInstanceFields
    .filter((field) => fieldSet.has(field))
    .map((field) => `                    ${field}`)
    .join("\n");
}

function cleanOptionalString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function firstOptionalString(node: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanOptionalString(node[key]);
    if (value) return value;
  }
  return undefined;
}

function numericPort(value: unknown) {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port;
  }
  return null;
}

function normalizedGitRepo(value: string) {
  const repoFullName = value.replace("https://github.com/", "").replace(/\.git$/, "");
  const repoUrl = value.startsWith("http") ? value : `https://github.com/${value}`;
  return { repoFullName, repoUrl };
}

function dockerImagePathParts(image: string) {
  const withoutDigest = image.trim().toLowerCase().split("@")[0] ?? "";
  const slashIndex = withoutDigest.lastIndexOf("/");
  const withoutTag = slashIndex >= 0
    ? `${withoutDigest.slice(0, slashIndex + 1)}${withoutDigest.slice(slashIndex + 1).replace(/:[^:]+$/, "")}`
    : withoutDigest.replace(/:[^:]+$/, "");
  const parts = withoutTag.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  if (first.includes(".") || first.includes(":") || first === "localhost") {
    return parts.slice(1);
  }
  return parts;
}

function databaseTypeFromImage(image: string) {
  const parts = dockerImagePathParts(image);
  const name = parts.at(-1) ?? "";
  const path = parts.join("/");

  if (!name) return null;
  if (path.includes("timescale/timescaledb") || name.includes("timescaledb") || name.includes("timescale")) return "timescale";
  if (path === "postgis/postgis" || name === "postgres" || name.startsWith("postgres-") || name.includes("postgresql")) return "postgres";
  if (name === "mysql" || name.startsWith("mysql-") || name === "mariadb" || name.startsWith("mariadb-")) return "mysql";
  if (name === "redis" || name.startsWith("redis-")) return "redis";
  if (name === "mongo" || name === "mongodb" || name.startsWith("mongo-") || name.startsWith("mongodb-")) return "mongodb";
  if (path.includes("clickhouse/clickhouse-server") || name === "clickhouse" || name === "clickhouse-server") return "clickhouse";
  return null;
}

function databaseTypeFromName(name: string) {
  const lowercaseName = name.toLowerCase();
  if (
    lowercaseName.includes("timescale") ||
    lowercaseName.includes("postgres") ||
    lowercaseName.includes("mysql") ||
    lowercaseName.includes("redis") ||
    lowercaseName.includes("mongo") ||
    lowercaseName.includes("clickhouse")
  ) {
    return normalizeDatabaseType(lowercaseName);
  }
  return null;
}

function classifyRailwayServiceSource(serviceName: string, sourceInfo?: RailwayServiceSourceInfo, trigger?: { repository?: string | null }): RailwayServiceClassification {
  if (trigger?.repository) {
    const git = normalizedGitRepo(trigger.repository);
    return {
      kind: "git",
      ...git,
      sourceLabel: git.repoFullName
    };
  }

  if (sourceInfo?.repo) {
    const git = normalizedGitRepo(sourceInfo.repo);
    return {
      kind: "git",
      ...git,
      sourceLabel: git.repoFullName
    };
  }

  if (sourceInfo?.image) {
    const validation = validateDockerImageReference(sourceInfo.image);
    if (!validation.ok) {
      return {
        kind: "unsupported",
        sourceLabel: sourceInfo.image,
        unsupportedReason: validation.error
      };
    }

    const dbType = databaseTypeFromImage(validation.image);
    if (dbType) {
      return {
        kind: "database",
        image: validation.image,
        dbType,
        repoUrl: "database",
        repoFullName: `database:${dbType}`,
        internalPort: defaultDatabasePort(dbType),
        sourceLabel: `${dbType} database image`
      };
    }

    return {
      kind: "docker-image",
      image: validation.image,
      repoUrl: DOCKER_IMAGE_REPO_URL,
      repoFullName: dockerImageRepoFullName(validation.image),
      sourceLabel: validation.image
    };
  }

  if (sourceInfo) {
    const sourceType = sourceInfo.sourceType ? ` (${sourceInfo.sourceType})` : "";
    return {
      kind: "unsupported",
      sourceLabel: `Unsupported Railway source${sourceType}`,
      unsupportedReason: "This Railway service is not backed by a Git repository or Docker image source Aeroplane can import yet."
    };
  }

  const dbType = databaseTypeFromName(serviceName);
  if (dbType) {
    return {
      kind: "database",
      dbType,
      repoUrl: "database",
      repoFullName: `database:${dbType}`,
      internalPort: defaultDatabasePort(dbType),
      sourceLabel: `${dbType} database`
    };
  }

  return {
    kind: "unsupported",
    sourceLabel: "Unsupported source",
    unsupportedReason: "This Railway service does not expose a Git repository or Docker image source Aeroplane can import yet."
  };
}

export async function getRailwayProjects(token: string) {
  const query = `
    query GetRailwayProjects {
      projects {
        edges {
          node {
            id
            name
            description
            services {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await fetchRailwayGraphQL(token, query);
  const edges = data?.projects?.edges ?? [];
  
  return edges.map((edge: any) => {
    const node = edge.node;
    const servicesEdges = node.services?.edges ?? [];
    return {
      id: node.id,
      name: node.name,
      description: node.description ?? "",
      serviceCount: servicesEdges.length
    };
  });
}

export async function getRailwayProjectDetails(token: string, railwayProjectId: string) {
  const query = `
    query GetRailwayProjectDetails($id: String!) {
      project(id: $id) {
        id
        name
        description
        services {
          edges {
            node {
              id
              name
              repoTriggers {
                edges {
                  node {
                    repository
                    branch
                  }
                }
              }
            }
          }
        }
        environments {
          edges {
            node {
              id
              name
              serviceInstances {
                edges {
                  node {
                    serviceId
                    source {
                      __typename
                      repo
                      image
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await fetchRailwayGraphQL(token, query, { id: railwayProjectId });
  const project = data?.project;
  if (!project) {
    throw new Error("Railway project not found");
  }

  const environments: RailwayEnvironmentPreview[] = (project.environments?.edges ?? []).map((e: any) => ({
    id: e.node.id,
    name: e.node.name
  }));
  const firstEnvironmentId = environments[0]?.id ?? "";
  const sourcesByEnvironment = new Map<string, Map<string, RailwayServiceSourceInfo>>();
  for (const envEdge of project.environments?.edges ?? []) {
    const envNode = envEdge?.node;
    if (!envNode?.id) continue;
    const sourceMap = new Map<string, RailwayServiceSourceInfo>();
    for (const instanceEdge of envNode.serviceInstances?.edges ?? []) {
      const instanceNode = instanceEdge?.node;
      if (!instanceNode?.serviceId) continue;
      sourceMap.set(instanceNode.serviceId, {
        repo: instanceNode.source?.repo || undefined,
        image: instanceNode.source?.image || undefined,
        sourceType: instanceNode.source?.__typename || undefined
      });
    }
    sourcesByEnvironment.set(envNode.id, sourceMap);
  }

  const services = (project.services?.edges ?? []).map((e: any) => {
    const serviceNode = e.node;
    const trigger = serviceNode.repoTriggers?.edges?.[0]?.node;
    const classifications = Object.fromEntries(
      environments.map((environment) => {
        const classification = classifyRailwayServiceSource(
          serviceNode.name,
          sourcesByEnvironment.get(environment.id)?.get(serviceNode.id),
          trigger
        );
        return [
          environment.id,
          {
            kind: classification.kind,
            sourceLabel: classification.sourceLabel,
            unsupportedReason: classification.unsupportedReason ?? null,
            dbType: classification.dbType ?? null,
            image: classification.image ?? null
          }
        ];
      })
    );
    const defaultClassification = classifications[firstEnvironmentId] ?? {
      kind: "unsupported",
      sourceLabel: "Unsupported source",
      unsupportedReason: "No Railway environment source was found.",
      dbType: null,
      image: null
    };

    return {
      id: serviceNode.id,
      name: serviceNode.name,
      ...defaultClassification,
      sourcesByEnvironment: classifications
    };
  });

  return {
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    services,
    environments
  };
}

export async function getRailwayServiceVariables(token: string, projectId: string, environmentId: string, serviceId: string) {
  const query = `
    query GetVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `;
  const data = await fetchRailwayGraphQL(token, query, { projectId, environmentId, serviceId });
  return (data?.variables ?? {}) as Record<string, string>;
}

export async function getRailwayServiceDeploymentVariables(token: string, projectId: string, environmentId: string, serviceId: string) {
  const query = `
    query GetDeploymentVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variablesForServiceDeployment(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `;
  const data = await fetchRailwayGraphQL(token, query, { projectId, environmentId, serviceId });
  return (data?.variablesForServiceDeployment ?? {}) as Record<string, string>;
}

export interface ImportConfig {
  environmentId?: string;
  excludeRailwayVars?: boolean;
  importDatabases?: boolean;
  autoDeploy?: boolean;
  importDatabaseData?: boolean;
  selectedServiceIds?: string[];
}

export async function importRailwayProject(token: string, railwayProjectId: string, config: ImportConfig, options: { ownerUserId: string }) {
  const serviceInstanceFields = await getServiceInstanceFieldSet(token);
  const serviceInstanceCommandSelection = optionalServiceInstanceSelection(serviceInstanceFields);
  const projectQuery = `
    query GetRailwayProjectDetails($id: String!) {
      project(id: $id) {
        id
        name
        description
        services {
          edges {
            node {
              id
              name
              repoTriggers {
                edges {
                  node {
                    repository
                    branch
                  }
                }
              }
            }
          }
        }
        environments {
          edges {
            node {
              id
              name
              serviceInstances {
                edges {
                  node {
                    serviceId
                    source {
                      __typename
                      repo
                      image
                    }
                    rootDirectory
                    buildCommand
                    startCommand
${serviceInstanceCommandSelection}
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const projectData = await fetchRailwayGraphQL(token, projectQuery, { id: railwayProjectId });
  const rProject = projectData?.project;
  if (!rProject) {
    throw new Error("Railway project not found or token has insufficient permissions");
  }

  const servicesEdges = rProject.services?.edges ?? [];
  const environmentEdges = rProject.environments?.edges ?? [];
  
  // Use target environment if provided, otherwise default to first environment
  const targetEnvNode = config.environmentId
    ? environmentEdges.find((e: any) => e.node?.id === config.environmentId)?.node || environmentEdges[0]?.node
    : environmentEdges[0]?.node;
  const targetEnvId = targetEnvNode?.id;
  const targetEnvName = targetEnvNode?.name;

  // Build serviceSourceMap from serviceInstances of the target environment
  const serviceSourceMap = new Map<string, RailwayServiceSourceInfo>();
  if (targetEnvNode) {
    const instancesEdges = targetEnvNode.serviceInstances?.edges ?? [];
    for (const edge of instancesEdges) {
      const node = edge?.node;
      if (node && node.serviceId) {
        serviceSourceMap.set(node.serviceId, {
          repo: node.source?.repo || undefined,
          image: node.source?.image || undefined,
          sourceType: node.source?.__typename || undefined,
          rootDirectory: cleanOptionalString(node.rootDirectory),
          installCommand: cleanOptionalString(node.installCommand),
          buildCommand: cleanOptionalString(node.buildCommand),
          startCommand: cleanOptionalString(node.startCommand),
          staticOutput: firstOptionalString(node, ["staticOutput", "outputDirectory", "publishDirectory"])
        });
      }
    }
  }

  const timestamp = nowIso();
  const projectGroupId = nanoid(10);
  const importedServices: Array<{
    id: string;
    railwayServiceId: string;
    name: string;
    isDatabase: boolean;
    isDockerImage: boolean;
    dbType: string | null;
  }> = [];
  let importedCustomDomainCount = 0;
  
  // Create project slug
  const baseSlug = rProject.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  let projectSlug = baseSlug;
  let counter = 1;
  while (db.select().from(projectGroups).where(eq(projectGroups.slug, projectSlug)).get()) {
    projectSlug = `${baseSlug}-${counter++}`;
  }

  // Create Project Group
  db.insert(projectGroups).values({
    id: projectGroupId,
    ownerUserId: options.ownerUserId,
    name: rProject.name,
    slug: projectSlug,
    description: rProject.description ?? null,
    createdAt: timestamp,
    updatedAt: timestamp
  }).run();
  const { defaultEnvironment } = createDefaultProjectEnvironments(projectGroupId, timestamp);

  for (const edge of servicesEdges) {
    const sNode = edge.node;
    const serviceName = sNode.name;
    const serviceId = sNode.id;

    // Filter services based on selection
    if (config.selectedServiceIds && !config.selectedServiceIds.includes(serviceId)) {
      continue;
    }

    let repoUrl = "";
    let repoFullName = "";
    let branch = "main";
    let internalPort = 8080;
    let isDatabase = false;
    let isDockerImage = false;

    let rootDir: string | null = null;
    let installCommand: string | null = null;
    let buildCommand: string | null = null;
    let startCommand: string | null = null;
    let staticOutput: string | null = null;
    let railwayDomainInfo: RailwayServiceDomainInfo | null = null;
    let railwayTargetPort: number | null = null;

    // 1. Resolve from repoTriggers if available
    const triggersEdges = sNode.repoTriggers?.edges ?? [];
    const firstTrigger = triggersEdges[0]?.node;
    if (firstTrigger) {
      branch = firstTrigger.branch || "main";
    }

    // 2. Resolve from serviceSourceMap (fallback for repo, or container image details)
    const sourceInfo = serviceSourceMap.get(serviceId);
    if (sourceInfo) {
      if (sourceInfo.rootDirectory) {
        rootDir = sourceInfo.rootDirectory;
      }
      installCommand = sourceInfo.installCommand ?? null;
      buildCommand = sourceInfo.buildCommand ?? null;
      startCommand = sourceInfo.startCommand ?? null;
      staticOutput = sourceInfo.staticOutput ?? null;
    }

    const classification = classifyRailwayServiceSource(serviceName, sourceInfo, firstTrigger);
    if (classification.kind === "unsupported") {
      continue;
    }
    if (classification.kind === "database" && config.importDatabases === false) {
      continue;
    }
    isDatabase = classification.kind === "database";
    isDockerImage = classification.kind === "docker-image";
    repoUrl = classification.repoUrl ?? "";
    repoFullName = classification.repoFullName ?? "";
    internalPort = classification.internalPort ?? internalPort;

    if (!isDatabase && targetEnvId) {
      try {
        railwayDomainInfo = await getRailwayServiceDomainInfo(token, railwayProjectId, targetEnvId, serviceId);
        railwayTargetPort = railwayServiceTargetPort(railwayDomainInfo);
        if (railwayTargetPort) {
          internalPort = railwayTargetPort;
        }
      } catch {
        // Railway domain metadata is useful for target ports and custom domains, but not required.
      }
    }

    // Database imports are recreated with fresh Aeroplane-managed credentials.
    // Railway variables often point at Railway-only hosts and should not be copied.
    let fetchedVars: Record<string, string> = isDatabase
      ? generatedDatabaseEnvVars(repoFullName.split(":")[1] || "postgres")
      : {};
    let deploymentVars: Record<string, string> = {};
    if (!isDatabase && targetEnvId) {
      try {
        fetchedVars = await getRailwayServiceVariables(token, railwayProjectId, targetEnvId, serviceId);
      } catch {
        // Fallback to empty variables if query fails
      }
      try {
        deploymentVars = await getRailwayServiceDeploymentVariables(token, railwayProjectId, targetEnvId, serviceId);
        fetchedVars = { ...fetchedVars, ...deploymentVars };
      } catch {
        // Runtime/deployment variables are best-effort; service variables still cover user-defined values.
      }
    }

    if (!isDatabase && !railwayTargetPort) {
      const envPort = numericPort(deploymentVars.PORT ?? fetchedVars.PORT);
      if (envPort) {
        internalPort = envPort;
      }
    }

    // Create unique service slug
    const baseServiceSlug = serviceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "service";
    let serviceSlug = baseServiceSlug;
    let sCounter = 1;
    while (db.select().from(services).where(eq(services.slug, serviceSlug)).get()) {
      serviceSlug = `${baseServiceSlug}-${sCounter++}`;
    }

    const hostPort = allocateHostPort();
    const targetServiceId = nanoid(10);
    const databasePublicHostname = isDatabase
      ? generateDatabaseHostname(serviceSlug, getSystemSettings().rootDomain) || null
      : null;

    // Insert Service
    db.insert(services).values({
      id: targetServiceId,
      projectId: projectGroupId,
      environmentId: defaultEnvironment.id,
      slug: serviceSlug,
      name: serviceName,
      repoFullName: repoFullName || null,
      repoUrl,
      branch,
      rootDir,
      githubToken: null,
      webhookSecret: nanoid(24),
      installCommand: isDatabase || isDockerImage ? null : installCommand,
      buildCommand: isDatabase || isDockerImage ? null : buildCommand,
      startCommand: isDatabase || isDockerImage ? null : startCommand,
      staticOutput: isDatabase || isDockerImage ? null : staticOutput,
      runtimeMode: "web",
      internalPort,
      hostPort,
      activePort: null,
      databasePublicEnabled: isDatabase,
      databasePublicHostname,
      postgresLogicalReplicationEnabled: isDatabase && isPostgresFamilyDatabase(repoFullName.split(":")[1] || "postgres"),
      status: "idle",
      lastDeployedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }).run();

    if (isDatabase) {
      initializeDatabaseBackupSettings(targetServiceId);
    }

    const createdService = db.select().from(services).where(eq(services.id, targetServiceId)).get();
    if (createdService) {
      ensureDefaultDomainForService(createdService);
      if (!isDatabase) {
        try {
          const importedDomains = await importRailwayCustomDomains({
            token,
            projectId: railwayProjectId,
            environmentId: targetEnvId,
            railwayServiceId: serviceId,
            targetServiceId,
            domainInfo: railwayDomainInfo
          });
          importedCustomDomainCount += importedDomains.length;
        } catch {
          // Domain import should not block service migration.
        }
      }
    }

    recordServiceImportSource({
      serviceId: targetServiceId,
      provider: "railway",
      externalProjectId: railwayProjectId,
      externalEnvironmentId: targetEnvId ?? null,
      externalServiceId: serviceId,
      externalServiceName: serviceName,
      metadata: {
        projectName: rProject.name,
        environmentName: targetEnvName ?? null,
        sourceKind: classification.kind,
        sourceRepo: sourceInfo?.repo ?? null,
        sourceImage: sourceInfo?.image ?? null
      }
    });

    const variablesToInsert = { ...fetchedVars };
    if (isDatabase) {
      const dbType = repoFullName.split(":")[1] || "postgres";
      const envMap = new Map(Object.entries(fetchedVars));
      const connectionUrl = buildDatabaseConnectionUrl({
        dbType,
        envMap,
        host: serviceSlug,
        port: internalPort
      });
      variablesToInsert[connectionUrl.key] = connectionUrl.value;
    }

    // Insert app variables or generated database credentials
    for (const [key, value] of Object.entries(variablesToInsert)) {
      if (config.excludeRailwayVars && key.startsWith("RAILWAY_")) {
        continue; // Filter out system vars
      }
      db.insert(envVars).values({
        id: nanoid(10),
        serviceId: targetServiceId,
        key,
        value,
        createdAt: timestamp,
        updatedAt: timestamp
      }).run();
    }

    importedServices.push({
      id: targetServiceId,
      railwayServiceId: serviceId,
      name: serviceName,
      isDatabase,
      isDockerImage,
      dbType: isDatabase ? repoFullName.split(":")[1] || "postgres" : null
    });
  }

  const databaseSync = syncProjectDatabaseConnectionEnv(projectGroupId);
  const appEnvLinks = linkProjectAppDatabaseConnectionEnv(projectGroupId);

  // Trigger Caddy reload to map services
  await writeAndReloadCaddy();

  return {
    projectId: projectGroupId,
    projectSlug,
    services: importedServices,
    databaseServiceIds: importedServices.filter((service) => service.isDatabase).map((service) => service.id),
    appServiceIds: importedServices.filter((service) => !service.isDatabase).map((service) => service.id),
    importedCustomDomainCount,
    linkedDatabaseVariables: appEnvLinks.linked,
    syncedDatabaseVariables: databaseSync.synced
  };
}
