import { createPrivateKey, sign } from "node:crypto";
import { config } from "./config.js";
import { deriveFrameworkHint, directChildFileNames } from "./framework-tree-detector.js";
import { createTtlCache } from "./ttl-cache.js";

type GitHubRepo = {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  pushed_at: null | string;
  updated_at: string;
};

type GitHubBranch = {
  name: string;
};

export type GitHubTreeEntry = {
  path: string;
  type: "blob" | "tree";
};

type GitHubContentFile = {
  content: string;
  encoding: string;
  type: "file";
};

type GitHubInstallation = {
  id: number;
  account: {
    login: string;
  };
  target_type: "Organization" | "User";
};

type InstallationTokenCacheEntry = {
  expiresAt: number;
  token: string;
};

type GitHubSearchResponse = {
  items: GitHubRepo[];
};

type GitHubStatus = {
  appConfigured: boolean;
  connected: boolean;
  installationCount: number;
  installed: boolean;
  installUrl: null | string;
  mode: "app" | "token" | "none";
};

const installationTokenCache = new Map<number, InstallationTokenCacheEntry>();
const repoTreeCache = createTtlCache<string, GitHubTreeEntry[]>(10 * 60 * 1000);
const repoTreeInFlight = new Map<string, Promise<GitHubTreeEntry[]>>();
const githubPageSize = 100;

function hasGitHubAppConfig() {
  return Boolean(config.githubAppId && config.githubAppPrivateKey);
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getGitHubAppInstallUrl() {
  if (!config.githubAppSlug) return null;
  return `https://github.com/apps/${config.githubAppSlug}/installations/new`;
}

function createGitHubAppJwt() {
  if (!hasGitHubAppConfig()) {
    throw new Error("GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY on the server.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: config.githubAppClientId || config.githubAppId
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(config.githubAppPrivateKey));
  return `${unsigned}.${base64Url(signature)}`;
}

async function githubRequest<T>(path: string, options: { body?: unknown; token?: string; tokenKind?: "bearer" | "token" } = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.body ? "POST" : "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `${options.tokenKind === "token" ? "token" : "Bearer"} ${options.token ?? config.githubAccessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "aeroplane-control-plane",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub request failed (${response.status}): ${body || response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function githubAppRequest<T>(path: string, options: { body?: unknown } = {}) {
  return githubRequest<T>(path, {
    body: options.body,
    token: createGitHubAppJwt(),
    tokenKind: "bearer"
  });
}

function paginatedGitHubPath(path: string, page: number) {
  const url = new URL(path, "https://api.github.com");
  url.searchParams.set("per_page", String(githubPageSize));
  url.searchParams.set("page", String(page));
  return `${url.pathname}${url.search}`;
}

async function githubPaginatedRequest<Item, Response>(
  path: string,
  getItems: (response: Response) => Item[],
  options: { token?: string; tokenKind?: "bearer" | "token" } = {}
) {
  const items: Item[] = [];

  for (let page = 1; ; page += 1) {
    const response = await githubRequest<Response>(paginatedGitHubPath(path, page), options);
    const pageItems = getItems(response);
    items.push(...pageItems);

    if (pageItems.length < githubPageSize) {
      break;
    }
  }

  return items;
}

async function getInstallationToken(installationId: number) {
  const cached = installationTokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const result = await githubAppRequest<{ expires_at: string; token: string }>(`/app/installations/${installationId}/access_tokens`, {
    body: {}
  });
  installationTokenCache.set(installationId, {
    token: result.token,
    expiresAt: new Date(result.expires_at).getTime()
  });
  return result.token;
}

async function getInstallationForRepo(repoFullName: string) {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error("Invalid repository name");
  }

  return githubAppRequest<{ id: number }>(`/repos/${owner}/${repo}/installation`);
}

async function getInstallationTokenForRepo(repoFullName: string) {
  const installation = await getInstallationForRepo(repoFullName);
  return getInstallationToken(installation.id);
}

async function listReposViaApp(query?: string) {
  const installations = await githubPaginatedRequest<GitHubInstallation, GitHubInstallation[]>(
    "/app/installations",
    (response) => response,
    {
      token: createGitHubAppJwt(),
      tokenKind: "bearer"
    }
  );
  const normalizedQuery = query?.trim().toLowerCase();
  const repos: GitHubRepo[] = [];
  const seen = new Set<number>();

  for (const installation of installations) {
    const token = await getInstallationToken(installation.id);
    const candidates = normalizedQuery
      ? await githubPaginatedRequest<GitHubRepo, GitHubSearchResponse>(
          `/search/repositories?q=${encodeURIComponent(buildInstallationSearchQuery(query ?? "", installation))}`,
          (response) => response.items,
          {
            token,
            tokenKind: "token"
          }
        )
      : await githubPaginatedRequest<GitHubRepo, { repositories: GitHubRepo[] }>("/installation/repositories", (response) => response.repositories, {
          token,
          tokenKind: "token"
        });

    for (const repo of candidates) {
      if (seen.has(repo.id)) continue;
      seen.add(repo.id);

      if (
        normalizedQuery &&
        !repo.full_name.toLowerCase().includes(normalizedQuery) &&
        !repo.name.toLowerCase().includes(normalizedQuery)
      ) {
        continue;
      }

      repos.push(repo);
    }
  }

  return repos;
}

async function listReposViaToken(query?: string) {
  if (!config.githubAccessToken) {
    throw new Error("GitHub is not connected. Configure a GitHub App or set GITHUB_ACCESS_TOKEN on the server.");
  }

  const repos = query?.trim()
    ? await githubPaginatedRequest<GitHubRepo, GitHubSearchResponse>(
        `/search/repositories?q=${encodeURIComponent(query)}`,
        (response) => response.items,
        {
          tokenKind: "bearer"
        }
      )
    : await githubPaginatedRequest<GitHubRepo, GitHubRepo[]>("/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member", (response) => response, {
        tokenKind: "bearer"
      });
  const normalizedQuery = query?.trim().toLowerCase();

  return repos.filter(
    (repo) => !normalizedQuery || repo.full_name.toLowerCase().includes(normalizedQuery) || repo.name.toLowerCase().includes(normalizedQuery)
  );
}

function repoLastPushedTime(repo: GitHubRepo) {
  const time = new Date(repo.pushed_at ?? repo.updated_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildInstallationSearchQuery(query: string, installation: GitHubInstallation) {
  const normalized = query.trim();
  const qualifier = installation.target_type === "Organization" ? `org:${installation.account.login}` : `user:${installation.account.login}`;
  const repoNameQuery = normalized.includes("/") ? normalized.split("/").at(-1) ?? normalized : normalized;
  return `${repoNameQuery} ${qualifier}`.trim();
}

async function getRepoToken(repoFullName: string) {
  if (hasGitHubAppConfig()) {
    return getInstallationTokenForRepo(repoFullName);
  }

  if (!config.githubAccessToken) {
    throw new Error("GitHub is not connected. Configure a GitHub App or set GITHUB_ACCESS_TOKEN on the server.");
  }

  return config.githubAccessToken;
}

async function githubRepoRequest<T>(repoFullName: string, path: string): Promise<T> {
  const token = await getRepoToken(repoFullName);
  return githubRequest<T>(path, {
    token,
    tokenKind: "token"
  });
}

export async function readRepoFile(repoFullName: string, branch: string, filePath: string) {
  const [owner, repo] = repoFullName.split("/");
  const normalizedPath = filePath.trim().replace(/^\/+/, "");
  if (!owner || !repo || !normalizedPath) return null;

  try {
    const response = await githubRepoRequest<GitHubContentFile>(
      repoFullName,
      `/repos/${owner}/${repo}/contents/${normalizedPath}?ref=${encodeURIComponent(branch)}`
    );
    if (response.type !== "file" || response.encoding !== "base64") {
      return null;
    }
    return Buffer.from(response.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function repoUrlFromFullName(fullName: string) {
  return `https://github.com/${fullName}.git`;
}

export async function listConnectedRepos(query?: string) {
  const repos = hasGitHubAppConfig() ? await listReposViaApp(query) : await listReposViaToken(query);

  return repos
    .sort((left, right) => repoLastPushedTime(right) - repoLastPushedTime(left))
    .map((repo) => ({
      id: String(repo.id),
      fullName: repo.full_name,
      name: repo.name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      pushedAt: repo.pushed_at ?? repo.updated_at,
      updatedAt: repo.updated_at,
      cloneUrl: repoUrlFromFullName(repo.full_name)
    }));
}

export async function listRepoBranches(repoFullName: string) {
  const [owner, repo] = repoFullName.split("/");
  const branches = await githubRepoRequest<GitHubBranch[]>(repoFullName, `/repos/${owner}/${repo}/branches?per_page=100`);
  return branches.map((branch) => branch.name);
}

function repoTreeCacheKey(repoFullName: string, branch: string) {
  return `${repoFullName}::${branch}`;
}

async function fetchRepoTree(repoFullName: string, branch: string) {
  const [owner, repo] = repoFullName.split("/");
  const branchInfo = await githubRepoRequest<{ commit: { sha: string } }>(
    repoFullName,
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
  );
  const tree = await githubRepoRequest<{ tree: GitHubTreeEntry[] }>(
    repoFullName,
    `/repos/${owner}/${repo}/git/trees/${branchInfo.commit.sha}?recursive=1`
  );
  return tree.tree;
}

// The recursive tree is the full file manifest for the repo at this branch. Directory
// listing and framework detection both need it, so it's fetched once and shared instead
// of re-downloading it on every folder expand.
export async function repoTree(repoFullName: string, branch: string): Promise<GitHubTreeEntry[]> {
  const key = repoTreeCacheKey(repoFullName, branch);
  const cached = repoTreeCache.get(key);
  if (cached) return cached;

  const inFlight = repoTreeInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = fetchRepoTree(repoFullName, branch)
    .then((tree) => {
      repoTreeCache.set(key, tree);
      return tree;
    })
    .finally(() => {
      repoTreeInFlight.delete(key);
    });
  repoTreeInFlight.set(key, promise);
  return promise;
}

// File names (not paths) directly inside dirPath, read from the cached tree. Lets the
// precise framework detector read only the files that actually exist instead of probing
// every candidate manifest name.
export async function filesInDirectory(repoFullName: string, branch: string, dirPath: string) {
  const tree = await repoTree(repoFullName, branch);
  return directChildFileNames(dirPath.trim().replace(/^\/+|\/+$/g, ""), tree);
}

export async function listRepoDirectories(repoFullName: string, branch: string, parentPath = "") {
  const tree = await repoTree(repoFullName, branch);
  const normalizedParent = parentPath.trim().replace(/^\/+|\/+$/g, "");
  const children = new Map<string, { path: string; name: string; depth: number; hasChildren: boolean }>();

  for (const entry of tree) {
    const entryPath = entry.path.trim().replace(/^\/+|\/+$/g, "");
    if (!entryPath) continue;

    if (normalizedParent) {
      if (!entryPath.startsWith(`${normalizedParent}/`)) continue;
      const remainder = entryPath.slice(normalizedParent.length + 1);
      if (!remainder) continue;
      const isDirectoryChild = remainder.includes("/") || entry.type === "tree";
      if (!isDirectoryChild) continue;
      const nextSegment = remainder.split("/")[0];
      const childPath = `${normalizedParent}/${nextSegment}`;
      const hasChildren = remainder.includes("/") || entry.type === "tree";
      const depth = childPath.split("/").length;
      const existing = children.get(childPath);
      children.set(childPath, {
        path: childPath,
        name: nextSegment,
        depth,
        hasChildren: existing?.hasChildren || hasChildren
      });
      continue;
    }

    const isDirectoryChild = entryPath.includes("/") || entry.type === "tree";
    if (!isDirectoryChild) continue;
    const nextSegment = entryPath.split("/")[0];
    const childPath = nextSegment;
    const hasChildren = entryPath.includes("/") || entry.type === "tree";
    const existing = children.get(childPath);
    children.set(childPath, {
      path: childPath,
      name: nextSegment,
      depth: 1,
      hasChildren: existing?.hasChildren || hasChildren
    });
  }

  return [...children.values()]
    .map((child) => ({ ...child, frameworkHintSlug: deriveFrameworkHint(child.path, tree) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function getCloneTokenForRepo(repoFullName: string) {
  if (hasGitHubAppConfig()) {
    return getInstallationTokenForRepo(repoFullName);
  }

  return config.githubAccessToken || null;
}

async function getAppInstallationCount() {
  if (!hasGitHubAppConfig()) {
    return 0;
  }

  const installations = await githubAppRequest<GitHubInstallation[]>("/app/installations");
  return installations.length;
}

type GitHubManifestConversion = {
  id: number;
  slug: string;
  client_id: string;
  client_secret: null | string;
  webhook_secret: null | string;
  pem: string;
  html_url: string;
  owner: { login: string };
};

export type GitHubAppCredentials = {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKey: string;
  htmlUrl: string;
  owner: string;
};

function isPublicWebhookHost(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

export function buildGitHubAppManifest(options: { baseUrl: string; name: string }) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const manifest = {
    name: options.name,
    url: base,
    redirect_url: `${base}/api/github/manifest/callback`,
    public: false,
    default_permissions: {
      contents: "read",
      metadata: "read",
      pull_requests: "read"
    }
  };

  if (!isPublicWebhookHost(base)) return manifest;

  return {
    ...manifest,
    hook_attributes: {
      url: `${base}/api/github/app/webhook`,
      active: true
    },
    default_events: ["push"]
  };
}

// Exchanges the temporary code GitHub sends back after an App Manifest creation for
// the full set of App credentials. This endpoint takes no authentication — the
// single-use code is the credential.
export async function convertGitHubManifestCode(code: string): Promise<GitHubAppCredentials> {
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "aeroplane-control-plane",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub manifest conversion failed (${response.status}): ${body || response.statusText}`);
  }

  const data = (await response.json()) as GitHubManifestConversion;
  return {
    appId: String(data.id),
    slug: data.slug,
    clientId: data.client_id,
    clientSecret: data.client_secret ?? "",
    webhookSecret: data.webhook_secret ?? "",
    privateKey: data.pem ?? "",
    htmlUrl: data.html_url,
    owner: data.owner?.login ?? ""
  };
}

export async function githubConnectionStatus(): Promise<GitHubStatus> {
  if (hasGitHubAppConfig()) {
    const installationCount = await getAppInstallationCount();
    return {
      appConfigured: true,
      connected: installationCount > 0,
      installationCount,
      installed: installationCount > 0,
      mode: "app",
      installUrl: getGitHubAppInstallUrl()
    };
  }

  if (config.githubAccessToken) {
    return {
      appConfigured: false,
      connected: true,
      installationCount: 0,
      installed: true,
      mode: "token",
      installUrl: null
    };
  }

  return {
    appConfigured: false,
    connected: false,
    installationCount: 0,
    installed: false,
    mode: "none",
    installUrl: getGitHubAppInstallUrl()
  };
}
