import { Add01Icon, Layers01Icon } from "@hugeicons/core-free-icons";
import type { ProjectEnvironment, Service } from "../../api";
import { AppIcon } from "../../components/ui/primitives";

export function ProjectEnvironmentTabs({
  environments,
  services,
  selectedEnvironmentId,
  onSelect,
  onCreate
}: {
  environments: ProjectEnvironment[];
  services: Service[];
  selectedEnvironmentId: string;
  onSelect: (environmentId: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="mb-5 flex items-center gap-2 overflow-x-auto border-b border-white/10 pb-3">
      {environments.map((environment) => {
        const selected = environment.id === selectedEnvironmentId;
        const serviceCount = services.filter((service) => service.environmentId === environment.id).length;

        return (
          <button
            key={environment.id}
            type="button"
            className={`inline-flex h-9 shrink-0 items-center gap-2 border px-3 text-sm transition ${
              selected
                ? "border-white bg-white text-black"
                : "border-white/15 text-zinc-400 hover:border-white/35 hover:bg-white/[0.05] hover:text-white"
            }`}
            onClick={() => onSelect(environment.id)}
            aria-pressed={selected}
          >
            <AppIcon icon={Layers01Icon} size={14} />
            {environment.name}
            {environment.isDefault ? (
              <span className={`font-mono text-[8px] uppercase tracking-[0.12em] ${selected ? "text-zinc-500" : "text-zinc-600"}`}>
                default
              </span>
            ) : null}
            <span className={`font-mono text-[9px] ${selected ? "text-zinc-500" : "text-zinc-600"}`}>
              {serviceCount}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        className="inline-flex h-9 shrink-0 items-center gap-2 border border-dashed border-white/20 px-3 text-sm text-zinc-500 transition hover:border-white/40 hover:bg-white/[0.05] hover:text-white"
        onClick={onCreate}
      >
        <AppIcon icon={Add01Icon} size={14} />
        New environment
      </button>
    </div>
  );
}
