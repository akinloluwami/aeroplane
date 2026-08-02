import { DeployPlaneIcon } from "../../components/icons/deploy-plane-icon";

const flightPath = "M 18 96 C 68 18, 124 120, 174 54 S 245 20, 270 67";

export const forceProjectRouteLoaderPreview = true;

export function ProjectRouteLoader({
  label = "Loading project",
  fullPage = false
}: {
  label?: string;
  fullPage?: boolean;
}) {
  const loader = (
    <div
      role="status"
      aria-label={label}
      className="flex flex-col items-center justify-center px-4 py-12 text-center"
    >
      <div className="relative h-32 w-72 max-w-full" aria-hidden="true">
        <svg
          viewBox="0 0 288 128"
          className="absolute inset-0 h-full w-full overflow-visible"
          fill="none"
        >
          <path d={flightPath} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
          <path
            d={flightPath}
            className="project-route-loader-path"
            stroke="rgba(255,255,255,0.48)"
            strokeWidth="1"
            strokeDasharray="7 11"
          />
          <circle cx="18" cy="96" r="3" fill="#09090b" stroke="rgba(255,255,255,0.28)" />
          <circle cx="174" cy="54" r="3" fill="#09090b" stroke="rgba(255,255,255,0.28)" />
          <circle cx="270" cy="67" r="3" fill="#09090b" stroke="rgba(255,255,255,0.28)" />
        </svg>

        <div
          className="project-route-loader-plane absolute left-0 top-0 grid h-7 w-7 place-items-center text-white"
          style={{
            offsetPath: `path("${flightPath}")`,
            offsetRotate: "auto",
            offsetAnchor: "center"
          }}
        >
          <DeployPlaneIcon size={18} className="rotate-45" />
        </div>
      </div>

      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </p>
      <span className="sr-only">Please wait</span>
    </div>
  );

  if (fullPage) {
    return (
      <main className="grid h-dvh place-items-center overflow-hidden bg-zinc-950 text-white">
        {loader}
      </main>
    );
  }

  return (
    <section className="grid min-h-[calc(100dvh-8rem)] place-items-center overflow-hidden">
      {loader}
    </section>
  );
}
