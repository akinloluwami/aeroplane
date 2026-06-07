import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  Delete02Icon,
  DatabaseIcon,
  FolderOpenIcon,
  GithubIcon,
  Globe02Icon,
  PackageIcon,
  PencilEdit02Icon,
  LeftToRightListStarIcon,
  VariableIcon,
  VideoConsoleIcon,
  DashboardSquare02Icon,
  DatabaseExportIcon
} from "@hugeicons/core-free-icons";
import { FormEvent, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type DeploymentLog,
  type GitHubDirectory,
  type GitHubRepo,
  type RuntimeLog,
  type Service,
  type ServiceOverview
} from "../../api";
import {
  AppIcon,
  BrowserIconFallback,
  FieldLabel,
  FormInput,
  chipClass,
  shellButton
} from "../../components/ui/primitives";
import { githubBranchesCache, githubDirectoriesCache, githubReposCache } from "../../lib/github-cache";
import { DirectoryPickerModal } from "../../components/modals/directory-picker";
import { SourcePickerModal } from "../../components/modals/source-picker";
import { TransferServiceModal } from "../../components/modals/transfer-service-modal";
import { DatabaseServiceSettingsPanel } from "../../components/modals/database-service-settings-panel";
import { DockerImageServiceSettingsPanel } from "../../components/modals/docker-image-service-settings-panel";
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
import { ServicePageSkeleton } from "./service-page-skeleton";
import { RedeployRequiredToast } from "./redeploy-required-toast";
import { RuntimeModeControl } from "../../components/ui/runtime-mode-control";
import type { ServiceTab } from "./service-tabs";
import { dockerImageForService, dockerImageRepoFullName, isDatabaseService, isDockerImageService } from "../../../shared/service-source";
import { deploymentIsPending, mergeDeploymentList } from "../../lib/deployment-status";

function textOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

const serviceTabLabels: Record<ServiceTab, string> = {
  overview: "Overview",
  deployments: "Deployments",
  logs: "Logs",
  environment: "Variables",
  domains: "Domains",
  data: "Data",
  sql: "Console",
  backups: "Backups",
  settings: "Settings"
};

function actionRequiresRedeploy(label: string) {
  return label === "env" || label === "settings";
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
  onTransferred
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
}) {
  const [overview, setOverview] = useState<null | ServiceOverview>(null);
  const [activeDeploymentId, setActiveDeploymentId] = useState<null | string>(null);
  const [deploymentLogs, setDeploymentLogs] = useState<DeploymentLog[]>([]);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLog[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ key: string; label: string }>>([]);
  const [settings, setSettings] = useState({
    name: "",
    repoFullName: "",
    repoUrl: "",
    dockerImage: "",
    branch: "",
    rootDir: "",
    installCommand: "",
    buildCommand: "",
    startCommand: "",
    staticOutput: "",
    runtimeMode: "web" as "web" | "worker",
    internalPort: 8080,
    databasePublicEnabled: true,
    databasePublicHostname: "",
    postgresLogicalReplicationEnabled: false,
    buildMethod: "railpack" as "railpack" | "dockerfile",
    dockerfilePath: "Dockerfile"
  });
  const [settingsBranches, setSettingsBranches] = useState<string[]>([]);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
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

  const loadOverview = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true;
    if (showLoading) setOverviewLoading(true);
    try {
      const [result, suggs] = await Promise.all([
        api.serviceOverview(serviceId),
        api.suggestionKeys(serviceId).catch(() => ({ suggestions: [], databaseVariables: [] }))
      ]);
      startTransition(() => {
        setOverview(result);
        setSuggestions(suggs.suggestions);
        setActiveDeploymentId((current) => {
          const pendingDeployment = result.deployments.find((deployment) => deploymentIsPending(deployment.status));
          if (pendingDeployment) return pendingDeployment.id;
          if (current && result.deployments.some((deployment) => deployment.id === current)) return current;
          return result.deployments[0]?.id ?? null;
        });
        setSettings({
          name: result.service.name,
          repoFullName: result.service.repoFullName ?? "",
          repoUrl: result.service.repoUrl,
          dockerImage: result.service.dockerImage ?? dockerImageForService(result.service),
          branch: result.service.branch,
          rootDir: result.service.rootDir ?? "",
          installCommand: result.service.installCommand ?? "",
          buildCommand: result.service.buildCommand ?? "",
          startCommand: result.service.startCommand ?? "",
          staticOutput: result.service.staticOutput ?? "",
          runtimeMode: result.service.runtimeMode,
          internalPort: result.service.internalPort,
          databasePublicEnabled: result.service.databasePublicEnabled,
          databasePublicHostname: result.service.databasePublicHostname ?? "",
          postgresLogicalReplicationEnabled: result.service.postgresLogicalReplicationEnabled,
          buildMethod: result.service.buildMethod ?? "railpack",
          dockerfilePath: result.service.dockerfilePath ?? "Dockerfile"
        });
        setError("");
        setOverviewLoading(false);
      });
    } catch (issue) {
      startTransition(() => {
        setError(issue instanceof Error ? issue.message : "Could not load service");
        setOverviewLoading(false);
      });
    }
  }, [serviceId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, serviceId]);

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
    if (selectedTab !== "settings" || !settings.repoFullName || settings.repoFullName.startsWith("database:") || settings.repoFullName.startsWith("image:")) return;
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
    if (selectedTab !== "settings" || isDockerImage || !directoryPickerOpen || !settings.repoFullName || !settings.branch) return;
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
      await loadOverview({ showLoading: false });
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

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    await doAction("settings", async () => {
      await api.updateService(serviceId, {
        name: settings.name,
        repoFullName: isDatabase ? settings.repoFullName : isDockerImage ? dockerImageRepoFullName(settings.dockerImage) : (settings.repoFullName.trim() ? settings.repoFullName : null),
        repoUrl: isDatabase ? undefined : isDockerImage ? "docker-image" : (settings.repoFullName.trim() ? undefined : settings.repoUrl.trim() || undefined),
        dockerImage: isDockerImage ? settings.dockerImage : undefined,
        branch: settings.branch,
        rootDir: isDatabase || isDockerImage ? undefined : textOrNull(settings.rootDir),
        installCommand: isDatabase || isDockerImage ? undefined : textOrNull(settings.installCommand),
        buildCommand: isDatabase || isDockerImage ? undefined : textOrNull(settings.buildCommand),
        startCommand: isDatabase || isDockerImage ? undefined : textOrNull(settings.startCommand),
        staticOutput: isDatabase || isDockerImage ? undefined : textOrNull(settings.staticOutput),
        runtimeMode: isDatabase ? undefined : settings.runtimeMode,
        internalPort: Number(settings.internalPort),
        databasePublicEnabled: isDatabase ? true : undefined,
        databasePublicHostname: isDatabase ? settings.databasePublicHostname || undefined : undefined,
        postgresLogicalReplicationEnabled: isDatabase ? settings.postgresLogicalReplicationEnabled : undefined,
        buildMethod: isDatabase || isDockerImage ? undefined : settings.buildMethod,
        dockerfilePath: isDatabase || isDockerImage ? undefined : (settings.buildMethod === "dockerfile" ? (settings.dockerfilePath.trim() || "Dockerfile") : undefined)
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
    if (!overview?.service || !window.confirm(`Delete service "${overview.service.name}"?`)) return;
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
  const isWorker = service?.runtimeMode === "worker";
  const isGitUrlSource = Boolean(service && !isDatabase && !isDockerImage && !settings.repoFullName && settings.repoUrl);
  const databaseEngine = service?.repoFullName?.startsWith("database:")
    ? service.repoFullName.slice("database:".length).toLowerCase()
    : "";
  const supportsPostgresLogicalReplication = databaseEngine === "postgres" || databaseEngine === "timescale";
  const hasSqlConsole = isDatabase && databaseEngine !== "redis" && databaseEngine !== "mongodb" && databaseEngine !== "mongo";
  const appTabs: Array<[ServiceTab, unknown]> = [
    ["overview", DashboardSquare02Icon],
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
  const shellClass = "relative isolate h-dvh overflow-hidden bg-zinc-950 text-zinc-100";
  const viewportClass = "relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col px-5 py-10 sm:px-6 lg:px-10";
  const panelClass = "flex min-h-0 w-full flex-1 flex-col";
  const tabButtonClass = (tab: ServiceTab) => `${chipClass(selectedTab === tab)} relative !py-1`;
  const tabUsesContainedScroll = selectedTab === "deployments" || selectedTab === "logs" || selectedTab === "data" || selectedTab === "sql" || selectedTab === "backups";
  const contentClass = `mt-6 min-h-0 flex-1 ${tabUsesContainedScroll ? "overflow-hidden" : "overflow-y-auto"}`;

  useEffect(() => {
    if (!service) return;
    if ((isDatabase || isWorker) && selectedTab === "domains") {
      onTabChange("deployments");
    } else if (isDatabase && selectedTab === "sql" && !hasSqlConsole) {
      onTabChange("deployments");
    } else if (!isDatabase && (selectedTab === "data" || selectedTab === "sql" || selectedTab === "backups")) {
      onTabChange("deployments");
    }
  }, [hasSqlConsole, isDatabase, isWorker, onTabChange, selectedTab, service]);

  if (!overview && overviewLoading && !error) return <ServicePageSkeleton />;

  return (
    <>
      <div className={shellClass}>
        <div aria-hidden className="hero-noise pointer-events-none absolute inset-0" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_0%_0%,rgba(79,184,178,0.10),transparent),radial-gradient(ellipse_70%_50%_at_100%_100%,rgba(120,113,255,0.06),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:72px_72px]"
        />
        <div className={viewportClass}>
          <div className={panelClass}>
            <ServicePageToolbar
              services={pageServices}
              currentService={service ?? null}
              onBack={onClose}
              onServiceSelect={onServiceSelect ?? (() => undefined)}
            />

            <div className="flex flex-wrap gap-2">
              {visibleTabs.map(([tab, icon]) => (
                <button key={tab} type="button" className={tabButtonClass(tab)} onClick={() => onTabChange(tab)}>
                  <AppIcon icon={icon} size={15} />
                  <span>{serviceTabLabels[tab]}</span>
                  {tab === "deployments" && hasPendingDeployment ? (
                    <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]">
                      <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/70" />
                      <span className="sr-only">Deployment in progress</span>
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {error ? <div className="mt-3 border border-rose-500/25 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

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
                <form onSubmit={saveSettings} className="space-y-5">
                  <div className="grid gap-5 xl:grid-cols-2">
                    {isDatabase ? (
                      <>
                        <DatabaseServiceSettingsPanel
                          settings={settings}
                          hostPort={service?.hostPort}
                          supportsLogicalReplication={supportsPostgresLogicalReplication}
                          onChange={(nextSettings) => setSettings({ ...settings, ...nextSettings })}
                        />
                      </>
                    ) : isDockerImage ? (
                      <DockerImageServiceSettingsPanel
                        settings={settings}
                        hostPort={service?.hostPort}
                        onChange={(nextSettings) => setSettings({ ...settings, ...nextSettings })}
                      />
                    ) : (
                      <>
                        <div className="xl:col-span-2">
                          <FieldLabel>Repository</FieldLabel>
                          <div className="space-y-3 border border-zinc-700 bg-zinc-900/88 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="break-all text-[18px] text-zinc-100">{settings.repoFullName || settings.repoUrl || "Disconnected"}</div>
                              <div className="flex items-center gap-2">
                                <button type="button" className={shellButton("secondary")} onClick={() => setSourcePickerOpen(true)}>
                                  <AppIcon icon={PencilEdit02Icon} size={15} />
                                  Change source
                                </button>
                                <button
                                  type="button"
                                  className={shellButton("ghost")}
                                  onClick={() => {
                                    setSettings((current) => ({ ...current, repoFullName: "", repoUrl: "" }));
                                    setSourceQuery("");
                                    setSourceRepos([]);
                                    setSourcePickerOpen(false);
                                  }}
                                >
                                  <AppIcon icon={Cancel01Icon} size={15} />
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="relative">
                          <FieldLabel>Branch</FieldLabel>
                          {isGitUrlSource ? (
                            <FormInput value={settings.branch} onChange={(event) => setSettings({ ...settings, branch: event.target.value })} placeholder="main" />
                          ) : (
                            <button
                              type="button"
                              className="flex h-11 w-full items-center justify-between border border-zinc-700 bg-zinc-900 px-3 text-left text-sm text-zinc-100"
                              onClick={() => setBranchMenuOpen((current) => !current)}
                              disabled={!settings.repoFullName}
                            >
                              <span>{settings.branch || "Select branch"}</span>
                              <AppIcon icon={ArrowLeft01Icon} size={16} className={branchMenuOpen ? "rotate-90" : "-rotate-90"} />
                            </button>
                          )}
                          {!isGitUrlSource && branchMenuOpen ? (
                            <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-64 overflow-auto border border-zinc-700 bg-zinc-900 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
                              {(settingsBranches.length ? settingsBranches : [settings.branch]).map((branch) => (
                                <button
                                  key={branch}
                                  type="button"
                                  className="flex w-full items-center justify-between border-b border-zinc-800 px-3 py-3 text-left text-sm text-zinc-100 last:border-b-0 hover:bg-zinc-800"
                                  onClick={() => {
                                    setSettings((current) => ({ ...current, branch }));
                                    setBranchMenuOpen(false);
                                    setSettingsDirectoryNodes({});
                                    setSettingsExpandedDirectories(new Set());
                                  }}
                                >
                                  <span>{branch}</span>
                                  {settings.branch === branch ? <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7fe3dd]">Current</span> : null}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <FieldLabel>Directory</FieldLabel>
                          {isGitUrlSource ? (
                            <FormInput value={settings.rootDir} onChange={(event) => setSettings({ ...settings, rootDir: event.target.value })} placeholder="." />
                          ) : (
                            <div className="flex h-11 items-center justify-between gap-3 border border-zinc-700 bg-zinc-900 px-3">
                              <div className="truncate text-sm text-zinc-100">{settings.rootDir || "."}</div>
                              <button
                                type="button"
                                className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-800 bg-zinc-900/70 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-60"
                                onClick={() => setDirectoryPickerOpen(true)}
                                disabled={!settings.repoFullName}
                              >
                                <AppIcon icon={PencilEdit02Icon} size={15} />
                                Edit
                              </button>
                            </div>
                          )}
                        </div>

                        <div>
                          <FieldLabel>Service name</FieldLabel>
                          <FormInput value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} />
                        </div>
                        <div className="xl:col-span-2">
                          <FieldLabel>Runtime mode</FieldLabel>
                          <RuntimeModeControl
                            value={settings.runtimeMode}
                            onChange={(runtimeMode) => setSettings((current) => ({
                              ...current,
                              runtimeMode,
                              staticOutput: runtimeMode === "worker" ? "" : current.staticOutput
                            }))}
                          />
                        </div>
                        {settings.runtimeMode !== "worker" ? (
                          <div>
                            <FieldLabel>App port</FieldLabel>
                            <FormInput type="number" value={settings.internalPort} onChange={(event) => setSettings({ ...settings, internalPort: Number(event.target.value) })} />
                          </div>
                        ) : null}
                        <div>
                          <FieldLabel>Install command</FieldLabel>
                          <FormInput value={settings.installCommand} onChange={(event) => setSettings({ ...settings, installCommand: event.target.value })} placeholder="auto" />
                        </div>
                        <div>
                          <FieldLabel>Build command</FieldLabel>
                          <FormInput value={settings.buildCommand} onChange={(event) => setSettings({ ...settings, buildCommand: event.target.value })} placeholder="auto" />
                        </div>
                        <div>
                          <FieldLabel>Start command</FieldLabel>
                          <FormInput value={settings.startCommand} onChange={(event) => setSettings({ ...settings, startCommand: event.target.value })} placeholder="auto" />
                        </div>
                        {settings.runtimeMode !== "worker" ? (
                          <div>
                            <FieldLabel>Static output</FieldLabel>
                            <FormInput value={settings.staticOutput} onChange={(event) => setSettings({ ...settings, staticOutput: event.target.value })} placeholder="auto" />
                          </div>
                        ) : null}

                        {/* Build Method */}
                        <div className="xl:col-span-2">
                          <FieldLabel>Build method</FieldLabel>
                          <div className="space-y-3 border border-zinc-700 bg-zinc-900/88 p-4">
                            <div className="flex gap-3">
                              <button
                                type="button"
                                id="build-method-railpack"
                                onClick={() => setSettings((s) => ({ ...s, buildMethod: "railpack" }))}
                                className={`flex-1 border px-4 py-3 text-left text-sm transition ${
                                  settings.buildMethod === "railpack"
                                    ? "border-[#4FB8B2]/60 bg-[#4FB8B2]/10 text-[#7fe3dd]"
                                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                                }`}
                              >
                                <div className="font-semibold">Railpack (default)</div>
                                <div className="mt-1 text-xs opacity-70">Auto-detects language and framework. No Dockerfile needed.</div>
                              </button>
                              <button
                                type="button"
                                id="build-method-dockerfile"
                                onClick={() => setSettings((s) => ({ ...s, buildMethod: "dockerfile" }))}
                                className={`flex-1 border px-4 py-3 text-left text-sm transition ${
                                  settings.buildMethod === "dockerfile"
                                    ? "border-[#4FB8B2]/60 bg-[#4FB8B2]/10 text-[#7fe3dd]"
                                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                                }`}
                              >
                                <div className="font-semibold">Dockerfile</div>
                                <div className="mt-1 text-xs opacity-70">Uses your Dockerfile via <code className="font-mono">docker build</code>. Bypasses Railpack.</div>
                              </button>
                            </div>
                            {settings.buildMethod === "dockerfile" ? (
                              <div>
                                <div className="mb-1.5 text-xs text-zinc-400">Dockerfile path (relative to root directory)</div>
                                <FormInput
                                  id="dockerfile-path"
                                  value={settings.dockerfilePath}
                                  onChange={(event) => setSettings({ ...settings, dockerfilePath: event.target.value })}
                                  placeholder="Dockerfile"
                                />
                              </div>
                            ) : null}
                            {settings.buildMethod === "railpack" ? (
                              <p className="text-xs text-zinc-500">
                                Aeroplane will automatically switch to Dockerfile mode if a <code className="font-mono text-zinc-400">Dockerfile</code> is detected in the repo at deploy time.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex justify-between gap-3 border-t border-zinc-800 pt-5">
                    <div className="flex items-center gap-3">
                      {isDatabase ? (
                        <div className="flex items-center gap-3 border border-zinc-700 bg-zinc-900/85 px-3 py-3 text-sm text-zinc-200">
                          <BrowserIconFallback size={17} />
                          <span className="truncate">
                            {service?.databasePublicHostname
                              ? `Public TCP ${service.databasePublicHostname}:${service.hostPort}`
                              : `Public TCP port ${service?.hostPort}`}
                          </span>
                        </div>
                      ) : isWorker && service?.reachable ? (
                        <div className="flex items-center gap-3 border border-zinc-700 bg-zinc-900/85 px-3 py-3 text-sm text-zinc-200">
                          <BrowserIconFallback size={17} />
                          <span className="truncate">Worker process running</span>
                        </div>
                      ) : service?.reachable ? (
                        <a
                          href={service.primaryUrl.replace("127.0.0.1", window.location.hostname)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 border border-zinc-700 bg-zinc-900/85 px-3 py-3 text-sm text-zinc-200 transition hover:border-[#4FB8B2]/45 hover:text-[#7fe3dd]"
                        >
                          <BrowserIconFallback size={17} />
                          <span className="truncate">{service.primaryUrl.replace("127.0.0.1", window.location.hostname).replace(/^https?:\/\//, "")}</span>
                        </a>
                      ) : service?.status === "queued" || service?.status === "building" ? (
                        <div className="flex items-center gap-3 border border-amber-500/20 bg-amber-950/20 px-3 py-3 text-sm text-amber-100">
                          <BrowserIconFallback size={17} />
                          <span className="truncate">Deployment in progress</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 border border-rose-500/20 bg-rose-950/20 px-3 py-3 text-sm text-rose-200">
                          <BrowserIconFallback size={17} />
                          <span className="truncate">Service crashed</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" className={shellButton("secondary")} onClick={() => setTransferOpen(true)} disabled={transferDisabled}>
                        <AppIcon icon={FolderOpenIcon} size={16} />
                        Move service
                      </button>
                      <button type="button" className={shellButton("danger")} onClick={() => void deleteService()} disabled={busy === "delete"}>
                        <AppIcon icon={Delete02Icon} size={16} />
                        Delete service
                      </button>
                      <button type="submit" className={shellButton("primary")} disabled={busy === "settings"}>
                        <AppIcon icon={CheckmarkCircle02Icon} size={16} />
                        Save settings
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
            </div>
          </div>
        </div>
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
