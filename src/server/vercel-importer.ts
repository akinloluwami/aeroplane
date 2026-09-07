import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, nowIso } from "./db.js";
import { domains, envVars, projectGroups, services } from "./schema.js";
import { allocateHostPort } from "./deploy.js";
import { writeAndReloadCaddy } from "./caddy.js";
import { ensureDefaultDomainForService } from "./service-domains.js";
import { recordServiceImportSource } from "./service-import-sources.js";
import { repoUrlFromFullName } from "./github-connect.js";
import { fetchVercel } from "./vercel-api.js";
import { createDefaultProjectEnvironments } from "./project-environments.js";

type VercelGitLink = {
  type?: string | null;
  // GitHub
  org?: string | null;
  repo?: string | null;
  // GitLab
  projectNamespace?: string | null;
  projectName?: string | null;
  // Bitbucket
  owner?: string | null;
  slug?: string | null;
  name?: string | null;
  productionBranch?: string | null;
};

type VercelProjectNode = {
  id: string;
  name: string;
  framework?: string | null;
  rootDirectory?: string | null;
  buildCommand?: string | null;
  installCommand?: string | null;
  outputDirectory?: string | null;
  link?: VercelGitLink | null;
};

type VercelEnvNode = {
  key?: string | null;
  value?: string | null;
  type?: string | null;
  target?: string[] | string | null;
};

export type VercelEnvTarget = "production" | "preview" | "development";

const vercelEnvTargets: VercelEnvTarget[] = ["production", "preview", "development"];

type VercelProjectClassification = {
  kind: "git" | "unsupported";
  repoUrl?: string;
  repoFullName?: string | null;
  branch?: string;
  sourceLabel: string;
  unsupportedReason?: string;
};

function cleanOptionalString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numericPort(value: unknown) {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port;
  }
  return null;
}

function uniqueSlug(base: string, exists: (slug: string) => boolean) {
  const normalized = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const baseSlug = normalized || "project";
  let slug = baseSlug;
  let counter = 1;
  while (exists(slug)) {
    slug = `${baseSlug}-${counter++}`;
  }
  return slug;
}

function gitRepoFromLink(link: VercelGitLink): { host: string; owner: string; repo: string } | null {
  if (link.type === "github" && link.org && link.repo) {
    return { host: "github.com", owner: link.org, repo: link.repo };
  }
  if (link.type === "gitlab" && link.projectNamespace && link.projectName) {
    return { host: "gitlab.com", owner: link.projectNamespace, repo: link.projectName };
  }
  if (link.type === "bitbucket" && link.owner && (link.slug || link.name)) {
    return { host: "bitbucket.org", owner: link.owner, repo: (link.slug || link.name) as string };
  }
  return null;
}

function classifyVercelProjectSource(project: VercelProjectNode): VercelProjectClassification {
  const link = project.link;
  if (!link || !link.type) {
    return {
      kind: "unsupported",
      sourceLabel: "No Git repository connected",
      unsupportedReason: "This Vercel project has no connected Git repository for Aeroplane to deploy from."
    };
  }

  const repo = gitRepoFromLink(link);
  if (!repo) {
    return {
      kind: "unsupported",
      sourceLabel: `Unsupported Git provider (${link.type})`,
      unsupportedReason: "Aeroplane could not resolve a Git repository from this Vercel project."
    };
  }

  const branch = cleanOptionalString(link.productionBranch) ?? "main";
  const fullName = `${repo.owner}/${repo.repo}`;
  // GitHub repos integrate with Aeroplane's GitHub App; other providers only get a clone URL.
  const isGitHub = repo.host === "github.com";

  return {
    kind: "git",
    repoUrl: isGitHub ? repoUrlFromFullName(fullName) : `https://${repo.host}/${fullName}.git`,
    repoFullName: isGitHub ? fullName : null,
    branch,
    sourceLabel: fullName
  };
}

function envTargetMatches(target: VercelEnvNode["target"], selected: VercelEnvTarget) {
  if (Array.isArray(target)) return target.includes(selected);
  if (typeof target === "string") return target === selected;
  return false;
}

async function getVercelProjectEnv(token: string, projectId: string, target: VercelEnvTarget, teamId?: string) {
  const data = await fetchVercel<{ envs?: VercelEnvNode[] }>(token, `/v9/projects/${encodeURIComponent(projectId)}/env`, {
    teamId,
    query: { decrypt: "true" }
  });

  const vars: Record<string, string> = {};
  let skippedSensitive = 0;
  for (const env of data.envs ?? []) {
    if (!env.key || !envTargetMatches(env.target, target)) continue;
    // Sensitive variables cannot be decrypted through the API and come back empty.
    if (typeof env.value !== "string" || env.value.length === 0) {
      skippedSensitive += 1;
      continue;
    }
    vars[env.key] = env.value;
  }

  return { vars, skippedSensitive };
}

async function getVercelProjectCustomDomains(token: string, projectId: string, teamId?: string) {
  const data = await fetchVercel<{ domains?: Array<{ name?: string | null }> }>(
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/domains`,
    { teamId }
  );

  const hostnames: string[] = [];
  for (const domain of data.domains ?? []) {
    const hostname = typeof domain.name === "string" ? domain.name.trim().toLowerCase() : "";
    // Skip Vercel-managed hostnames; they can't be routed to the self-hosted server.
    if (!hostname || hostname.endsWith(".vercel.app")) continue;
    hostnames.push(hostname);
  }
  return hostnames;
}

function importCustomDomains(serviceId: string, hostnames: string[], timestamp: string) {
  let imported = 0;
  for (const hostname of hostnames) {
    const existing = db.select({ id: domains.id }).from(domains).where(eq(domains.hostname, hostname)).get();
    if (existing) continue;
    db.insert(domains)
      .values({
        id: nanoid(10),
        serviceId,
        hostname,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();
    imported += 1;
  }
  return imported;
}

export async function getVercelTeams(token: string) {
  const data = await fetchVercel<{ teams?: Array<{ id: string; slug?: string | null; name?: string | null }> }>(token, "/v2/teams");
  return (data.teams ?? []).map((team) => ({
    id: team.id,
    slug: team.slug ?? team.id,
    name: team.name || team.slug || team.id
  }));
}

export async function getVercelProjects(token: string, teamId?: string) {
  const data = await fetchVercel<{ projects?: VercelProjectNode[] }>(token, "/v9/projects", {
    teamId,
    query: { limit: 100 }
  });

  return (data.projects ?? []).map((project) => {
    const classification = classifyVercelProjectSource(project);
    return {
      id: project.id,
      name: project.name,
      framework: project.framework ?? null,
      kind: classification.kind,
      sourceLabel: classification.sourceLabel
    };
  });
}

export async function getVercelProjectDetails(token: string, projectId: string, teamId?: string) {
  const project = await fetchVercel<VercelProjectNode>(token, `/v9/projects/${encodeURIComponent(projectId)}`, { teamId });
  if (!project?.id) {
    throw new Error("Vercel project not found");
  }

  const classification = classifyVercelProjectSource(project);
  return {
    id: project.id,
    name: project.name,
    framework: project.framework ?? null,
    rootDirectory: cleanOptionalString(project.rootDirectory) ?? null,
    buildCommand: cleanOptionalString(project.buildCommand) ?? null,
    installCommand: cleanOptionalString(project.installCommand) ?? null,
    branch: classification.branch ?? null,
    kind: classification.kind,
    sourceLabel: classification.sourceLabel,
    unsupportedReason: classification.unsupportedReason ?? null,
    targets: vercelEnvTargets
  };
}

export interface VercelImportConfig {
  target?: VercelEnvTarget;
  excludeSystemVars?: boolean;
  autoDeploy?: boolean;
}

export async function importVercelProject(
  token: string,
  vercelProjectId: string,
  config: VercelImportConfig,
  options: { ownerUserId: string; teamId?: string }
) {
  const project = await fetchVercel<VercelProjectNode>(token, `/v9/projects/${encodeURIComponent(vercelProjectId)}`, {
    teamId: options.teamId
  });
  if (!project?.id) {
    throw new Error("Vercel project not found or token has insufficient permissions");
  }

  const classification = classifyVercelProjectSource(project);
  if (classification.kind === "unsupported") {
    throw new Error(classification.unsupportedReason ?? "This Vercel project cannot be imported.");
  }

  const target = config.target && vercelEnvTargets.includes(config.target) ? config.target : "production";
  const timestamp = nowIso();
  const projectGroupId = nanoid(10);

  const projectSlug = uniqueSlug(
    project.name,
    (slug) => Boolean(db.select({ id: projectGroups.id }).from(projectGroups).where(eq(projectGroups.slug, slug)).get())
  );

  db.insert(projectGroups)
    .values({
      id: projectGroupId,
      ownerUserId: options.ownerUserId,
      name: project.name,
      slug: projectSlug,
      description: null,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .run();
  const { defaultEnvironment } = createDefaultProjectEnvironments(projectGroupId, timestamp);

  const serviceSlug = uniqueSlug(
    project.name,
    (slug) => Boolean(db.select({ id: services.id }).from(services).where(eq(services.slug, slug)).get())
  );

  const { vars: fetchedVars, skippedSensitive } = await getVercelProjectEnv(token, vercelProjectId, target, options.teamId).catch(
    () => ({ vars: {} as Record<string, string>, skippedSensitive: 0 })
  );

  let internalPort = 8080;
  const envPort = numericPort(fetchedVars.PORT);
  if (envPort) {
    internalPort = envPort;
  }

  const targetServiceId = nanoid(10);
  db.insert(services)
    .values({
      id: targetServiceId,
      projectId: projectGroupId,
      environmentId: defaultEnvironment.id,
      slug: serviceSlug,
      name: project.name,
      repoFullName: classification.repoFullName ?? null,
      repoUrl: classification.repoUrl ?? "",
      branch: classification.branch ?? "main",
      rootDir: cleanOptionalString(project.rootDirectory) ?? null,
      githubToken: null,
      webhookSecret: nanoid(24),
      installCommand: cleanOptionalString(project.installCommand) ?? null,
      buildCommand: cleanOptionalString(project.buildCommand) ?? null,
      startCommand: null,
      staticOutput: null,
      runtimeMode: "web",
      internalPort,
      hostPort: allocateHostPort(),
      activePort: null,
      databasePublicEnabled: false,
      databasePublicHostname: null,
      postgresLogicalReplicationEnabled: false,
      status: "idle",
      lastDeployedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .run();

  const createdService = db.select().from(services).where(eq(services.id, targetServiceId)).get();
  let importedCustomDomainCount = 0;
  if (createdService) {
    ensureDefaultDomainForService(createdService);
    try {
      const customDomains = await getVercelProjectCustomDomains(token, vercelProjectId, options.teamId);
      importedCustomDomainCount = importCustomDomains(targetServiceId, customDomains, timestamp);
    } catch {
      // Domain import should not block service migration.
    }
  }

  recordServiceImportSource({
    serviceId: targetServiceId,
    provider: "vercel",
    externalProjectId: vercelProjectId,
    externalEnvironmentId: target,
    externalServiceId: vercelProjectId,
    externalServiceName: project.name,
    metadata: {
      projectName: project.name,
      target,
      framework: project.framework ?? null,
      sourceRepo: classification.sourceLabel,
      teamId: options.teamId ?? null
    }
  });

  let importedVariableCount = 0;
  for (const [key, value] of Object.entries(fetchedVars)) {
    if (config.excludeSystemVars && key.startsWith("VERCEL_")) {
      continue;
    }
    db.insert(envVars)
      .values({
        id: nanoid(10),
        serviceId: targetServiceId,
        key,
        value,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();
    importedVariableCount += 1;
  }

  await writeAndReloadCaddy();

  return {
    projectId: projectGroupId,
    projectSlug,
    appServiceIds: [targetServiceId],
    importedCustomDomainCount,
    importedVariableCount,
    skippedSensitiveCount: skippedSensitive
  };
}
