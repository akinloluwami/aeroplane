import { Link, useNavigate } from "@tanstack/react-router";
import { AddSquareIcon, Activity01Icon, FolderCodeIcon } from "@hugeicons/core-free-icons";
import { startTransition, useCallback, useEffect, useState } from "react";
import {
  api,
  type AuthUser,
  type GitHubStatus,
  type ProjectCard,
  type R2SettingsStatus,
  type ToolCheck,
} from "../api";
import { BrandMark } from "../components/ui/brand-mark";
import { AppIcon } from "../components/ui/primitives";
import { GitHubInstallModal } from "../features/github/github-install-modal";
import { CreateProjectModal } from "../features/projects/create-project-modal";
import { ProjectsGridSkeleton } from "../features/projects/projects-grid-skeleton";
import { ServiceCluster } from "../features/projects/service-cluster";
import { SystemHealthPill } from "../features/projects/system-health-pill";
import { SetupTodoList } from "../features/projects/setup-todo-list";
import { RailwayImportModal } from "../features/integrations/railway-import-modal";
import { VercelImportModal } from "../features/integrations/vercel-import-modal";
import type { SystemSettingsTab } from "../components/modals/system-settings-types";
import { SignOutButton } from "../components/auth/sign-out-button";
import { serviceIsDeploying } from "../lib/deployment-status";
import { usePageTitle } from "../lib/page-title";

export function ProjectsPage() {
  const navigate = useNavigate();
  usePageTitle("Projects");

  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [githubStatus, setGitHubStatus] = useState<null | GitHubStatus>(null);
  const [domainSettings, setDomainSettings] = useState<null | Awaited<
    ReturnType<typeof api.systemSettings>
  >>(null);
  const [r2Status, setR2Status] = useState<null | R2SettingsStatus>(null);
  const [setupLoading, setSetupLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [railwayImportOpen, setRailwayImportOpen] = useState(false);
  const [vercelImportOpen, setVercelImportOpen] = useState(false);
  const [githubInstallOpen, setGitHubInstallOpen] = useState(false);
  const [error, setError] = useState("");

  const loadProjects = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true;
    if (showLoading) setSetupLoading(true);
    try {
      const [authData, projectData, systemData, githubData, domainData, r2Data] =
        await Promise.all([
          api.authStatus(),
          api.projects(),
          api.system().catch(() => ({ tools: [] })),
          api.githubStatus().catch(() => null),
          api.systemSettings().catch(() => null),
          api
            .r2Settings()
            .then((result) => result.r2)
            .catch(() => null),
        ]);
      startTransition(() => {
        setCurrentUser(authData.user);
        setProjects(projectData.projects);
        setTools(systemData.tools);
        setGitHubStatus(githubData);
        setDomainSettings(domainData);
        setR2Status(r2Data);
        setGitHubInstallOpen(
          Boolean(
            githubData &&
            githubData.mode === "app" &&
            !githubData.installed &&
            githubData.installUrl,
          ),
        );
        setError("");
        setSetupLoading(false);
      });
    } catch (issue) {
      startTransition(() => {
        setError(
          issue instanceof Error ? issue.message : "Could not load projects",
        );
        setSetupLoading(false);
      });
    }
  }, []);

  const refreshProjectCards = useCallback(async () => {
    try {
      const projectData = await api.projects();
      startTransition(() => {
        setProjects(projectData.projects);
        setError("");
      });
    } catch (issue) {
      startTransition(() => {
        setError(
          issue instanceof Error ? issue.message : "Could not refresh projects",
        );
      });
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const hasDeployingService = projects.some((project) =>
      project.services.some((service) => serviceIsDeploying(service.status)),
    );
    if (setupLoading) return;

    const interval = setInterval(() => {
      void refreshProjectCards();
    }, hasDeployingService ? 1500 : 6000);

    return () => clearInterval(interval);
  }, [projects, refreshProjectCards, setupLoading]);

  useEffect(() => {
    function reloadAfterSettingsClose() {
      void loadProjects({ showLoading: false });
    }

    window.addEventListener(
      "aeroplane-system-settings-closed",
      reloadAfterSettingsClose,
    );
    return () =>
      window.removeEventListener(
        "aeroplane-system-settings-closed",
        reloadAfterSettingsClose,
      );
  }, [loadProjects]);

  async function createProject(payload: {
    name: string;
    description?: string;
  }) {
    const result = await api.createProject(payload);
    await loadProjects();
    void navigate({
      to: "/$projectSlug",
      params: { projectSlug: result.project.slug },
    });
  }

  function openSystemSettings(tab: SystemSettingsTab = "root-domain") {
    void navigate({
      to: "/",
      search: (current) => ({
        ...current,
        settings: tab,
      }),
    });
  }

  const owner = currentUser?.role === "owner";

  return (
    <>
      <main className="relative isolate min-h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
        <div
          aria-hidden
          className="hero-noise pointer-events-none absolute inset-0"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_0%_0%,rgba(79,184,178,0.12),transparent),radial-gradient(ellipse_70%_50%_at_100%_100%,rgba(120,113,255,0.08),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:72px_72px]"
        />

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pb-24 pt-14 sm:px-6 lg:pl-14 lg:pr-10">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/90 pb-5 font-mono text-[11px] text-zinc-500">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center border border-[#4FB8B2]/35 bg-[#4FB8B2]/10 text-[#4FB8B2]">
                <BrandMark />
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-600">
                  Aeroplane registry
                </div>
                <div className="font-hero text-lg tracking-tight text-zinc-100">
                  Projects
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {owner ? (
                <div className="hidden sm:block">
                  <SystemHealthPill tools={tools} />
                </div>
              ) : null}
              {owner ? (
                <Link
                  to="/monitoring"
                  className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-800 bg-zinc-900/50 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  <AppIcon icon={Activity01Icon} size={14} />
                  <span className="hidden md:inline">Monitoring</span>
                </Link>
              ) : null}
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 border border-[#E93D82]/45 bg-[#E93D82]/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#E93D82] transition-colors hover:bg-[#E93D82]/20"
                onClick={() => setRailwayImportOpen(true)}
              >
                <AppIcon icon={AddSquareIcon} size={14} />
                <span className="hidden md:inline">Import Railway</span>
                <span className="md:hidden">Railway</span>
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-100/40 bg-zinc-100/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-100 transition-colors hover:bg-zinc-100/20"
                onClick={() => setVercelImportOpen(true)}
              >
                <AppIcon icon={AddSquareIcon} size={14} />
                <span className="hidden md:inline">Import Vercel</span>
                <span className="md:hidden">Vercel</span>
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 border border-[#4FB8B2]/50 bg-[#4FB8B2]/15 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4FB8B2] transition-colors hover:bg-[#4FB8B2]/25"
                onClick={() => setCreateOpen(true)}
              >
                <AppIcon icon={AddSquareIcon} size={14} />
                New
              </button>
              <SignOutButton />
            </div>
          </header>

          {error ? (
            <div className="border border-rose-500/35 bg-rose-950/30 px-4 py-3 font-mono text-xs text-rose-300">
              {error}
            </div>
          ) : null}

          {!setupLoading && owner ? (
            <SetupTodoList
              domainSettings={domainSettings}
              githubStatus={githubStatus}
              r2Status={r2Status}
              tools={tools}
              onOpenSettings={openSystemSettings}
              onOpenGitHubInstall={() => setGitHubInstallOpen(true)}
            />
          ) : null}

          {setupLoading ? (
            <ProjectsGridSkeleton />
          ) : projects.length === 0 ? (
            <section className="border border-zinc-800 bg-zinc-950/60 px-6 py-10 sm:px-8">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 border border-zinc-800 bg-zinc-900/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  <AppIcon icon={FolderCodeIcon} size={14} />
                  Empty registry
                </div>
                <h2 className="mt-6 font-hero text-3xl font-extrabold tracking-tight text-zinc-100">
                  No projects yet
                </h2>
                <p className="mt-3 max-w-lg font-mono text-sm leading-relaxed text-zinc-500">
                  Create a project first, then attach services inside it. Each
                  service gets its own deployment timeline, runtime logs,
                  variables, and domains.
                </p>
                <button
                  type="button"
                  className="mt-8 inline-flex items-center justify-center gap-2 border border-[#4FB8B2]/50 bg-[#4FB8B2]/15 px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#4FB8B2] transition-colors hover:bg-[#4FB8B2]/25"
                  onClick={() => setCreateOpen(true)}
                >
                  <AppIcon icon={AddSquareIcon} size={16} />
                  Create project
                </button>
              </div>
            </section>
          ) : (
            <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="group relative overflow-hidden border border-zinc-800 bg-zinc-950/68 p-5 text-left transition-colors hover:border-[#4FB8B2]/35 hover:bg-zinc-900/72"
                  onClick={() =>
                    void navigate({
                      to: "/$projectSlug",
                      params: { projectSlug: project.slug },
                    })
                  }
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] bg-[size:72px_72px] opacity-50"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(79,184,178,0.06),transparent_55%)]"
                  />

                  <div className="relative z-10">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="font-sans text-lg font-semibold tracking-tight text-zinc-100">
                          {project.name}
                        </h2>
                      </div>
                      <span className="shrink-0 border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-200">
                        {project.serviceCount} service
                        {project.serviceCount === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="mt-5">
                      <ServiceCluster project={project} />
                    </div>
                  </div>
                </button>
              ))}
            </section>
          )}
        </div>
      </main>
      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createProject}
      />
      <RailwayImportModal
        open={railwayImportOpen}
        onClose={() => setRailwayImportOpen(false)}
        onSuccess={loadProjects}
      />
      <VercelImportModal
        open={vercelImportOpen}
        onClose={() => setVercelImportOpen(false)}
        onSuccess={loadProjects}
      />
      <GitHubInstallModal
        open={githubInstallOpen}
        status={githubStatus}
        onClose={() => setGitHubInstallOpen(false)}
      />
    </>
  );
}
