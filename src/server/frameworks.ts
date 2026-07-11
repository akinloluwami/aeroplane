import { readRepoFile } from "./github-connect.js";
import { detectFrameworkFromProjectFiles } from "./framework-file-detectors.js";
import { DATABASE_ICON_CATALOG, FRAMEWORK_ICON_CATALOG, type FrameworkIconCatalogEntry } from "./framework-icon-catalog.js";
import { cachedFrameworkIconMeta } from "./framework-icons.js";
import { createTtlCache } from "./ttl-cache.js";

export type FrameworkMeta = {
  logoUrl: null | string;
  name: string;
  slug: string;
  website: null | string;
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

const frameworkCache = createTtlCache<string, FrameworkMeta | null>(10 * 60 * 1000);
const frameworkDetectionInFlight = new Map<string, Promise<FrameworkMeta | null>>();

type FrameworkDetectionOptions = {
  buildCommand?: null | string;
  installCommand?: null | string;
  serviceName?: null | string;
  startCommand?: null | string;
  // Skip workspace/filter-aware resolution and check only rootDir's own package.json.
  // The directory picker uses this: it has no configured install/build commands to
  // derive a --filter or service name from, so the workspace-glob and literal-entry
  // expansion in candidatePackagePaths has nothing legitimate to scope itself to — it
  // would otherwise pull in every declared workspace member's manifest regardless of
  // which folder is actually being browsed, both mislabeling folders with an unrelated
  // sibling's framework and reading N manifests per expanded folder instead of one.
  exactPathOnly?: boolean;
};

type PackageJsonRead = {
  packageJson: PackageJson;
  path: string;
};

function detectionCommandSignature(options: FrameworkDetectionOptions = {}) {
  return [options.installCommand, options.buildCommand, options.startCommand]
    .map((command) => command?.trim() ?? "")
    .filter(Boolean)
    .join(" :: ");
}

function cacheKey(repoFullName: string, branch: string, rootDir: null | string, options: FrameworkDetectionOptions = {}) {
  return `${repoFullName}::${branch}::${rootDir ?? ""}::${detectionCommandSignature(options)}::${options.exactPathOnly ? "exact" : ""}`;
}

function parsePackageJson(source: null | string) {
  if (!source) return null;
  try {
    return JSON.parse(source) as PackageJson;
  } catch {
    return null;
  }
}

function packageJsonPaths(rootDir: null | string) {
  const normalizedRoot = rootDir?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  // No fallback to the repo-root package.json here: a folder with no manifest of its
  // own should report "nothing detected," not silently inherit an unrelated folder's
  // framework. Genuine monorepo members are still resolved separately, through root's
  // declared `workspaces` globs in candidatePackagePaths.
  return normalizedRoot ? [`${normalizedRoot}/package.json`] : ["package.json"];
}

function packageJsonDir(path: string) {
  return path.endsWith("/package.json") ? path.slice(0, -"package.json".length).replace(/\/+$/g, "") : "";
}

function packageNameLeaf(value: string) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").replace(/^\.\/+/, "").replace(/\/+$/g, "");
  const withoutGlob = normalized.replace(/\*+$/g, "").replace(/\/+$/g, "");
  return withoutGlob.split("/").filter(Boolean).at(-1)?.replace(/^@/, "") ?? "";
}

function normalizedWorkspaceEntries(packageJson: PackageJson | null) {
  const workspaces = packageJson?.workspaces;
  if (Array.isArray(workspaces)) return workspaces;
  if (workspaces && Array.isArray(workspaces.packages)) return workspaces.packages;
  return [];
}

function commandPackageFilters(options: FrameworkDetectionOptions = {}) {
  const commands = detectionCommandSignature(options);
  const filters: string[] = [];
  const pattern = /--filter(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(commands))) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value && !value.includes("*")) filters.push(value);
  }
  return [...new Set(filters)];
}

function candidatePackagePaths(rootDir: null | string, rootPackageJson: PackageJson | null, options: FrameworkDetectionOptions = {}) {
  const paths = new Map<string, number>();
  const addPath = (path: string, priority: number) => {
    const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "");
    if (!normalizedPath || normalizedPath.includes("..")) return;
    const existing = paths.get(normalizedPath);
    if (existing === undefined || priority < existing) paths.set(normalizedPath, priority);
  };

  const filters = commandPackageFilters(options);
  const filterNames = filters.map(packageNameLeaf).filter(Boolean);
  const serviceName = options.serviceName ? packageNameLeaf(options.serviceName.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-")) : "";

  for (const filter of filters) {
    const normalizedFilter = filter.replace(/^\.\/+/, "").replace(/\/+$/g, "");
    const filterName = packageNameLeaf(filter);
    if (normalizedFilter.includes("/")) addPath(`${normalizedFilter}/package.json`, 0);
    if (filterName) {
      addPath(`apps/${filterName}/package.json`, 0);
      addPath(`packages/${filterName}/package.json`, 0);
      addPath(`services/${filterName}/package.json`, 0);
    }
  }

  if (serviceName) {
    addPath(`apps/${serviceName}/package.json`, 1);
    addPath(`packages/${serviceName}/package.json`, 1);
    addPath(`services/${serviceName}/package.json`, 1);
  }

  for (const entry of normalizedWorkspaceEntries(rootPackageJson)) {
    const workspace = entry.trim().replace(/^\.\/+/, "").replace(/\/+$/g, "");
    if (!workspace || workspace.includes("..")) continue;
    if (workspace.includes("*")) {
      for (const name of filterNames) {
        addPath(`${workspace.replace("*", name)}/package.json`, 0);
      }
      if (serviceName) addPath(`${workspace.replace("*", serviceName)}/package.json`, 1);
      continue;
    }
    addPath(`${workspace}/package.json`, filters.length > 0 ? 2 : 3);
  }

  for (const path of packageJsonPaths(rootDir)) {
    addPath(path, path === "package.json" ? 5 : 4);
  }

  return [...paths.entries()].sort((left, right) => left[1] - right[1]).map(([path]) => path);
}

function packageMatchesFilters(read: PackageJsonRead, filters: string[]) {
  if (filters.length === 0) return false;
  const packageName = read.packageJson.name ?? "";
  const packageLeaf = packageNameLeaf(packageName);
  const dirLeaf = packageNameLeaf(packageJsonDir(read.path));
  return filters.some((filter) => {
    const filterLeaf = packageNameLeaf(filter);
    return packageName === filter || packageLeaf === filterLeaf || dirLeaf === filterLeaf;
  });
}

async function readPackageJsonAt(repoFullName: string, branch: string, path: string): Promise<PackageJsonRead | null> {
  const content = await readRepoFile(repoFullName, branch, path);
  const parsed = parsePackageJson(content);
  return parsed ? { path, packageJson: parsed } : null;
}

async function readPackageJsons(repoFullName: string, branch: string, rootDir: null | string, options: FrameworkDetectionOptions = {}) {
  if (options.exactPathOnly) {
    const normalizedRoot = rootDir?.trim().replace(/^\/+|\/+$/g, "") ?? "";
    const read = await readPackageJsonAt(repoFullName, branch, normalizedRoot ? `${normalizedRoot}/package.json` : "package.json");
    return read ? [read.packageJson] : [];
  }

  const rootPackage = await readPackageJsonAt(repoFullName, branch, "package.json");
  const filters = commandPackageFilters(options);
  const reads: PackageJsonRead[] = [];
  const seen = new Set<string>();

  for (const path of candidatePackagePaths(rootDir, rootPackage?.packageJson ?? null, options)) {
    if (seen.has(path)) continue;
    seen.add(path);
    const read = path === "package.json" && rootPackage ? rootPackage : await readPackageJsonAt(repoFullName, branch, path);
    if (read) reads.push(read);
  }

  const matchingReads = reads.filter((read) => packageMatchesFilters(read, filters));
  const otherReads = reads.filter((read) => !matchingReads.includes(read));
  return [...matchingReads, ...otherReads].map((read) => read.packageJson);
}

function dependencySet(packageJson: PackageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {})
  ]);
}

function packageScriptText(packageJson: PackageJson) {
  return Object.values(packageJson.scripts ?? {}).join(" ");
}

function candidateMatchesDeps(candidate: FrameworkIconCatalogEntry, deps: Set<string>) {
  if (candidate.dependencies?.some((dependency) => deps.has(dependency))) return true;
  return candidate.dependencyPrefixes?.some((prefix) => [...deps].some((dependency) => dependency.startsWith(prefix))) ?? false;
}

function catalogEntry(slug: string) {
  return FRAMEWORK_ICON_CATALOG.find((candidate) => candidate.slug === slug) ?? null;
}

function packageRuntimeMatch(packageJsons: PackageJson[], options: FrameworkDetectionOptions = {}) {
  const commands = detectionCommandSignature(options);

  for (const packageJson of packageJsons) {
    const deps = dependencySet(packageJson);
    const scripts = packageScriptText(packageJson);
    if (deps.has("@types/node") || /\bnode\b/i.test(scripts) || /\bnode\b/i.test(commands)) {
      return catalogEntry("nodejs");
    }
    if (/\bbun\b/i.test(scripts) || /\bbun\b/i.test(commands)) {
      return catalogEntry("bun");
    }
    if (/\bdeno\b/i.test(scripts) || /\bdeno\b/i.test(commands)) {
      return catalogEntry("deno");
    }
  }

  return null;
}

function packageFrameworkMatch(packageJsons: PackageJson[], options: FrameworkDetectionOptions = {}) {
  for (const packageJson of packageJsons) {
    const deps = dependencySet(packageJson);
    const dependencyMatch = FRAMEWORK_ICON_CATALOG.find((candidate) => candidateMatchesDeps(candidate, deps));
    if (dependencyMatch) return dependencyMatch;

    const runtimeMatch = packageRuntimeMatch([packageJson], options);
    if (runtimeMatch) return runtimeMatch;
  }

  return null;
}

async function frameworkMetaFromCatalog(candidate: FrameworkIconCatalogEntry): Promise<FrameworkMeta> {
  const icon = await cachedFrameworkIconMeta(candidate);
  return {
    slug: candidate.slug,
    name: candidate.name,
    logoUrl: icon.logoUrl,
    website: icon.website ?? candidate.website ?? null
  };
}

export async function frameworkMetaForSlug(slug: string): Promise<FrameworkMeta | null> {
  const entry = catalogEntry(slug);
  if (!entry) return null;
  return frameworkMetaFromCatalog(entry);
}

async function databaseFrameworkMeta(dbType: string) {
  const entry = DATABASE_ICON_CATALOG.find((candidate) => candidate.slug === dbType);
  if (!entry) return null;
  return frameworkMetaFromCatalog(entry);
}

function cachedFramework(key: string) {
  return frameworkCache.get(key);
}

function setCachedFramework(key: string, value: FrameworkMeta | null) {
  frameworkCache.set(key, value);
}

async function resolveFramework(
  repoFullName: string,
  branch: string,
  rootDir: null | string,
  options: FrameworkDetectionOptions = {},
  knownFiles?: Set<string>
) {
  const fileMatch = await detectFrameworkFromProjectFiles((path) => readRepoFile(repoFullName, branch, path), rootDir, options, knownFiles);
  if (fileMatch) {
    return frameworkMetaFromCatalog(fileMatch);
  }

  const packageJsons = await readPackageJsons(repoFullName, branch, rootDir, options);
  if (packageJsons.length === 0) return null;

  const runtimeMatch = packageFrameworkMatch(packageJsons, options);
  if (!runtimeMatch) return null;

  return frameworkMetaFromCatalog(runtimeMatch);
}

function warmFrameworkCache(
  key: string,
  repoFullName: string,
  branch: string,
  rootDir: null | string,
  options: FrameworkDetectionOptions = {},
  knownFiles?: Set<string>
) {
  const existing = frameworkDetectionInFlight.get(key);
  if (existing) return existing;

  const promise = resolveFramework(repoFullName, branch, rootDir, options, knownFiles)
    .then((framework) => {
      setCachedFramework(key, framework);
      return framework;
    })
    .finally(() => {
      frameworkDetectionInFlight.delete(key);
    });
  frameworkDetectionInFlight.set(key, promise);
  return promise;
}

export async function detectFramework(
  repoFullName: null | string,
  branch: string,
  rootDir: null | string,
  options: FrameworkDetectionOptions = {},
  knownFiles?: Set<string>
) {
  if (!repoFullName) return null;

  if (repoFullName.startsWith("database:")) {
    const dbType = repoFullName.split(":")[1];
    return databaseFrameworkMeta(dbType);
  }

  const key = cacheKey(repoFullName, branch, rootDir, options);
  const cached = cachedFramework(key);
  if (cached !== undefined) return cached;

  return warmFrameworkCache(key, repoFullName, branch, rootDir, options, knownFiles);
}

export async function detectFrameworkPreview(repoFullName: null | string, branch: string, rootDir: null | string, options: FrameworkDetectionOptions = {}) {
  if (!repoFullName) return null;

  if (repoFullName.startsWith("database:")) {
    const dbType = repoFullName.split(":")[1];
    return databaseFrameworkMeta(dbType);
  }

  const key = cacheKey(repoFullName, branch, rootDir, options);
  const cached = cachedFramework(key);
  if (cached !== undefined) return cached;

  void warmFrameworkCache(key, repoFullName, branch, rootDir, options).catch(() => undefined);
  return null;
}
