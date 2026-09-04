import { Search01Icon } from "@hugeicons/core-free-icons";
import { AppIcon } from "../../components/ui/primitives";

export function ProjectSearchEmptyState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <section className="flex min-h-72 flex-col items-center justify-center border border-dashed border-white/15 bg-black/20 px-6 text-center">
      <span className="grid h-11 w-11 place-items-center border border-white/15 bg-white/5 text-zinc-400">
        <AppIcon icon={Search01Icon} size={18} />
      </span>
      <h2 className="mt-5 text-lg font-semibold text-white">No matching projects</h2>
      <p className="mt-2 max-w-md text-sm text-zinc-500">
        Nothing matched “{query}”. Try a project name, description, or service.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 border border-white/15 px-3.5 py-2.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition hover:border-white/30 hover:text-white"
      >
        Clear search
      </button>
    </section>
  );
}
