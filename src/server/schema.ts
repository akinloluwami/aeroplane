import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectGroups = sqliteTable("project_groups", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id"),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const services = sqliteTable("projects", {
  id: text("id").primaryKey(),
  projectId: text("project_group_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  repoFullName: text("repo_full_name"),
  repoUrl: text("repo_url").notNull(),
  branch: text("branch").notNull(),
  rootDir: text("root_dir"),
  githubToken: text("github_token"),
  webhookSecret: text("webhook_secret").notNull(),
  installCommand: text("install_command"),
  prebuildCommand: text("prebuild_command"),
  buildCommand: text("build_command"),
  startCommand: text("start_command"),
  staticOutput: text("static_output"),
  buildMethod: text("build_method").notNull().default("auto"),
  dockerfilePath: text("dockerfile_path"),
  detectedBuildMethod: text("detected_build_method"),
  runtimeMode: text("runtime_mode").notNull().default("web"),
  internalPort: integer("internal_port").notNull(),
  hostPort: integer("host_port").notNull(),
  activePort: integer("active_port"),
  databasePublicEnabled: integer("database_public_enabled", { mode: "boolean" }).notNull().default(false),
  databasePublicHostname: text("database_public_hostname"),
  postgresLogicalReplicationEnabled: integer("postgres_logical_replication_enabled", { mode: "boolean" }).notNull().default(false),
  autoscalingEnabled: integer("autoscaling_enabled", { mode: "boolean" }).notNull().default(false),
  autoscalingMinCpu: integer("autoscaling_min_cpu"),
  autoscalingMaxCpu: integer("autoscaling_max_cpu"),
  status: text("status").notNull(),
  lastDeployedAt: text("last_deployed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  serviceId: text("project_id").notNull(),
  commitSha: text("commit_sha"),
  status: text("status").notNull(),
  trigger: text("trigger").notNull(),
  imageTag: text("image_tag"),
  containerName: text("container_name"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull()
});

export const deploymentLogs = sqliteTable("deployment_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deploymentId: text("deployment_id").notNull(),
  line: text("line").notNull(),
  stream: text("stream").notNull(),
  createdAt: text("created_at").notNull()
});

export const envVars = sqliteTable("env_vars", {
  id: text("id").primaryKey(),
  serviceId: text("project_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  serviceId: text("project_id").notNull(),
  hostname: text("hostname").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const databaseBackups = sqliteTable("database_backups", {
  id: text("id").primaryKey(),
  serviceId: text("project_id").notNull(),
  engine: text("engine").notNull(),
  status: text("status").notNull(),
  trigger: text("trigger").notNull().default("manual"),
  storage: text("storage").notNull(),
  format: text("format").notNull(),
  localPath: text("local_path"),
  r2Key: text("r2_key"),
  sizeBytes: integer("size_bytes"),
  checksum: text("checksum"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at")
});

export const databaseBackupSettings = sqliteTable("database_backup_settings", {
  serviceId: text("project_id").primaryKey(),
  storage: text("storage").notNull(),
  automaticEnabled: integer("automatic_enabled", { mode: "boolean" }).notNull().default(false),
  dailyEnabled: integer("daily_enabled", { mode: "boolean" }).notNull().default(false),
  weeklyEnabled: integer("weekly_enabled", { mode: "boolean" }).notNull().default(false),
  monthlyEnabled: integer("monthly_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const databaseDataImports = sqliteTable("database_data_imports", {
  id: text("id").primaryKey(),
  serviceId: text("project_id").notNull(),
  engine: text("engine").notNull(),
  source: text("source").notNull(),
  sourceLabel: text("source_label").notNull(),
  sourceVariableKey: text("source_variable_key"),
  status: text("status").notNull(),
  dumpSizeBytes: integer("dump_size_bytes"),
  checksum: text("checksum"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at")
});

export const serviceImportSources = sqliteTable("service_import_sources", {
  id: text("id").primaryKey(),
  serviceId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  externalProjectId: text("external_project_id"),
  externalEnvironmentId: text("external_environment_id"),
  externalServiceId: text("external_service_id").notNull(),
  externalServiceName: text("external_service_name"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const serviceFunctions = sqliteTable("service_functions", {
  serviceId: text("project_id").primaryKey(),
  runtime: text("runtime").notNull(),
  sourceCode: text("source_code").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastLoginAt: text("last_login_at")
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull()
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  accessLevel: text("access_level").notNull(),
  projectScope: text("project_scope").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at")
});

export const apiKeyProjectScopes = sqliteTable("api_key_project_scopes", {
  id: text("id").primaryKey(),
  apiKeyId: text("api_key_id").notNull(),
  projectId: text("project_id").notNull(),
  createdAt: text("created_at").notNull()
});

export type ProjectGroup = typeof projectGroups.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
export type DeploymentLog = typeof deploymentLogs.$inferSelect;
export type ServiceImportSource = typeof serviceImportSources.$inferSelect;
export type EnvVar = typeof envVars.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type DatabaseBackup = typeof databaseBackups.$inferSelect;
export type DatabaseBackupSettings = typeof databaseBackupSettings.$inferSelect;
export type DatabaseDataImport = typeof databaseDataImports.$inferSelect;
export type ServiceFunction = typeof serviceFunctions.$inferSelect;
export type User = typeof users.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiKeyProjectScope = typeof apiKeyProjectScopes.$inferSelect;
