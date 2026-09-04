import { Globe02Icon } from "@hugeicons/core-free-icons";
import type { ProjectCard } from "../../api";
import { AppIcon, FrameworkMark } from "../../components/ui/primitives";

export function ServiceCluster({ project }: { project: ProjectCard }) {
  const previewServices = project.services.slice(0, 7);
  const extraCount = Math.max(0, project.serviceCount - previewServices.length);

  return (
    <div className="border border-white/10 bg-black/30 p-2">
      <div className="flex min-h-[104px] items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-size-[18px_18px] p-3">
        <div className="flex max-w-[11.5rem] flex-wrap items-center justify-center gap-2">
          {previewServices.map((service) => (
            <div
              key={service.id}
              className="flex h-10 w-10 items-center justify-center border border-white/15 bg-zinc-950 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
            >
              <FrameworkMark framework={service.framework} size={17} fallback={<AppIcon icon={Globe02Icon} size={15} className="text-zinc-400" />} />
            </div>
          ))}
          {previewServices.length === 0 ? (
            <div className="flex h-full min-h-[104px] items-center justify-center text-xs text-zinc-600">No services yet.</div>
          ) : null}
          {extraCount > 0 ? (
            <div className="flex h-10 w-10 items-center justify-center border border-white/15 bg-zinc-950 font-mono text-xs tracking-[0.08em] text-zinc-400">
              +{extraCount}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
