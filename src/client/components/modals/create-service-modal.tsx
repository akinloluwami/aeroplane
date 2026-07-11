import {
  AddSquareIcon,
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  Delete02Icon,
  FolderCodeIcon,
  FolderOpenIcon,
  FunctionIcon,
  GitBranchIcon,
  GithubIcon,
  Globe02Icon,
  PackageIcon,
  PencilEdit02Icon,
  Search01Icon,
  Settings01Icon,
  WorkflowSquare07Icon,
  CloudServerIcon
} from "@hugeicons/core-free-icons";
import { FormEvent, ReactNode, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type DatabaseVariableSuggestion,
  type EnvExampleVariableSuggestion,
  type Framework,
  type GitHubDirectory,
  type GitHubRepo,
  type GitHubStatus,
  type ServiceOverview
} from "../../api";
import { ModalShell } from "./modal-shell";
import {
  AppIcon,
  BrowserIconFallback,
  FieldLabel,
  FormInput,
  SectionTitle,
  StatusPill,
  chipClass,
  deploymentCardClass,
  shellButton
} from "../ui/primitives";
import { Dropdown } from "../ui/dropdown";
import { formatRelativeTime, formatTime, shortSha } from "../../lib/format";
import { githubBranchesCache, githubDirectoriesCache, githubDirectoryFrameworkCache, githubReposCache } from "../../lib/github-cache";
import { compareReposByLastPush, repoLastPushedAt } from "../../lib/github-repos";
import { DirectoryPickerModal } from "./directory-picker";
import { DirectoryTree } from "./directory-tree";
import { SourcePickerModal } from "./source-picker";
import type { ServiceFormPayload } from "../../features/services/service-form-types";
import { RuntimeModeControl } from "../ui/runtime-mode-control";
import { ImportTypeStep, type ServiceType } from "./import-type-step";
import { DatabaseSelectStep } from "./database-select-step";
import { DatabaseConfigureStep } from "./database-configure-step";
import { DockerImageConfigureStep } from "./docker-image-configure-step";
import { FunctionConfigureStep } from "./function-configure-step";
import type { DatabaseType } from "./database-service-options";
import {
  EnvironmentVariableSuggestions,
  type EnvironmentVariableSuggestionGroup
} from "../../features/services/environment-variable-suggestions";

type ParsedEnvEntry = {
  key: string;
  value: string;
};

type GitSourceMode = "github" | "url";

function isGitUrl(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("https://") || trimmed.startsWith("git@");
}

function nameFromGitUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, "").replace(/\.git$/, "");
  if (!trimmed) return "";

  if (trimmed.startsWith("git@")) {
    return trimmed.split(":").at(-1)?.split("/").at(-1) ?? "";
  }

  try {
    return new URL(trimmed).pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return "";
  }
}

function parseEnvText(input: string): ParsedEnvEntry[] {
  const byKey = new Map<string, string>();

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;

    byKey.set(key, value);
  }

  return Array.from(byKey.entries()).map(([key, value]) => ({ key, value }));
}

export function CreateServiceModal({
  projectId,
  open,
  onClose,
  onCreate
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onCreate: (payload: ServiceFormPayload) => Promise<void>;
}) {
  const [step, setStep] = useState<"type" | "repo" | "directory" | "configure" | "database-select" | "database-configure" | "docker-image-configure" | "function-configure">("type");
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [gitSourceMode, setGitSourceMode] = useState<GitSourceMode>("github");
  const [selectedDbType, setSelectedDbType] = useState<DatabaseType>("postgres");

  const [form, setForm] = useState<ServiceFormPayload>({
    name: "",
    repoFullName: "",
    repoUrl: "",
    branch: "main",
    rootDir: undefined,
    runtimeMode: "web",
    internalPort: 8080,
    installCommand: "",
    buildCommand: "",
    startCommand: "",
    staticOutput: ""
  });
  const [connected, setConnected] = useState<null | boolean>(null);
  const [githubStatus, setGitHubStatus] = useState<null | GitHubStatus>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [directoryError, setDirectoryError] = useState("");
  const [loadingDirectories, setLoadingDirectories] = useState(false);
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<Set<string>>(new Set());
  const [directoryNodes, setDirectoryNodes] = useState<Record<string, GitHubDirectory[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [preciseFrameworks, setPreciseFrameworks] = useState<Record<string, Framework | null>>({});
  const directoryFrameworkRequests = useRef(new Map<string, Promise<void>>());
  const repoSelectionRef = useRef(0);
  const [buildOpen, setBuildOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [envSuggestionsOpen, setEnvSuggestionsOpen] = useState(false);
  const [newEnvOpen, setNewEnvOpen] = useState(false);
  const [envEntries, setEnvEntries] = useState<ParsedEnvEntry[]>([]);
  const [envForm, setEnvForm] = useState<ParsedEnvEntry>({ key: "", value: "" });
  const [databaseVariableSuggestions, setDatabaseVariableSuggestions] = useState<DatabaseVariableSuggestion[]>([]);
  const [envExampleVariableSuggestions, setEnvExampleVariableSuggestions] = useState<EnvExampleVariableSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const owners = useMemo(() => {
    const values = new Set<string>();
    for (const repo of repos) {
      const owner = repo.fullName.split("/")[0];
      if (owner) values.add(owner);
    }
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [repos]);

  const filteredRepos = useMemo(() => {
    return repos
      .filter((repo) => ownerFilter === "all" || repo.fullName.startsWith(`${ownerFilter}/`))
      .sort(compareReposByLastPush);
  }, [ownerFilter, repos]);

  const selectedRepo = useMemo(() => repos.find((repo) => repo.fullName === form.repoFullName) ?? null, [repos, form.repoFullName]);

  const directoryNodesWithPreciseFrameworks = useMemo(() => {
    if (Object.keys(preciseFrameworks).length === 0) return directoryNodes;

    const merged: Record<string, GitHubDirectory[]> = {};
    for (const [parentPath, rows] of Object.entries(directoryNodes)) {
      merged[parentPath] = rows.map((row) => (row.path in preciseFrameworks ? { ...row, framework: preciseFrameworks[row.path] } : row));
    }
    return merged;
  }, [directoryNodes, preciseFrameworks]);

  const rootFramework = preciseFrameworks[""] ?? null;

  useEffect(() => {
    if (!open) {
      setStep("type");
      setServiceType(null);
      setGitSourceMode("github");
      setForm({
        name: "",
        repoFullName: "",
        repoUrl: "",
        branch: "main",
        rootDir: undefined,
        runtimeMode: "web",
        internalPort: 8080,
        installCommand: "",
        buildCommand: "",
        startCommand: "",
        staticOutput: ""
      });
      setConnected(null);
      setGitHubStatus(null);
      setRepoQuery("");
      setOwnerFilter("all");
      setOwnerMenuOpen(false);
      setRepos([]);
      setBranches([]);
      setLoadingRepos(false);
      setLoadingDirectories(false);
      setLoadingDirectoryPaths(new Set());
      setPreciseFrameworks({});
      repoSelectionRef.current += 1;
      setRepoError("");
      setDirectoryError("");
      setDirectoryNodes({});
      setExpandedDirectories(new Set());
      setBuildOpen(false);
      setEnvOpen(false);
      setEnvSuggestionsOpen(false);
      setNewEnvOpen(false);
      setEnvEntries([]);
      setEnvForm({ key: "", value: "" });
      setDatabaseVariableSuggestions([]);
      setEnvExampleVariableSuggestions([]);
      setBusy(false);
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;

    void (async () => {
      try {
        const result = await api.projectDatabaseVariableSuggestions(projectId);
        if (!cancelled) setDatabaseVariableSuggestions(result.suggestions);
      } catch {
        if (!cancelled) setDatabaseVariableSuggestions([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    const repoFullName = form.repoFullName;
    const branch = form.branch;
    const rootDir = form.rootDir;

    if (
      !open ||
      !projectId ||
      step !== "configure" ||
      serviceType !== "git" ||
      gitSourceMode !== "github" ||
      !repoFullName ||
      !branch
    ) {
      setEnvExampleVariableSuggestions([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await api.projectEnvExampleVariableSuggestions(projectId, {
          repoFullName,
          branch,
          rootDir
        });
        if (!cancelled) setEnvExampleVariableSuggestions(result.suggestions);
      } catch {
        if (!cancelled) setEnvExampleVariableSuggestions([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [form.branch, form.repoFullName, form.rootDir, gitSourceMode, open, projectId, serviceType, step]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      try {
        const status = await api.githubStatus();
        if (cancelled) return;
        startTransition(() => {
          setGitHubStatus(status);
          setConnected(status.connected);
        });
      } catch {
        if (cancelled) return;
        startTransition(() => {
          setGitHubStatus(null);
          setConnected(false);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (connected !== true || !open) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setLoadingRepos(true);
      void (async () => {
        try {
          const cacheKey = repoQuery.trim().toLowerCase();
          const cachedRepos = githubReposCache.get(cacheKey);
          const repoList = cachedRepos ?? (await api.githubRepos(repoQuery)).repos;
          if (!cachedRepos) {
            githubReposCache.set(cacheKey, repoList);
          }
          if (cancelled) return;
          startTransition(() => {
            setRepos(repoList);
            setRepoError("");
          });
        } catch (issue) {
          if (cancelled) return;
          startTransition(() => {
            setRepos([]);
            setRepoError(issue instanceof Error ? issue.message : "Could not load repositories");
          });
        } finally {
          if (!cancelled) setLoadingRepos(false);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [connected, open, repoQuery]);

  useEffect(() => {
    if (!owners.length) return;
    if (ownerFilter === "all" || owners.includes(ownerFilter)) return;
    setOwnerFilter("all");
  }, [ownerFilter, owners]);

  useEffect(() => {
    const repoFullName = form.repoFullName;
    if (!repoFullName) return;
    let cancelled = false;

    void (async () => {
      try {
        const cachedBranches = githubBranchesCache.get(repoFullName);
        const nextBranches = cachedBranches ?? (await api.githubBranches(repoFullName)).branches;
        if (!cachedBranches) {
          githubBranchesCache.set(repoFullName, nextBranches);
        }
        if (cancelled) return;
        startTransition(() => {
          setBranches(nextBranches);
        });
      } catch {
        if (cancelled) return;
        startTransition(() => {
          setBranches([]);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [form.repoFullName]);

  useEffect(() => {
    if (!form.repoFullName || !form.branch || step !== "directory") return;
    if (directoryNodes[""]) return;
    void loadDirectoryLevel("");
  }, [directoryNodes, form.branch, form.repoFullName, step]);

  function selectRepo(repo: GitHubRepo) {
    setForm((current) => ({
      ...current,
      name: current.name || repo.name,
      repoFullName: repo.fullName,
      repoUrl: undefined,
      branch: repo.defaultBranch,
      rootDir: undefined
    }));
    setDirectoryNodes({});
    setExpandedDirectories(new Set());
    setPreciseFrameworks({});
    repoSelectionRef.current += 1;
    setDirectoryError("");
    setStep("directory");
  }

  async function loadDirectoryLevel(path: string) {
    if (!form.repoFullName || !form.branch) return;

    const cacheKey = `${form.repoFullName}:${form.branch}:${path}`;
    const cached = githubDirectoriesCache.get(cacheKey);
    if (cached) {
      startTransition(() => {
        setDirectoryNodes((current) => ({ ...current, [path]: cached.directories }));
        // Root's badge is already precise as of the listing response — seeding it here
        // means clicking the root row afterward hits the "already resolved" guard in
        // resolveDirectoryFramework instead of firing a redundant fetch.
        if (path === "") setPreciseFrameworks((current) => ({ ...current, "": cached.rootFramework }));
      });
      return;
    }

    setLoadingDirectories(true);
    setLoadingDirectoryPaths((current) => new Set(current).add(path));
    setDirectoryError("");
    try {
      const response = await api.githubDirectories(form.repoFullName, form.branch, path);
      githubDirectoriesCache.set(cacheKey, response);
      startTransition(() => {
        setDirectoryNodes((current) => ({ ...current, [path]: response.directories }));
        if (path === "") setPreciseFrameworks((current) => ({ ...current, "": response.rootFramework }));
      });
    } catch (issue) {
      startTransition(() => {
        setDirectoryError(issue instanceof Error ? issue.message : "Could not load directories");
      });
    } finally {
      setLoadingDirectories(false);
      setLoadingDirectoryPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }

  async function toggleDirectory(path: string) {
    const isExpanded = expandedDirectories.has(path);
    if (isExpanded) {
      startTransition(() => {
        setExpandedDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      });
      return;
    }

    await loadDirectoryLevel(path);
    void resolveDirectoryFramework(path);
    startTransition(() => {
      setExpandedDirectories((current) => new Set(current).add(path));
    });
  }

  // Coarse badges come free with the directory listing; the precise one (Next.js vs
  // plain React, Fiber vs Go) is only worth the extra request once a folder is actually
  // opened or picked as the root.
  async function resolveDirectoryFramework(path: string) {
    if (!form.repoFullName || !form.branch || path in preciseFrameworks) return;

    const cacheKey = `${form.repoFullName}:${form.branch}:${path}`;
    const cached = githubDirectoryFrameworkCache.get(cacheKey);
    if (cached !== undefined) {
      setPreciseFrameworks((current) => ({ ...current, [path]: cached }));
      return;
    }

    // Toggling/selecting the same folder again before the first lookup lands (or a
    // stray double-click firing both the toggle and select handlers) would otherwise
    // issue a duplicate request — reuse the in-flight one instead.
    const existing = directoryFrameworkRequests.current.get(cacheKey);
    if (existing) return existing;

    const repoFullName = form.repoFullName;
    const branch = form.branch;
    const selectionAtRequest = repoSelectionRef.current;

    const promise = (async () => {
      try {
        const { framework } = await api.githubDirectoryFramework(repoFullName, branch, path);
        githubDirectoryFrameworkCache.set(cacheKey, framework);
        // Discard if the user switched repos while this was in flight — otherwise a
        // late-arriving result can label a folder in the newly selected repo with a
        // framework detected in the previous one.
        if (repoSelectionRef.current !== selectionAtRequest) return;
        startTransition(() => {
          setPreciseFrameworks((current) => ({ ...current, [path]: framework }));
        });
      } catch {
        // Best-effort upgrade; the coarse badge from the directory listing stays as-is.
      } finally {
        directoryFrameworkRequests.current.delete(cacheKey);
      }
    })();

    directoryFrameworkRequests.current.set(cacheKey, promise);
    return promise;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const isUrlSource = serviceType === "git" && gitSourceMode === "url";
      await onCreate({
        ...form,
        repoFullName: isUrlSource ? null : form.repoFullName,
        repoUrl: isUrlSource ? form.repoUrl?.trim() : undefined,
        rootDir: form.rootDir || undefined,
        installCommand: form.installCommand || undefined,
        buildCommand: form.buildCommand || undefined,
        startCommand: form.startCommand || undefined,
        runtimeMode: form.runtimeMode,
        staticOutput: form.runtimeMode === "worker" ? undefined : form.staticOutput || undefined,
        env: envEntries
      });
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not create service");
    } finally {
      setBusy(false);
    }
  }

  async function handleDatabaseSubmit(payload: {
    name: string;
    repoFullName: string;
    repoUrl: string;
    branch: string;
    internalPort: number;
    databasePublicEnabled: boolean;
    databasePublicHostname?: string;
    postgresLogicalReplicationEnabled: boolean;
    env: Array<{ key: string; value: string }>;
  }) {
    setBusy(true);
    setError("");
    try {
      await onCreate({
        name: payload.name,
        repoFullName: payload.repoFullName,
        repoUrl: payload.repoUrl,
        branch: payload.branch,
        internalPort: payload.internalPort,
        databasePublicEnabled: payload.databasePublicEnabled,
        databasePublicHostname: payload.databasePublicHostname,
        postgresLogicalReplicationEnabled: payload.postgresLogicalReplicationEnabled,
        env: payload.env
      });
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not create database service");
    } finally {
      setBusy(false);
    }
  }

  async function handleDockerImageSubmit(payload: {
    name: string;
    repoFullName: string;
    repoUrl: string;
    branch: string;
    dockerImage: string;
    runtimeMode: "web" | "worker";
    internalPort: number;
    env: Array<{ key: string; value: string }>;
  }) {
    setBusy(true);
    setError("");
    try {
      await onCreate({
        name: payload.name,
        repoFullName: payload.repoFullName,
        repoUrl: payload.repoUrl,
        branch: payload.branch,
        dockerImage: payload.dockerImage,
        runtimeMode: payload.runtimeMode,
        internalPort: payload.internalPort,
        env: payload.env
      });
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not create Docker image service");
    } finally {
      setBusy(false);
    }
  }

  async function handleFunctionSubmit(payload: ServiceFormPayload) {
    setBusy(true);
    setError("");
    try {
      await onCreate(payload);
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not create function service");
    } finally {
      setBusy(false);
    }
  }

  const currentDirectory = form.rootDir || "";
  const isUrlSource = serviceType === "git" && gitSourceMode === "url";
  const gitUrlValid = isGitUrl(form.repoUrl ?? "");

  const stepItems = serviceType === "database"
    ? ([
        { key: "database-select", label: "Database" },
        { key: "database-configure", label: "Configure" }
      ] as const)
    : serviceType === "docker-image"
    ? ([{ key: "docker-image-configure", label: "Docker Image" }] as const)
    : serviceType === "function"
    ? ([{ key: "function-configure", label: "Function" }] as const)
    : isUrlSource
    ? ([
        { key: "repo", label: "Git URL" },
        { key: "configure", label: "Configure" }
      ] as const)
    : ([
        { key: "repo", label: "Repository" },
        { key: "directory", label: "Directory" },
        { key: "configure", label: "Configure" }
      ] as const);

  const stepIndex = serviceType === "database"
    ? step === "database-select" ? 0 : 1
    : serviceType === "docker-image"
    ? 0
    : serviceType === "function"
    ? 0
    : isUrlSource
    ? step === "repo" ? 0 : 1
    : step === "repo" ? 0 : step === "directory" ? 1 : 2;

  function handleEnvPaste(text: string) {
    const entries = parseEnvText(text);
    if (entries.length === 0) return false;

    if (entries.length === 1) {
      setNewEnvOpen(true);
      setEnvForm(entries[0]);
      return true;
    }

    setEnvEntries((current) => {
      const next = new Map(current.map((entry) => [entry.key, entry.value]));
      for (const entry of entries) next.set(entry.key, entry.value);
      return Array.from(next.entries()).map(([key, value]) => ({ key, value }));
    });
    setNewEnvOpen(false);
    setEnvForm({ key: "", value: "" });
    return true;
  }

  function addEnvEntry() {
    if (!envForm.key.trim()) return;
    setEnvEntries((current) => {
      const next = new Map(current.map((entry) => [entry.key, entry.value]));
      next.set(envForm.key.trim(), envForm.value);
      return Array.from(next.entries()).map(([key, value]) => ({ key, value }));
    });
    setEnvForm({ key: "", value: "" });
    setNewEnvOpen(false);
  }

  function addEnvironmentVariableSuggestions(entries: ParsedEnvEntry[]) {
    setEnvEntries((current) => {
      const next = new Map(current.map((entry) => [entry.key, entry.value]));
      for (const entry of entries) {
        if (!entry.key.trim()) continue;
        next.set(entry.key.trim(), entry.value);
      }
      return Array.from(next.entries()).map(([key, value]) => ({ key, value }));
    });
    setEnvSuggestionsOpen(false);
  }

  const modalIcon =
    step === "type"
      ? PackageIcon
      : step === "database-select"
      ? CloudServerIcon
      : step === "database-configure"
      ? Settings01Icon
      : step === "docker-image-configure"
      ? PackageIcon
      : step === "function-configure"
      ? FunctionIcon
      : step === "repo"
      ? GithubIcon
      : step === "directory"
      ? FolderOpenIcon
      : Settings01Icon;

  const modalTitle =
    step === "type"
      ? "Create New Service"
      : step === "database-select"
      ? "Select Database Engine"
      : step === "database-configure"
      ? "Configure Database"
      : step === "docker-image-configure"
      ? "Configure Docker Image"
      : step === "function-configure"
      ? "Configure Function"
      : step === "repo"
      ? "Import Git Repository"
      : step === "directory"
      ? "Choose Root Directory"
      : "Configure service";

  const modalMeta =
    step === "type"
      ? "Choose service type"
      : serviceType === "database"
      ? step === "database-select"
        ? "Step 1 of 2"
        : "Step 2 of 2"
      : serviceType === "docker-image"
      ? "Step 1 of 1"
      : serviceType === "function"
      ? "Step 1 of 1"
      : isUrlSource
      ? step === "repo"
        ? "Step 1 of 2"
        : "Step 2 of 2"
      : step === "repo"
      ? "Step 1 of 3"
      : step === "directory"
      ? "Step 2 of 3"
      : "Step 3 of 3";
  const databaseSuggestionKeys = useMemo(() => {
    return new Set(databaseVariableSuggestions.map((suggestion) => suggestion.key.toUpperCase()));
  }, [databaseVariableSuggestions]);
  const visibleEnvExampleVariableSuggestions = useMemo(() => {
    return envExampleVariableSuggestions.filter((suggestion) => !databaseSuggestionKeys.has(suggestion.key.toUpperCase()));
  }, [databaseSuggestionKeys, envExampleVariableSuggestions]);
  const environmentVariableSuggestionGroups = useMemo<EnvironmentVariableSuggestionGroup[]>(() => {
    return [
      {
        id: "database",
        title: "Database variables",
        suggestions: databaseVariableSuggestions.map((suggestion) => ({
          id: `database:${suggestion.serviceId}:${suggestion.key}`,
          key: suggestion.key,
          value: `\${${suggestion.serviceSlug}.${suggestion.sourceKey}}`,
          label: suggestion.label,
          context: suggestion.serviceSlug
        }))
      },
      {
        id: "env-example",
        title: ".env.example variables",
        suggestions: visibleEnvExampleVariableSuggestions.map((suggestion) => ({
          id: `env-example:${suggestion.sourcePath}:${suggestion.key}`,
          key: suggestion.key,
          value: "",
          label: suggestion.label,
          context: suggestion.sourcePath
        }))
      }
    ];
  }, [databaseVariableSuggestions, visibleEnvExampleVariableSuggestions]);
  const environmentVariableSuggestionCount = environmentVariableSuggestionGroups.reduce((total, group) => total + group.suggestions.length, 0);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      icon={modalIcon}
      title={modalTitle}
      meta={modalMeta}
      width="max-w-2xl"
      bodyClassName="min-h-0 flex flex-1 flex-col overflow-hidden"
    >
      {step !== "type" && (
        <div className="mb-4 grid shrink-0 grid-cols-2 md:grid-cols-3 gap-3">
          {stepItems.map((item, index) => (
            <div
              key={item.key}
              className={`flex min-w-0 items-center gap-2 border px-2.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${
                index === stepIndex ? "border-[#4FB8B2]/40 bg-[#4FB8B2]/14 text-[#7fe3dd]" : index < stepIndex ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-zinc-700 bg-zinc-900/85 text-zinc-300"
              }`}
            >
              <span className={`grid h-4 w-4 place-items-center border text-[9px] ${index === stepIndex ? "border-[#4FB8B2]/35 bg-[#4FB8B2]/10 text-[#7fe3dd]" : "border-zinc-700 text-zinc-400"}`}>{index + 1}</span>
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {step === "type" ? (
        <ImportTypeStep
          onSelect={(type) => {
            setServiceType(type);
            if (type === "git") {
              setStep("repo");
            } else if (type === "docker-image") {
              setStep("docker-image-configure");
            } else if (type === "function") {
              setStep("function-configure");
            } else {
              setStep("database-select");
            }
          }}
        />
      ) : step === "database-select" ? (
        <DatabaseSelectStep
          onSelect={(dbType) => {
            setSelectedDbType(dbType);
            setStep("database-configure");
          }}
          onBack={() => {
            setServiceType(null);
            setStep("type");
          }}
        />
      ) : step === "database-configure" ? (
        <DatabaseConfigureStep
          dbType={selectedDbType}
          onBack={() => setStep("database-select")}
          onSubmit={handleDatabaseSubmit}
          busy={busy}
        />
      ) : step === "docker-image-configure" ? (
        <DockerImageConfigureStep
          onBack={() => {
            setServiceType(null);
            setStep("type");
          }}
          onSubmit={handleDockerImageSubmit}
          busy={busy}
        />
      ) : step === "function-configure" ? (
        <FunctionConfigureStep
          onBack={() => {
            setServiceType(null);
            setStep("type");
          }}
          onSubmit={handleFunctionSubmit}
          busy={busy}
        />
      ) : step === "repo" ? (
        <div className="flex min-h-full flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={`${gitSourceMode === "github" ? chipClass(true) : chipClass(false)} w-full justify-start`}
                  onClick={() => {
                    setGitSourceMode("github");
                    setForm((current) => ({ ...current, repoUrl: undefined }));
                  }}
                >
                  <AppIcon icon={GithubIcon} size={15} />
                  GitHub repository
                </button>
                <button
                  type="button"
                  className={`${gitSourceMode === "url" ? chipClass(true) : chipClass(false)} w-full justify-start`}
                  onClick={() => {
                    setGitSourceMode("url");
                    setForm((current) => ({ ...current, repoFullName: "", rootDir: undefined }));
                    setDirectoryNodes({});
                    setExpandedDirectories(new Set());
                    setPreciseFrameworks({});
                    repoSelectionRef.current += 1;
                    setDirectoryError("");
                  }}
                >
                  <AppIcon icon={WorkflowSquare07Icon} size={15} />
                  Git URL
                </button>
              </div>

              {gitSourceMode === "url" ? (
                <div className="space-y-4 border border-zinc-700 bg-zinc-900/85 p-4">
                  <div>
                    <FieldLabel>Git URL</FieldLabel>
                    <FormInput
                      value={form.repoUrl ?? ""}
                      onChange={(event) => {
                        const repoUrl = event.target.value;
                        const inferredName = nameFromGitUrl(repoUrl);
                        setForm((current) => ({
                          ...current,
                          repoUrl,
                          name: current.name || inferredName
                        }));
                      }}
                      placeholder="https://github.com/owner/repo.git"
                      autoComplete="off"
                      disabled={busy}
                    />
                    {form.repoUrl?.trim() && !gitUrlValid ? (
                      <p className="mt-2 text-xs text-rose-300">Use an HTTPS Git URL or SSH URL like git@github.com:owner/repo.git.</p>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">Use this for public repos, SSH repos, or providers outside the GitHub App flow.</p>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <FieldLabel>Service name</FieldLabel>
                      <FormInput
                        value={form.name}
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="api"
                        required
                      />
                    </div>
                    <div>
                      <FieldLabel>Branch</FieldLabel>
                      <FormInput
                        value={form.branch}
                        onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
                        placeholder="main"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className={shellButton("primary")}
                      disabled={!gitUrlValid || !form.name.trim() || !form.branch.trim()}
                      onClick={() => setStep("configure")}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : connected === false ? (
                <div className="space-y-3 border border-zinc-700 bg-zinc-900/85 p-4">
                  <div className="text-sm text-zinc-300">
                    {githubStatus?.installUrl ? (
                      <>
                        Install the GitHub App first, or enter <code>owner/repo</code> manually to continue.
                      </>
                    ) : (
                      <>
                        GitHub is not connected yet. Configure a GitHub App or set <code>GITHUB_ACCESS_TOKEN</code> on the server.
                      </>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <FormInput
                      value={form.repoFullName ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, repoFullName: event.target.value, name: event.target.value.split("/").at(-1) || current.name }))}
                      placeholder="owner/repo"
                      disabled={busy}
                    />
                    <button type="button" className={shellButton("primary")} onClick={() => setStep("directory")} disabled={!form.repoFullName?.trim()}>
                      Continue
                    </button>
                  </div>
                </div>
              ) : connected === null ? (
                <div className="border border-zinc-700 bg-zinc-900/85 px-4 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">Checking GitHub connection…</div>
              ) : (
                <>
                  <div className="grid gap-2 md:grid-cols-[260px_minmax(0,1fr)]">
                    <div className="relative">
                      <button
                        type="button"
                        className="flex h-11 w-full items-center justify-between border border-zinc-700 bg-zinc-900 px-3 text-left text-sm text-zinc-100 disabled:opacity-60"
                        onClick={() => setOwnerMenuOpen((current) => !current)}
                        disabled={!owners.length}
                      >
                        <span className="truncate">{ownerFilter === "all" ? "All accounts" : ownerFilter}</span>
                        <AppIcon icon={ArrowLeft01Icon} size={16} className={ownerMenuOpen ? "rotate-90" : "-rotate-90"} />
                      </button>
                      {ownerMenuOpen ? (
                        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-64 overflow-auto border border-zinc-700 bg-zinc-900 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between border-b border-zinc-800 px-3 py-3 text-left text-sm text-zinc-100 hover:bg-zinc-800"
                            onClick={() => {
                              setOwnerFilter("all");
                              setOwnerMenuOpen(false);
                            }}
                          >
                            <span className="truncate">All accounts</span>
                            {ownerFilter === "all" ? <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7fe3dd]">Current</span> : null}
                          </button>
                          {owners.map((owner) => (
                            <button
                              key={owner}
                              type="button"
                              className="flex w-full items-center justify-between border-b border-zinc-800 px-3 py-3 text-left text-sm text-zinc-100 hover:bg-zinc-800"
                              onClick={() => {
                                setOwnerFilter(owner);
                                setOwnerMenuOpen(false);
                              }}
                            >
                              <span className="truncate">{owner}</span>
                              {ownerFilter === owner ? <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7fe3dd]">Current</span> : null}
                            </button>
                          ))}
                          {githubStatus?.installUrl ? (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-3 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7fe3dd] hover:bg-[#4FB8B2]/10"
                              onClick={() => {
                                window.open(githubStatus.installUrl ?? "", "_blank", "noopener,noreferrer");
                                setOwnerMenuOpen(false);
                              }}
                            >
                              <AppIcon icon={GithubIcon} size={14} />
                              Configure GitHub
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="relative">
                      <AppIcon icon={Search01Icon} size={16} className="pointer-events-none absolute left-3 top-3 text-zinc-500" />
                      <FormInput value={repoQuery} onChange={(event) => setRepoQuery(event.target.value)} placeholder="Search repositories" className="pl-10" />
                    </div>
                  </div>

                  {repoError ? <div className="border border-rose-500/25 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">GitHub is configured, but repo lookup failed: {repoError}</div> : null}

                  <div className="overflow-hidden border border-zinc-700 bg-zinc-900/85">
                    <div className="max-h-[280px] overflow-auto">
                      {filteredRepos.length === 0 ? (
                        <div className="px-4 py-5 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                          {loadingRepos ? "Loading repositories..." : "No repositories found for this search yet."}
                        </div>
                      ) : (
                        filteredRepos.map((repo) => (
                          <div key={repo.id} className="flex items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2.5 last:border-b-0">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="grid h-8 w-8 shrink-0 place-items-center border border-zinc-800 bg-zinc-900 text-zinc-200">
                                <AppIcon icon={GithubIcon} size={15} />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-zinc-100">{repo.name}</div>
                                <div className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                                  {repo.fullName}
                                  <span className="ml-2">{formatRelativeTime(repoLastPushedAt(repo))}</span>
                                </div>
                              </div>
                            </div>
                            <button type="button" className={shellButton("secondary")} onClick={() => selectRepo(repo)}>
                              Import
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="mt-5 flex items-center justify-start gap-3 border-t border-zinc-800 pt-4">
            <button
              type="button"
              className={shellButton("ghost")}
              onClick={() => {
                setServiceType(null);
                setStep("type");
              }}
            >
              <AppIcon icon={ArrowLeft01Icon} size={16} />
              Back
            </button>
          </div>
        </div>
      ) : step === "directory" ? (
        <div className="flex min-h-full flex-col">
          <div className="shrink-0 space-y-5">
            <div>
              <FieldLabel>Selected directory</FieldLabel>
              <div className="flex h-11 items-center border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                {currentDirectory ? `./${currentDirectory}` : "./"}
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-5">
            <DirectoryTree
              repoLabel={selectedRepo?.name ?? form.repoFullName ?? ""}
              selectedPath={currentDirectory}
              directoriesByPath={directoryNodesWithPreciseFrameworks}
              expandedPaths={expandedDirectories}
              loadingPaths={loadingDirectoryPaths}
              errorMessage={directoryError}
              footerMessage={loadingDirectories ? "Loading folders..." : "Choose the folder that contains the app you want to deploy."}
              rootLabel={`${selectedRepo?.name ?? "Repository"} (root)`}
              rootFramework={rootFramework}
              onToggle={toggleDirectory}
              onSelect={(path) => {
                setForm((current) => ({ ...current, rootDir: path || undefined }));
                void resolveDirectoryFramework(path);
              }}
            />
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
            <button type="button" className={shellButton("ghost")} onClick={() => setStep("repo")}>
              <AppIcon icon={ArrowLeft01Icon} size={16} />
              Back
            </button>
            <button type="button" className={shellButton("primary")} onClick={() => setStep("configure")}>
              Continue
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-5">
          <div>
            <FieldLabel>Root directory</FieldLabel>
            {isUrlSource ? (
              <FormInput
                value={form.rootDir ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, rootDir: event.target.value || undefined }))}
                placeholder="."
              />
            ) : (
              <div className="flex h-11 items-center border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                {currentDirectory ? `./${currentDirectory}` : "./"}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between border border-zinc-700 bg-zinc-900/90 px-4 py-4 text-left"
              onClick={() => setBuildOpen((current) => !current)}
            >
              <span className="text-base font-medium text-zinc-100">Build and Output Settings</span>
              <AppIcon icon={ArrowLeft01Icon} size={16} className={buildOpen ? "rotate-90" : "-rotate-90"} />
            </button>
            {buildOpen ? (
              <div className="border border-zinc-700 bg-zinc-900 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>Service name</FieldLabel>
                    <FormInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="api" required />
                  </div>
                  <div>
                    <FieldLabel>Branch</FieldLabel>
                    <Dropdown
                      value={form.branch}
                      options={(branches.length === 0 ? [form.branch || "main"] : branches).map((branch) => ({ value: branch, label: branch }))}
                      onChange={(branch) => setForm((current) => ({ ...current, branch }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel>Runtime mode</FieldLabel>
                    <RuntimeModeControl
                      value={form.runtimeMode ?? "web"}
                      onChange={(runtimeMode) => setForm((current) => ({
                        ...current,
                        runtimeMode,
                        staticOutput: runtimeMode === "worker" ? "" : current.staticOutput
                      }))}
                    />
                  </div>
                  {form.runtimeMode !== "worker" ? (
                    <>
                      <div>
                        <FieldLabel>App port</FieldLabel>
                        <FormInput type="number" min={1} max={65535} value={form.internalPort} onChange={(event) => setForm({ ...form, internalPort: Number(event.target.value) })} required />
                      </div>
                      <div>
                        <FieldLabel>Static output</FieldLabel>
                        <FormInput value={form.staticOutput ?? ""} onChange={(event) => setForm({ ...form, staticOutput: event.target.value })} placeholder="auto" />
                      </div>
                    </>
                  ) : null}
                  <div>
                    <FieldLabel>Install command</FieldLabel>
                    <FormInput value={form.installCommand ?? ""} onChange={(event) => setForm({ ...form, installCommand: event.target.value })} placeholder="auto" />
                  </div>
                  <div>
                    <FieldLabel>Build command</FieldLabel>
                    <FormInput value={form.buildCommand ?? ""} onChange={(event) => setForm({ ...form, buildCommand: event.target.value })} placeholder="auto" />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel>Start command</FieldLabel>
                    <FormInput value={form.startCommand ?? ""} onChange={(event) => setForm({ ...form, startCommand: event.target.value })} placeholder="auto" />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex w-full items-center border border-zinc-700 bg-zinc-900/90">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 text-left"
                onClick={() => setEnvOpen((current) => !current)}
              >
                <span className="text-base font-medium text-zinc-100">Environment Variables</span>
              </button>
              {environmentVariableSuggestionCount > 0 ? (
                <button
                  type="button"
                  className="mr-2 inline-flex shrink-0 items-center border border-[#4FB8B2]/35 bg-[#4FB8B2]/10 px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7fe3dd] transition hover:bg-[#4FB8B2]/16"
                  onClick={() => {
                    setEnvOpen(true);
                    setEnvSuggestionsOpen((current) => !current);
                  }}
                >
                  [{environmentVariableSuggestionCount} suggestion{environmentVariableSuggestionCount === 1 ? "" : "s"}]
                </button>
              ) : null}
              <button
                type="button"
                className="px-4 py-4 text-zinc-300 transition hover:text-zinc-100"
                onClick={() => setEnvOpen((current) => !current)}
                aria-label={envOpen ? "Collapse environment variables" : "Expand environment variables"}
              >
                <AppIcon icon={ArrowLeft01Icon} size={16} className={envOpen ? "rotate-90" : "-rotate-90"} />
              </button>
            </div>
            {envOpen ? (
              <div className="space-y-4 border border-zinc-700 bg-zinc-900 p-4">
                <div className="flex items-center justify-end gap-3">
                  <button type="button" className={shellButton("secondary")} onClick={() => setNewEnvOpen((current) => !current)}>
                    <AppIcon icon={AddSquareIcon} size={16} />
                    New variable
                  </button>
                </div>

                {envSuggestionsOpen ? (
                  <EnvironmentVariableSuggestions
                    groups={environmentVariableSuggestionGroups}
                    onAdd={addEnvironmentVariableSuggestions}
                  />
                ) : null}

                {newEnvOpen ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]">
                    <div>
                      <FieldLabel>Key</FieldLabel>
                      <FormInput
                        value={envForm.key}
                        onChange={(event) => setEnvForm({ ...envForm, key: event.target.value })}
                        onPaste={(event) => {
                          const text = event.clipboardData.getData("text");
                          if (handleEnvPaste(text)) event.preventDefault();
                        }}
                        placeholder="KEY"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <FieldLabel>Value</FieldLabel>
                      <FormInput
                        value={envForm.value}
                        onChange={(event) => setEnvForm({ ...envForm, value: event.target.value })}
                        onPaste={(event) => {
                          const text = event.clipboardData.getData("text");
                          if (handleEnvPaste(text)) event.preventDefault();
                        }}
                        placeholder="VALUE"
                        autoComplete="new-password"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button type="button" className={shellButton("primary")} onClick={addEnvEntry}>
                        Save
                      </button>
                      <button
                        type="button"
                        className={shellButton("ghost")}
                        onClick={() => {
                          setNewEnvOpen(false);
                          setEnvForm({ key: "", value: "" });
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="overflow-hidden border border-zinc-700 bg-zinc-900/88">
                  {envEntries.length === 0 ? (
                    <div className="px-5 py-6 text-sm text-zinc-400">No environment variables yet.</div>
                  ) : (
                    envEntries.map((item) => (
                      <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_180px_56px] items-center gap-4 border-b border-zinc-800 px-5 py-4 last:border-b-0">
                        <div className="flex min-w-0 items-center gap-4">
                          <span className="font-mono text-lg text-zinc-500">{`{ }`}</span>
                          <span className="truncate font-mono text-[15px] uppercase tracking-[0.06em] text-zinc-100">{item.key}</span>
                        </div>
                        <div className="font-mono text-[15px] text-zinc-300">********</div>
                        <button
                          type="button"
                          className="ml-auto inline-flex h-9 w-9 items-center justify-center text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                          aria-label={`Delete ${item.key}`}
                          onClick={() => setEnvEntries((current) => current.filter((entry) => entry.key !== item.key))}
                        >
                          <AppIcon icon={Delete02Icon} size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-rose-200">{error}</p> : null}
          </div>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
            <button type="button" className={shellButton("ghost")} onClick={() => setStep(isUrlSource ? "repo" : "directory")}>
              <AppIcon icon={ArrowLeft01Icon} size={16} />
              Back
            </button>
            <button type="submit" className={shellButton("primary")} disabled={busy}>
              <AppIcon icon={AddSquareIcon} size={16} />
              {busy ? "Deploying..." : "Deploy"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
