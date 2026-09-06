import { ArrowRight02Icon, StarIcon } from "@hugeicons/core-free-icons";
import type { ProjectCard } from "../../api";
import { AppIcon } from "../../components/ui/primitives";
import { formatRelativeTime } from "../../lib/format";
import { ServiceCluster } from "./service-cluster";

export function ProjectOverviewCard({
  project,
  index,
  pinned,
  onOpen,
  onTogglePin,
}: {
  project: ProjectCard;
  index: number;
  pinned: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  return (
    <article className="group relative flex overflow-hidden border border-white/10 bg-black/25 text-left transition hover:border-white/30 hover:bg-white/[0.03]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]"
      />

      <button
        type="button"
        onClick={onOpen}
        className="relative z-10 flex min-w-0 flex-1 flex-col p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Project {String(index + 1).padStart(2, "0")}
            </span>
            <h2 className="mt-1.5 truncate text-lg font-semibold tracking-tight text-white">
              {project.name}
            </h2>
            {project.description ? (
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-zinc-500">
                {project.description}
              </p>
            ) : null}
          </div>
          <span className="grid h-9 w-9 flex-none place-items-center border border-white/15 text-zinc-500 transition group-hover:border-white group-hover:bg-white group-hover:text-black">
            <AppIcon icon={ArrowRight02Icon} size={15} />
          </span>
        </div>

        <div className="mb-3 mt-4">
          <ServiceCluster project={project} />
        </div>

        <div className="mt-auto flex items-center justify-between gap-4 border-t border-white/10 pr-8 pt-3">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            {project.serviceCount} service
            {project.serviceCount === 1 ? "" : "s"}
          </span>
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-zinc-600">
            Updated {formatRelativeTime(project.lastUpdatedAt)}
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={onTogglePin}
        aria-label={pinned ? `Remove ${project.name} from favorites` : `Add ${project.name} to favorites`}
        title={pinned ? "Remove from favorites" : "Add to favorites"}
        className={
          pinned
            ? "absolute bottom-2.5 right-2.5 z-20 grid h-8 w-8 place-items-center text-amber-300 transition hover:text-amber-200"
            : "absolute bottom-2.5 right-2.5 z-20 grid h-8 w-8 place-items-center text-zinc-600 transition hover:text-white"
        }
      >
        <AppIcon icon={StarIcon} size={16} className={pinned ? "fill-current" : ""} />
      </button>
    </article>
  );
}
