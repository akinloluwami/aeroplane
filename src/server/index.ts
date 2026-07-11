import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import dns from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { isPostgresFamilyDatabase } from "./database-engine.js";
import { abortDeployment, allocateHostPort, containerNameForService, enqueueDeployment, getServiceById, removeServiceRuntime, startDeployWorker, staticSiteDirForService } from "./deploy.js";
import { db, nowIso } from "./db.js";
import { normalizeServiceBuildMethod, serviceBuildMethods } from "./dockerfile-build.js";
import { detectFramework, detectFrameworkPreview, frameworkMetaForSlug } from "./frameworks.js";
import { frameworkIconAsset, frameworkIconUrl, prewarmFrameworkIconCache } from "./framework-icons.js";
import { DATABASE_ICON_CATALOG, FRAMEWORK_ICON_CATALOG } from "./framework-icon-catalog.js";
import { envExampleVariableSuggestions } from "./env-example-suggestions.js";
import { resolveServiceEnv } from "./variable-resolver.js";
import { getRailwayProjects, getRailwayProjectDetails, importRailwayProject } from "./railway-importer.js";
import { startRailwayImportAutomation } from "./railway-import-automation.js";
import { getVercelTeams, getVercelProjects, getVercelProjectDetails, importVercelProject } from "./vercel-importer.js";
import {
  buildGitHubAppManifest,
  convertGitHubManifestCode,
  filesInDirectory,
  githubConnectionStatus,
  listConnectedRepos,
  listRepoBranches,
  listRepoDirectories,
  repoUrlFromFullName
} from "./github-connect.js";
import { branchFromGitRef, verifyGitHubSignature } from "./github.js";
import { rateLimit } from "./rate-limit.js";
import { subscribeToDeploymentLogs } from "./logBus.js";
import {
  buildDatabaseConnectionUrl,
  databaseTypeForService,
  generateDatabaseHostname,
  isDatabaseService,
  publicDatabaseUrlKey,
  publicDatabaseUrlKeys
} from "./database-urls.js";
import {
  deploymentLogs,
  deployments,
  domains,
  envVars,
  projectGroups,
  services,
  users,
  type ProjectGroup,
  type Service
} from "./schema.js";
import { getSystemChecks } from "./system.js";
import { getSystemMaintenanceInfo, maintenanceCleanupTargets, runSystemMaintenanceCleanup } from "./system-maintenance.js";
import { writeAndReloadCaddy } from "./caddy.js";
import { databaseConnectionEnvSuggestionsForProject, databaseConnectionEnvSuggestionsForService, syncProjectDatabaseConnectionEnv } from "./database-service-linker.js";
import { createUniqueSlug } from "../shared/slug.js";
import {
  aiProviderIdValues,
  aiProviderName,
  defaultAiModel,
  isAiProviderModel,
  type AiProviderId
} from "../shared/ai-providers.js";
import {
  backupSchedulesEnabled,
  configuredControlPlaneHostname,
  getSystemSettings,
  normalizeDatabaseBackupScheduleDefaults,
  normalizeDeploymentConcurrency,
  publicDnsSettings,
  publicR2Settings,
  saveSystemSettings
} from "./system-settings.js";
import { applyDnsProviderARecord, dnsProviderName, dnsProviderSettings } from "./dns-providers.js";
import { getSystemUpdateInfo, startSystemUpdate } from "./system-updates.js";
import { ensureDefaultDomainForService, ensureDefaultDomainsForExistingServices, isGeneratedServiceHostname } from "./service-domains.js";
import { normalizeRootDomain } from "./root-domain.js";
import { ensureR2Bucket } from "./r2-storage.js";
import {
  authenticateUser,
  clearSession,
  createOwner,
  createSession,
  getCurrentUser,
  hasAuthUsers,
  publicUser,
  requireAuth
} from "./auth.js";
import { registerApiKeyRoutes } from "./api-key-routes.js";
import { registerBackupStorageRoutes } from "./backup-storage-routes.js";
import {
  actorUserId,
  canAccessProject,
  isOwnerSession,
  requireAllProjectsScope,
  requireApiMethodAccessMiddleware,
  requireOwnerSessionAccess,
  requireOwnerSessionAccessMiddleware,
  requireProjectAccess,
  requireServiceAccess,
  requireSessionAccessMiddleware
} from "./api-access-control.js";
import { registerSystemUserRoutes } from "./system-user-routes.js";
import { getUserAiSettings, publicUserAiSettings, publicUserR2Settings, saveUserAiSettings } from "./user-settings.js";
import { managedEnvPath, writeManagedEnv, writeManagedEnvPatch } from "./env-file.js";
import { generateSecretKey, hasSecretKey } from "./secret-crypto.js";
import {
  createDatabaseBackup,
  deleteDatabaseBackup,
  getDatabaseBackupFile,
  getDatabaseBackupSettings,
  initializeDatabaseBackupSettings,
  listDatabaseBackups,
  restoreDatabaseBackup,
  startDatabaseBackupScheduler,
  updateDatabaseBackupSettings
} from "./database-backups.js";
import {
  deleteDatabaseRow,
  getDatabaseRows,
  getDatabaseTables,
  insertDatabaseRow,
  runDatabaseQuery,
  updateDatabaseRow,
  type DatabaseRowFilter
} from "./database-console.js";
import { createMigrationBundle, importMigrationBundle } from "./migration-bundle.js";
import { importPostgresDataFromRailway, importPostgresDataFromUrl } from "./postgres-data-import.js";
import { importRedisDataFromRailway, importRedisDataFromUrl } from "./redis-data-import.js";
import { listDatabaseDataImports } from "./database-data-imports.js";
import { listServiceImportSources } from "./service-import-sources.js";
import { checkPostgresTlsActive, ensurePostgresTlsAssets, getPostgresTlsInfo } from "./postgres-tls.js";
import { DeploymentFailureExplanationError, explainDeploymentFailure } from "./deployment-failure-ai.js";
import { FunctionCodeGenerationError, generateFunctionSourceCode } from "./function-code-ai.js";
import {
  DOCKER_IMAGE_REPO_URL,
  dockerImageForService,
  dockerImageRepoFullName,
  isDockerImageService,
  validateDockerImageReference
} from "../shared/service-source.js";
import {
  FUNCTION_REPO_URL,
  functionRepoFullName,
  functionRuntimes,
  functionRuntimeForService,
  isFunctionService
} from "../shared/service-functions.js";
import { isWorkerService, normalizeServiceRuntimeMode, serviceRuntimeModes } from "../shared/service-runtime.js";
import { projectActivityTimestamp, sortProjectsByRecentActivity } from "./project-activity.js";
import {
  createServiceFunction,
  deleteServiceFunctionSource,
  functionRuntimeLabel,
  getServiceFunctionSource,
  updateServiceFunctionSource
} from "./service-functions.js";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

const optionalString = z.string().trim().optional().transform((value) => (value ? value : undefined));
const optionalCommand = z.string().trim().optional().transform((value) => {
  if (!value) return undefined;
  return value.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, "\"");
});
const clearableString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed || null;
}, z.string().nullable().optional());
const clearableCommand = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, "\"") : null;
}, z.string().nullable().optional());
const clearableRootDir = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed || null;
}, z.string().nullable().optional()).refine(
  (value) => value === undefined || value === null || !value.split("/").includes(".."),
  { message: "Invalid directory path" }
);
const optionalRootDir = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value.replace(/^\/+|\/+$/g, "") : undefined))
  .refine((value) => value === undefined || !value.split("/").includes(".."), { message: "Invalid directory path" });
const optionalDockerfilePath = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value.replace(/^\/+/, "") : undefined))
  .refine((value) => value === undefined || !value.split("/").includes(".."), { message: "Invalid Dockerfile path" });
const clearableDockerfilePath = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed || null;
}, z.string().nullable().optional()).refine(
  (value) => value === undefined || value === null || !value.split("/").includes(".."),
  { message: "Invalid Dockerfile path" }
);
const repoSchema = z.string().trim().min(1).refine((value) => {
  return value.startsWith("https://") || value.startsWith("git@") || value === "database" || value === DOCKER_IMAGE_REPO_URL || value === FUNCTION_REPO_URL;
}, {
  message: "Use an HTTPS Git URL, SSH Git URL, database, Docker image, or function source"
});
const repoFullNameSchema = z.string().trim().refine((value) => {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.startsWith("database:")) return true;
  if (value.startsWith("function:")) return functionRuntimes.includes(value.slice("function:".length) as (typeof functionRuntimes)[number]);
  if (!value.startsWith("image:")) return false;
  return validateDockerImageReference(value.slice("image:".length)).ok;
}, {
  message: "Choose a GitHub repository, database engine, Docker image, or function runtime"
});
const githubRepoFullNameSchema = z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Choose a GitHub repository");
const dockerImageSchema = z.string().trim().optional().superRefine((value, ctx) => {
  if (!value) return;
  const validation = validateDockerImageReference(value);
  if (!validation.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: validation.error
    });
  }
}).transform((value) => {
  if (!value) return undefined;
  const validation = validateDockerImageReference(value);
  return validation.ok ? validation.image : value;
});
const hostnameRegex = /^[a-z0-9.-]+\.[a-z]{2,}$|^[a-z0-9-]+\.localhost$/;
const publicHostnameSchema = z.preprocess((value) => {
  if (typeof value !== "string") return undefined;
  const hostname = value.trim().toLowerCase();
  return hostname || undefined;
}, z.string().regex(hostnameRegex, "Use a valid hostname like db.example.com").optional());
const serviceRuntimeModeSchema = z.enum(serviceRuntimeModes).default("web");

const serviceSettingsSchema = z.object({
  name: z.string().trim().min(1),
  repoFullName: repoFullNameSchema.nullish(),
  repoUrl: repoSchema.optional(),
  dockerImage: dockerImageSchema,
  branch: z.string().trim().min(1).default("main"),
  rootDir: optionalRootDir,
  githubToken: optionalString,
  installCommand: optionalCommand,
  buildCommand: optionalCommand,
  startCommand: optionalCommand,
  staticOutput: optionalString,
  buildMethod: z.enum(serviceBuildMethods).optional(),
  dockerfilePath: optionalDockerfilePath,
  runtimeMode: serviceRuntimeModeSchema,
  internalPort: z.coerce.number().int().min(1).max(65535).default(8080),
  databasePublicEnabled: z.boolean().optional().default(true),
  databasePublicHostname: publicHostnameSchema,
  postgresLogicalReplicationEnabled: z.boolean().optional().default(true),
  functionRuntime: z.enum(functionRuntimes).optional(),
  sourceCode: z.string().optional()
});

const createProjectSchema = z.object({
  name: z.string().trim().min(1),
  description: optionalString
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: optionalString.nullish()
});

const envSchema = z.object({ key: z.string().trim().regex(/^[A-Z_][A-Z0-9_]*$/i), value: z.string() });
const databaseRowValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const databaseRowSchema = z.record(z.string(), databaseRowValueSchema);
const databaseQuerySchema = z.object({ sql: z.string().trim().min(1) });
const databaseFilterOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "greater_than",
  "less_than"
]);
const databaseRowsFiltersSchema = z.array(z.object({
  column: z.string().trim().min(1),
  operator: databaseFilterOperatorSchema,
  value: z.string().default("")
})).max(12);
const databaseInsertSchema = z.object({
  table: z.string().trim().min(1),
  values: databaseRowSchema
});
const databaseUpdateSchema = z.object({
  table: z.string().trim().min(1),
  primaryKey: databaseRowSchema,
  values: databaseRowSchema
});
const databaseDeleteSchema = z.object({
  table: z.string().trim().min(1),
  primaryKey: databaseRowSchema
});
const backupCreateSchema = z.object({
  storage: z.enum(["disk", "r2", "disk+r2"]).optional()
});
const backupScheduleSettingsSchema = z.object({
  daily: z.boolean().optional(),
  weekly: z.boolean().optional(),
  monthly: z.boolean().optional()
});
const backupSettingsSchema = z.object({
  storage: z.enum(["disk", "r2", "disk+r2"]).optional(),
  automaticEnabled: z.boolean().optional(),
  scheduleEnabled: backupScheduleSettingsSchema.optional()
});
const postgresUrlImportSchema = z.object({
  sourceUrl: z.string().trim().min(1, "Postgres URL is required")
});
const redisUrlImportSchema = z.object({
  sourceUrl: z.string().trim().min(1, "Redis URL is required")
});
const railwayDataImportSchema = z.object({
  apiToken: z.string().trim().min(1, "Railway API token is required")
});
const migrationExportSchema = z.object({
  passphrase: z.string().min(8, "Use a migration passphrase with at least 8 characters.")
});
const maintenanceCleanupSchema = z.object({
  targets: z.array(z.enum(maintenanceCleanupTargets)).min(1).max(maintenanceCleanupTargets.length)
});
const r2ConnectionSchema = z.object({
  accountId: z.string().trim().min(1).transform((value) => value.toLowerCase()),
  bucket: z.string().trim().min(1).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i, "Use a valid R2 bucket name").transform((value) => value.toLowerCase()),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().min(1).optional(),
  createBucket: z.boolean().optional().default(true)
});
const aiProviderIdSchema = z.enum(aiProviderIdValues);
const aiProviderCredentialsSchema = z.object({
  apiKey: z.string().optional().default(""),
  selectedModel: z.string().trim().optional()
});
const aiSettingsSchema = z.object({
  defaultProvider: aiProviderIdSchema,
  defaultModel: z.string().trim().optional()
});
const deploymentFailureExplanationRequestSchema = z.object({
  providerId: aiProviderIdSchema.optional(),
  model: z.string().trim().optional()
});
const dnsProviderIdSchema = z.enum(["cloudflare", "namecheap", "spaceship"]);
const cloudflareDnsConnectionSchema = z.object({
  apiToken: z.string().optional().default(""),
  accountEmail: z.string().trim().optional().default(""),
  zoneId: z.string().trim().optional().default("")
});
const namecheapDnsConnectionSchema = z.object({
  apiUser: z.string().trim().optional().default(""),
  apiKey: z.string().optional().default(""),
  clientIp: z.string().trim().optional().default("")
});
const spaceshipDnsConnectionSchema = z.object({
  apiKey: z.string().optional().default(""),
  apiSecret: z.string().optional().default("")
});
const dnsRecordApplySchema = z.object({
  providerId: dnsProviderIdSchema
});
const githubSettingsSchema = z.object({
  githubAccessToken: z.string().optional().default(""),
  githubAppId: z.string().trim().optional().default(""),
  githubAppClientId: z.string().trim().optional().default(""),
  githubAppSlug: z.string().trim().optional().default(""),
  githubAppPrivateKey: z.string().optional().default(""),
  githubWebhookSecret: z.string().optional().default("")
});
const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});
const setupSchema = z.object({
  owner: z.object({
    name: z.string().trim().min(1),
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    password: z.string().min(8)
  }),
  env: z.object({
    secretKey: optionalString,
    dataDir: z.string().trim().min(1).default("./data"),
    deployDryRun: z.boolean().default(false),
    caddyConfigPath: z.string().trim().min(1).default("./data/Caddyfile"),
    caddyDataDir: z.string().trim().min(1).default("./data"),
    caddyReloadCmd: z.string().trim().min(1).default("caddy reload --config ./data/Caddyfile"),
    port: z.coerce.number().int().min(1).max(65535).default(4310),
    publicUrl: z.string().trim().min(1).default("http://localhost:5173"),
    controlPlaneHostname: publicHostnameSchema,
    buildkitHost: z.string().trim().min(1).default("tcp://127.0.0.1:1234"),
    runtimeNetworkName: z.string().trim().min(1).default("aeroplane-runtime"),
    githubAccessToken: optionalString,
    githubAppId: optionalString,
    githubAppClientId: optionalString,
    githubAppSlug: optionalString,
    githubAppPrivateKey: optionalString,
    githubWebhookSecret: optionalString
  }),
  rootDomain: optionalString,
  r2: z.object({
    accountId: optionalString,
    bucket: optionalString,
    accessKeyId: optionalString,
    secretAccessKey: optionalString,
    createBucket: z.boolean().default(true)
  }).optional(),
  databaseBackupScheduleDefaults: backupScheduleSettingsSchema.optional(),
  databaseBackupsAutomaticEnabled: z.boolean().optional()
});
const restartOnboardingSchema = setupSchema.pick({
  env: true,
  rootDomain: true,
  r2: true,
  databaseBackupScheduleDefaults: true,
  databaseBackupsAutomaticEnabled: true
});

const createServiceSchema = serviceSettingsSchema.extend({
  name: z.string().trim().min(1),
  env: z.array(envSchema).optional().default([])
}).superRefine((value, ctx) => {
  const isFunction = value.repoUrl === FUNCTION_REPO_URL || value.repoFullName?.startsWith("function:");
  if (isFunction) {
    if (!value.functionRuntime && !value.repoFullName?.startsWith("function:")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["functionRuntime"],
        message: "Function runtime is required"
      });
      return;
    }
    if (!value.sourceCode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceCode"],
        message: "Function source code is required"
      });
    }
    return;
  }

  const repoFullNameImage = value.repoFullName?.startsWith("image:") ? dockerImageForService({ repoFullName: value.repoFullName }) : "";
  if (value.repoUrl === DOCKER_IMAGE_REPO_URL && !value.dockerImage && !repoFullNameImage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dockerImage"],
      message: "Docker image is required"
    });
    return;
  }

  if (value.dockerImage || repoFullNameImage) return;
  if (value.repoFullName || value.repoUrl) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["repoUrl"],
    message: "Choose a GitHub repository, Git URL, database, Docker image, or function"
  });
});
const envExampleSuggestionsQuerySchema = z.object({
  repo: githubRepoFullNameSchema,
  branch: z.string().trim().min(1).default("main"),
  rootDir: optionalRootDir
});

const updateServiceSchema = z.object({
  name: z.string().trim().min(1).optional(),
  repoFullName: repoFullNameSchema.nullish(),
  repoUrl: repoSchema.nullish(),
  dockerImage: dockerImageSchema,
  branch: z.string().trim().min(1).optional(),
  rootDir: clearableRootDir,
  githubToken: optionalString.nullish(),
  installCommand: clearableCommand,
  buildCommand: clearableCommand,
  startCommand: clearableCommand,
  staticOutput: clearableString,
  buildMethod: z.enum(serviceBuildMethods).optional(),
  dockerfilePath: clearableDockerfilePath,
  runtimeMode: z.enum(serviceRuntimeModes).optional(),
  internalPort: z.coerce.number().int().min(1).max(65535).optional(),
  databasePublicEnabled: z.boolean().optional(),
  databasePublicHostname: publicHostnameSchema,
  postgresLogicalReplicationEnabled: z.boolean().optional()
});
const functionSourceUpdateSchema = z.object({
  runtime: z.enum(functionRuntimes).optional(),
  sourceCode: z.string().optional()
}).refine((value) => value.runtime !== undefined || value.sourceCode !== undefined, {
  message: "Nothing to update"
});
const functionCodeGenerationRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Describe what the function should do.").max(4000, "Keep the prompt under 4000 characters."),
  runtime: z.enum(functionRuntimes),
  sourceCode: z.string().optional(),
  providerId: aiProviderIdSchema.optional(),
  model: z.string().trim().optional()
});
const transferServiceSchema = z.object({
  targetProjectId: z.string().trim().min(1)
});

function parseDatabaseFilters(raw: string | undefined): DatabaseRowFilter[] {
  if (!raw) return [];
  const parsed = databaseRowsFiltersSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Invalid database filters");
  return parsed.data;
}
const domainSchema = z.object({
  hostname: z.string().trim().toLowerCase().regex(hostnameRegex)
});

const searchSchema = z.object({
  service: z.string().optional(),
  tab: z.enum(["deployments", "logs", "environment", "domains", "data", "sql", "backups", "settings"]).optional()
});

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizeEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function currentRuntimeConfig() {
  return {
    dataDir: resolve(process.env.DATA_DIR ?? config.dataDir),
    deployDryRun: (process.env.DEPLOY_DRY_RUN ?? String(config.deployDryRun)) === "true",
    caddyConfigPath: resolve(process.env.CADDY_CONFIG_PATH ?? config.caddyConfigPath),
    caddyDataDir: process.env.CADDY_DATA_DIR ?? config.caddyDataDir,
    caddyReloadCmd: process.env.CADDY_RELOAD_CMD ?? config.caddyReloadCmd,
    port: Number(process.env.PORT ?? config.port),
    publicUrl: process.env.PUBLIC_URL ?? config.publicUrl,
    controlPlaneHostname: configuredControlPlaneHostname(),
    buildkitHost: process.env.BUILDKIT_HOST ?? config.buildkitHost,
    runtimeNetworkName: process.env.AEROPLANE_RUNTIME_NETWORK ?? config.runtimeNetworkName
  };
}

type RuntimeLog = {
  id: number;
  line: string;
  stream: string;
  createdAt: string;
};

function parseRuntimeLog(line: string, stream: string, id: number): RuntimeLog {
  const match = line.match(/^(\S+)\s+(.*)$/);
  const timestamp = match ? Date.parse(match[1]) : Number.NaN;

  return {
    id,
    line: match ? match[2] : line,
    stream,
    createdAt: Number.isNaN(timestamp) ? nowIso() : new Date(timestamp).toISOString()
  };
}

function readContainerLogs(containerName: string, tail = 200) {
  return new Promise<RuntimeLog[]>((resolve) => {
    const child = spawn("docker", ["logs", "--timestamps", "--tail", String(tail), containerName], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const collected: RuntimeLog[] = [];
    let nextId = 1;
    const consume = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);

      for (const line of lines) {
        collected.push(parseRuntimeLog(line, stream, nextId));
        nextId += 1;
      }
    };

    child.stdout.on("data", consume("stdout"));
    child.stderr.on("data", consume("stderr"));
    child.on("error", () => resolve([]));
    child.on("close", () => resolve(collected));
  });
}

function getProjectBySlug(c: Context, projectSlug: string) {
  return db
    .select()
    .from(projectGroups)
    .where(eq(projectGroups.slug, projectSlug))
    .all()
    .find((project) => canAccessProject(c, project.id));
}

function getProjectById(projectId: string) {
  return db.select().from(projectGroups).where(eq(projectGroups.id, projectId)).get();
}

type AuthorizedServiceResult = { service: Service; response?: never } | { service?: never; response: Response };

function getAuthorizedService(c: Context): AuthorizedServiceResult {
  const serviceId = c.req.param("serviceId");
  if (!serviceId) {
    return { response: jsonError("Service not found", 404) };
  }

  const service = getServiceById(serviceId);
  if (!service) {
    return { response: jsonError("Service not found", 404) };
  }

  const denied = requireServiceAccess(c, service);
  if (denied) {
    return { response: denied };
  }

  return { service };
}

function getAuthorizedDeploymentService(c: Context): AuthorizedServiceResult {
  const deploymentId = c.req.param("deploymentId");
  if (!deploymentId) {
    return { response: jsonError("Deployment not found", 404) };
  }

  const deployment = db.select().from(deployments).where(eq(deployments.id, deploymentId)).get();
  if (!deployment) {
    return { response: jsonError("Deployment not found", 404) };
  }

  const service = getServiceById(deployment.serviceId);
  if (!service) {
    return { response: jsonError("Service not found", 404) };
  }

  const denied = requireServiceAccess(c, service);
  if (denied) {
    return { response: denied };
  }

  return { service };
}

function getServicesForProject(projectId: string) {
  return db.select().from(services).where(eq(services.projectId, projectId)).orderBy(asc(services.name)).all();
}

function getProjectSlugSet(ownerUserId: string) {
  return new Set(
    db
      .select({ slug: projectGroups.slug })
      .from(projectGroups)
      .where(eq(projectGroups.ownerUserId, ownerUserId))
      .all()
      .map((row) => row.slug)
  );
}

function getServiceSlugSet(projectId: string) {
  return new Set(
    db
      .select({ slug: services.slug })
      .from(services)
      .where(eq(services.projectId, projectId))
      .all()
      .map((row) => row.slug)
  );
}

function checkPortReachable(port: number, host = "127.0.0.1", timeoutMs = 350) {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function checkContainerRunning(containerName: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn("docker", ["inspect", "--format", "{{.State.Running}}", containerName], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      resolve(code === 0 && stdout.trim() === "true");
    });
  });
}

function checkStaticSiteReady(serviceId: string) {
  return existsSync(join(staticSiteDirForService(serviceId), "index.html"));
}

function urlForHostname(hostname: string) {
  const isIpv4Address = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  return `${isIpv4Address ? "http" : "https"}://${hostname}`;
}

type PublicServiceOptions = {
  frameworkDetection?: "full" | "preview";
  includeDomains?: boolean;
  liveChecks?: boolean;
};

async function publicService(service: Service, options: PublicServiceOptions = {}) {
  const liveChecks = options.liveChecks ?? true;
  const includeDomains = options.includeDomains ?? true;
  const normalizedService = ensureDatabasePublicDefaults(service) ?? service;
  const isDatabase = isDatabaseService(normalizedService);
  const isDockerImage = isDockerImageService(normalizedService);
  const isFunction = isFunctionService(normalizedService);
  const isWorker = isWorkerService(normalizedService);
  const isStaticSite = !isDatabase && !isWorker && Boolean(normalizedService.staticOutput?.trim());
  service = normalizedService;
  const appPort = service.activePort ?? service.hostPort;
  const localUrl = isDatabase || isWorker || isStaticSite ? "" : `http://127.0.0.1:${appPort}`;
  const latestDeployment = liveChecks
    ? db
        .select({ status: deployments.status })
        .from(deployments)
        .where(eq(deployments.serviceId, service.id))
        .orderBy(desc(deployments.createdAt))
        .limit(1)
        .get()
    : null;
  const shouldProbe = liveChecks && service.status === "active";
  const reachable = shouldProbe
    ? isWorker
      ? await checkContainerRunning(containerNameForService(service.id))
      : isStaticSite
        ? checkStaticSiteReady(service.id)
        : await checkPortReachable(appPort)
    : false;
  const latestDeploymentIsActive = latestDeployment?.status === "queued" || latestDeployment?.status === "building";
  const liveStatus = liveChecks && service.status === "active" && !reachable && !latestDeploymentIsActive ? "crashed" : service.status;
  const serviceDomains = includeDomains && !isDatabase && !isWorker
    ? db.select().from(domains).where(eq(domains.serviceId, service.id)).orderBy(asc(domains.createdAt)).all()
    : [];
  const customDomains = serviceDomains.filter((domain) => !isGeneratedServiceHostname(service.slug, domain.hostname));
  const preferredDomain =
    customDomains.find((domain) => domain.status === "active") ??
    customDomains.find((domain) => Boolean(domain.hostname)) ??
    serviceDomains.find((domain) => domain.status === "active") ??
    serviceDomains.find((domain) => Boolean(domain.hostname));
  const primaryUrl = isDatabase || isWorker ? "" : preferredDomain ? urlForHostname(preferredDomain.hostname) : localUrl;
  const preferredDomainPayload = preferredDomain
    ? { hostname: preferredDomain.hostname, status: preferredDomain.status }
    : null;
  const detectServiceFramework = options.frameworkDetection === "preview" ? detectFrameworkPreview : detectFramework;
  const functionRuntime = isFunction ? functionRuntimeForService(service) : null;
  const functionRuntimeEntry = functionRuntime
    ? FRAMEWORK_ICON_CATALOG.find((entry) => entry.slug === (functionRuntime === "node" ? "nodejs" : functionRuntime))
    : null;
  const framework = functionRuntime && functionRuntimeEntry
    ? {
        slug: functionRuntimeEntry.slug,
        name: functionRuntimeLabel(functionRuntime),
        logoUrl: frameworkIconUrl(functionRuntimeEntry.slug),
        website: functionRuntimeEntry.website ?? null
      }
    : isDockerImage
    ? null
    : await detectServiceFramework(service.repoFullName, service.branch, service.rootDir, {
        buildCommand: service.buildCommand,
        installCommand: service.installCommand,
        serviceName: service.name,
        startCommand: service.startCommand
      });

  return {
    id: service.id,
    projectId: service.projectId,
    name: service.name,
    slug: service.slug,
    repoFullName: service.repoFullName,
    repoUrl: service.repoUrl,
    dockerImage: isDockerImage ? dockerImageForService(service) : null,
    functionRuntime,
    branch: service.branch,
    rootDir: service.rootDir,
    hasGithubToken: Boolean(service.githubToken),
    installCommand: service.installCommand,
    buildCommand: service.buildCommand,
    startCommand: service.startCommand,
    staticOutput: service.staticOutput,
    buildMethod: normalizeServiceBuildMethod(service.buildMethod),
    dockerfilePath: service.dockerfilePath,
    detectedBuildMethod: service.detectedBuildMethod,
    runtimeMode: normalizeServiceRuntimeMode(service.runtimeMode),
    internalPort: service.internalPort,
    hostPort: service.hostPort,
    databasePublicEnabled: Boolean(service.databasePublicEnabled),
    databasePublicHostname: service.databasePublicHostname,
    postgresLogicalReplicationEnabled: Boolean(service.postgresLogicalReplicationEnabled),
    status: liveStatus,
    reachable,
    localUrl,
    primaryUrl,
    preferredDomain: preferredDomainPayload,
    framework,
    lastDeployedAt: service.lastDeployedAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
  };
}

async function summarizeProject(project: ProjectGroup, projectServices: Service[], serviceOptions: PublicServiceOptions = {}) {
  const hydratedServices = await Promise.all(projectServices.map((service) => publicService(service, serviceOptions)));
  const statuses = hydratedServices.map((service) => service.status);
  const status = statuses.includes("queued") || statuses.includes("building")
    ? "building"
    : statuses.includes("failed") || statuses.includes("crashed")
      ? "degraded"
      : statuses.every((value) => value === "active")
        ? "active"
        : "idle";

  const lastUpdatedAt = projectActivityTimestamp(project, projectServices);

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    status,
    serviceCount: projectServices.length,
    lastUpdatedAt,
    services: hydratedServices
  };
}

function createServiceRecord(projectId: string, input: z.infer<typeof createServiceSchema>) {
  const timestamp = nowIso();
  const serviceSlug = createUniqueSlug(input.name, getServiceSlugSet(projectId));
  const inputFunctionRuntime = input.functionRuntime ?? functionRuntimeForService({ repoFullName: input.repoFullName ?? null, repoUrl: input.repoUrl ?? "" });
  const inputDockerImage = input.dockerImage ?? (input.repoFullName?.startsWith("image:") ? dockerImageForService({ repoFullName: input.repoFullName }) : "");
  const repoFullName = inputFunctionRuntime
    ? functionRepoFullName(inputFunctionRuntime)
    : inputDockerImage
      ? dockerImageRepoFullName(inputDockerImage)
      : input.repoFullName ?? null;
  const repoUrl = inputFunctionRuntime
    ? FUNCTION_REPO_URL
    : inputDockerImage
    ? DOCKER_IMAGE_REPO_URL
    : input.repoUrl ?? (repoFullName?.startsWith("database:") ? "database" : repoFullName ? repoUrlFromFullName(repoFullName) : "");
  const isDatabase = repoUrl === "database" || (repoFullName?.startsWith("database:") ?? false);
  const isFunction = isFunctionService({ repoFullName, repoUrl });
  const dbType = isDatabase ? databaseTypeForService({ repoFullName, repoUrl }) : "";
  const databasePublicHostname = isDatabase
    ? input.databasePublicHostname ?? defaultDatabasePublicHostname(serviceSlug)
    : null;

  const service: Service = {
    id: nanoid(10),
    projectId,
    slug: serviceSlug,
    name: input.name,
    repoFullName,
    repoUrl,
    branch: input.branch,
    rootDir: isFunction ? null : input.rootDir ?? null,
    githubToken: isFunction ? null : input.githubToken ?? null,
    webhookSecret: randomBytes(24).toString("hex"),
    installCommand: isFunction ? null : input.installCommand ?? null,
    buildCommand: isFunction ? null : input.buildCommand ?? null,
    startCommand: isFunction ? null : input.startCommand ?? null,
    staticOutput: isFunction ? null : input.staticOutput ?? null,
    buildMethod: isFunction ? "dockerfile" : input.buildMethod ?? "auto",
    dockerfilePath: isFunction ? "Dockerfile" : input.dockerfilePath ?? null,
    detectedBuildMethod: null,
    runtimeMode: isDatabase || input.staticOutput ? "web" : input.runtimeMode,
    internalPort: input.internalPort,
    hostPort: allocateHostPort(),
    activePort: null,
    databasePublicEnabled: isDatabase,
    databasePublicHostname,
    postgresLogicalReplicationEnabled: isDatabase && isPostgresFamilyDatabase(dbType) && input.postgresLogicalReplicationEnabled,
    status: "idle",
    lastDeployedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.insert(services).values(service).run();

  if (isFunction) {
    createServiceFunction(service.id, inputFunctionRuntime, input.sourceCode);
  }

  if (isDatabase) {
    initializeDatabaseBackupSettings(service.id);
  }
  ensureDefaultDomainForService(service);
  if (input.env.length > 0) {
    const timestamp = nowIso();
    const uniqueEnv = new Map<string, string>();
    for (const entry of input.env) {
      uniqueEnv.set(entry.key, normalizeEnvValue(entry.value));
    }

    db.insert(envVars)
      .values(
        Array.from(uniqueEnv.entries()).map(([key, value]) => ({
          id: nanoid(10),
          serviceId: service.id,
          key,
          value,
          createdAt: timestamp,
          updatedAt: timestamp
        }))
      )
      .run();
  }

  syncDatabaseUrlEnvVar(service.id);

  return service;
}

function syncDatabaseUrlEnvVar(serviceId: string) {
  const service = ensureDatabasePublicDefaults(getServiceById(serviceId));
  if (!service) return;
  if (!isDatabaseService(service)) return;

  const dbType = databaseTypeForService(service);
  const envMap = envMapForService(serviceId);
  const privateUrl = buildDatabaseConnectionUrl({
    dbType,
    envMap,
    host: service.slug,
    port: service.internalPort
  });

  if (envMap.get(privateUrl.key) !== privateUrl.value) {
    const timestamp = nowIso();
    db.insert(envVars)
      .values({
        id: nanoid(10),
        serviceId,
        key: privateUrl.key,
        value: privateUrl.value,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .onConflictDoUpdate({
        target: [envVars.serviceId, envVars.key],
        set: { value: privateUrl.value, updatedAt: timestamp }
      })
      .run();
  }

  const publicUrl = service.databasePublicEnabled && service.databasePublicHostname
    ? buildDatabaseConnectionUrl({
        dbType,
        envMap,
        host: service.databasePublicHostname,
        port: service.hostPort
      }).value
    : "";
  const publicKey = publicDatabaseUrlKey(dbType);

  if (publicUrl) {
    const timestamp = nowIso();
    db.insert(envVars)
      .values({
        id: nanoid(10),
        serviceId,
        key: publicKey,
        value: publicUrl,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .onConflictDoUpdate({
        target: [envVars.serviceId, envVars.key],
        set: { value: publicUrl, updatedAt: timestamp }
      })
      .run();
  }

  for (const key of publicDatabaseUrlKeys) {
    if (key !== publicKey && envMap.has(key)) {
      db.delete(envVars).where(and(eq(envVars.serviceId, serviceId), eq(envVars.key, key))).run();
    } else if (!publicUrl && envMap.has(key)) {
      db.delete(envVars).where(and(eq(envVars.serviceId, serviceId), eq(envVars.key, key))).run();
    }
  }
}

function envMapForService(serviceId: string) {
  const envs = db.select().from(envVars).where(eq(envVars.serviceId, serviceId)).all();
  return new Map(envs.map((row) => [row.key, row.value]));
}

function defaultDatabasePublicHostname(serviceSlug: string) {
  return generateDatabaseHostname(serviceSlug, getSystemSettings().rootDomain) || null;
}

function ensureDatabasePublicDefaults(service: Service | undefined) {
  if (!service || !isDatabaseService(service)) return service ?? null;

  const nextHostname = service.databasePublicHostname ?? defaultDatabasePublicHostname(service.slug);
  if (service.databasePublicEnabled && service.databasePublicHostname === nextHostname) return service;

  const updated = {
    ...service,
    databasePublicEnabled: true,
    databasePublicHostname: nextHostname,
    updatedAt: nowIso()
  };
  db.update(services)
    .set({
      databasePublicEnabled: updated.databasePublicEnabled,
      databasePublicHostname: updated.databasePublicHostname,
      updatedAt: updated.updatedAt
    })
    .where(eq(services.id, service.id))
    .run();
  return updated;
}

function syncAllExistingDatabaseUrls() {
  try {
    const allServices = db.select().from(services).all();
    for (const service of allServices) {
      if (isDatabaseService(service)) {
        syncDatabaseUrlEnvVar(service.id);
      }
    }
  } catch (error) {
    console.error("Failed to run retroactive database URL sync:", error);
  }
}

function publicAuthStatus(c: Parameters<typeof getCurrentUser>[0]) {
  const setupComplete = hasAuthUsers();
  const user = setupComplete ? getCurrentUser(c) : null;
  const includeRuntimeDetails = !setupComplete || user?.role === "owner";
  return {
    setupComplete,
    authenticated: Boolean(user),
    user,
    secretKeyConfigured: includeRuntimeDetails ? hasSecretKey() : false,
    envPath: includeRuntimeDetails ? managedEnvPath() : "",
    publicIp: includeRuntimeDetails ? cachedPublicIp : undefined,
    runtimeConfig: includeRuntimeDetails ? currentRuntimeConfig() : undefined
  };
}

type UploadedMigrationFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name?: string;
  size?: number;
};

function isUploadedMigrationFile(value: unknown): value is UploadedMigrationFile {
  const candidate = value as Partial<UploadedMigrationFile> | null;
  return Boolean(candidate && typeof candidate === "object" && typeof candidate.arrayBuffer === "function");
}

async function saveUploadedMigrationBundle(c: Context) {
  const form = await c.req.formData();
  const passphrase = String(form.get("passphrase") ?? "");
  const bundle = form.get("bundle");
  if (!passphrase || passphrase.length < 8) {
    throw new Error("Use the migration passphrase from the source server.");
  }
  if (!isUploadedMigrationFile(bundle)) {
    throw new Error("Choose an Aeroplane migration bundle.");
  }

  const uploadDir = mkdtempSync(join(tmpdir(), "aeroplane-upload-"));
  const uploadPath = join(uploadDir, "bundle.aeroplane");
  writeFileSync(uploadPath, Buffer.from(await bundle.arrayBuffer()));
  return { passphrase, uploadDir, uploadPath };
}

function queueImportedAppDeployments() {
  const importedServices = db.select().from(services).all();
  const queued = [];
  for (const service of importedServices) {
    if (isDatabaseService(service) || service.staticOutput || service.status !== "active") continue;
    queued.push(enqueueDeployment(service.id, { trigger: "manual" }));
  }
  return queued;
}

function currentGithubEnv() {
  return {
    githubAccessToken: process.env.GITHUB_ACCESS_TOKEN ?? config.githubAccessToken,
    githubAppId: process.env.GITHUB_APP_ID ?? config.githubAppId,
    githubAppClientId: process.env.GITHUB_APP_CLIENT_ID ?? config.githubAppClientId,
    githubAppSlug: process.env.GITHUB_APP_SLUG ?? config.githubAppSlug,
    githubAppPrivateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? config.githubAppPrivateKey).replace(/\\n/g, "\n"),
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? config.githubWebhookSecret
  };
}

function secretSuffix(value: string) {
  return value ? value.slice(-6) : "";
}

async function publicGithubSettings() {
  const env = currentGithubEnv();
  let statusError = "";
  const status = await githubConnectionStatus().catch((error) => {
    statusError = error instanceof Error ? error.message : "Could not check GitHub connection";
    return {
      appConfigured: Boolean(env.githubAppId && env.githubAppPrivateKey),
      connected: false,
      installationCount: 0,
      installed: false,
      installUrl: env.githubAppSlug ? `https://github.com/apps/${env.githubAppSlug}/installations/new` : null,
      mode: env.githubAppId && env.githubAppPrivateKey ? "app" as const : env.githubAccessToken ? "token" as const : "none" as const
    };
  });
  return {
    status,
    statusError,
    settings: {
      githubAccessTokenSuffix: secretSuffix(env.githubAccessToken),
      githubAppId: env.githubAppId,
      githubAppClientId: env.githubAppClientId,
      githubAppSlug: env.githubAppSlug,
      githubAppPrivateKeyConfigured: Boolean(env.githubAppPrivateKey),
      githubWebhookSecretSuffix: secretSuffix(env.githubWebhookSecret),
      envPath: managedEnvPath()
    }
  };
}

function publicBackupR2SettingsForRequest(c: Context) {
  const userId = actorUserId(c);
  return userId ? publicUserR2Settings(userId) : publicR2Settings({ ...getSystemSettings(), r2: null });
}

function publicDatabaseBackupsForRequest(c: Context, serviceId: string) {
  const backups = listDatabaseBackups(serviceId);
  if (isOwnerSession(c)) return backups;
  return backups.map((backup) => ({
    ...backup,
    localPath: null
  }));
}

function updateGithubRuntimeEnv(values: ReturnType<typeof currentGithubEnv>) {
  process.env.GITHUB_ACCESS_TOKEN = values.githubAccessToken;
  process.env.GITHUB_APP_ID = values.githubAppId;
  process.env.GITHUB_APP_CLIENT_ID = values.githubAppClientId;
  process.env.GITHUB_APP_SLUG = values.githubAppSlug;
  process.env.GITHUB_APP_PRIVATE_KEY = values.githubAppPrivateKey;
  process.env.GITHUB_WEBHOOK_SECRET = values.githubWebhookSecret;

  config.githubAccessToken = values.githubAccessToken;
  config.githubAppId = values.githubAppId;
  config.githubAppClientId = values.githubAppClientId;
  config.githubAppSlug = values.githubAppSlug;
  config.githubAppPrivateKey = values.githubAppPrivateKey;
  config.githubWebhookSecret = values.githubWebhookSecret;
}

function resolveMaskedSecret(input: string, existing: string) {
  const value = input.trim();
  if (value.startsWith("******")) return existing;
  return value;
}

function resolveOptionalMaskedSecret(input: string, existing = "") {
  const value = input.trim();
  if (!value) return existing;
  return resolveMaskedSecret(value, existing);
}

function isExternalMaskedSecret(input: string) {
  const value = input.trim();
  return value.includes("*") && !value.startsWith("******");
}

function onboardingSettingsError(error: unknown) {
  return error instanceof Error ? error.message : "Could not apply onboarding settings";
}

async function applyOnboardingSettings(input: z.infer<typeof restartOnboardingSchema>, options: { generateSecretKeyIfMissing: boolean }) {
  const secretKey = input.env.secretKey || process.env.AEROPLANE_SECRET_KEY || config.secretKey || (options.generateSecretKeyIfMissing ? generateSecretKey() : "");
  const managedEnv = {
    AEROPLANE_SECRET_KEY: secretKey,
    DATA_DIR: input.env.dataDir,
    DEPLOY_DRY_RUN: input.env.deployDryRun,
    CADDY_CONFIG_PATH: input.env.caddyConfigPath,
    CADDY_DATA_DIR: input.env.caddyDataDir,
    CADDY_RELOAD_CMD: input.env.caddyReloadCmd,
    PORT: input.env.port,
    PUBLIC_URL: input.env.publicUrl,
    CONTROL_PLANE_HOSTNAME: input.env.controlPlaneHostname,
    BUILDKIT_HOST: input.env.buildkitHost,
    AEROPLANE_RUNTIME_NETWORK: input.env.runtimeNetworkName,
    GITHUB_ACCESS_TOKEN: input.env.githubAccessToken ?? process.env.GITHUB_ACCESS_TOKEN,
    GITHUB_APP_ID: input.env.githubAppId ?? process.env.GITHUB_APP_ID,
    GITHUB_APP_CLIENT_ID: input.env.githubAppClientId ?? process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_SLUG: input.env.githubAppSlug ?? process.env.GITHUB_APP_SLUG,
    GITHUB_APP_PRIVATE_KEY: input.env.githubAppPrivateKey ?? process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_WEBHOOK_SECRET: input.env.githubWebhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET
  };

  const settings = getSystemSettings();
  let r2 = settings.r2 ?? null;
  if (input.r2?.accountId || input.r2?.bucket || input.r2?.accessKeyId || input.r2?.secretAccessKey) {
    const parsedR2 = r2ConnectionSchema.safeParse({
      accountId: input.r2.accountId,
      bucket: input.r2.bucket,
      accessKeyId: input.r2.accessKeyId,
      secretAccessKey: input.r2.secretAccessKey,
      createBucket: input.r2.createBucket
    });
    if (!parsedR2.success) {
      throw new Error(parsedR2.error.issues[0]?.message ?? "Invalid R2 settings");
    }
    if (!parsedR2.data.secretAccessKey) {
      throw new Error("R2 secret access key is required");
    }

    const timestamp = nowIso();
    r2 = {
      accountId: parsedR2.data.accountId,
      bucket: parsedR2.data.bucket,
      accessKeyId: parsedR2.data.accessKeyId,
      secretAccessKey: parsedR2.data.secretAccessKey,
      endpoint: `https://${parsedR2.data.accountId}.r2.cloudflarestorage.com`,
      connectedAt: settings.r2?.connectedAt ?? timestamp,
      updatedAt: timestamp
    };

    if (parsedR2.data.createBucket) {
      try {
        await ensureR2Bucket(r2);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not verify R2 bucket";
        throw new Error(`R2 setup failed: ${message}`);
      }
    }
  }

  const envPath = writeManagedEnv(managedEnv);
  const controlPlaneHostname = input.env.controlPlaneHostname ?? "";
  const databaseBackupScheduleDefaults = input.databaseBackupScheduleDefaults
    ? normalizeDatabaseBackupScheduleDefaults(input.databaseBackupScheduleDefaults)
    : input.databaseBackupsAutomaticEnabled === undefined
      ? settings.databaseBackupScheduleDefaults
      : normalizeDatabaseBackupScheduleDefaults(undefined, input.databaseBackupsAutomaticEnabled);
  config.controlPlaneHostname = controlPlaneHostname;
  updateGithubRuntimeEnv(currentGithubEnv());
  saveSystemSettings({
    ...settings,
    rootDomain: input.rootDomain === undefined ? settings.rootDomain : normalizeRootDomain(input.rootDomain),
    controlPlaneHostname,
    databaseBackupScheduleDefaults,
    databaseBackupsAutomaticEnabled: backupSchedulesEnabled(databaseBackupScheduleDefaults),
    r2
  });
  await writeAndReloadCaddy();

  return envPath;
}

app.get("/api/auth/status", (c) => c.json(publicAuthStatus(c)));

app.post("/api/auth/setup", rateLimit, async (c) => {
  if (hasAuthUsers()) {
    return jsonError("Aeroplane has already been set up", 409);
  }

  const body = setupSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid setup");
  }

  let envPath = "";
  try {
    envPath = await applyOnboardingSettings(body.data, { generateSecretKeyIfMissing: true });
  } catch (error) {
    return jsonError(onboardingSettingsError(error), 400);
  }

  const user = createOwner(body.data.owner);
  createSession(c, user);
  return c.json({ ok: true, user: publicUser(user), envPath, restartRequired: true }, 201);
});

app.post("/api/auth/migration/import", rateLimit, async (c) => {
  if (hasAuthUsers()) {
    return jsonError("Aeroplane has already been set up", 409);
  }

  let upload: { passphrase: string; uploadDir: string; uploadPath: string } | null = null;
  try {
    upload = await saveUploadedMigrationBundle(c);
    const result = await importMigrationBundle(upload.uploadPath, upload.passphrase);
    const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
    if (owner) {
      createSession(c, owner);
    }
    const queuedDeployments = queueImportedAppDeployments();
    return c.json({
      ok: true,
      result,
      user: owner ? publicUser(owner) : null,
      queuedDeployments: queuedDeployments.map((deployment) => deployment.id),
      restartRequired: true
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not import migration bundle", 400);
  } finally {
    if (upload) rmSync(upload.uploadDir, { recursive: true, force: true });
  }
});

app.post("/api/auth/login", rateLimit, async (c) => {
  if (!hasAuthUsers()) {
    return jsonError("Setup required", 401);
  }

  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid login");
  }

  const user = authenticateUser(body.data.email, body.data.password);
  if (!user) {
    return jsonError("Invalid email or password", 401);
  }

  createSession(c, user);
  return c.json({ ok: true, user: publicUser(user) });
});

app.post("/api/auth/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

app.get("/api/assets/framework-icons", (c) => {
  return c.json({
    icons: [
      ...FRAMEWORK_ICON_CATALOG.map((entry) => ({
        category: "framework",
        logoUrl: frameworkIconUrl(entry.slug),
        name: entry.name,
        slug: entry.slug,
        website: entry.website ?? null
      })),
      ...DATABASE_ICON_CATALOG.map((entry) => ({
        category: "database",
        logoUrl: frameworkIconUrl(entry.slug),
        name: entry.name,
        slug: entry.slug,
        website: entry.website ?? null
      }))
    ]
  });
});

app.get("/api/assets/framework-icons/:file", async (c) => {
  const asset = await frameworkIconAsset(c.req.param("file"));
  if (!asset) {
    return new Response("Framework icon not found", { status: 404 });
  }

  return new Response(asset.body, {
    headers: {
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
      "Content-Type": asset.contentType
    }
  });
});

// --- GitHub App Manifest (one-click connect) ---
// Registered before requireAuth so the flow works during first-run onboarding
// (no users yet). Post-setup access is gated to the owner inside each handler.
type GitHubManifestState = { expiresAt: number; redirectTo: string };
const githubManifestStates = new Map<string, GitHubManifestState>();
const githubManifestStateTtl = 15 * 60 * 1000;
const githubManifestStateLimit = 500;

function requestBaseUrl(c: Context) {
  const requestUrl = new URL(c.req.url);
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? requestUrl.host;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || requestUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function createGitHubManifestState(redirectTo: string) {
  const now = Date.now();
  for (const [key, value] of githubManifestStates) {
    if (value.expiresAt <= now) githubManifestStates.delete(key);
  }
  while (githubManifestStates.size >= githubManifestStateLimit) {
    const oldestState = githubManifestStates.keys().next().value;
    if (!oldestState) break;
    githubManifestStates.delete(oldestState);
  }
  const state = randomBytes(24).toString("hex");
  githubManifestStates.set(state, { expiresAt: now + githubManifestStateTtl, redirectTo });
  return state;
}

function consumeGitHubManifestState(state: string) {
  const entry = githubManifestStates.get(state);
  if (!entry) return null;
  githubManifestStates.delete(state);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

function defaultGitHubAppName(baseUrl: string) {
  let hostSlug = "";
  try {
    hostSlug = new URL(baseUrl).hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  } catch {
    hostSlug = "";
  }
  const stem = hostSlug && hostSlug !== "localhost" ? `aeroplane-${hostSlug}` : "aeroplane";
  return `${stem}-${randomBytes(3).toString("hex")}`.slice(0, 34);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

function renderManifestCallbackPage(ok: boolean, message: string) {
  const payload = JSON.stringify({ source: "aeroplane-github-manifest", ok, message }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>GitHub connection</title></head>
<body style="font-family:ui-monospace,SFMono-Regular,monospace;background:#09090b;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:32rem;padding:1.5rem">
<p style="font-weight:600;color:${ok ? "#34d399" : "#fb7185"}">${ok ? "&#10003; Connected" : "&#10007; Connection failed"}</p>
<p style="color:#a1a1aa">${escapeHtml(message)}</p>
</div>
<script>
(function(){
  try { if (window.opener) window.opener.postMessage(${payload}, window.location.origin); } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, ${ok ? 800 : 4000});
})();
</script>
</body></html>`;
}

function canUseGitHubManifest(c: Context) {
  if (!hasAuthUsers()) return true;
  return getCurrentUser(c)?.role === "owner";
}

app.post("/api/github/manifest", async (c) => {
  if (!canUseGitHubManifest(c)) {
    return jsonError("Only the owner can connect GitHub", 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as { organization?: unknown; redirectTo?: unknown };
  const redirectTo = body.redirectTo === "onboarding" ? "onboarding" : "settings";
  const organization = typeof body.organization === "string" ? body.organization.trim() : "";
  const baseUrl = requestBaseUrl(c);
  const state = createGitHubManifestState(redirectTo);
  const manifest = buildGitHubAppManifest({ baseUrl, name: defaultGitHubAppName(baseUrl) });
  const postUrl = organization
    ? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new?state=${state}`
    : `https://github.com/settings/apps/new?state=${state}`;

  return c.json({ postUrl, manifest: JSON.stringify(manifest) });
});

app.get("/api/github/manifest/callback", async (c) => {
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  const entry = state ? consumeGitHubManifestState(state) : null;

  if (!entry) {
    return c.html(renderManifestCallbackPage(false, "This GitHub connection link has expired. Please start again."));
  }
  if (!canUseGitHubManifest(c)) {
    return c.html(renderManifestCallbackPage(false, "Only the owner can connect GitHub."));
  }
  if (!code) {
    return c.html(renderManifestCallbackPage(false, "GitHub did not return an authorization code."));
  }

  try {
    const credentials = await convertGitHubManifestCode(code);
    const existing = currentGithubEnv();
    const next = {
      githubAccessToken: existing.githubAccessToken,
      githubAppId: credentials.appId,
      githubAppClientId: credentials.clientId,
      githubAppSlug: credentials.slug,
      githubAppPrivateKey: credentials.privateKey,
      githubWebhookSecret: credentials.webhookSecret
    };
    writeManagedEnvPatch({
      GITHUB_APP_ID: next.githubAppId,
      GITHUB_APP_CLIENT_ID: next.githubAppClientId,
      GITHUB_APP_SLUG: next.githubAppSlug,
      GITHUB_APP_PRIVATE_KEY: next.githubAppPrivateKey,
      GITHUB_WEBHOOK_SECRET: next.githubWebhookSecret
    });
    updateGithubRuntimeEnv(next);
    return c.html(renderManifestCallbackPage(true, "GitHub App created and connected. You can close this window."));
  } catch (error) {
    return c.html(renderManifestCallbackPage(false, error instanceof Error ? error.message : "Could not complete GitHub connection."));
  }
});

app.use("/api/*", requireAuth);
app.use("/api/system", requireSessionAccessMiddleware);
app.use("/api/system/*", requireSessionAccessMiddleware);
app.use("/api/system/onboarding/*", requireOwnerSessionAccessMiddleware);
app.use("/api/system/settings", requireOwnerSessionAccessMiddleware);
app.use("/api/system/r2", requireOwnerSessionAccessMiddleware);
app.use("/api/system/dns", requireOwnerSessionAccessMiddleware);
app.use("/api/system/dns/*", requireOwnerSessionAccessMiddleware);
app.use("/api/system/github", requireOwnerSessionAccessMiddleware);
app.use("/api/system/updates", requireOwnerSessionAccessMiddleware);
app.use("/api/system/updates/*", requireOwnerSessionAccessMiddleware);
app.use("/api/system/maintenance", requireOwnerSessionAccessMiddleware);
app.use("/api/system/maintenance/*", requireOwnerSessionAccessMiddleware);
app.use("/api/system/migration/*", requireOwnerSessionAccessMiddleware);
app.use("/api/system/users", requireOwnerSessionAccessMiddleware);
app.use("/api/system/users/*", requireOwnerSessionAccessMiddleware);
app.use("/api/github/status", requireOwnerSessionAccessMiddleware);
app.use("/api/github/repos", requireOwnerSessionAccessMiddleware);
app.use("/api/github/branches", requireOwnerSessionAccessMiddleware);
app.use("/api/github/directories", requireOwnerSessionAccessMiddleware);
app.use("/api/github/directories/framework", requireOwnerSessionAccessMiddleware);
app.use("/api/integrations/*", requireSessionAccessMiddleware);
app.use("/api/projects", requireApiMethodAccessMiddleware);
app.use("/api/projects/*", requireApiMethodAccessMiddleware);
app.use("/api/services/*", requireApiMethodAccessMiddleware);
app.use("/api/deployments/*", requireApiMethodAccessMiddleware);

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/system/onboarding/restart", async (c) => {
  const body = restartOnboardingSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid onboarding settings");
  }

  try {
    const envPath = await applyOnboardingSettings(body.data, { generateSecretKeyIfMissing: false });
    return c.json({ ok: true, envPath, restartRequired: true });
  } catch (error) {
    return jsonError(onboardingSettingsError(error), 400);
  }
});

app.get("/api/system", async (c) => {
  const denied = requireOwnerSessionAccess(c);
  if (denied) return denied;
  return c.json(await getSystemChecks());
});

app.get("/api/system/maintenance", async (c) => c.json(await getSystemMaintenanceInfo()));

app.post("/api/system/maintenance/cleanup", async (c) => {
  const body = maintenanceCleanupSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid cleanup request");
  }

  return c.json(await runSystemMaintenanceCleanup(body.data.targets));
});

app.post("/api/system/migration/export", async (c) => {
  const body = migrationExportSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid migration request");
  }

  try {
    const bundle = await createMigrationBundle(body.data.passphrase);
    const nodeStream = createReadStream(bundle.bundlePath);
    nodeStream.on("close", () => {
      rmSync(bundle.workDir, { recursive: true, force: true });
    });
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${bundle.fileName}"`,
        "Content-Length": String(bundle.sizeBytes),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not create migration bundle", 400);
  }
});

app.get("/api/system/settings", async (c) => {
  const settings = getSystemSettings();
  const rootDomain = normalizeRootDomain(settings.rootDomain);
  let dnsStatus = "pending";
  let controlPlaneDnsStatus = "pending";
  const controlPlaneHostname = configuredControlPlaneHostname(settings);
  if (rootDomain) {
    dnsStatus = await checkDomainDns(`dns-test.${rootDomain}`, cachedPublicIp);
  }
  if (controlPlaneHostname) {
    controlPlaneDnsStatus = await checkDomainDns(controlPlaneHostname, cachedPublicIp);
  }
  return c.json({
    settings: {
      rootDomain,
      controlPlaneHostname,
      deploymentConcurrency: settings.deploymentConcurrency,
      databaseBackupScheduleDefaults: settings.databaseBackupScheduleDefaults,
      databaseBackupsAutomaticEnabled: backupSchedulesEnabled(settings.databaseBackupScheduleDefaults)
    },
    publicIp: cachedPublicIp,
    dnsStatus,
    controlPlaneDnsStatus
  });
});

app.post("/api/system/settings", async (c) => {
  const body = await c.req.json();
  const settings = getSystemSettings();
  const hasRootDomain = Object.prototype.hasOwnProperty.call(body, "rootDomain");
  const hasControlPlaneHostname = Object.prototype.hasOwnProperty.call(body, "controlPlaneHostname");
  const hasDeploymentConcurrency = Object.prototype.hasOwnProperty.call(body, "deploymentConcurrency");
  const hasDatabaseBackupScheduleDefaults = Object.prototype.hasOwnProperty.call(body, "databaseBackupScheduleDefaults");
  const hasDatabaseBackupsAutomaticEnabled = Object.prototype.hasOwnProperty.call(body, "databaseBackupsAutomaticEnabled");
  const rootDomain = hasRootDomain ? normalizeRootDomain(String(body.rootDomain ?? "")) : normalizeRootDomain(settings.rootDomain);
  let deploymentConcurrency = settings.deploymentConcurrency;
  let databaseBackupScheduleDefaults = settings.databaseBackupScheduleDefaults;

  let controlPlaneHostname = configuredControlPlaneHostname(settings);
  if (hasControlPlaneHostname) {
    const parsed = publicHostnameSchema.safeParse(body.controlPlaneHostname);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid dashboard domain");
    }
    controlPlaneHostname = parsed.data ?? "";
    writeManagedEnvPatch({ CONTROL_PLANE_HOSTNAME: controlPlaneHostname });
    config.controlPlaneHostname = controlPlaneHostname;
  }

  if (hasDeploymentConcurrency) {
    const rawConcurrency = Number(body.deploymentConcurrency);
    if (!Number.isInteger(rawConcurrency) || rawConcurrency < 1 || rawConcurrency > 10) {
      return jsonError("Deployment concurrency must be a whole number between 1 and 10.");
    }
    deploymentConcurrency = normalizeDeploymentConcurrency(rawConcurrency);
  }

  if (hasDatabaseBackupScheduleDefaults) {
    const parsed = backupScheduleSettingsSchema.safeParse(body.databaseBackupScheduleDefaults);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid database backup schedule defaults.");
    }
    databaseBackupScheduleDefaults = normalizeDatabaseBackupScheduleDefaults(parsed.data);
  } else if (hasDatabaseBackupsAutomaticEnabled) {
    if (typeof body.databaseBackupsAutomaticEnabled !== "boolean") {
      return jsonError("Database backup automation default must be true or false.");
    }
    databaseBackupScheduleDefaults = normalizeDatabaseBackupScheduleDefaults(undefined, body.databaseBackupsAutomaticEnabled);
  }

  saveSystemSettings({ ...settings, rootDomain, controlPlaneHostname, deploymentConcurrency, databaseBackupScheduleDefaults });
  const routingChanged = hasRootDomain || hasControlPlaneHostname;
  if (hasRootDomain && rootDomain) {
    ensureDefaultDomainsForExistingServices(rootDomain);
  }
  if (routingChanged) {
    syncAllExistingDatabaseUrls();
  }
  const caddy = routingChanged ? await writeAndReloadCaddy() : undefined;
  return c.json({
    ok: true,
    settings: {
      rootDomain,
      controlPlaneHostname,
      deploymentConcurrency,
      databaseBackupScheduleDefaults,
      databaseBackupsAutomaticEnabled: backupSchedulesEnabled(databaseBackupScheduleDefaults)
    },
    caddy
  });
});

registerApiKeyRoutes(app);
registerBackupStorageRoutes(app);
registerSystemUserRoutes(app);

app.get("/api/system/r2", (c) => c.json({ r2: publicR2Settings() }));

app.post("/api/system/r2", async (c) => {
  if (!hasSecretKey()) {
    return jsonError("AEROPLANE_SECRET_KEY is required before saving R2 credentials", 409);
  }

  const existing = getSystemSettings();
  const body = r2ConnectionSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid R2 settings");
  }

  const timestamp = nowIso();
  const secretAccessKey = body.data.secretAccessKey || existing.r2?.secretAccessKey;
  const accessKeyId = body.data.accessKeyId.startsWith("******") ? existing.r2?.accessKeyId : body.data.accessKeyId;
  if (!secretAccessKey) {
    return jsonError("Secret access key is required");
  }
  if (!accessKeyId) {
    return jsonError("Access key ID is required");
  }

  const endpoint = `https://${body.data.accountId}.r2.cloudflarestorage.com`;
  const r2 = {
    accountId: body.data.accountId,
    bucket: body.data.bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    connectedAt: existing.r2?.connectedAt ?? timestamp,
    updatedAt: timestamp
  };

  if (body.data.createBucket) {
    try {
      await ensureR2Bucket(r2);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Could not create or verify R2 bucket", 400);
    }
  }

  saveSystemSettings({ ...existing, r2 });
  return c.json({ ok: true, r2: publicR2Settings({ ...existing, r2 }) });
});

app.delete("/api/system/r2", (c) => {
  const settings = getSystemSettings();
  const nextSettings = { ...settings, r2: null };
  saveSystemSettings(nextSettings);
  return c.json({ ok: true, r2: publicR2Settings(nextSettings) });
});

app.get("/api/system/dns", (c) => c.json({ dns: publicDnsSettings() }));

app.post("/api/system/dns/:provider", async (c) => {
  if (!hasSecretKey()) {
    return jsonError("AEROPLANE_SECRET_KEY is required before saving DNS provider credentials", 409);
  }

  const provider = dnsProviderIdSchema.safeParse(c.req.param("provider"));
  if (!provider.success) {
    return jsonError("Unsupported DNS provider", 404);
  }

  const existing = getSystemSettings();
  const timestamp = nowIso();

  if (provider.data === "cloudflare") {
    const body = cloudflareDnsConnectionSchema.safeParse(await c.req.json());
    if (!body.success) {
      return jsonError(body.error.issues[0]?.message ?? "Invalid Cloudflare DNS settings");
    }

    const previous = existing.dns?.cloudflare;
    const apiToken = resolveOptionalMaskedSecret(body.data.apiToken, previous?.apiToken ?? "");
    if (!apiToken) return jsonError("Cloudflare API token is required");

    const dns = {
      ...(existing.dns ?? {}),
      cloudflare: {
        provider: "cloudflare" as const,
        apiToken,
        accountEmail: body.data.accountEmail,
        zoneId: body.data.zoneId,
        connectedAt: previous?.connectedAt ?? timestamp,
        updatedAt: timestamp
      }
    };
    const nextSettings = { ...existing, dns };
    saveSystemSettings(nextSettings);
    return c.json({ ok: true, dns: publicDnsSettings(nextSettings) });
  }

  if (provider.data === "namecheap") {
    const body = namecheapDnsConnectionSchema.safeParse(await c.req.json());
    if (!body.success) {
      return jsonError(body.error.issues[0]?.message ?? "Invalid Namecheap DNS settings");
    }

    const previous = existing.dns?.namecheap;
    const apiKey = resolveOptionalMaskedSecret(body.data.apiKey, previous?.apiKey ?? "");
    if (!body.data.apiUser) return jsonError("Namecheap API user is required");
    if (!apiKey) return jsonError("Namecheap API key is required");

    const dns = {
      ...(existing.dns ?? {}),
      namecheap: {
        provider: "namecheap" as const,
        apiUser: body.data.apiUser,
        apiKey,
        clientIp: body.data.clientIp,
        connectedAt: previous?.connectedAt ?? timestamp,
        updatedAt: timestamp
      }
    };
    const nextSettings = { ...existing, dns };
    saveSystemSettings(nextSettings);
    return c.json({ ok: true, dns: publicDnsSettings(nextSettings) });
  }

  const body = spaceshipDnsConnectionSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid Spaceship DNS settings");
  }

  const previous = existing.dns?.spaceship;
  const apiKey = resolveOptionalMaskedSecret(body.data.apiKey, previous?.apiKey ?? "");
  const apiSecret = resolveOptionalMaskedSecret(body.data.apiSecret, previous?.apiSecret ?? "");
  if (!apiKey) return jsonError("Spaceship API key is required");
  if (!apiSecret) return jsonError("Spaceship API secret is required");

  const dns = {
    ...(existing.dns ?? {}),
    spaceship: {
      provider: "spaceship" as const,
      apiKey,
      apiSecret,
      connectedAt: previous?.connectedAt ?? timestamp,
      updatedAt: timestamp
    }
  };
  const nextSettings = { ...existing, dns };
  saveSystemSettings(nextSettings);
  return c.json({ ok: true, dns: publicDnsSettings(nextSettings) });
});

app.delete("/api/system/dns/:provider", (c) => {
  const provider = dnsProviderIdSchema.safeParse(c.req.param("provider"));
  if (!provider.success) {
    return jsonError("Unsupported DNS provider", 404);
  }

  const settings = getSystemSettings();
  const dns = { ...(settings.dns ?? {}) };
  if (provider.data === "cloudflare") delete dns.cloudflare;
  if (provider.data === "namecheap") delete dns.namecheap;
  if (provider.data === "spaceship") delete dns.spaceship;

  const nextSettings = {
    ...settings,
    dns: Object.keys(dns).length > 0 ? dns : null
  };
  saveSystemSettings(nextSettings);
  return c.json({ ok: true, dns: publicDnsSettings(nextSettings) });
});

app.get("/api/system/ai", (c) => {
  const userId = actorUserId(c);
  if (!userId) return jsonError("Authenticated user not found", 401);
  return c.json({ ai: publicUserAiSettings(userId) });
});

app.post("/api/system/ai", async (c) => {
  const userId = actorUserId(c);
  if (!userId) return jsonError("Authenticated user not found", 401);

  const body = aiSettingsSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid AI settings");
  }

  const ai = getUserAiSettings(userId);
  const providers = { ...(ai?.providers ?? {}) };
  const defaultProvider = body.data.defaultProvider;
  const providerSettings = providers[defaultProvider];
  if (!providerSettings?.apiKey) {
    return jsonError(`${aiProviderName(defaultProvider)} credentials must be saved before it can be set as default.`);
  }

  const defaultModel = body.data.defaultModel || providerSettings.selectedModel || defaultAiModel(defaultProvider);
  if (!isAiProviderModel(defaultProvider, defaultModel)) {
    return jsonError(`${defaultModel} is not a supported ${aiProviderName(defaultProvider)} model.`);
  }

  providers[defaultProvider] = { ...providerSettings, selectedModel: defaultModel };
  const nextAi = { defaultProvider, defaultModel, providers };
  saveUserAiSettings(userId, nextAi);
  return c.json({ ok: true, ai: publicUserAiSettings(userId) });
});

app.post("/api/system/ai/providers/:provider", async (c) => {
  const userId = actorUserId(c);
  if (!userId) return jsonError("Authenticated user not found", 401);

  if (!hasSecretKey()) {
    return jsonError("AEROPLANE_SECRET_KEY is required before saving AI provider credentials", 409);
  }

  const provider = aiProviderIdSchema.safeParse(c.req.param("provider"));
  if (!provider.success) {
    return jsonError("Unsupported AI provider", 404);
  }

  const body = aiProviderCredentialsSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid AI provider credentials");
  }

  const ai = getUserAiSettings(userId);
  const providerId = provider.data;
  const previous = ai?.providers?.[providerId];
  const submittedApiKey = body.data.apiKey.trim();
  if (isExternalMaskedSecret(submittedApiKey)) {
    return jsonError(`Paste the full ${aiProviderName(providerId)} API key, not a masked key.`);
  }

  const apiKey = resolveOptionalMaskedSecret(submittedApiKey, previous?.apiKey ?? "");
  if (!apiKey) {
    return jsonError(`${aiProviderName(providerId)} API key is required`);
  }
  if (apiKey.startsWith("******")) {
    return jsonError(`The saved ${aiProviderName(providerId)} API key is only a mask. Paste the full API key once to repair it.`);
  }

  const selectedModel = body.data.selectedModel || previous?.selectedModel || defaultAiModel(providerId);
  if (!isAiProviderModel(providerId, selectedModel)) {
    return jsonError(`${selectedModel} is not a supported ${aiProviderName(providerId)} model.`);
  }

  const timestamp = nowIso();
  const providers = {
    ...(ai?.providers ?? {}),
    [providerId]: {
      provider: providerId,
      apiKey,
      selectedModel,
      connectedAt: previous?.connectedAt ?? timestamp,
      updatedAt: timestamp
    }
  };
  const currentDefaultProvider: AiProviderId | "" = ai?.defaultProvider && providers[ai.defaultProvider] ? ai.defaultProvider : "";
  const currentDefaultModel =
    currentDefaultProvider === providerId
      ? selectedModel
      : currentDefaultProvider
        ? ai?.defaultModel || providers[currentDefaultProvider]?.selectedModel || defaultAiModel(currentDefaultProvider)
        : "";
  const nextAi = {
    defaultProvider: currentDefaultProvider,
    defaultModel: currentDefaultModel,
    providers
  };

  saveUserAiSettings(userId, nextAi);
  return c.json({ ok: true, ai: publicUserAiSettings(userId) });
});

app.delete("/api/system/ai/providers/:provider", (c) => {
  const userId = actorUserId(c);
  if (!userId) return jsonError("Authenticated user not found", 401);

  const provider = aiProviderIdSchema.safeParse(c.req.param("provider"));
  if (!provider.success) {
    return jsonError("Unsupported AI provider", 404);
  }

  const ai = getUserAiSettings(userId);
  const providers = { ...(ai?.providers ?? {}) };
  delete providers[provider.data];

  const currentDefaultProvider = ai?.defaultProvider;
  const defaultProvider: AiProviderId | "" = currentDefaultProvider && currentDefaultProvider !== provider.data && providers[currentDefaultProvider] ? currentDefaultProvider : "";
  const defaultModel = defaultProvider ? ai?.defaultModel || providers[defaultProvider]?.selectedModel || defaultAiModel(defaultProvider) : "";
  const nextAi = Object.keys(providers).length > 0 ? { defaultProvider, defaultModel, providers } : null;

  saveUserAiSettings(userId, nextAi);
  return c.json({ ok: true, ai: publicUserAiSettings(userId) });
});

app.get("/api/system/github", async (c) => {
  try {
    return c.json(await publicGithubSettings());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load GitHub settings", 503);
  }
});

app.post("/api/system/github", async (c) => {
  const body = githubSettingsSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid GitHub settings");
  }

  const existing = currentGithubEnv();
  const next = {
    githubAccessToken: resolveMaskedSecret(body.data.githubAccessToken, existing.githubAccessToken),
    githubAppId: body.data.githubAppId,
    githubAppClientId: body.data.githubAppClientId,
    githubAppSlug: body.data.githubAppSlug,
    githubAppPrivateKey: body.data.githubAppPrivateKey.trim() ? body.data.githubAppPrivateKey.replace(/\\n/g, "\n") : existing.githubAppPrivateKey,
    githubWebhookSecret: resolveMaskedSecret(body.data.githubWebhookSecret, existing.githubWebhookSecret)
  };

  writeManagedEnvPatch({
    GITHUB_ACCESS_TOKEN: next.githubAccessToken,
    GITHUB_APP_ID: next.githubAppId,
    GITHUB_APP_CLIENT_ID: next.githubAppClientId,
    GITHUB_APP_SLUG: next.githubAppSlug,
    GITHUB_APP_PRIVATE_KEY: next.githubAppPrivateKey,
    GITHUB_WEBHOOK_SECRET: next.githubWebhookSecret
  });
  updateGithubRuntimeEnv(next);

  try {
    return c.json({ ok: true, ...(await publicGithubSettings()) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub settings saved, but status check failed", 503);
  }
});

app.delete("/api/system/github", async (c) => {
  const next = {
    githubAccessToken: "",
    githubAppId: "",
    githubAppClientId: "",
    githubAppSlug: "",
    githubAppPrivateKey: "",
    githubWebhookSecret: ""
  };
  writeManagedEnvPatch({
    GITHUB_ACCESS_TOKEN: "",
    GITHUB_APP_ID: "",
    GITHUB_APP_CLIENT_ID: "",
    GITHUB_APP_SLUG: "",
    GITHUB_APP_PRIVATE_KEY: "",
    GITHUB_WEBHOOK_SECRET: ""
  });
  updateGithubRuntimeEnv(next);

  return c.json({ ok: true, ...(await publicGithubSettings()) });
});

app.get("/api/system/updates", async (c) => c.json(await getSystemUpdateInfo()));

app.post("/api/system/updates/apply", (c) => c.json({ ok: true, updateRun: startSystemUpdate() }));

app.get("/api/github/status", async (c) => {
  try {
    return c.json(await githubConnectionStatus());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load GitHub status", 503);
  }
});

app.get("/api/github/repos", async (c) => {
  try {
    return c.json({ repos: await listConnectedRepos(c.req.query("q")) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load repositories", 503);
  }
});

app.get("/api/github/branches", async (c) => {
  const repoFullName = c.req.query("repo");
  if (!repoFullName) {
    return jsonError("Missing repo");
  }

  try {
    return c.json({ branches: await listRepoBranches(repoFullName) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load branches", 503);
  }
});

app.get("/api/github/directories", async (c) => {
  const repoFullName = c.req.query("repo");
  const branch = c.req.query("branch");
  if (!repoFullName || !branch) {
    return jsonError("Missing repo or branch");
  }

  const path = c.req.query("path") ?? "";
  try {
    const directories = await listRepoDirectories(repoFullName, branch, path);
    const withFrameworks = await Promise.all(
      directories.map(async ({ frameworkHintSlug, ...directory }) => ({
        ...directory,
        framework: frameworkHintSlug ? await frameworkMetaForSlug(frameworkHintSlug) : null
      }))
    );

    // The root has no parent row of its own, so its badge is resolved here, attached to
    // the listing that represents it — the top-level fetch. Unlike child rows, this is
    // resolved precisely (not just coarsely) up front: root is exactly one folder, not
    // N, so reading its own manifest content doesn't reintroduce the N-multiplied cost
    // the lazy per-folder tier exists to avoid. A folder with no recognizable framework
    // of its own (e.g. a bare monorepo root) correctly resolves to no badge at all.
    const rootFramework =
      path === "" ? await detectFramework(repoFullName, branch, "", {}, await filesInDirectory(repoFullName, branch, "")) : null;

    return c.json({ directories: withFrameworks, rootFramework });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load directories", 503);
  }
});

// Precise detection is deferred until a folder is actually opened, so it costs at most
// one file read (the manifest we already know is there) instead of probing every folder
// in the tree up front.
app.get("/api/github/directories/framework", async (c) => {
  const repoFullName = c.req.query("repo");
  const branch = c.req.query("branch");
  if (!repoFullName || !branch) {
    return jsonError("Missing repo or branch");
  }

  const path = c.req.query("path") ?? "";
  try {
    const knownFiles = await filesInDirectory(repoFullName, branch, path);
    return c.json({ framework: await detectFramework(repoFullName, branch, path, {}, knownFiles) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not detect framework", 503);
  }
});

app.get("/api/projects", async (c) => {
  const groups = db.select().from(projectGroups).orderBy(desc(projectGroups.updatedAt)).all().filter((group) => canAccessProject(c, group.id));
  const projectIds = new Set(groups.map((group) => group.id));
  const serviceRows = db.select().from(services).orderBy(asc(services.name)).all().filter((service) => projectIds.has(service.projectId));

  const grouped = await Promise.all(groups.map((group) => summarizeProject(
    group,
    serviceRows.filter((service) => service.projectId === group.id),
    { frameworkDetection: "preview", includeDomains: false, liveChecks: false }
  )));
  return c.json({ projects: sortProjectsByRecentActivity(grouped) });
});

app.post("/api/projects", async (c) => {
  const body = createProjectSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid project");
  }
  const denied = requireAllProjectsScope(c);
  if (denied) return denied;
  const ownerUserId = actorUserId(c);
  if (!ownerUserId) {
    return jsonError("Authenticated user not found", 401);
  }

  const timestamp = nowIso();
  const projectSlug = createUniqueSlug(body.data.name, getProjectSlugSet(ownerUserId));
  const project: ProjectGroup = {
    id: nanoid(10),
    ownerUserId,
    name: body.data.name,
    slug: projectSlug,
    description: body.data.description ?? null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.insert(projectGroups).values(project).run();
  return c.json({ project: await summarizeProject(project, []) }, 201);
});

app.get("/api/projects/:projectSlug", async (c) => {
  const project = getProjectBySlug(c, c.req.param("projectSlug"));
  if (!project) {
    return jsonError("Project not found", 404);
  }
  const denied = requireProjectAccess(c, project.id);
  if (denied) return denied;

  return c.json({ project: await summarizeProject(project, getServicesForProject(project.id)) });
});

app.patch("/api/projects/:projectId", async (c) => {
  const project = getProjectById(c.req.param("projectId"));
  if (!project) {
    return jsonError("Project not found", 404);
  }
  const denied = requireProjectAccess(c, project.id);
  if (denied) return denied;

  const body = updateProjectSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid project");
  }

  const updated = {
    ...project,
    name: body.data.name ?? project.name,
    description: body.data.description === undefined ? project.description : body.data.description ?? null,
    updatedAt: nowIso()
  };

  db.update(projectGroups)
    .set({ name: updated.name, description: updated.description, updatedAt: updated.updatedAt })
    .where(eq(projectGroups.id, project.id))
    .run();

  return c.json({ project: await summarizeProject(updated, getServicesForProject(project.id)) });
});

app.get("/api/projects/:projectId/database-variable-suggestions", async (c) => {
  const project = getProjectById(c.req.param("projectId"));
  if (!project) {
    return jsonError("Project not found", 404);
  }
  const denied = requireProjectAccess(c, project.id);
  if (denied) return denied;

  return c.json({ suggestions: databaseConnectionEnvSuggestionsForProject(project.id) });
});

app.get("/api/projects/:projectId/env-example-variable-suggestions", async (c) => {
  const project = getProjectById(c.req.param("projectId"));
  if (!project) {
    return jsonError("Project not found", 404);
  }
  const denied = requireProjectAccess(c, project.id);
  if (denied) return denied;

  const query = envExampleSuggestionsQuerySchema.safeParse({
    repo: c.req.query("repo"),
    branch: c.req.query("branch") ?? undefined,
    rootDir: c.req.query("rootDir") ?? undefined
  });
  if (!query.success) {
    return jsonError(query.error.issues[0]?.message ?? "Invalid repository");
  }

  const databaseSuggestions = databaseConnectionEnvSuggestionsForProject(project.id);
  const suggestions = await envExampleVariableSuggestions({
    repoFullName: query.data.repo,
    branch: query.data.branch,
    rootDir: query.data.rootDir ?? null,
    excludedKeys: databaseSuggestions.map((suggestion) => suggestion.key)
  });

  return c.json({ suggestions });
});

app.post("/api/projects/:projectId/services", async (c) => {
  const project = getProjectById(c.req.param("projectId"));
  if (!project) {
    return jsonError("Project not found", 404);
  }
  const denied = requireProjectAccess(c, project.id);
  if (denied) return denied;

  const body = createServiceSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid service");
  }

  const service = createServiceRecord(project.id, body.data);
  db.update(projectGroups).set({ updatedAt: nowIso() }).where(eq(projectGroups.id, project.id)).run();
  await writeAndReloadCaddy();
  return c.json({ service: await publicService(service) }, 201);
});

function getLocalIpAddress() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

let cachedPublicIp = getLocalIpAddress();
async function fetchPublicIp() {
  try {
    const res = await fetch("https://api.ipify.org");
    if (res.ok) {
      cachedPublicIp = (await res.text()).trim();
    }
  } catch {
    // Keep local network IP address
  }
}
fetchPublicIp();

async function checkDomainDns(hostname: string, targetIp: string): Promise<"active" | "pending"> {
  if (hostname.endsWith(".localhost") || hostname === "localhost" || hostname === "127.0.0.1") {
    return "active";
  }
  try {
    const addresses = await dns.resolve4(hostname);
    if (addresses.includes(targetIp) || addresses.includes("127.0.0.1")) {
      return "active";
    }
  } catch {
    // DNS lookup failed
  }
  return "pending";
}

app.get("/api/services/:serviceId/overview", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  const isDatabase = isDatabaseService(service);
  const isWorker = isWorkerService(service);
  if (isDatabase) {
    syncDatabaseUrlEnvVar(service.id);
  }

  const serviceDeployments = db
    .select()
    .from(deployments)
    .where(eq(deployments.serviceId, service.id))
    .orderBy(desc(deployments.createdAt))
    .limit(30)
    .all();

  const resolvedEnv = resolveServiceEnv(service.id);

  const serviceEnv = db
    .select()
    .from(envVars)
    .where(eq(envVars.serviceId, service.id))
    .orderBy(asc(envVars.key))
    .all()
    .map((row) => ({
      id: row.id,
      key: row.key,
      hasValue: row.value.length > 0,
      value: row.value,
      resolvedValue: resolvedEnv[row.key] ?? row.value,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));

  const serviceDomains = db
    .select()
    .from(domains)
    .where(eq(domains.serviceId, service.id))
    .orderBy(asc(domains.hostname))
    .all();

  // Dynamically check DNS configuration for each public domain in real-time
  const updatedDomains = isDatabase || isWorker
    ? []
    : await Promise.all(
        serviceDomains.map(async (d) => {
          const status = await checkDomainDns(d.hostname, cachedPublicIp);
          if (status !== d.status) {
            db.update(domains).set({ status, updatedAt: nowIso() }).where(eq(domains.id, d.id)).run();
            return { ...d, status, updatedAt: nowIso() };
          }
          return d;
        })
      );

  return c.json({
    service: await publicService(service),
    deployments: serviceDeployments,
    env: serviceEnv,
    domains: updatedDomains,
    publicIp: cachedPublicIp
  });
});

app.get("/api/services/:serviceId/function-source", (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  if (!isFunctionService(service)) {
    return jsonError("Source Code is only available for function services.", 404);
  }

  const source = getServiceFunctionSource(service.id);
  if (!source) {
    return jsonError("Function source not found", 404);
  }

  return c.json({ source });
});

app.patch("/api/services/:serviceId/function-source", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  if (!isFunctionService(service)) {
    return jsonError("Source Code is only available for function services.", 404);
  }

  const body = functionSourceUpdateSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid function source");
  }

  try {
    const source = updateServiceFunctionSource(service.id, body.data);
    const updated = getServiceById(service.id);
    return c.json({ source, service: updated ? await publicService(updated) : null });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not update function source");
  }
});

app.post("/api/services/:serviceId/function-source/generate", async (c) => {
  try {
    const serviceAccess = getAuthorizedService(c);
    if (serviceAccess.response) return serviceAccess.response;
    const { service } = serviceAccess;
    if (!isFunctionService(service)) {
      return jsonError("Source Code is only available for function services.", 404);
    }

    const userId = actorUserId(c);
    if (!userId) return jsonError("Authenticated user not found", 401);

    const body = functionCodeGenerationRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return jsonError(body.error.issues[0]?.message ?? "Invalid code generation request");
    }

    const generation = await generateFunctionSourceCode(userId, service, {
      prompt: body.data.prompt,
      runtime: body.data.runtime,
      sourceCode: body.data.sourceCode,
      providerId: body.data.providerId,
      modelId: body.data.model
    });
    return c.json({ generation });
  } catch (error) {
    if (error instanceof FunctionCodeGenerationError) {
      return jsonError(error.message, error.status);
    }
    return jsonError(error instanceof Error ? error.message : "Could not generate function code", 500);
  }
});

app.get("/api/services/:serviceId/suggestion-keys", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  const groupServices = db
    .select()
    .from(services)
    .where(eq(services.projectId, service.projectId))
    .all();

  const serviceIds = groupServices.map((s) => s.id);
  const allEnvs = serviceIds.length > 0
    ? db.select().from(envVars).where(inArray(envVars.serviceId, serviceIds)).all()
    : [];

  const envsByServiceId = new Map<string, string[]>();
  for (const sId of serviceIds) {
    envsByServiceId.set(sId, []);
  }
  for (const row of allEnvs) {
    envsByServiceId.get(row.serviceId)?.push(row.key);
  }

  const suggestions: Array<{ key: string; label: string }> = [];

  const properties = ["hostPort", "activePort", "internalPort", "runtimeMode", "name", "slug", "status"];
  for (const prop of properties) {
    suggestions.push({
      key: prop,
      label: `Local service ${prop}`
    });
  }

  const localEnvs = envsByServiceId.get(service.id) || [];
  for (const key of localEnvs) {
    suggestions.push({
      key,
      label: "Local environment variable"
    });
  }

  for (const s of groupServices) {
    if (s.id === service.id) continue;

    for (const prop of properties) {
      suggestions.push({
        key: `${s.slug}.${prop}`,
        label: `Service ${s.name} ${prop}`
      });
    }

    const sEnvs = envsByServiceId.get(s.id) || [];
    for (const key of sEnvs) {
      suggestions.push({
        key: `${s.slug}.${key}`,
        label: `Service ${s.name} variable`
      });
    }
  }

  return c.json({
    suggestions,
    databaseVariables: databaseConnectionEnvSuggestionsForService(service.id)
  });
});

app.get("/api/services/:serviceId/database/tables", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  try {
    return c.json(await getDatabaseTables(c.req.param("serviceId"), Number(c.req.query("database") ?? 0)));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load database tables", 400);
  }
});

app.get("/api/services/:serviceId/database/rows", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  try {
    const table = c.req.query("table") ?? "";
    if (!table) return jsonError("Table is required");

    const limit = Number(c.req.query("limit") ?? 50);
    const offset = Number(c.req.query("offset") ?? 0);
    const filters = parseDatabaseFilters(c.req.query("filters"));
    return c.json(await getDatabaseRows(c.req.param("serviceId"), table, limit, offset, filters));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load database rows", 400);
  }
});

app.post("/api/services/:serviceId/database/query", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = databaseQuerySchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid SQL query");
  }

  try {
    return c.json(await runDatabaseQuery(c.req.param("serviceId"), body.data.sql));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not run SQL query", 400);
  }
});

app.post("/api/services/:serviceId/database/rows", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = databaseInsertSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid row");
  }

  try {
    return c.json(await insertDatabaseRow(c.req.param("serviceId"), body.data.table, body.data.values), 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not insert database row", 400);
  }
});

app.patch("/api/services/:serviceId/database/rows", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = databaseUpdateSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid row update");
  }

  try {
    return c.json(await updateDatabaseRow(c.req.param("serviceId"), body.data.table, body.data.primaryKey, body.data.values));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not update database row", 400);
  }
});

app.delete("/api/services/:serviceId/database/rows", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = databaseDeleteSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid row delete");
  }

  try {
    return c.json(await deleteDatabaseRow(c.req.param("serviceId"), body.data.table, body.data.primaryKey));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not delete database row", 400);
  }
});

app.get("/api/services/:serviceId/database/backups", (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  try {
    const serviceId = c.req.param("serviceId");
    const settings = getDatabaseBackupSettings(serviceId);
    return c.json({
      backups: publicDatabaseBackupsForRequest(c, serviceId),
      settings,
      r2: publicBackupR2SettingsForRequest(c)
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load backups", 400);
  }
});

app.patch("/api/services/:serviceId/database/backups/settings", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = backupSettingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid backup settings");
  }

  try {
    return c.json({ settings: updateDatabaseBackupSettings(c.req.param("serviceId"), body.data) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not update backup settings", 400);
  }
});

app.post("/api/services/:serviceId/database/backups", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = backupCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid backup request");
  }

  try {
    const serviceId = c.req.param("serviceId");
    return c.json({ backup: await createDatabaseBackup(serviceId, body.data.storage) }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not create backup", 400);
  }
});

app.get("/api/services/:serviceId/database/backups/:backupId/download", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  let cleanup: null | (() => void) = null;
  try {
    const file = getDatabaseBackupFile(c.req.param("serviceId"), c.req.param("backupId"));
    cleanup = file.cleanup;
    const { backup, localPath, download } = file;
    const fileName = backup.fileName || basename(localPath);
    await download;
    const body = readFileSync(localPath);
    cleanup?.();
    cleanup = null;
    return new Response(body, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/octet-stream"
      }
    });
  } catch (error) {
    cleanup?.();
    return jsonError(error instanceof Error ? error.message : "Could not download backup", 404);
  }
});

app.post("/api/services/:serviceId/database/backups/:backupId/restore", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  try {
    return c.json(await restoreDatabaseBackup(c.req.param("serviceId"), c.req.param("backupId")));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not restore backup", 400);
  }
});

app.get("/api/services/:serviceId/database/tls", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  if (!isDatabaseService(service)) {
    return jsonError("Database service not found", 404);
  }
  if (!isPostgresFamilyDatabase(databaseTypeForService(service))) {
    return jsonError("Postgres TLS setup is only available for Postgres-compatible services.", 400);
  }

  try {
    const envMap = envMapForService(service.id);
    await ensurePostgresTlsAssets(service);
    const active = await checkPostgresTlsActive(service, envMap, containerNameForService(service.id));
    return c.json({ tls: getPostgresTlsInfo(service, envMap, active) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load Postgres TLS setup", 400);
  }
});

app.get("/api/services/:serviceId/database/tls/ca", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  if (!isDatabaseService(service)) {
    return jsonError("Database service not found", 404);
  }
  if (!isPostgresFamilyDatabase(databaseTypeForService(service))) {
    return jsonError("Postgres TLS setup is only available for Postgres-compatible services.", 400);
  }

  try {
    const assets = await ensurePostgresTlsAssets(service);
    return new Response(readFileSync(assets.caCertPath), {
      headers: {
        "Content-Disposition": `attachment; filename="${service.slug}-postgres-ca.pem"`,
        "Content-Type": "application/x-pem-file"
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not download Postgres CA", 400);
  }
});

app.delete("/api/services/:serviceId/database/backups/:backupId", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  try {
    return c.json(await deleteDatabaseBackup(c.req.param("serviceId"), c.req.param("backupId")));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not delete backup", 400);
  }
});

app.get("/api/services/:serviceId/import-sources", (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  return c.json({ sources: listServiceImportSources(service.id) });
});

app.get("/api/services/:serviceId/database/imports", (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  try {
    return c.json({ imports: listDatabaseDataImports(c.req.param("serviceId")) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load database imports", 400);
  }
});

app.post("/api/services/:serviceId/database/import/postgres-url", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = postgresUrlImportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid Postgres import request");
  }

  try {
    return c.json({ result: await importPostgresDataFromUrl(c.req.param("serviceId"), body.data.sourceUrl) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not import Postgres data", 400);
  }
});

app.post("/api/services/:serviceId/database/import/railway", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = railwayDataImportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid Railway import request");
  }

  try {
    return c.json({ result: await importPostgresDataFromRailway(c.req.param("serviceId"), body.data.apiToken) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not import Railway Postgres data", 400);
  }
});

app.post("/api/services/:serviceId/database/import/redis-url", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = redisUrlImportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid Redis import request");
  }

  try {
    return c.json({ result: await importRedisDataFromUrl(c.req.param("serviceId"), body.data.sourceUrl) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not import Redis data", 400);
  }
});

app.post("/api/services/:serviceId/database/import/redis-railway", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const body = railwayDataImportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid Railway import request");
  }

  try {
    return c.json({ result: await importRedisDataFromRailway(c.req.param("serviceId"), body.data.apiToken) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not import Railway Redis data", 400);
  }
});

app.patch("/api/services/:serviceId", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  const body = updateServiceSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid update");
  }

  const { dockerImage, ...updateData } = body.data;
  let repoFullName = updateData.repoFullName === undefined ? service.repoFullName : updateData.repoFullName;
  let repoUrl =
    updateData.repoUrl === undefined
      ? repoFullName
        ? repoFullName.startsWith("image:")
          ? DOCKER_IMAGE_REPO_URL
          : repoFullName.startsWith("database:")
            ? "database"
            : repoFullName.startsWith("function:")
              ? FUNCTION_REPO_URL
              : repoUrlFromFullName(repoFullName)
        : service.repoUrl
      : updateData.repoUrl ?? service.repoUrl;
  if (dockerImage) {
    repoFullName = dockerImageRepoFullName(dockerImage);
    repoUrl = DOCKER_IMAGE_REPO_URL;
  }
  const nextIsDatabase = isDatabaseService({ repoFullName, repoUrl });
  const nextDatabaseType = nextIsDatabase ? databaseTypeForService({ repoFullName, repoUrl }) : "";
  const databasePublicEnabled = nextIsDatabase;
  const databasePublicHostname = nextIsDatabase
    ? body.data.databasePublicHostname ?? service.databasePublicHostname ?? defaultDatabasePublicHostname(service.slug)
    : null;
  const postgresLogicalReplicationEnabled =
    nextIsDatabase && isPostgresFamilyDatabase(nextDatabaseType)
      ? updateData.postgresLogicalReplicationEnabled ?? service.postgresLogicalReplicationEnabled
      : false;
  const nextStaticOutput = updateData.staticOutput === undefined ? service.staticOutput : updateData.staticOutput;
  const runtimeMode = nextIsDatabase || nextStaticOutput
    ? "web"
    : normalizeServiceRuntimeMode(updateData.runtimeMode ?? service.runtimeMode);

  db.update(services)
    .set({
      ...updateData,
      repoFullName,
      repoUrl,
      githubToken: updateData.githubToken === undefined ? service.githubToken : updateData.githubToken ?? null,
      runtimeMode,
      ...(runtimeMode === "worker" ? { activePort: null } : {}),
      databasePublicEnabled,
      databasePublicHostname,
      postgresLogicalReplicationEnabled,
      updatedAt: nowIso()
    })
    .where(eq(services.id, service.id))
    .run();

  syncDatabaseUrlEnvVar(service.id);

  const updated = getServiceById(service.id);
  if (updated && !isDatabaseService(updated) && !isWorkerService(updated)) {
    ensureDefaultDomainForService(updated);
  }
  if (updated && runtimeMode !== normalizeServiceRuntimeMode(service.runtimeMode)) {
    await writeAndReloadCaddy();
  }
  return c.json({ service: updated ? await publicService(updated) : null });
});

app.post("/api/services/:serviceId/transfer", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  const body = transferServiceSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid transfer");
  }

  const targetProject = getProjectById(body.data.targetProjectId);
  if (!targetProject) {
    return jsonError("Target project not found", 404);
  }
  const targetDenied = requireProjectAccess(c, targetProject.id);
  if (targetDenied) return targetDenied;
  if (targetProject.id === service.projectId) {
    return jsonError("Choose a different project for this service.");
  }

  const latestDeployment = db
    .select({ status: deployments.status })
    .from(deployments)
    .where(eq(deployments.serviceId, service.id))
    .orderBy(desc(deployments.createdAt))
    .limit(1)
    .get();
  if (service.status === "queued" || service.status === "building" || latestDeployment?.status === "queued" || latestDeployment?.status === "building") {
    return jsonError("Wait for the current deployment to finish before moving this service.", 409);
  }

  const timestamp = nowIso();
  const targetSlugs = getServiceSlugSet(targetProject.id);
  const nextSlug = targetSlugs.has(service.slug) ? createUniqueSlug(service.name, targetSlugs) : service.slug;
  const sourceProjectId = service.projectId;

  db.update(services)
    .set({
      projectId: targetProject.id,
      slug: nextSlug,
      updatedAt: timestamp
    })
    .where(eq(services.id, service.id))
    .run();
  db.update(projectGroups).set({ updatedAt: timestamp }).where(eq(projectGroups.id, sourceProjectId)).run();
  db.update(projectGroups).set({ updatedAt: timestamp }).where(eq(projectGroups.id, targetProject.id)).run();

  const updated = getServiceById(service.id);
  if (!updated) {
    return jsonError("Service not found after transfer", 404);
  }

  ensureDefaultDomainForService(updated);
  syncProjectDatabaseConnectionEnv(sourceProjectId);
  syncProjectDatabaseConnectionEnv(targetProject.id);
  const caddy = await writeAndReloadCaddy();
  const updatedTargetProject = getProjectById(targetProject.id) ?? targetProject;

  return c.json({
    service: await publicService(updated),
    project: await summarizeProject(updatedTargetProject, getServicesForProject(updatedTargetProject.id)),
    caddy
  });
});

app.delete("/api/services/:serviceId", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  await removeServiceRuntime(service);
  db.delete(domains).where(eq(domains.serviceId, service.id)).run();
  db.delete(envVars).where(eq(envVars.serviceId, service.id)).run();
  deleteServiceFunctionSource(service.id);

  const serviceDeployments = db.select({ id: deployments.id }).from(deployments).where(eq(deployments.serviceId, service.id)).all();
  if (serviceDeployments.length > 0) {
    db.delete(deploymentLogs).where(inArray(deploymentLogs.deploymentId, serviceDeployments.map((row) => row.id))).run();
  }
  db.delete(deployments).where(eq(deployments.serviceId, service.id)).run();
  db.delete(services).where(eq(services.id, service.id)).run();
  db.update(projectGroups).set({ updatedAt: nowIso() }).where(eq(projectGroups.id, service.projectId)).run();

  const caddy = await writeAndReloadCaddy();
  return c.json({ ok: true, caddy });
});

app.delete("/api/projects/:projectId", async (c) => {
  const project = getProjectById(c.req.param("projectId"));
  if (!project) {
    return jsonError("Project not found", 404);
  }
  const denied = requireProjectAccess(c, project.id);
  if (denied) return denied;

  const projectServices = getServicesForProject(project.id);
  for (const service of projectServices) {
    await removeServiceRuntime(service);
    db.delete(domains).where(eq(domains.serviceId, service.id)).run();
    db.delete(envVars).where(eq(envVars.serviceId, service.id)).run();
    deleteServiceFunctionSource(service.id);
    const serviceDeployments = db.select({ id: deployments.id }).from(deployments).where(eq(deployments.serviceId, service.id)).all();
    if (serviceDeployments.length > 0) {
      db.delete(deploymentLogs).where(inArray(deploymentLogs.deploymentId, serviceDeployments.map((row) => row.id))).run();
    }
    db.delete(deployments).where(eq(deployments.serviceId, service.id)).run();
    db.delete(services).where(eq(services.id, service.id)).run();
  }

  db.delete(projectGroups).where(eq(projectGroups.id, project.id)).run();
  const caddy = await writeAndReloadCaddy();
  return c.json({ ok: true, caddy });
});

app.post("/api/services/:serviceId/deployments", (c) => {
  try {
    const serviceAccess = getAuthorizedService(c);
    if (serviceAccess.response) return serviceAccess.response;
    const { service } = serviceAccess;

    syncProjectDatabaseConnectionEnv(service.projectId);
    const deployment = enqueueDeployment(service.id, { trigger: "manual" });
    return c.json({ deployment }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not create deployment", 404);
  }
});

app.post("/api/deployments/:deploymentId/abort", (c) => {
  try {
    const serviceAccess = getAuthorizedDeploymentService(c);
    if (serviceAccess.response) return serviceAccess.response;

    const result = abortDeployment(c.req.param("deploymentId"));
    return c.json(result, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not abort deployment";
    return jsonError(message, message === "Deployment not found" ? 404 : 409);
  }
});

app.get("/api/services/:serviceId/deployments", (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  const rows = db
    .select()
    .from(deployments)
    .where(eq(deployments.serviceId, service.id))
    .orderBy(desc(deployments.createdAt))
    .limit(30)
    .all();
  return c.json({ deployments: rows });
});

app.get("/api/deployments/:deploymentId/logs", (c) => {
  const serviceAccess = getAuthorizedDeploymentService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const rows = db
    .select()
    .from(deploymentLogs)
    .where(eq(deploymentLogs.deploymentId, c.req.param("deploymentId")))
    .orderBy(asc(deploymentLogs.id))
    .all();
  return c.json({ logs: rows });
});

app.post("/api/deployments/:deploymentId/explain-failure", async (c) => {
  try {
    const serviceAccess = getAuthorizedDeploymentService(c);
    if (serviceAccess.response) return serviceAccess.response;

    const body = deploymentFailureExplanationRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return jsonError(body.error.issues[0]?.message ?? "Invalid AI explanation request");
    }

    const explanation = await explainDeploymentFailure(c.req.param("deploymentId"), {
      providerId: body.data.providerId,
      modelId: body.data.model
    });
    return c.json({ explanation });
  } catch (error) {
    if (error instanceof DeploymentFailureExplanationError) {
      return jsonError(error.message, error.status);
    }
    return jsonError(error instanceof Error ? error.message : "Could not explain this deployment failure", 500);
  }
});

app.get("/api/deployments/:deploymentId/stream", (c) => {
  const serviceAccess = getAuthorizedDeploymentService(c);
  if (serviceAccess.response) return serviceAccess.response;

  const deploymentId = c.req.param("deploymentId");
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        const write = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const existing = db
          .select()
          .from(deploymentLogs)
          .where(eq(deploymentLogs.deploymentId, deploymentId))
          .orderBy(asc(deploymentLogs.id))
          .all();
        write("snapshot", existing);

        const unsubscribe = subscribeToDeploymentLogs(deploymentId, (log) => write("log", log));
        const ping = setInterval(() => write("ping", { t: Date.now() }), 15000);

        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(ping);
          unsubscribe();
          controller.close();
        });
      }
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    }
  );
});

app.get("/api/services/:serviceId/runtime-logs/stream", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  const containerName = containerNameForService(service.id);
  const snapshot = await readContainerLogs(containerName);
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        let closed = false;
        const write = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            closed = true;
          }
        };

        write("snapshot", snapshot);

        let nextId = snapshot.at(-1)?.id ?? 0;
        const child = spawn("docker", ["logs", "-f", "--tail", "0", "--timestamps", containerName], {
          stdio: ["ignore", "pipe", "pipe"]
        });

        const consume = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
          const lines = chunk
            .toString()
            .split(/\r?\n/)
            .map((line) => line.trimEnd())
            .filter(Boolean);

          for (const line of lines) {
            nextId += 1;
            write("log", parseRuntimeLog(line, stream, nextId));
          }
        };

        child.stdout.on("data", consume("stdout"));
        child.stderr.on("data", consume("stderr"));
        child.on("error", (error) => write("status", { ok: false, detail: error.message }));
        child.on("close", () => write("status", { ok: true, closed: true }));

        const ping = setInterval(() => write("ping", { t: Date.now() }), 15000);

        c.req.raw.signal.addEventListener("abort", () => {
          if (closed) return;
          closed = true;
          clearInterval(ping);
          child.kill("SIGTERM");
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        });
      }
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    }
  );
});

app.post("/api/services/:serviceId/env", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  const body = envSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid env var");
  }

  const timestamp = nowIso();
  const normalizedValue = normalizeEnvValue(body.data.value);
  db.insert(envVars)
    .values({ id: nanoid(10), serviceId: service.id, key: body.data.key, value: normalizedValue, createdAt: timestamp, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: [envVars.serviceId, envVars.key],
      set: { value: normalizedValue, updatedAt: timestamp }
    })
    .run();

  syncDatabaseUrlEnvVar(service.id);

  return c.json({ ok: true }, 201);
});

app.delete("/api/services/:serviceId/env/:envId", (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  db.delete(envVars).where(and(eq(envVars.id, c.req.param("envId")), eq(envVars.serviceId, service.id))).run();
  syncDatabaseUrlEnvVar(service.id);
  return c.json({ ok: true });
});

app.post("/api/services/:serviceId/domains", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  if (isWorkerService(service)) {
    return jsonError("Background workers do not accept custom domains");
  }

  const body = domainSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid domain");
  }

  const timestamp = nowIso();
  const isLocal = body.data.hostname.endsWith(".localhost") || body.data.hostname === "localhost" || body.data.hostname === "127.0.0.1";
  const initialStatus = isLocal ? "active" : "pending";

  db.insert(domains)
    .values({ id: nanoid(10), serviceId: service.id, hostname: body.data.hostname, status: initialStatus, createdAt: timestamp, updatedAt: timestamp })
    .run();

  const caddy = await writeAndReloadCaddy();
  return c.json({ ok: true, caddy }, 201);
});

app.delete("/api/services/:serviceId/domains/:domainId", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;

  db.delete(domains).where(and(eq(domains.id, c.req.param("domainId")), eq(domains.serviceId, service.id))).run();
  const caddy = await writeAndReloadCaddy();
  return c.json({ ok: true, caddy });
});

app.patch("/api/services/:serviceId/domains/:domainId", async (c) => {
  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  if (isWorkerService(service)) {
    return jsonError("Background workers do not accept custom domains");
  }

  const body = domainSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid domain");
  }

  const hostname = body.data.hostname.trim().toLowerCase();
  const isLocal = hostname.endsWith(".localhost") || hostname === "localhost" || hostname === "127.0.0.1";
  const status = isLocal ? "active" : "pending";

  db.update(domains)
    .set({ hostname, status, updatedAt: nowIso() })
    .where(and(eq(domains.id, c.req.param("domainId")), eq(domains.serviceId, service.id)))
    .run();

  const caddy = await writeAndReloadCaddy();
  return c.json({ ok: true, caddy });
});

app.post("/api/services/:serviceId/domains/:domainId/dns-records", async (c) => {
  const ownerDenied = requireOwnerSessionAccess(c);
  if (ownerDenied) return ownerDenied;

  const serviceAccess = getAuthorizedService(c);
  if (serviceAccess.response) return serviceAccess.response;
  const { service } = serviceAccess;
  if (isWorkerService(service)) {
    return jsonError("Background workers do not accept custom domains");
  }

  const body = dnsRecordApplySchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError(body.error.issues[0]?.message ?? "Invalid DNS provider");
  }

  const domain = db
    .select()
    .from(domains)
    .where(and(eq(domains.id, c.req.param("domainId")), eq(domains.serviceId, service.id)))
    .get();
  if (!domain) {
    return jsonError("Domain not found", 404);
  }

  const settings = getSystemSettings();
  const providerSettings = dnsProviderSettings(settings.dns, body.data.providerId);
  if (!providerSettings) {
    return jsonError(`${dnsProviderName(body.data.providerId)} is not connected in system settings.`, 409);
  }

  try {
    const result = await applyDnsProviderARecord(body.data.providerId, providerSettings, {
      hostname: domain.hostname,
      targetIp: cachedPublicIp,
      publicIp: cachedPublicIp
    });
    const status = await checkDomainDns(domain.hostname, cachedPublicIp);
    const updatedAt = nowIso();
    db.update(domains).set({ status, updatedAt }).where(eq(domains.id, domain.id)).run();

    return c.json({
      ok: true,
      result,
      domain: {
        ...domain,
        status,
        updatedAt
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : `Could not update ${dnsProviderName(body.data.providerId)} DNS record`, 400);
  }
});

app.post("/api/github/app/webhook", async (c) => {
  if (!config.githubWebhookSecret) {
    return jsonError("GitHub webhook secret is not configured", 503);
  }
  const rawBody = await c.req.text();
  if (!verifyGitHubSignature(rawBody, c.req.header("x-hub-signature-256"), config.githubWebhookSecret)) {
    return jsonError("Invalid webhook signature", 401);
  }

  const event = c.req.header("x-github-event");
  if (event === "ping") {
    return c.json({ ok: true, event: "ping" });
  }

  if (event !== "push") {
    return c.json({ ok: true, ignored: event });
  }

  const payload = JSON.parse(rawBody) as {
    after?: string;
    ref?: string;
    repository?: {
      full_name?: string;
    };
  };
  const branch = branchFromGitRef(payload.ref);
  const repoFullName = payload.repository?.full_name;
  if (!branch || !repoFullName) {
    return c.json({ ok: true, ignored: "missing ref or repository" });
  }

  const matchingServices = db
    .select()
    .from(services)
    .where(and(eq(services.repoFullName, repoFullName), eq(services.branch, branch)))
    .all();

  if (matchingServices.length === 0) {
    return c.json({ ok: true, ignored: `${repoFullName}@${branch}` });
  }

  for (const projectId of new Set(matchingServices.map((service) => service.projectId))) {
    syncProjectDatabaseConnectionEnv(projectId);
  }

  const queued = matchingServices.map((service) => enqueueDeployment(service.id, { trigger: "github", commitSha: payload.after }));
  return c.json({ ok: true, queued: queued.map((deployment) => deployment.id) });
});

app.post("/api/integrations/railway/projects", async (c) => {
  try {
    const body = await c.req.json();
    const token = body?.apiToken;
    if (!token) {
      return jsonError("API Token is required");
    }
    const projects = await getRailwayProjects(token);
    return c.json({ projects });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load Railway projects";
    return jsonError(msg);
  }
});

app.post("/api/integrations/railway/project-details", async (c) => {
  try {
    const body = await c.req.json();
    const token = body?.apiToken;
    const projectId = body?.projectId;
    if (!token || !projectId) {
      return jsonError("API Token and Project ID are required");
    }
    const details = await getRailwayProjectDetails(token, projectId);
    return c.json({ details });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load Railway project details";
    return jsonError(msg);
  }
});

app.post("/api/integrations/railway/import", async (c) => {
  try {
    const body = await c.req.json();
    const token = body?.apiToken;
    const projectId = body?.projectId;
    const config = body?.config || {};
    if (!token || !projectId) {
      return jsonError("API Token and Project ID are required");
    }
    const ownerUserId = actorUserId(c);
    if (!ownerUserId) {
      return jsonError("Authenticated user not found", 401);
    }
    const result = await importRailwayProject(token, projectId, config, { ownerUserId });
    const autoDeploy = config.autoDeploy !== false;
    const importDatabaseData = Boolean(config.importDatabaseData) && autoDeploy && config.importDatabases !== false;
    startRailwayImportAutomation({
      railwayToken: token,
      autoDeploy,
      importDatabaseData,
      databaseServiceIds: result.databaseServiceIds,
      appServiceIds: result.appServiceIds
    });

    return c.json({
      ok: true,
      projectSlug: result.projectSlug,
      importedCustomDomainCount: result.importedCustomDomainCount,
      linkedDatabaseVariables: result.linkedDatabaseVariables,
      syncedDatabaseVariables: result.syncedDatabaseVariables
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to import Railway project";
    return jsonError(msg);
  }
});

app.post("/api/integrations/vercel/teams", async (c) => {
  try {
    const body = await c.req.json();
    const token = body?.apiToken;
    if (!token) {
      return jsonError("API Token is required");
    }
    const teams = await getVercelTeams(token);
    return c.json({ teams });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load Vercel teams";
    return jsonError(msg);
  }
});

app.post("/api/integrations/vercel/projects", async (c) => {
  try {
    const body = await c.req.json();
    const token = body?.apiToken;
    if (!token) {
      return jsonError("API Token is required");
    }
    const teamId = optionalString.parse(body?.teamId);
    const projects = await getVercelProjects(token, teamId);
    return c.json({ projects });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load Vercel projects";
    return jsonError(msg);
  }
});

app.post("/api/integrations/vercel/project-details", async (c) => {
  try {
    const body = await c.req.json();
    const token = body?.apiToken;
    const projectId = body?.projectId;
    if (!token || !projectId) {
      return jsonError("API Token and Project ID are required");
    }
    const teamId = optionalString.parse(body?.teamId);
    const details = await getVercelProjectDetails(token, projectId, teamId);
    return c.json({ details });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load Vercel project details";
    return jsonError(msg);
  }
});

app.post("/api/integrations/vercel/import", async (c) => {
  try {
    const body = await c.req.json();
    const token = body?.apiToken;
    const projectId = body?.projectId;
    const config = body?.config || {};
    if (!token || !projectId) {
      return jsonError("API Token and Project ID are required");
    }
    const ownerUserId = actorUserId(c);
    if (!ownerUserId) {
      return jsonError("Authenticated user not found", 401);
    }
    const teamId = optionalString.parse(body?.teamId);
    const result = await importVercelProject(token, projectId, config, { ownerUserId, teamId });

    if (config.autoDeploy !== false) {
      for (const serviceId of result.appServiceIds) {
        enqueueDeployment(serviceId, { trigger: "manual" });
      }
    }

    return c.json({
      ok: true,
      projectSlug: result.projectSlug,
      importedCustomDomainCount: result.importedCustomDomainCount,
      importedVariableCount: result.importedVariableCount,
      skippedSensitiveCount: result.skippedSensitiveCount
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to import Vercel project";
    return jsonError(msg);
  }
});

app.get("/api/search", (c) => {
  const result = searchSchema.safeParse(c.req.query());
  return c.json(result.success ? result.data : {});
});

if (process.env.NODE_ENV === "production") {
  app.use("*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
}

syncAllExistingDatabaseUrls();
ensureDefaultDomainsForExistingServices();
void writeAndReloadCaddy().catch((error) => {
  console.error("Failed to write Caddy config on startup:", error);
});
startDatabaseBackupScheduler();
startDeployWorker();
void prewarmFrameworkIconCache().catch((error) => {
  console.error("Failed to prewarm framework icon cache:", error);
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Aeroplane control plane listening on http://${info.address}:${info.port}`);
});
