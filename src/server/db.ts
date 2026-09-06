import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { nanoid } from "nanoid";
import * as schema from "./schema.js";
import { createUniqueSlug } from "../shared/slug.js";

const dataDir = resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });

const sqlitePath = resolve(dataDir, "deploy.db");
mkdirSync(dirname(sqlitePath), { recursive: true });

export const sqlite = new Database(sqlitePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS project_groups (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_group_id TEXT,
  slug TEXT,
  name TEXT NOT NULL,
  repo_full_name TEXT,
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL,
  root_dir TEXT,
  github_token TEXT,
  webhook_secret TEXT NOT NULL,
  install_command TEXT,
  prebuild_command TEXT,
  build_command TEXT,
  start_command TEXT,
  static_output TEXT,
  build_method TEXT NOT NULL DEFAULT 'auto',
  dockerfile_path TEXT,
  persistent_volume_path TEXT,
  detected_build_method TEXT,
  runtime_mode TEXT NOT NULL DEFAULT 'web',
  internal_port INTEGER NOT NULL,
  host_port INTEGER NOT NULL UNIQUE,
  active_port INTEGER,
  database_public_enabled INTEGER NOT NULL DEFAULT 0,
  database_public_hostname TEXT,
  postgres_logical_replication_enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  last_deployed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha TEXT,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  image_tag TEXT,
  container_name TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  line TEXT NOT NULL,
  stream TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS env_vars (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, key)
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS database_backups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'manual',
  storage TEXT NOT NULL,
  format TEXT NOT NULL,
  local_path TEXT,
  r2_key TEXT,
  size_bytes INTEGER,
  checksum TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS database_backup_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  storage TEXT NOT NULL,
  automatic_enabled INTEGER NOT NULL DEFAULT 0,
  daily_enabled INTEGER NOT NULL DEFAULT 0,
  weekly_enabled INTEGER NOT NULL DEFAULT 0,
  monthly_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS database_data_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  source TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_variable_key TEXT,
  status TEXT NOT NULL,
  dump_size_bytes INTEGER,
  checksum TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS service_import_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_project_id TEXT,
  external_environment_id TEXT,
  external_service_id TEXT NOT NULL,
  external_service_name TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, provider, external_project_id, external_environment_id, external_service_id)
);

CREATE TABLE IF NOT EXISTS service_functions (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  runtime TEXT NOT NULL,
  source_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  access_level TEXT NOT NULL,
  project_scope TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS api_key_project_scopes (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(api_key_id, project_id)
);
`);

function hasColumn(table: string, column: string) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

if (!hasColumn("projects", "project_group_id")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN project_group_id TEXT");
}

if (!hasColumn("project_groups", "owner_user_id")) {
  sqlite.exec("ALTER TABLE project_groups ADD COLUMN owner_user_id TEXT");
}

if (!hasColumn("projects", "slug")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN slug TEXT");
}

if (!hasColumn("projects", "repo_full_name")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN repo_full_name TEXT");
}

if (!hasColumn("projects", "root_dir")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN root_dir TEXT");
}

if (!hasColumn("projects", "active_port")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN active_port INTEGER");
}

if (!hasColumn("projects", "runtime_mode")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'web'");
}

if (!hasColumn("projects", "prebuild_command")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN prebuild_command TEXT");
}

if (!hasColumn("projects", "database_public_enabled")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN database_public_enabled INTEGER NOT NULL DEFAULT 0");
}

if (!hasColumn("projects", "database_public_hostname")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN database_public_hostname TEXT");
}

if (!hasColumn("projects", "postgres_logical_replication_enabled")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN postgres_logical_replication_enabled INTEGER NOT NULL DEFAULT 0");
}

if (!hasColumn("projects", "build_method")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN build_method TEXT NOT NULL DEFAULT 'auto'");
}

if (!hasColumn("projects", "dockerfile_path")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN dockerfile_path TEXT");
}

if (!hasColumn("projects", "persistent_volume_path")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN persistent_volume_path TEXT");
}

if (!hasColumn("projects", "detected_build_method")) {
  sqlite.exec("ALTER TABLE projects ADD COLUMN detected_build_method TEXT");
}

if (!hasColumn("database_backups", "trigger")) {
  sqlite.exec("ALTER TABLE database_backups ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'");
}

if (!hasColumn("database_backup_settings", "daily_enabled")) {
  sqlite.exec("ALTER TABLE database_backup_settings ADD COLUMN daily_enabled INTEGER NOT NULL DEFAULT 0");
  sqlite.exec("UPDATE database_backup_settings SET daily_enabled = automatic_enabled WHERE automatic_enabled = 1");
}

if (!hasColumn("database_backup_settings", "weekly_enabled")) {
  sqlite.exec("ALTER TABLE database_backup_settings ADD COLUMN weekly_enabled INTEGER NOT NULL DEFAULT 0");
  sqlite.exec("UPDATE database_backup_settings SET weekly_enabled = automatic_enabled WHERE automatic_enabled = 1");
}

if (!hasColumn("database_backup_settings", "monthly_enabled")) {
  sqlite.exec("ALTER TABLE database_backup_settings ADD COLUMN monthly_enabled INTEGER NOT NULL DEFAULT 0");
  sqlite.exec("UPDATE database_backup_settings SET monthly_enabled = automatic_enabled WHERE automatic_enabled = 1");
}

sqlite.exec(`
CREATE INDEX IF NOT EXISTS idx_deployments_project_created ON deployments(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_deployment_created ON deployment_logs(deployment_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_env_project_key ON env_vars(project_id, key);
CREATE INDEX IF NOT EXISTS idx_project_groups_slug ON project_groups(slug);
CREATE INDEX IF NOT EXISTS idx_project_groups_owner ON project_groups(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_services_project_group ON projects(project_group_id);
CREATE INDEX IF NOT EXISTS idx_services_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_database_backups_service_created ON database_backups(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_database_backups_service_trigger_created ON database_backups(project_id, trigger, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_database_data_imports_service_created ON database_data_imports(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_database_data_imports_service_status ON database_data_imports(project_id, status);
CREATE INDEX IF NOT EXISTS idx_service_import_sources_service ON service_import_sources(project_id);
CREATE INDEX IF NOT EXISTS idx_service_import_sources_provider ON service_import_sources(provider, external_project_id, external_environment_id, external_service_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_token ON api_keys(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_api_key_project_scopes_key ON api_key_project_scopes(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_project_scopes_project ON api_key_project_scopes(project_id);
`);

function defaultProjectOwnerId() {
  const owner = sqlite.prepare("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (owner?.id) return owner.id;
  const firstUser = sqlite.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  return firstUser?.id ?? null;
}

const legacyProjectOwnerId = defaultProjectOwnerId();
if (legacyProjectOwnerId) {
  sqlite
    .prepare("UPDATE project_groups SET owner_user_id = ? WHERE owner_user_id IS NULL OR owner_user_id = ''")
    .run(legacyProjectOwnerId);
}

const projectGroupSlugRows = sqlite.prepare("SELECT slug FROM project_groups").all() as Array<{ slug: string }>;
const projectGroupSlugs = new Set(projectGroupSlugRows.map((row) => row.slug));

const serviceRows = sqlite
  .prepare("SELECT id, name, repo_url, repo_full_name, project_group_id, slug, created_at, updated_at FROM projects")
  .all() as Array<{
  id: string;
  name: string;
  repo_url: string;
  repo_full_name: null | string;
  project_group_id: null | string;
  slug: null | string;
  created_at: string;
  updated_at: string;
}>;

for (const service of serviceRows) {
  let projectGroupId = service.project_group_id;
  let serviceSlug = service.slug;

  if (!projectGroupId) {
    const groupId = nanoid(10);
    const groupSlug = createUniqueSlug(service.name, projectGroupSlugs);
    sqlite
      .prepare("INSERT INTO project_groups (id, owner_user_id, name, slug, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(groupId, legacyProjectOwnerId, service.name, groupSlug, null, service.created_at, service.updated_at);
    projectGroupId = groupId;
  }

  if (!serviceSlug) {
    serviceSlug = createUniqueSlug(service.name, new Set());
  }

  const repoFullName =
    service.repo_full_name ??
    service.repo_url
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/^git@github\.com:/, "")
      .replace(/\.git$/, "");

  sqlite
    .prepare("UPDATE projects SET project_group_id = ?, slug = ?, repo_full_name = COALESCE(repo_full_name, ?) WHERE id = ?")
    .run(projectGroupId, serviceSlug, repoFullName, service.id);
}

export const db = drizzle(sqlite, { schema });

export function nowIso() {
  return new Date().toISOString();
}
