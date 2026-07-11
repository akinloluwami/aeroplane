import type { AiProviderId, AiProviderModel } from "../shared/ai-providers";
import type { FunctionRuntime } from "../shared/service-functions";
export type { AiProviderId, AiProviderModel } from "../shared/ai-providers";

export type Framework = {
  slug: string;
  name: string;
  logoUrl: null | string;
  website: null | string;
};

export type FrameworkIconAsset = Framework & {
  category: "database" | "framework";
};

export type ServiceRuntimeMode = "web" | "worker";

export type ServiceBuildMethod = "auto" | "railpack" | "dockerfile";

export type Service = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  repoFullName: null | string;
  repoUrl: string;
  dockerImage: null | string;
  functionRuntime: null | FunctionRuntime;
  branch: string;
  rootDir: null | string;
  hasGithubToken: boolean;
  installCommand: null | string;
  buildCommand: null | string;
  startCommand: null | string;
  staticOutput: null | string;
  buildMethod: ServiceBuildMethod;
  dockerfilePath: null | string;
  detectedBuildMethod: null | "railpack" | "dockerfile";
  runtimeMode: ServiceRuntimeMode;
  internalPort: number;
  hostPort: number;
  databasePublicEnabled: boolean;
  databasePublicHostname: null | string;
  postgresLogicalReplicationEnabled: boolean;
  status: string;
  reachable: boolean;
  localUrl: string;
  primaryUrl: string;
  preferredDomain: { hostname: string; status: string } | null;
  framework: Framework | null;
  lastDeployedAt: null | string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCard = {
  id: string;
  name: string;
  slug: string;
  description: null | string;
  status: string;
  serviceCount: number;
  lastUpdatedAt: string;
  services: Service[];
};

export type ProjectDetail = ProjectCard;

export type Deployment = {
  id: string;
  serviceId: string;
  commitSha: null | string;
  status: string;
  trigger: string;
  imageTag: null | string;
  containerName: null | string;
  startedAt: null | string;
  finishedAt: null | string;
  createdAt: string;
};

export type DeploymentLog = {
  id: number;
  deploymentId: string;
  line: string;
  stream: string;
  createdAt: string;
};

export type DeploymentFailureExplanation = {
  summary: string;
  cause: string;
  suggestedFix: string;
  confidence: "low" | "medium" | "high";
  commands: string[];
  relatedLogLines: string[];
  provider: AiProviderId;
  providerName: string;
  model: string;
};

export type RuntimeLog = {
  id: number;
  line: string;
  stream: string;
  createdAt: string;
};

export type DatabaseRowValue = null | boolean | number | string;

export type DatabaseRow = Record<string, DatabaseRowValue>;

export type DatabaseTable = {
  id: string;
  schema: string;
  name: string;
  rowCount: number | null;
};

export type DatabaseSchema = {
  name: string;
};

export type DatabaseColumn = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
};

export type DatabaseFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than";

export type DatabaseRowFilter = {
  column: string;
  operator: DatabaseFilterOperator;
  value: string;
};

export type DatabaseRuntimeState = "ready" | "deploying" | "idle" | "failed" | "unavailable";

export type DatabaseTablesResponse = {
  engine: string;
  supported: boolean;
  editable: boolean;
  schemas: DatabaseSchema[];
  tables: DatabaseTable[];
  message?: string;
  runtimeState?: DatabaseRuntimeState;
  serviceStatus?: string;
  deploymentStatus?: string | null;
};

export type DatabaseRowsResponse = {
  engine: string;
  editable: boolean;
  table: string;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  limit: number;
  offset: number;
  totalRows: number;
};

export type DatabaseQueryResult = {
  engine: string;
  columns: string[];
  rows: DatabaseRow[];
  rowCount: number;
  message?: string;
  elapsedMs: number;
};

export type R2SettingsStatus = {
  connected: boolean;
  accountId: string;
  bucket: string;
  endpoint: string;
  accessKeyIdSuffix: string;
  connectedAt: null | string;
  updatedAt: null | string;
};

export type DnsProviderId = "cloudflare" | "namecheap" | "spaceship";

export type DnsProviderStatus = {
  id: DnsProviderId;
  name: string;
  connected: boolean;
  values: Record<string, string>;
  secretSuffixes: Record<string, string>;
  keySuffix: string;
  connectedAt: null | string;
  updatedAt: null | string;
};

export type DnsSettingsStatus = {
  providers: DnsProviderStatus[];
};

export type AiProviderStatus = {
  id: AiProviderId;
  name: string;
  connected: boolean;
  keySuffix: string;
  selectedModel: string;
  models: AiProviderModel[];
  connectedAt: null | string;
  updatedAt: null | string;
};

export type AiSettingsStatus = {
  defaultProvider: AiProviderId | null;
  defaultModel: string;
  providers: AiProviderStatus[];
};

export type DnsRecordApplyResult = {
  provider: DnsProviderId;
  providerName: string;
  action: "created" | "updated";
  hostname: string;
  recordType: "A";
  host: string;
  zone: string;
  targetIp: string;
};

export type SystemSettings = {
  rootDomain: string;
  controlPlaneHostname: string;
  deploymentConcurrency: number;
  databaseBackupScheduleDefaults: BackupScheduleEnabled;
  databaseBackupsAutomaticEnabled?: boolean;
};

export type ApiKeyAccessLevel = "read" | "write";
export type ApiKeyProjectScope = "all" | "selected";
export type ApiKeyExpiryDays = 7 | 30 | 90 | null;

export type ApiKeySummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  accessLevel: ApiKeyAccessLevel;
  projectScope: ApiKeyProjectScope;
  projectIds: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: null | string;
  expiresAt: null | string;
  revokedAt: null | string;
};

export type ApiKeyProjectOption = {
  id: string;
  name: string;
  slug: string;
};

export type DatabaseBackup = {
  id: string;
  serviceId: string;
  engine: string;
  status: "running" | "succeeded" | "failed";
  trigger: "manual" | "daily" | "weekly" | "monthly";
  storage: BackupStorageTarget;
  format: string;
  localPath: null | string;
  fileName: null | string;
  r2Key: null | string;
  sizeBytes: null | number;
  checksum: null | string;
  error: null | string;
  createdAt: string;
  startedAt: null | string;
  finishedAt: null | string;
};

export type BackupStorageTarget = "disk" | "r2" | "disk+r2";
export type BackupScheduleTrigger = "daily" | "weekly" | "monthly";
export type BackupScheduleEnabled = Record<BackupScheduleTrigger, boolean>;

export type DatabaseBackupSettings = {
  storage: BackupStorageTarget;
  automaticEnabled: boolean;
  defaultStorage: BackupStorageTarget;
  schedules: Array<{
    trigger: BackupScheduleTrigger;
    intervalHours: number;
    retentionDays: number;
    enabled: boolean;
  }>;
  scheduleEnabled: BackupScheduleEnabled;
};

export type ServiceImportSource = {
  id: string;
  serviceId: string;
  provider: string;
  externalProjectId: null | string;
  externalEnvironmentId: null | string;
  externalServiceId: string;
  externalServiceName: null | string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type PostgresDataImportResult = {
  ok: true;
  serviceId: string;
  source: "postgres-url" | "railway";
  sourceLabel: string;
  sourceVariableKey?: string;
  dumpSizeBytes: number;
  checksum: string;
  importedAt: string;
};

export type RedisDataImportResult = {
  ok: true;
  serviceId: string;
  source: "redis-url" | "railway";
  sourceLabel: string;
  sourceVariableKey?: string;
  dumpSizeBytes: number;
  checksum: string;
  importedAt: string;
};

export type DatabaseDataImport = {
  id: string;
  serviceId: string;
  engine: string;
  source: string;
  sourceLabel: string;
  sourceVariableKey: null | string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  dumpSizeBytes: null | number;
  checksum: null | string;
  error: null | string;
  createdAt: string;
  startedAt: null | string;
  finishedAt: null | string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ManagedUser = AuthUser & {
  projectCount: number;
  serviceCount: number;
  activeServiceCount: number;
  apiKeyCount: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: null | string;
};

function managedUsersFromPayload(payload: unknown): ManagedUser[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const users = (payload as { users?: unknown }).users;
  return Array.isArray(users) ? users as ManagedUser[] : [];
}

export type AuthStatus = {
  setupComplete: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  secretKeyConfigured: boolean;
  envPath: string;
  publicIp?: string;
  runtimeConfig?: {
    dataDir: string;
    deployDryRun: boolean;
    caddyConfigPath: string;
    caddyDataDir: string;
    caddyReloadCmd: string;
    port: number;
    publicUrl: string;
    controlPlaneHostname: string;
    buildkitHost: string;
    runtimeNetworkName: string;
  };
};

export type OnboardingPayload = {
  owner: {
    name: string;
    email: string;
    password: string;
  };
  env: {
    secretKey?: string;
    dataDir: string;
    deployDryRun: boolean;
    caddyConfigPath: string;
    caddyDataDir: string;
    caddyReloadCmd: string;
    port: number;
    publicUrl: string;
    controlPlaneHostname?: string;
    buildkitHost: string;
    runtimeNetworkName: string;
    githubAccessToken?: string;
    githubAppId?: string;
    githubAppClientId?: string;
    githubAppSlug?: string;
    githubAppPrivateKey?: string;
    githubWebhookSecret?: string;
  };
  rootDomain?: string;
  r2?: {
    accountId?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    createBucket?: boolean;
  };
  databaseBackupScheduleDefaults?: BackupScheduleEnabled;
  databaseBackupsAutomaticEnabled?: boolean;
};

export type EnvVar = {
  id: string;
  key: string;
  hasValue: boolean;
  value?: string;
  resolvedValue?: string;
  createdAt: string;
  updatedAt: string;
};

export type DatabaseVariableSuggestion = {
  key: string;
  sourceKey: string;
  value: string;
  label: string;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  dbType: string;
};

export type EnvExampleVariableSuggestion = {
  key: string;
  value: string;
  label: string;
  sourcePath: string;
};

export type Domain = {
  id: string;
  serviceId: string;
  hostname: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ToolCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type SystemUpdateCommit = {
  sha: string;
  shortSha: string;
  title: string;
  author: string;
  date: string;
  url: null | string;
};

export type SystemUpdateRun = {
  status: "idle" | "running" | "succeeded" | "failed";
  startedAt: null | string;
  finishedAt: null | string;
  targetCommit: null | string;
  restartQueued: boolean;
  logs: string[];
  error: null | string;
};

export type SystemUpdateInfo = {
  installType: "git" | "image";
  repo: string;
  repoUrl: string;
  branch: string;
  currentCommit: null | string;
  currentShortCommit: null | string;
  remoteCommit: null | string;
  remoteShortCommit: null | string;
  status: "current" | "available" | "diverged" | "unknown";
  dirty: boolean;
  commits: SystemUpdateCommit[];
  checkedAt: string;
  error: null | string;
  updateRun: SystemUpdateRun;
  updateCommand: null | string;
  canApplyUpdate: boolean;
};

export type MaintenanceCleanupTarget =
  | "docker-containers"
  | "docker-images"
  | "docker-build-cache"
  | "docker-volumes"
  | "apt-cache"
  | "journals"
  | "build-artifacts";

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

export type MigrationImportResult = {
  importedAt: string;
  projects: number;
  services: number;
  users: number;
  restoredDatabases: number;
  databaseDumps: Array<{
    serviceId: string;
    engine: string;
    format: string;
    path: string;
    sizeBytes: number;
    checksum: string;
  }>;
};

export type ServiceOverview = {
  service: Service;
  deployments: Deployment[];
  env: EnvVar[];
  domains: Domain[];
  publicIp?: string;
};

export type FunctionSource = {
  runtime: FunctionRuntime;
  sourceCode: string;
  fileName: string;
  updatedAt: string;
};

export type FunctionCodeGeneration = {
  sourceCode: string;
  provider: AiProviderId;
  providerName: string;
  model: string;
};

export type GitHubRepo = {
  id: string;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string;
  updatedAt: string;
  cloneUrl: string;
};

export type GitHubDirectory = {
  path: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  framework: Framework | null;
};

export type GitHubStatus = {
  appConfigured: boolean;
  connected: boolean;
  installationCount: number;
  installed: boolean;
  installUrl: null | string;
  mode: "app" | "token" | "none";
};

export type GitHubSettingsStatus = {
  status: GitHubStatus;
  statusError: string;
  settings: {
    githubAccessTokenSuffix: string;
    githubAppId: string;
    githubAppClientId: string;
    githubAppSlug: string;
    githubAppPrivateKeyConfigured: boolean;
    githubWebhookSecretSuffix: string;
    envPath: string;
  };
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {})
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      throw new Error(`Could not reach the Aeroplane API at ${path}. Check that your domain/proxy forwards /api requests to Aeroplane, then try again.`);
    }
    throw new Error(message);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (payload as { error?: string }).error;
    throw new Error(detail ?? `Request failed with HTTP ${response.status}`);
  }

  return payload as T;
}

async function requestJsonError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({}));
  return new Error((payload as { error?: string }).error ?? fallback);
}

function downloadFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  login: (body: { email: string; password: string }) =>
    request<{ ok: boolean; user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  setup: (body: OnboardingPayload) =>
    request<{ ok: boolean; user: AuthUser; envPath: string; restartRequired: boolean }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  restartOnboarding: (body: Omit<OnboardingPayload, "owner">) =>
    request<{ ok: boolean; envPath: string; restartRequired: boolean }>("/api/system/onboarding/restart", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  system: () => request<{ tools: ToolCheck[] }>("/api/system"),
  frameworkIcons: () => request<{ icons: FrameworkIconAsset[] }>("/api/assets/framework-icons"),
  githubStatus: () => request<GitHubStatus>("/api/github/status"),
  githubRepos: (query = "") => request<{ repos: GitHubRepo[] }>(`/api/github/repos?q=${encodeURIComponent(query)}`),
  githubBranches: (repoFullName: string) => request<{ branches: string[] }>(`/api/github/branches?repo=${encodeURIComponent(repoFullName)}`),
  githubDirectories: (repoFullName: string, branch: string, path = "") =>
    request<{ directories: GitHubDirectory[]; rootFramework: Framework | null }>(
      `/api/github/directories?repo=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
    ),
  githubDirectoryFramework: (repoFullName: string, branch: string, path = "") =>
    request<{ framework: Framework | null }>(
      `/api/github/directories/framework?repo=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
    ),
  projects: () => request<{ projects: ProjectCard[] }>("/api/projects"),
  project: (slug: string) => request<{ project: ProjectDetail }>(`/api/projects/${slug}`),
  createProject: (body: unknown) => request<{ project: ProjectDetail }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (projectId: string, body: unknown) =>
    request<{ project: ProjectDetail }>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(body) }),
  createService: (projectId: string, body: unknown) =>
    request<{ service: Service }>(`/api/projects/${projectId}/services`, { method: "POST", body: JSON.stringify(body) }),
  projectDatabaseVariableSuggestions: (projectId: string) =>
    request<{ suggestions: DatabaseVariableSuggestion[] }>(`/api/projects/${projectId}/database-variable-suggestions`),
  projectEnvExampleVariableSuggestions: (projectId: string, params: { repoFullName: string; branch: string; rootDir?: string | null }) =>
    request<{ suggestions: EnvExampleVariableSuggestion[] }>(
      `/api/projects/${projectId}/env-example-variable-suggestions?repo=${encodeURIComponent(params.repoFullName)}&branch=${encodeURIComponent(params.branch)}&rootDir=${encodeURIComponent(params.rootDir ?? "")}`
    ),
  deleteProject: (projectId: string) => request(`/api/projects/${projectId}`, { method: "DELETE" }),
  serviceOverview: (serviceId: string) => request<ServiceOverview>(`/api/services/${serviceId}/overview`),
  functionSource: (serviceId: string) => request<{ source: FunctionSource }>(`/api/services/${serviceId}/function-source`),
  updateFunctionSource: (serviceId: string, body: { runtime?: FunctionRuntime; sourceCode?: string }) =>
    request<{ source: FunctionSource; service: Service | null }>(`/api/services/${serviceId}/function-source`, { method: "PATCH", body: JSON.stringify(body) }),
  generateFunctionSource: (serviceId: string, body: { prompt: string; runtime: FunctionRuntime; sourceCode?: string; providerId?: AiProviderId; model?: string }) =>
    request<{ generation: FunctionCodeGeneration }>(`/api/services/${serviceId}/function-source/generate`, { method: "POST", body: JSON.stringify(body) }),
  updateService: (serviceId: string, body: unknown) =>
    request<{ service: Service }>(`/api/services/${serviceId}`, { method: "PATCH", body: JSON.stringify(body) }),
  transferService: (serviceId: string, body: { targetProjectId: string }) =>
    request<{ service: Service; project: ProjectDetail }>(`/api/services/${serviceId}/transfer`, { method: "POST", body: JSON.stringify(body) }),
  deleteService: (serviceId: string) => request(`/api/services/${serviceId}`, { method: "DELETE" }),
  createDeployment: (serviceId: string) =>
    request<{ deployment: Deployment }>(`/api/services/${serviceId}/deployments`, { method: "POST" }),
  abortDeployment: (deploymentId: string) =>
    request<{ accepted: boolean }>(`/api/deployments/${deploymentId}/abort`, { method: "POST" }),
  deploymentLogs: (deploymentId: string) => request<{ logs: DeploymentLog[] }>(`/api/deployments/${deploymentId}/logs`),
  explainDeploymentFailure: (deploymentId: string, body?: { providerId?: AiProviderId; model?: string }) =>
    request<{ explanation: DeploymentFailureExplanation }>(`/api/deployments/${deploymentId}/explain-failure`, {
      method: "POST",
      body: JSON.stringify(body ?? {})
    }),
  upsertEnv: (serviceId: string, body: unknown) =>
    request(`/api/services/${serviceId}/env`, { method: "POST", body: JSON.stringify(body) }),
  deleteEnv: (serviceId: string, envId: string) => request(`/api/services/${serviceId}/env/${envId}`, { method: "DELETE" }),
  suggestionKeys: (serviceId: string) =>
    request<{ suggestions: Array<{ key: string; label: string }>; databaseVariables: DatabaseVariableSuggestion[] }>(`/api/services/${serviceId}/suggestion-keys`),
  addDomain: (serviceId: string, body: unknown) =>
    request(`/api/services/${serviceId}/domains`, { method: "POST", body: JSON.stringify(body) }),
  deleteDomain: (serviceId: string, domainId: string) =>
    request(`/api/services/${serviceId}/domains/${domainId}`, { method: "DELETE" }),
  updateDomain: (serviceId: string, domainId: string, body: { hostname: string }) =>
    request(`/api/services/${serviceId}/domains/${domainId}`, { method: "PATCH", body: JSON.stringify(body) }),
  applyDnsRecord: (serviceId: string, domainId: string, providerId: DnsProviderId) =>
    request<{ ok: boolean; result: DnsRecordApplyResult; domain: Domain }>(`/api/services/${serviceId}/domains/${domainId}/dns-records`, {
      method: "POST",
      body: JSON.stringify({ providerId })
    }),
  databaseTables: (serviceId: string, logicalDatabase?: number) => {
    const suffix = logicalDatabase === undefined ? "" : `?database=${encodeURIComponent(String(logicalDatabase))}`;
    return request<DatabaseTablesResponse>(`/api/services/${serviceId}/database/tables${suffix}`);
  },
  databaseRows: (serviceId: string, table: string, limit = 50, offset = 0, filters: DatabaseRowFilter[] = []) => {
    const params = new URLSearchParams({
      table,
      limit: String(limit),
      offset: String(offset)
    });
    if (filters.length > 0) params.set("filters", JSON.stringify(filters));
    return request<DatabaseRowsResponse>(`/api/services/${serviceId}/database/rows?${params.toString()}`);
  },
  databaseQuery: (serviceId: string, sql: string) =>
    request<DatabaseQueryResult>(`/api/services/${serviceId}/database/query`, {
      method: "POST",
      body: JSON.stringify({ sql })
    }),
  insertDatabaseRow: (serviceId: string, body: { table: string; values: DatabaseRow }) =>
    request<{ ok: boolean; table?: string; id?: string }>(`/api/services/${serviceId}/database/rows`, { method: "POST", body: JSON.stringify(body) }),
  updateDatabaseRow: (serviceId: string, body: { table: string; primaryKey: DatabaseRow; values: DatabaseRow }) =>
    request(`/api/services/${serviceId}/database/rows`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDatabaseRow: (serviceId: string, body: { table: string; primaryKey: DatabaseRow }) =>
    request(`/api/services/${serviceId}/database/rows`, { method: "DELETE", body: JSON.stringify(body) }),
  railwayProjects: (apiToken: string) =>
    request<{ projects: Array<{ id: string; name: string; description: string; serviceCount: number }> }>(
      "/api/integrations/railway/projects",
      { method: "POST", body: JSON.stringify({ apiToken }) }
    ),
  railwayProjectDetails: (apiToken: string, projectId: string) =>
    request<{
      details: {
        id: string;
        name: string;
        description: string;
        services: Array<{
          id: string;
          name: string;
          kind: "git" | "database" | "docker-image" | "unsupported";
          sourceLabel: string;
          unsupportedReason: null | string;
          dbType: null | string;
          image: null | string;
          sourcesByEnvironment: Record<string, {
            kind: "git" | "database" | "docker-image" | "unsupported";
            sourceLabel: string;
            unsupportedReason: null | string;
            dbType: null | string;
            image: null | string;
          }>;
        }>;
        environments: Array<{ id: string; name: string }>;
      };
    }>("/api/integrations/railway/project-details", {
      method: "POST",
      body: JSON.stringify({ apiToken, projectId })
    }),
  railwayImport: (apiToken: string, projectId: string, config?: unknown) =>
    request<{
      ok: boolean;
      projectSlug: string;
      importedCustomDomainCount?: number;
      linkedDatabaseVariables?: number;
      syncedDatabaseVariables?: number;
    }>("/api/integrations/railway/import", {
      method: "POST",
      body: JSON.stringify({ apiToken, projectId, config })
    }),
  vercelTeams: (apiToken: string) =>
    request<{ teams: Array<{ id: string; slug: string; name: string }> }>("/api/integrations/vercel/teams", {
      method: "POST",
      body: JSON.stringify({ apiToken })
    }),
  vercelProjects: (apiToken: string, teamId?: string) =>
    request<{
      projects: Array<{
        id: string;
        name: string;
        framework: string | null;
        kind: "git" | "unsupported";
        sourceLabel: string;
      }>;
    }>("/api/integrations/vercel/projects", {
      method: "POST",
      body: JSON.stringify({ apiToken, teamId })
    }),
  vercelProjectDetails: (apiToken: string, projectId: string, teamId?: string) =>
    request<{
      details: {
        id: string;
        name: string;
        framework: string | null;
        rootDirectory: string | null;
        buildCommand: string | null;
        installCommand: string | null;
        branch: string | null;
        kind: "git" | "unsupported";
        sourceLabel: string;
        unsupportedReason: string | null;
        targets: Array<"production" | "preview" | "development">;
      };
    }>("/api/integrations/vercel/project-details", {
      method: "POST",
      body: JSON.stringify({ apiToken, projectId, teamId })
    }),
  vercelImport: (apiToken: string, projectId: string, teamId: string | undefined, config?: unknown) =>
    request<{
      ok: boolean;
      projectSlug: string;
      importedCustomDomainCount?: number;
      importedVariableCount?: number;
      skippedSensitiveCount?: number;
    }>("/api/integrations/vercel/import", {
      method: "POST",
      body: JSON.stringify({ apiToken, projectId, teamId, config })
    }),
  systemSettings: () =>
    request<{
      settings: SystemSettings;
      publicIp: string;
      dnsStatus?: "active" | "pending";
      controlPlaneDnsStatus?: "active" | "pending";
    }>("/api/system/settings"),
  updateSystemSettings: (body: {
    rootDomain?: string;
    controlPlaneHostname?: string;
    deploymentConcurrency?: number;
    databaseBackupScheduleDefaults?: BackupScheduleEnabled;
    databaseBackupsAutomaticEnabled?: boolean;
  }) =>
    request<{ ok: boolean; settings: SystemSettings; caddy?: { ok: boolean; detail: string } }>("/api/system/settings", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  systemUsers: async () => {
    const payload = await request<{ users?: unknown } | ManagedUser[]>("/api/system/users");
    return { users: managedUsersFromPayload(payload) };
  },
  createSystemUser: (body: { email: string; password: string }) =>
    request<{ user: ManagedUser }>("/api/system/users", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  apiKeys: () => request<{ apiKeys: ApiKeySummary[]; projects: ApiKeyProjectOption[] }>("/api/system/api-keys"),
  createApiKey: (body: {
    name: string;
    accessLevel: ApiKeyAccessLevel;
    projectScope: ApiKeyProjectScope;
    projectIds: string[];
    expiresInDays: ApiKeyExpiryDays;
  }) =>
    request<{ apiKey: ApiKeySummary; token: string }>("/api/system/api-keys", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  revokeApiKey: (apiKeyId: string) => request<{ ok: boolean }>(`/api/system/api-keys/${apiKeyId}`, { method: "DELETE" }),
  r2Settings: () => request<{ r2: R2SettingsStatus }>("/api/system/r2"),
  updateR2Settings: (body: {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey?: string;
    createBucket?: boolean;
  }) =>
    request<{ ok: boolean; r2: R2SettingsStatus }>("/api/system/r2", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  disconnectR2: () => request<{ ok: boolean; r2: R2SettingsStatus }>("/api/system/r2", { method: "DELETE" }),
  backupR2Settings: () => request<{ r2: R2SettingsStatus }>("/api/system/backup-storage/r2"),
  updateBackupR2Settings: (body: {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey?: string;
    createBucket?: boolean;
  }) =>
    request<{ ok: boolean; r2: R2SettingsStatus }>("/api/system/backup-storage/r2", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  disconnectBackupR2: () => request<{ ok: boolean; r2: R2SettingsStatus }>("/api/system/backup-storage/r2", { method: "DELETE" }),
  dnsSettings: () => request<{ dns: DnsSettingsStatus }>("/api/system/dns"),
  updateDnsProvider: (providerId: DnsProviderId, body: Record<string, string>) =>
    request<{ ok: boolean; dns: DnsSettingsStatus }>(`/api/system/dns/${providerId}`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  disconnectDnsProvider: (providerId: DnsProviderId) =>
    request<{ ok: boolean; dns: DnsSettingsStatus }>(`/api/system/dns/${providerId}`, { method: "DELETE" }),
  aiSettings: () => request<{ ai: AiSettingsStatus }>("/api/system/ai"),
  updateAiSettings: (body: { defaultProvider: AiProviderId; defaultModel?: string }) =>
    request<{ ok: boolean; ai: AiSettingsStatus }>("/api/system/ai", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateAiProvider: (providerId: AiProviderId, body: { apiKey: string; selectedModel: string }) =>
    request<{ ok: boolean; ai: AiSettingsStatus }>(`/api/system/ai/providers/${providerId}`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  disconnectAiProvider: (providerId: AiProviderId) =>
    request<{ ok: boolean; ai: AiSettingsStatus }>(`/api/system/ai/providers/${providerId}`, { method: "DELETE" }),
  githubManifest: (body: { redirectTo: "onboarding" | "settings"; organization?: string }) =>
    request<{ postUrl: string; manifest: string }>("/api/github/manifest", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  githubSettings: () => request<GitHubSettingsStatus>("/api/system/github"),
  updateGithubSettings: (body: {
    githubAccessToken?: string;
    githubAppId?: string;
    githubAppClientId?: string;
    githubAppSlug?: string;
    githubAppPrivateKey?: string;
    githubWebhookSecret?: string;
  }) =>
    request<{ ok: boolean } & GitHubSettingsStatus>("/api/system/github", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  disconnectGithub: () => request<{ ok: boolean } & GitHubSettingsStatus>("/api/system/github", { method: "DELETE" }),
  systemUpdates: () => request<SystemUpdateInfo>("/api/system/updates"),
  applySystemUpdate: () =>
    request<{ ok: boolean; updateRun: SystemUpdateRun }>("/api/system/updates/apply", {
      method: "POST"
    }),
  systemMaintenance: () => request<SystemMaintenanceInfo>("/api/system/maintenance"),
  runSystemMaintenanceCleanup: (targets: MaintenanceCleanupTarget[]) =>
    request<SystemMaintenanceCleanupResult>("/api/system/maintenance/cleanup", {
      method: "POST",
      body: JSON.stringify({ targets })
    }),
  exportMigrationBundle: async (passphrase: string) => {
    const response = await fetch("/api/system/migration/export", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase })
    });
    if (!response.ok) throw await requestJsonError(response, "Could not export migration bundle");

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? "aeroplane-export.aeroplane";
    downloadFile(blob, fileName);
    return { fileName, sizeBytes: blob.size };
  },
  importMigrationBundle: async (bundle: File, passphrase: string) => {
    const form = new FormData();
    form.set("bundle", bundle);
    form.set("passphrase", passphrase);
    const response = await fetch("/api/auth/migration/import", {
      method: "POST",
      credentials: "same-origin",
      body: form
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((payload as { error?: string }).error ?? "Could not import migration bundle");
    }
    return payload as {
      ok: boolean;
      result: MigrationImportResult;
      user: AuthUser | null;
      queuedDeployments: string[];
      restartRequired: boolean;
    };
  },
  databaseBackups: (serviceId: string) =>
    request<{ backups: DatabaseBackup[]; settings: DatabaseBackupSettings; r2: R2SettingsStatus }>(`/api/services/${serviceId}/database/backups`),
  updateDatabaseBackupSettings: (serviceId: string, body: Partial<Pick<DatabaseBackupSettings, "storage" | "automaticEnabled" | "scheduleEnabled">>) =>
    request<{ settings: DatabaseBackupSettings }>(`/api/services/${serviceId}/database/backups/settings`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  createDatabaseBackup: (serviceId: string, storage?: BackupStorageTarget) =>
    request<{ backup: DatabaseBackup }>(`/api/services/${serviceId}/database/backups`, {
      method: "POST",
      body: JSON.stringify(storage ? { storage } : {})
    }),
  deleteDatabaseBackup: (serviceId: string, backupId: string) =>
    request<{ ok: boolean }>(`/api/services/${serviceId}/database/backups/${backupId}`, { method: "DELETE" }),
  restoreDatabaseBackup: (serviceId: string, backupId: string) =>
    request<{ ok: boolean; restoredAt: string; backup: DatabaseBackup }>(`/api/services/${serviceId}/database/backups/${backupId}/restore`, { method: "POST" }),
  databaseBackupDownloadUrl: (serviceId: string, backupId: string) =>
    `/api/services/${serviceId}/database/backups/${backupId}/download`,
  serviceImportSources: (serviceId: string) =>
    request<{ sources: ServiceImportSource[] }>(`/api/services/${serviceId}/import-sources`),
  databaseDataImports: (serviceId: string) =>
    request<{ imports: DatabaseDataImport[] }>(`/api/services/${serviceId}/database/imports`),
  importPostgresDataFromUrl: (serviceId: string, sourceUrl: string) =>
    request<{ result: PostgresDataImportResult }>(`/api/services/${serviceId}/database/import/postgres-url`, {
      method: "POST",
      body: JSON.stringify({ sourceUrl })
    }),
  importPostgresDataFromRailway: (serviceId: string, apiToken: string) =>
    request<{ result: PostgresDataImportResult }>(`/api/services/${serviceId}/database/import/railway`, {
      method: "POST",
      body: JSON.stringify({ apiToken })
    }),
  importRedisDataFromUrl: (serviceId: string, sourceUrl: string) =>
    request<{ result: RedisDataImportResult }>(`/api/services/${serviceId}/database/import/redis-url`, {
      method: "POST",
      body: JSON.stringify({ sourceUrl })
    }),
  importRedisDataFromRailway: (serviceId: string, apiToken: string) =>
    request<{ result: RedisDataImportResult }>(`/api/services/${serviceId}/database/import/redis-railway`, {
      method: "POST",
      body: JSON.stringify({ apiToken })
    })
};
