import {
  Delete02Icon,
  DatabaseIcon,
  FileCodeIcon,
  FolderOpenIcon,
  GithubIcon,
  Globe02Icon,
  PackageIcon,
  LeftToRightListStarIcon,
  VariableIcon,
  VideoConsoleIcon,
  DashboardSquare02Icon,
  DatabaseExportIcon
} from "@hugeicons/core-free-icons";
import { FormEvent, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type AuthUser,
  type DeploymentLog,
  type GitHubDirectory,
  type GitHubRepo,
  type RuntimeLog,
  type Service,
  type ServiceOverview,
  type ToolCheck
} from "../../api";
import { AppIcon, BrowserIconFallback } from "../../components/ui/primitives";
import { githubBranchesCache, githubDirectoriesCache, githubReposCache } from "../../lib/github-cache";
import { DirectoryPickerModal } from "../../components/modals/directory-picker";
import { SourcePickerModal } from "../../components/modals/source-picker";
import { TransferServiceModal } from "../../components/modals/transfer-service-modal";
import { ConfirmationDialog } from "../../components/modals/confirmation-dialog";
import { DatabaseServiceSettingsPanel } from "../../components/modals/database-service-settings-panel";
import { DockerImageServiceSettingsPanel } from "../../components/modals/docker-image-service-settings-panel";
import { FunctionServiceSettingsPanel } from "../../components/modals/function-service-settings-panel";
import { DatabaseBackupsPanel } from "../../components/modals/database-backups-panel";
import { DatabaseBrowserPanel } from "../../components/modals/database-browser-panel";
import { DatabaseSqlConsolePanel } from "../../components/modals/database-sql-console-panel";
import { RedisBrowserPanel } from "../../components/modals/redis-browser-panel";
import { ServicePageToolbar } from "./service-page-toolbar";
import { ServiceDeploymentsPanel } from "./service-deployments-panel";
import { ServiceDomainsPanel } from "./service-domains-panel";
import { ServiceVariablesPanel } from "./service-variables-panel";
import { formatBuildDuration } from "./service-format";
import { RuntimeLogsPanel } from "./service-log-panels";
import { ServiceOverviewPanel } from "./service-overview-panel";
import { FunctionSourcePanel } from "./function-source-panel";
import { ProjectRouteLoader } from "../projects/project-route-loader";
import { RedeployRequiredToast } from "./redeploy-required-toast";
import { ProjectsDashboardSidebar } from "../projects/projects-dashboard-sidebar";
import type { ServiceTab } from "./service-tabs";
import { ApplicationServiceSettingsPanel } from "./application-service-settings-panel";
import type { ServiceSettingsState } from "./service-settings-state";
import { dockerImageForService, dockerImageRepoFullName, isDatabaseService, isDockerImageService } from "../../../shared/service-source";
import { isFunctionService } from "../../../shared/service-functions";
import { deploymentIsPending, mergeDeploymentList } from "../../lib/deployment-status";

function textOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function formValue(form: HTMLFormElement, name: string, fallback: string) {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.value : fallback;
}

function formNumberValue(form: HTMLFormElement, name: string, fallback: number) {
  const value = Number(formValue(form, name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function settingsFromService(service: Service): ServiceSettingsState {
  return {
    name: service.name,
    repoFullName: service.repoFullName ?? "",
    repoUrl: service.repoUrl,
    dockerImage: service.dockerImage ?? dockerImageForService(service),
    branch: service.branch,
    rootDir: service.rootDir ?? "",
    installCommand: service.installCommand ?? "",
    prebuildCommand: service.prebuildCommand ?? "",
    buildCommand: service.buildCommand ?? "",
    startCommand: service.startCommand ?? "",
    staticOutput: service.staticOutput ?? "",
    buildMethod: service.buildMethod,
    dockerfilePath: service.dockerfilePath ?? "",
    persistentVolumePath: service.persistentVolumePath ?? "",
    runtimeMode: service.runtimeMode,
    internalPort: service.internalPort,
    databasePublicEnabled: service.databasePublicEnabled,
    databasePublicHostname: service.databasePublicHostname ?? "",
    postgresLogicalReplicationEnabled: service.postgresLogicalReplicationEnabled
  };
}

const serviceTabLabels: Record<ServiceTab, string> = {
  overview: "Overview",
  deployments: "Deployments",
  logs: "Logs",
  environment: "Variables",
  domains: "Domains",
  source: "Source Code",
  data: "Data",
  sql: "Console",
  backups: "Backups",
  settings: "Settings"
};

function actionRequiresRedeploy(label: string) {
  return label === "env" || label === "settings" || label === "source";
}

export function ServicePageShell({
  selectedTab,
  serviceId,
  onClose,
  onTabChange,
  onProjectRefresh,
  onDeleted,
  pageServices = [],
  onServiceSelect,
  onTransferred,
  currentUser,
  tools,
  owner
}: {
  selectedTab: ServiceTab;
  serviceId: string;
  onClose: () => void;
  onTabChange: (tab: ServiceTab) => void;
  onProjectRefresh: () => Promise<void> | void;
  onDeleted: () => void;
  pageServices?: Service[];
  onServiceSelect?: (serviceSlug: string) => void;
  onTransferred: (projectSlug: string, serviceSlug: string) => void;
  currentUser: AuthUser | null;
  tools: ToolCheck[];
  owner: boolean;
}) {
  const [overview, setOverview] = useState<null | ServiceOverview>(null);
  const [activeDeploymentId, setActiveDeploymentId] = useState<null | string>(null);
  const [deploymentLogs, setDeploymentLogs] = useState<DeploymentLog[]>([]);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLog[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ key: string; label: string }>>([]);
  const [settings, setSettings] = useState<ServiceSettingsState>({
    name: "",
    repoFullName: "",
    repoUrl: "",
    dockerImage: "",
    branch: "",
    rootDir: "",
    installCommand: "",
    prebuildCommand: "",
    buildCommand: "",
    startCommand: "",
    staticOutput: "",
    buildMethod: "auto" as "auto" | "railpack" | "dockerfile",
    dockerfilePath: "",
    persistentVolumePath: "",
    runtimeMode: "web" as "web" | "worker",
    internalPort: 8080,
    databasePublicEnabled: true,
    databasePublicHostname: "",
    postgresLogicalReplicationEnabled: false
  });
  const [settingsBranches, setSettingsBranches] = useState<string[]>([]);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceRepos, setSourceRepos] = useState<GitHubRepo[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [settingsDirectoryNodes, setSettingsDirectoryNodes] = useState<Record<string, GitHubDirectory[]>>({});
  const [settingsExpandedDirectories, setSettingsExpandedDirectories] = useState<Set<string>>(new Set());
  const [settingsDirectoryError, setSettingsDirectoryError] = useState("");
  const [settingsDirectoryLoadingPaths, setSettingsDirectoryLoadingPaths] = useState<Set<string>>(new Set());
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [redeployToastVisible, setRedeployToastVisible] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastDeploymentRefreshRef = useRef(0);
  const overviewRequestIdRef = useRef(0);
  const settingsServiceIdRef = useRef<null | string>(null);
  const selectedTabRef = useRef(selectedTab);

  useEffect(() => {
    selectedTabRef.current = selectedTab;
  }, [selectedTab]);

  const loadSuggestionKeys = useCallback(async () => {
    const suggs = await api.suggestionKeys(serviceId).catch(() => ({ suggestions: [], databaseVariables: [] }));
    startTransition(() => {
      setSuggestions(suggs.suggestions);
    });
  }, [serviceId]);

  const loadOverview = useCallback(async (options: { showLoading?: boolean; syncSettings?: boolean } = {}) => {
    const requestId = ++overviewRequestIdRef.current;
    const showLoading = options.showLoading ?? true;
    if (showLoading) setOverviewLoading(true);
    try {
      const result = await api.serviceOverview(serviceId);
      if (requestId !== overviewRequestIdRef.current) return;
      const shouldSyncSettings = options.syncSettings ?? (selectedTabRef.current !== "settings" || settingsServiceIdRef.current !== result.service.id);
      if (shouldSyncSettings) settingsServiceIdRef.current = result.service.id;
      startTransition(() => {
        setOverview(result);
        setActiveDeploymentId((current) => {
          if (current && result.deployments.some((deployment) => deployment.id === current)) return current;
          const pendingDeployment = result.deployments.find((deployment) => deploymentIsPending(deployment.status));
          if (pendingDeployment) return pendingDeployment.id;
          return result.deployments[0]?.id ?? null;
        });
        if (shouldSyncSettings) setSettings(settingsFromService(result.service));
        setError("");
        setOverviewLoading(false);
      });
    } catch (issue) {
      if (requestId !== overviewRequestIdRef.current) return;
      startTransition(() => {
        setError(issue instanceof Error ? issue.message : "Could not load service");
        setOverviewLoading(false);
      });
    }
  }, [serviceId]);

  useEffect(() => {
    settingsServiceIdRef.current = null;
    setDeleteDialogOpen(false);
    void loadOverview();
    void loadSuggestionKeys();
  }, [loadOverview, loadSuggestionKeys, serviceId]);

  useEffect(() => {
    if (!overview) return;

    const hasActiveDeployment = overview.deployments.some((deployment) => deploymentIsPending(deployment.status));
    const hasPendingService = deploymentIsPending(overview.service.status);
    const refreshMs = hasActiveDeployment || hasPendingService ? 1000 : 5000;

    const interval = setInterval(() => {
      void loadOverview({ showLoading: false });
      if (hasActiveDeployment || hasPendingService) void onProjectRefresh();
    }, refreshMs);

    return () => clearInterval(interval);
  }, [loadOverview, onProjectRefresh, overview]);

  const refreshDeploymentState = useCallback(() => {
    const nextRefreshAt = Date.now();
    if (nextRefreshAt - lastDeploymentRefreshRef.current < 900) return;
    lastDeploymentRefreshRef.current = nextRefreshAt;
    void loadOverview({ showLoading: false });
    void onProjectRefresh();
  }, [loadOverview, onProjectRefresh]);

  const activeDeployment = useMemo(
    () => overview?.deployments.find((deployment) => deployment.id === activeDeploymentId) ?? null,
    [overview?.deployments, activeDeploymentId]
  );

  useEffect(() => {
    if (!activeDeployment || !deploymentIsPending(activeDeployment.status)) return;

    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [activeDeployment]);

  useEffect(() => {
    if (!activeDeploymentId) {
      setDeploymentLogs([]);
      return;
    }

    const events = new EventSource(`/api/deployments/${activeDeploymentId}/stream`);
    events.addEventListener("snapshot", (event) => {
      startTransition(() => setDeploymentLogs(JSON.parse((event as MessageEvent).data)));
      refreshDeploymentState();
    });
    events.addEventListener("log", (event) => {
      const log = JSON.parse((event as MessageEvent).data) as DeploymentLog;
      startTransition(() => setDeploymentLogs((current) => [...current, log]));
      refreshDeploymentState();
    });
    events.onerror = () => {
      refreshDeploymentState();
      events.close();
    };
    return () => events.close();
  }, [activeDeploymentId, refreshDeploymentState]);

  useEffect(() => {
    if (selectedTab !== "logs") return;

    const events = new EventSource(`/api/services/${serviceId}/runtime-logs/stream`);
    events.addEventListener("snapshot", (event) => {
      startTransition(() => setRuntimeLogs(JSON.parse((event as MessageEvent).data)));
    });
    events.addEventListener("log", (event) => {
      const log = JSON.parse((event as MessageEvent).data) as RuntimeLog;
      startTransition(() => setRuntimeLogs((current) => [...current, log]));
    });
    events.onerror = () => events.close();
    return () => events.close();
  }, [selectedTab, serviceId]);

  useEffect(() => {
    if (
      selectedTab !== "settings" ||
      !settings.repoFullName ||
      settings.repoFullName.startsWith("database:") ||
      settings.repoFullName.startsWith("image:") ||
      settings.repoFullName.startsWith("function:")
    ) return;
    let cancelled = false;

    void (async () => {
      try {
        const cachedBranches = githubBranchesCache.get(settings.repoFullName);
        const nextBranches = cachedBranches ?? (await api.githubBranches(settings.repoFullName)).branches;
        if (!cachedBranches) githubBranchesCache.set(settings.repoFullName, nextBranches);
        if (cancelled) return;
        startTransition(() => setSettingsBranches(nextBranches));
      } catch {
        if (cancelled) return;
        startTransition(() => setSettingsBranches(settings.branch ? [settings.branch] : []));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTab, settings.repoFullName, settings.branch]);

  useEffect(() => {
    if (selectedTab !== "settings" || !sourcePickerOpen) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setSourceLoading(true);
      void (async () => {
        try {
          const cacheKey = sourceQuery.trim().toLowerCase();
          const cachedRepos = githubReposCache.get(cacheKey);
          const nextRepos = cachedRepos ?? (await api.githubRepos(sourceQuery)).repos;
          if (!cachedRepos) githubReposCache.set(cacheKey, nextRepos);
          if (cancelled) return;
          startTransition(() => {
            setSourceRepos(nextRepos);
            setSourceError("");
          });
        } catch (issue) {
          if (cancelled) return;
          startTransition(() => {
            setSourceRepos([]);
            setSourceError(issue instanceof Error ? issue.message : "Could not load repositories");
          });
        } finally {
          if (!cancelled) setSourceLoading(false);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [selectedTab, sourcePickerOpen, sourceQuery]);

  useEffect(() => {
    if (selectedTab !== "settings" || isDockerImage || settings.repoFullName.startsWith("function:") || !directoryPickerOpen || !settings.repoFullName || !settings.branch) return;
    if (settingsDirectoryNodes[""]) return;
    void loadSettingsDirectoryLevel("");
  }, [selectedTab, directoryPickerOpen, settings.repoFullName, settings.branch, settingsDirectoryNodes]);

  useEffect(() => {
    setBranchMenuOpen(false);
    setSourcePickerOpen(false);
    setDirectoryPickerOpen(false);
  }, [selectedTab]);

  async function doAction(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
      await loadOverview({ showLoading: false, syncSettings: label === "settings" });
      await loadSuggestionKeys();
      await onProjectRefresh();
      if (actionRequiresRedeploy(label)) {
        setRedeployToastVisible(true);
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  async function loadSettingsDirectoryLevel(path: string) {
    if (!settings.repoFullName || !settings.branch) return;

    const cacheKey = `${settings.repoFullName}:${settings.branch}:${path}`;
    const cachedDirectories = githubDirectoriesCache.get(cacheKey);
    if (cachedDirectories) {
      startTransition(() => {
        setSettingsDirectoryNodes((current) => ({ ...current, [path]: cachedDirectories }));
      });
      return;
    }

    setSettingsDirectoryLoadingPaths((current) => new Set(current).add(path));
    setSettingsDirectoryError("");
    try {
      const nextDirectories = (await api.githubDirectories(settings.repoFullName, settings.branch, path)).directories;
      githubDirectoriesCache.set(cacheKey, nextDirectories);
      startTransition(() => {
        setSettingsDirectoryNodes((current) => ({ ...current, [path]: nextDirectories }));
      });
    } catch (issue) {
      startTransition(() => {
        setSettingsDirectoryError(issue instanceof Error ? issue.message : "Could not load directories");
      });
    } finally {
      setSettingsDirectoryLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }

  async function toggleSettingsDirectory(path: string) {
    const isExpanded = settingsExpandedDirectories.has(path);
    if (isExpanded) {
      startTransition(() => {
        setSettingsExpandedDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      });
      return;
    }

    await loadSettingsDirectoryLevel(path);
    startTransition(() => {
      setSettingsExpandedDirectories((current) => new Set(current).add(path));
    });
  }

  function settingsSnapshotFromForm(form: HTMLFormElement): ServiceSettingsState {
    return {
      ...settings,
      name: formValue(form, "name", settings.name),
      dockerImage: formValue(form, "dockerImage", settings.dockerImage),
      branch: formValue(form, "branch", settings.branch),
      rootDir: formValue(form, "rootDir", settings.rootDir),
      installCommand: formValue(form, "installCommand", settings.installCommand),
      prebuildCommand: formValue(form, "prebuildCommand", settings.prebuildCommand),
      buildCommand: formValue(form, "buildCommand", settings.buildCommand),
      startCommand: formValue(form, "startCommand", settings.startCommand),
      staticOutput: formValue(form, "staticOutput", settings.staticOutput),
      dockerfilePath: formValue(form, "dockerfilePath", settings.dockerfilePath),
      persistentVolumePath: formValue(form, "persistentVolumePath", settings.persistentVolumePath),
      internalPort: formNumberValue(form, "internalPort", settings.internalPort),
      databasePublicHostname: formValue(form, "databasePublicHostname", settings.databasePublicHostname)
    };
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedSettings = settingsSnapshotFromForm(event.currentTarget);
    setSettings(submittedSettings);
    await doAction("settings", async () => {
      await api.updateService(serviceId, {
        name: submittedSettings.name,
        repoFullName: isDatabase
          ? submittedSettings.repoFullName
          : isDockerImage
            ? dockerImageRepoFullName(submittedSettings.dockerImage)
            : isFunction
              ? undefined
              : (submittedSettings.repoFullName.trim() ? submittedSettings.repoFullName : null),
        repoUrl: isDatabase || isFunction ? undefined : isDockerImage ? "docker-image" : (submittedSettings.repoFullName.trim() ? undefined : submittedSettings.repoUrl.trim() || undefined),
        dockerImage: isDockerImage ? submittedSettings.dockerImage : undefined,
        branch: submittedSettings.branch,
        rootDir: isDatabase || isDockerImage || isFunction ? undefined : textOrNull(submittedSettings.rootDir),
        installCommand: isDatabase || isDockerImage || isFunction ? undefined : textOrNull(submittedSettings.installCommand),
        prebuildCommand: isDatabase || isDockerImage || isFunction ? undefined : textOrNull(submittedSettings.prebuildCommand),
        buildCommand: isDatabase || isDockerImage || isFunction ? undefined : textOrNull(submittedSettings.buildCommand),
        startCommand: isDatabase || isDockerImage || isFunction ? undefined : textOrNull(submittedSettings.startCommand),
        staticOutput: isDatabase || isDockerImage || isFunction ? undefined : textOrNull(submittedSettings.staticOutput),
        buildMethod: isDatabase || isDockerImage || isFunction ? undefined : submittedSettings.buildMethod,
        dockerfilePath: isDatabase || isDockerImage || isFunction ? undefined : textOrNull(submittedSettings.dockerfilePath),
        persistentVolumePath: isDatabase || isFunction || submittedSettings.staticOutput ? null : textOrNull(submittedSettings.persistentVolumePath),
        runtimeMode: isDatabase ? undefined : submittedSettings.runtimeMode,
        internalPort: Number(submittedSettings.internalPort),
        databasePublicEnabled: isDatabase ? true : undefined,
        databasePublicHostname: isDatabase ? submittedSettings.databasePublicHostname || undefined : undefined,
        postgresLogicalReplicationEnabled: isDatabase ? submittedSettings.postgresLogicalReplicationEnabled : undefined
      });
    });
  }

  async function abortActiveDeployment() {
    if (!activeDeployment || !deploymentIsPending(activeDeployment.status)) return;

    await doAction("abort", async () => {
      await api.abortDeployment(activeDeployment.id);
    });
  }

  async function deployService() {
    setRedeployToastVisible(false);
    setBusy("deploy");
    setError("");
    try {
      const result = await api.createDeployment(serviceId);
      startTransition(() => {
        setActiveDeploymentId(result.deployment.id);
        setOverview((current) => {
          if (!current) return current;
          return {
            ...current,
            service: {
              ...current.service,
              status: deploymentIsPending(result.deployment.status)
                ? result.deployment.status
                : current.service.status,
              updatedAt: result.deployment.createdAt
            },
            deployments: mergeDeploymentList(current.deployments, result.deployment)
          };
        });
      });
      void loadOverview({ showLoading: false });
      void onProjectRefresh();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  function deployFromToast() {
    onTabChange("deployments");
    void deployService();
  }

  async function transferService(targetProjectId: string) {
    setBusy("transfer");
    setError("");
    try {
      const result = await api.transferService(serviceId, { targetProjectId });
      setTransferOpen(false);
      onTransferred(result.project.slug, result.service.slug);
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "Could not transfer service";
      setError(message);
      throw new Error(message);
    } finally {
      setBusy("");
    }
  }

  async function deleteService() {
    if (!overview?.service) return;

    setDeleteDialogOpen(false);
    setBusy("delete");
    try {
      await api.deleteService(serviceId);
      await onProjectRefresh();
      onDeleted();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not delete service");
    } finally {
      setBusy("");
    }
  }

  const service = overview?.service;
  const isDatabase = service ? isDatabaseService(service) : false;
  const isDockerImage = service ? isDockerImageService(service) : false;
  const isFunction = service ? isFunctionService(service) : false;
  const isWorker = service?.runtimeMode === "worker";
  const isGitUrlSource = Boolean(service && !isDatabase && !isDockerImage && !isFunction && !settings.repoFullName && settings.repoUrl);
  const databaseEngine = service?.repoFullName?.startsWith("database:")
    ? service.repoFullName.slice("database:".length).toLowerCase()
    : "";
  const supportsPostgresLogicalReplication = databaseEngine === "postgres" || databaseEngine === "timescale";
  const hasSqlConsole = isDatabase && databaseEngine !== "redis" && databaseEngine !== "mongodb" && databaseEngine !== "mongo";
  const appTabs: Array<[ServiceTab, unknown]> = [
    ["overview", DashboardSquare02Icon],
    ...(isFunction ? [["source", FileCodeIcon] as [ServiceTab, unknown]] : []),
    ["deployments", PackageIcon],
    ["logs", LeftToRightListStarIcon],
    ["environment", VariableIcon],
    ...(!isWorker ? [["domains", Globe02Icon] as [ServiceTab, unknown]] : []),
    ["settings", GithubIcon]
  ];
  const databaseTabs: Array<[ServiceTab, unknown]> = [
    ["overview", DashboardSquare02Icon],
    ["data", DatabaseIcon],
    ["backups", DatabaseExportIcon],
    ["deployments", PackageIcon],
    ["logs", LeftToRightListStarIcon],
    ["environment", VariableIcon],
    ...(hasSqlConsole ? [["sql", VideoConsoleIcon] as [ServiceTab, unknown]] : []),
    ["settings", GithubIcon]
  ];
  const visibleTabs = isDatabase ? databaseTabs : appTabs;
  const deployments = overview?.deployments ?? [];
  const env = overview?.env ?? [];
  const domains = overview?.domains ?? [];
  const hasPendingDeployment = deploymentIsPending(service?.status ?? "") || deployments.some((deployment) => deploymentIsPending(deployment.status));
  const activeDeploymentDuration =
    activeDeployment && deploymentIsPending(activeDeployment.status)
      ? formatBuildDuration(activeDeployment.startedAt ?? activeDeployment.createdAt, activeDeployment.finishedAt, nowMs)
      : null;
  const transferDisabled = Boolean(busy) || hasPendingDeployment;
  const viewportClass = "mx-auto flex h-full w-full max-w-[1680px] flex-col px-5 py-6 sm:px-8 lg:px-10";
  const panelClass = "flex min-h-0 w-full flex-1 flex-col";
  const tabButtonClass = (tab: ServiceTab) =>
    selectedTab === tab
      ? "relative inline-flex h-10 shrink-0 items-center gap-2 border-b border-white px-2 text-xs text-white"
      : "relative inline-flex h-10 shrink-0 items-center gap-2 border-b border-transparent px-2 text-xs text-zinc-500 transition hover:text-white";
  const tabUsesContainedScroll = selectedTab === "deployments" || selectedTab === "logs" || selectedTab === "source" || selectedTab === "data" || selectedTab === "sql" || selectedTab === "backups";
  const contentClass = `min-h-0 flex-1 pt-5 ${tabUsesContainedScroll ? "overflow-hidden" : "overflow-y-auto"}`;

  useEffect(() => {
    if (!service) return;
    if ((isDatabase || isWorker) && selectedTab === "domains") {
      onTabChange("deployments");
    } else if (!isFunction && selectedTab === "source") {
      onTabChange("deployments");
    } else if (isDatabase && selectedTab === "sql" && !hasSqlConsole) {
      onTabChange("deployments");
    } else if (!isDatabase && (selectedTab === "data" || selectedTab === "sql" || selectedTab === "backups")) {
      onTabChange("deployments");
    }
  }, [hasSqlConsole, isDatabase, isFunction, isWorker, onTabChange, selectedTab, service]);

  if (!overview && overviewLoading && !error) {
    return <ProjectRouteLoader label="Loading service" fullPage />;
  }

  return (
    <>
      <main className="h-dvh overflow-hidden bg-black text-white">
        <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-1">
          <ProjectsDashboardSidebar
            currentUser={currentUser}
            tools={tools}
            owner={owner}
            contextLabel={service?.name ?? "Service"}
            contextItems={visibleTabs.map(([tab, icon]) => ({
              id: tab,
              label: serviceTabLabels[tab],
              icon,
              active: selectedTab === tab,
              attention: tab === "deployments" && hasPendingDeployment,
              onSelect: () => onTabChange(tab)
            }))}
          />

          <section className="min-h-0 min-w-0 overflow-hidden bg-zinc-950">
            <div className={viewportClass}>
              <div className={panelClass}>
            <ServicePageToolbar
              services={pageServices}
              currentService={service ?? null}
              onBack={onClose}
              onServiceSelect={onServiceSelect ?? (() => undefined)}
            />

            <nav aria-label="Service" className="flex shrink-0 gap-3 overflow-x-auto border-b border-white/10 lg:hidden">
              {visibleTabs.map(([tab, icon]) => (
                <button key={tab} type="button" className={tabButtonClass(tab)} onClick={() => onTabChange(tab)}>
                  <AppIcon icon={icon} size={14} />
                  <span>{serviceTabLabels[tab]}</span>
                  {tab === "deployments" && hasPendingDeployment ? (
                    <span className="h-1.5 w-1.5 bg-amber-400">
                      <span className="sr-only">Deployment in progress</span>
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>

            {error ? <div className="mt-3 border-l-2 border-rose-400 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

            <div className={contentClass}>
              {selectedTab === "overview" ? (
                service ? (
                  <ServiceOverviewPanel
                    service={service}
                    deployments={deployments}
                    env={env}
                    domains={domains}
                    pageServices={pageServices}
                    isDatabase={isDatabase}
                    databaseEngine={databaseEngine}
                    busy={busy}
                    nowMs={nowMs}
                    onDeploy={() => void deployService()}
                    onTabChange={onTabChange}
                  />
                ) : null
              ) : null}

              {selectedTab === "deployments" ? (
                <ServiceDeploymentsPanel
                  deployments={deployments}
                  activeDeployment={activeDeployment}
                  activeDeploymentId={activeDeploymentId}
                  deploymentLogs={deploymentLogs}
                  activeDeploymentDuration={activeDeploymentDuration}
                  busy={busy}
                  nowMs={nowMs}
                  onSelectDeployment={setActiveDeploymentId}
                  onDeploy={() => void deployService()}
                  onAbortActiveDeployment={() => void abortActiveDeployment()}
                />
              ) : null}

              {selectedTab === "logs" ? <RuntimeLogsPanel logs={runtimeLogs} title="Live service logs" emptyLabel="No runtime logs yet." /> : null}

              {selectedTab === "source" && isFunction && service ? (
                <FunctionSourcePanel
                  serviceId={serviceId}
                  serviceName={service.name}
                  busy={busy}
                  doAction={doAction}
                />
              ) : null}

              {selectedTab === "data" && isDatabase ? (
                databaseEngine === "redis" ? <RedisBrowserPanel serviceId={serviceId} /> : <DatabaseBrowserPanel serviceId={serviceId} />
              ) : null}

              {selectedTab === "sql" && hasSqlConsole ? <DatabaseSqlConsolePanel serviceId={serviceId} /> : null}

              {selectedTab === "backups" && isDatabase ? <DatabaseBackupsPanel serviceId={serviceId} /> : null}

              {selectedTab === "environment" ? (
                <ServiceVariablesPanel
                  serviceId={serviceId}
                  env={env}
                  suggestions={suggestions}
                  busy={busy}
                  doAction={doAction}
                />
              ) : null}

              {selectedTab === "domains" && !isDatabase && !isWorker ? (
                <ServiceDomainsPanel
                  serviceId={serviceId}
                  domains={domains}
                  publicIp={overview?.publicIp}
                  busy={busy}
                  doAction={doAction}
                  loadOverview={loadOverview}
                />
              ) : null}

              {selectedTab === "settings" ? (
                <form onSubmit={saveSettings} className="mx-auto w-full max-w-[1100px] overflow-visible border border-white/10 bg-black">
                  <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-5">
                    <div>
                      <h2 className="text-lg tracking-[-0.03em] text-white">Settings</h2>
                      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                        {isDatabase ? "Database service" : isDockerImage ? "Container service" : isFunction ? "Function service" : "Application service"}
                      </p>
                    </div>
                    <button
                      type="submit"
                      className="inline-flex h-8 items-center justify-center bg-white px-3 text-xs text-black transition hover:bg-zinc-200 disabled:opacity-40"
                      disabled={busy === "settings"}
                    >
                      {busy === "settings" ? "Saving…" : "Save settings"}
                    </button>
                  </header>

                  <div className="grid gap-4 px-4 py-5 sm:px-5 xl:grid-cols-2">
                    {isDatabase ? (
                      <>
                        <DatabaseServiceSettingsPanel
                          settings={settings}
                          hostPort={service?.hostPort}
                          supportsLogicalReplication={supportsPostgresLogicalReplication}
                          onChange={(nextSettings) => setSettings((current) => ({ ...current, ...nextSettings }))}
                        />
                      </>
                    ) : isDockerImage ? (
                      <DockerImageServiceSettingsPanel
                        settings={settings}
                        hostPort={service?.hostPort}
                        onChange={(nextSettings) => setSettings((current) => ({ ...current, ...nextSettings }))}
                      />
                    ) : isFunction ? (
                      <FunctionServiceSettingsPanel
                        settings={settings}
                        onChange={(nextSettings) => setSettings((current) => ({ ...current, ...nextSettings }))}
                      />
                    ) : (
                      <ApplicationServiceSettingsPanel
                        settings={settings}
                        branches={settingsBranches}
                        branchMenuOpen={branchMenuOpen}
                        isGitUrlSource={isGitUrlSource}
                        onChange={(nextSettings) => setSettings((current) => ({ ...current, ...nextSettings }))}
                        onToggleBranchMenu={() => setBranchMenuOpen((current) => !current)}
                        onSelectBranch={(branch) => {
                          setSettings((current) => ({ ...current, branch }));
                          setBranchMenuOpen(false);
                          setSettingsDirectoryNodes({});
                          setSettingsExpandedDirectories(new Set());
                        }}
                        onOpenSourcePicker={() => setSourcePickerOpen(true)}
                        onDisconnectSource={() => {
                          setSettings((current) => ({ ...current, repoFullName: "", repoUrl: "" }));
                          setSourceQuery("");
                          setSourceRepos([]);
                          setSourcePickerOpen(false);
                        }}
                        onOpenDirectoryPicker={() => setDirectoryPickerOpen(true)}
                      />
                    )}
                  </div>

                  <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-4 sm:px-5">
                    <div className="flex items-center gap-3">
                      {isDatabase ? (
                        <div className="flex h-8 items-center gap-2 text-xs text-zinc-500">
                          <BrowserIconFallback size={14} />
                          <span className="truncate">
                            {service?.databasePublicHostname
                              ? `Public TCP ${service.databasePublicHostname}:${service.hostPort}`
                              : `Public TCP port ${service?.hostPort}`}
                          </span>
                        </div>
                      ) : isWorker && service?.reachable ? (
                        <div className="flex h-8 items-center gap-2 text-xs text-zinc-500">
                          <BrowserIconFallback size={14} />
                          <span className="truncate">Worker process running</span>
                        </div>
                      ) : service?.reachable ? (
                        <a
                          href={service.primaryUrl.replace("127.0.0.1", window.location.hostname)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-8 items-center gap-2 text-xs text-zinc-500 transition hover:text-white"
                        >
                          <BrowserIconFallback size={14} />
                          <span className="truncate">{service.primaryUrl.replace("127.0.0.1", window.location.hostname).replace(/^https?:\/\//, "")}</span>
                        </a>
                      ) : service?.status === "queued" || service?.status === "building" ? (
                        <div className="flex h-8 items-center gap-2 text-xs text-amber-300">
                          <BrowserIconFallback size={14} />
                          <span className="truncate">Deployment in progress</span>
                        </div>
                      ) : (
                        <div className="flex h-8 items-center gap-2 text-xs text-rose-300">
                          <BrowserIconFallback size={14} />
                          <span className="truncate">Service crashed</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center gap-2 border border-white/15 px-3 text-xs text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
                        onClick={() => setTransferOpen(true)}
                        disabled={transferDisabled}
                      >
                        <AppIcon icon={FolderOpenIcon} size={13} />
                        Move service
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center gap-2 border border-rose-400/40 px-3 text-xs text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-40"
                        onClick={() => setDeleteDialogOpen(true)}
                        disabled={busy === "delete"}
                      >
                        <AppIcon icon={Delete02Icon} size={13} />
                        Delete service
                      </button>
                    </div>
                  </footer>
                </form>
              ) : null}
              </div>
              </div>
            </div>
          </section>
        </div>
      </main>
      <SourcePickerModal
        open={sourcePickerOpen}
        query={sourceQuery}
        repos={sourceRepos}
        loading={sourceLoading}
        error={sourceError}
        onClose={() => setSourcePickerOpen(false)}
        onQueryChange={setSourceQuery}
        onSelect={(repo) => {
          setSettings((current) => ({
            ...current,
            repoFullName: repo.fullName,
            repoUrl: "",
            branch: repo.defaultBranch,
            rootDir: ""
          }));
          setSourcePickerOpen(false);
          setSourceQuery("");
          setSourceRepos([]);
          setSettingsDirectoryNodes({});
          setSettingsExpandedDirectories(new Set());
          setSettingsDirectoryError("");
        }}
      />

      <DirectoryPickerModal
        open={directoryPickerOpen}
        repoLabel={settings.repoFullName}
        selectedPath={settings.rootDir}
        directoriesByPath={settingsDirectoryNodes}
        expandedPaths={settingsExpandedDirectories}
        loadingPaths={settingsDirectoryLoadingPaths}
        errorMessage={settingsDirectoryError}
        onClose={() => setDirectoryPickerOpen(false)}
        onToggle={toggleSettingsDirectory}
        onSelect={(path) => setSettings((current) => ({ ...current, rootDir: path }))}
      />
      <TransferServiceModal
        open={transferOpen}
        currentProjectId={service?.projectId ?? ""}
        serviceName={service?.name ?? "Service"}
        busy={busy === "transfer"}
        onClose={() => setTransferOpen(false)}
        onTransfer={transferService}
      />
      <ConfirmationDialog
        open={deleteDialogOpen && Boolean(service)}
        title="Delete service?"
        subject={service?.name}
        description="This will permanently remove the service, its deployments, variables, domains, and related runtime resources."
        confirmLabel="Delete service"
        busy={busy === "delete"}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={deleteService}
      />
      <RedeployRequiredToast
        visible={redeployToastVisible}
        busy={busy === "deploy"}
        serviceName={service?.name ?? "Service"}
        onDismiss={() => setRedeployToastVisible(false)}
        onRedeploy={deployFromToast}
      />
    </>
  );
}
