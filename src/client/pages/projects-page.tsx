import { useNavigate } from "@tanstack/react-router";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type AuthUser,
  type GitHubStatus,
  type ProjectCard,
  type R2SettingsStatus,
  type ToolCheck,
} from "../api";
import { GitHubInstallModal } from "../features/github/github-install-modal";
import {
  ProjectImportModal,
  type ProjectImportSource,
} from "../features/integrations/project-import-modal";
import { RailwayImportModal } from "../features/integrations/railway-import-modal";
import { VercelImportModal } from "../features/integrations/vercel-import-modal";
import { CreateProjectModal } from "../features/projects/create-project-modal";
import { ProjectOverviewCard } from "../features/projects/project-overview-card";
import { ProjectSearch } from "../features/projects/project-search";
import { ProjectSearchEmptyState } from "../features/projects/project-search-empty-state";
import {
  readPinnedProjectIds,
  writePinnedProjectIds,
} from "../features/projects/pinned-projects";
import { ProjectsDashboardHeader } from "../features/projects/projects-dashboard-header";
import { ProjectsDashboardSidebar } from "../features/projects/projects-dashboard-sidebar";
import { ProjectsEmptyState } from "../features/projects/projects-empty-state";
import { ProjectsGridSkeleton } from "../features/projects/projects-grid-skeleton";
import { SetupTodoList } from "../features/projects/setup-todo-list";
import {
  settingsPageForTab,
  type SystemSettingsTab,
} from "../features/settings/settings-pages";
import { serviceIsDeploying } from "../lib/deployment-status";
import { usePageTitle } from "../lib/page-title";

export function ProjectsPage() {
  const navigate = useNavigate();
  usePageTitle("Projects");

  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [githubStatus, setGitHubStatus] = useState<GitHubStatus | null>(null);
  const [domainSettings, setDomainSettings] = useState<
    Awaited<ReturnType<typeof api.systemSettings>> | null
  >(null);
  const [r2Status, setR2Status] = useState<R2SettingsStatus | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectImportView, setProjectImportView] = useState<
    "closed" | "choose" | ProjectImportSource
  >("closed");
  const [githubInstallOpen, setGitHubInstallOpen] = useState(false);
  const [error, setError] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>([]);

  const loadProjects = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const showLoading = options.showLoading ?? true;
      if (showLoading) setSetupLoading(true);
      try {
        const [
          authData,
          projectData,
          systemData,
          githubData,
          domainData,
          r2Data,
        ] = await Promise.all([
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
    },
    [],
  );

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
    setPinnedProjectIds(readPinnedProjectIds());
  }, []);

  useEffect(() => {
    const hasDeployingService = projects.some((project) =>
      project.services.some((service) => serviceIsDeploying(service.status)),
    );
    if (setupLoading) return;

    const interval = setInterval(
      () => {
        void refreshProjectCards();
      },
      hasDeployingService ? 1500 : 6000,
    );

    return () => clearInterval(interval);
  }, [projects, refreshProjectCards, setupLoading]);

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
      to: "/settings/$settingsPage",
      params: { settingsPage: settingsPageForTab(tab).slug },
    });
  }

  function openProject(project: ProjectCard) {
    void navigate({
      to: "/$projectSlug",
      params: { projectSlug: project.slug },
    });
  }

  function togglePinnedProject(projectId: string) {
    setPinnedProjectIds((current) => {
      const next = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
      writePinnedProjectIds(next);
      return next;
    });
  }

  const owner = currentUser?.role === "owner";
  const serviceCount = projects.reduce(
    (total, project) => total + project.serviceCount,
    0,
  );
  const visibleProjects = useMemo(() => {
    const needle = projectSearch.trim().toLocaleLowerCase();
    const filtered = needle
      ? projects.filter((project) => {
          const searchableText = [
            project.name,
            project.slug,
            project.description,
            ...project.services.flatMap((service) => [
              service.name,
              service.slug,
              service.repoFullName,
              service.framework?.name,
            ]),
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase();
          return searchableText.includes(needle);
        })
      : projects;

    return filtered
      .map((project, originalIndex) => ({ project, originalIndex }))
      .sort((left, right) => {
        const leftPinned = pinnedProjectIds.includes(left.project.id);
        const rightPinned = pinnedProjectIds.includes(right.project.id);
        if (leftPinned === rightPinned) return left.originalIndex - right.originalIndex;
        return leftPinned ? -1 : 1;
      })
      .map(({ project }) => project);
  }, [pinnedProjectIds, projectSearch, projects]);

  return (
    <>
      <main className="relative min-h-dvh bg-black text-white">
        <div className="grid min-h-dvh lg:grid-cols-[260px_minmax(0,1fr)]">
          <ProjectsDashboardSidebar
            currentUser={currentUser}
            tools={tools}
            owner={owner}
          />

          <section className="relative min-w-0 bg-zinc-950">
            <div
              aria-hidden
              className="hero-noise pointer-events-none absolute inset-0"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_6%,rgba(255,255,255,0.05),transparent_24%)]"
            />

            <div className="relative z-10 mx-auto w-full max-w-[1680px] px-5 pb-20 pt-6 sm:px-8 lg:px-10 lg:pt-6">
              <ProjectsDashboardHeader
                projectCount={projects.length}
                serviceCount={serviceCount}
                onCreate={() => setCreateOpen(true)}
                onImport={() => setProjectImportView("choose")}
              />

              {error ? (
                <div className="mt-6 border-l-2 border-white bg-white/10 px-4 py-3 text-sm text-white">
                  {error}
                </div>
              ) : null}

              {!setupLoading && owner ? (
                <div className="mt-7">
                  <SetupTodoList
                    domainSettings={domainSettings}
                    githubStatus={githubStatus}
                    r2Status={r2Status}
                    tools={tools}
                    onOpenSettings={openSystemSettings}
                    onOpenGitHubInstall={() => setGitHubInstallOpen(true)}
                  />
                </div>
              ) : null}

              <div className="mt-7">
                {!setupLoading && projects.length > 0 ? (
                  <div className="mb-5">
                    <ProjectSearch
                      query={projectSearch}
                      resultCount={visibleProjects.length}
                      totalCount={projects.length}
                      onQueryChange={setProjectSearch}
                    />
                  </div>
                ) : null}

                {setupLoading ? (
                  <ProjectsGridSkeleton />
                ) : projects.length === 0 ? (
                  <ProjectsEmptyState onCreate={() => setCreateOpen(true)} />
                ) : visibleProjects.length === 0 ? (
                  <ProjectSearchEmptyState
                    query={projectSearch.trim()}
                    onClear={() => setProjectSearch("")}
                  />
                ) : (
                  <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {visibleProjects.map((project, index) => (
                      <ProjectOverviewCard
                        key={project.id}
                        project={project}
                        index={index}
                        pinned={pinnedProjectIds.includes(project.id)}
                        onOpen={() => openProject(project)}
                        onTogglePin={() => togglePinnedProject(project.id)}
                      />
                    ))}
                  </section>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createProject}
      />
      <ProjectImportModal
        open={projectImportView === "choose"}
        onClose={() => setProjectImportView("closed")}
        onSelect={setProjectImportView}
      />
      <RailwayImportModal
        open={projectImportView === "railway"}
        onClose={() => setProjectImportView("closed")}
        onBackToProviders={() => setProjectImportView("choose")}
        onSuccess={loadProjects}
      />
      <VercelImportModal
        open={projectImportView === "vercel"}
        onClose={() => setProjectImportView("closed")}
        onBackToProviders={() => setProjectImportView("choose")}
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
