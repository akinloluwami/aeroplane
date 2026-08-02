import { ArrowLeft01Icon, CloudServerIcon } from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, type ProjectDetail, type ToolCheck } from "../api";
import { useAuthStatus } from "../components/auth/auth-context";
import { ServicePageShell } from "../features/services/service-page-shell";
import {
  forceProjectRouteLoaderPreview,
  ProjectRouteLoader
} from "../features/projects/project-route-loader";
import { ProjectsDashboardSidebar } from "../features/projects/projects-dashboard-sidebar";
import {
  routeSegmentToServiceTab,
  serviceTabToRouteSegment,
  type ServiceTab,
} from "../features/services/service-tabs";
import { AppIcon } from "../components/ui/primitives";
import { usePageTitle } from "../lib/page-title";

export function ServicePage({
  projectSlug,
  serviceSlug,
  serviceTab,
}: {
  projectSlug: string;
  serviceSlug: string;
  serviceTab?: string;
}) {
  const navigate = useNavigate();
  const authStatus = useAuthStatus();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selectedTab = useMemo<ServiceTab>(
    () => routeSegmentToServiceTab(serviceTab),
    [serviceTab],
  );
  const currentUser = authStatus?.user ?? null;
  const owner = currentUser?.role === "owner";

  const loadProject = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true;
    if (showLoading) setLoading(true);
    try {
      const result = await api.project(projectSlug);
      startTransition(() => {
        setProject(result.project);
        setError("");
        setLoading(false);
      });
    } catch (issue) {
      startTransition(() => {
        setError(
          issue instanceof Error ? issue.message : "Could not load project",
        );
        setLoading(false);
      });
    }
  }, [projectSlug]);

  useEffect(() => {
    setProject(null);
    setError("");
    setLoading(true);
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    if (!owner) {
      setTools([]);
      return;
    }

    let cancelled = false;
    void api.system()
      .then((result) => {
        if (!cancelled) setTools(result.tools);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });

    return () => {
      cancelled = true;
    };
  }, [owner]);

  const currentProject = project?.slug === projectSlug ? project : null;
  const service =
    currentProject?.services.find((item) => item.slug === serviceSlug) ?? null;
  const refreshProjectInBackground = useCallback(
    () => loadProject({ showLoading: false }),
    [loadProject],
  );
  usePageTitle(
    service
      ? `${service.name} - ${currentProject?.name ?? projectSlug}`
      : (currentProject?.name ?? projectSlug),
  );

  function navigateToProject() {
    void navigate({ to: "/$projectSlug", params: { projectSlug } });
  }

  function navigateToTab(tab: ServiceTab) {
    const segment = serviceTabToRouteSegment[tab];
    if (segment === "overview") {
      void navigate({
        to: "/$projectSlug/$serviceSlug",
        params: { projectSlug, serviceSlug },
      });
      return;
    }
    void navigate({
      to: "/$projectSlug/$serviceSlug/$serviceTab",
      params: { projectSlug, serviceSlug, serviceTab: segment },
    });
  }

  function navigateToService(nextServiceSlug: string) {
    void navigate({
      to: "/$projectSlug/$serviceSlug",
      params: { projectSlug, serviceSlug: nextServiceSlug },
    });
  }

  function navigateToTransferredService(nextProjectSlug: string, nextServiceSlug: string) {
    void navigate({
      to: "/$projectSlug/$serviceSlug",
      params: { projectSlug: nextProjectSlug, serviceSlug: nextServiceSlug },
    });
  }

  if (forceProjectRouteLoaderPreview) {
    return <ProjectRouteLoader label="Loading service" fullPage />;
  }

  if (error) {
    return (
      <main className="min-h-dvh bg-black text-white">
        <div className="grid min-h-dvh lg:grid-cols-[260px_minmax(0,1fr)]">
          <ProjectsDashboardSidebar currentUser={currentUser} tools={tools} owner={owner} />
          <section className="grid min-h-dvh place-items-center bg-zinc-950 px-5 py-12">
            <div className="w-full max-w-lg border border-white/10 bg-black p-5">
              <h1 className="text-lg text-zinc-100">Could not load service</h1>
              <p className="mt-2 text-sm text-rose-200">{error}</p>
              <button
                type="button"
                className="mt-5 inline-flex h-9 items-center justify-center gap-2 border border-white/15 px-3.5 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05]"
                onClick={navigateToProject}
              >
                <AppIcon icon={ArrowLeft01Icon} size={15} />
                Back to project
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (loading || !currentProject) {
    return <ProjectRouteLoader label="Loading service" fullPage />;
  }

  if (!service) {
    return (
      <main className="min-h-dvh bg-black text-white">
        <div className="grid min-h-dvh lg:grid-cols-[260px_minmax(0,1fr)]">
          <ProjectsDashboardSidebar currentUser={currentUser} tools={tools} owner={owner} />
          <section className="grid min-h-dvh place-items-center bg-zinc-950 px-5 py-12">
            <div className="w-full max-w-lg border border-white/10 bg-black p-5">
              <AppIcon icon={CloudServerIcon} size={20} className="text-zinc-600" />
              <h1 className="mt-4 text-lg text-zinc-100">Service not found</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                There is no service named <span className="font-mono text-zinc-300">{serviceSlug}</span> in this project.
              </p>
              <Link
                to="/$projectSlug"
                params={{ projectSlug }}
                className="mt-5 inline-flex h-9 items-center justify-center gap-2 border border-white/15 px-3.5 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05]"
              >
                <AppIcon icon={ArrowLeft01Icon} size={15} />
                Back to project
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <ServicePageShell
      key={service.id}
      selectedTab={selectedTab}
      serviceId={service.id}
      onClose={navigateToProject}
      onTabChange={navigateToTab}
      onProjectRefresh={refreshProjectInBackground}
      onDeleted={navigateToProject}
      pageServices={currentProject.services}
      onServiceSelect={navigateToService}
      onTransferred={navigateToTransferredService}
      currentUser={currentUser}
      tools={tools}
      owner={owner}
    />
  );
}
