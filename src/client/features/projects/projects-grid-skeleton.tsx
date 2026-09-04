import { SkeletonBlock } from "../../components/ui/skeleton";

function ProjectCardSkeleton() {
  return (
    <div className="relative overflow-hidden border border-white/10 bg-black/25 p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] bg-[size:72px_72px] opacity-45"
      />
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <SkeletonBlock className="h-2 w-16" />
            <SkeletonBlock className="mt-2 h-5 w-32 max-w-full" />
          </div>
          <SkeletonBlock className="h-9 w-9 shrink-0" />
        </div>

        <div className="mt-4 border border-white/10 bg-black/30 p-2">
          <div className="flex min-h-[104px] items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-size-[18px_18px] p-3">
            <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonBlock
                  key={index}
                  className="h-10 w-10 border border-white/10"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3">
          <SkeletonBlock className="h-2 w-14" />
          <SkeletonBlock className="h-2 w-20" />
        </div>
      </div>
    </div>
  );
}

export function ProjectsGridSkeleton() {
  return (
    <section
      role="status"
      aria-label="Loading projects"
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
    >
      <span className="sr-only">Loading projects</span>
      {Array.from({ length: 8 }).map((_, index) => (
        <ProjectCardSkeleton key={index} />
      ))}
    </section>
  );
}
