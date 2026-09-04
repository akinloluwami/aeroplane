import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { AppIcon } from "../../components/ui/primitives";

export function ProjectSearch({
  query,
  resultCount,
  totalCount,
  onQueryChange,
}: {
  query: string;
  resultCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-y border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative block w-full sm:max-w-md">
        <span className="sr-only">Search projects</span>
        <AppIcon
          icon={Search01Icon}
          size={15}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search projects or services…"
          className="h-11 w-full border border-white/15 bg-black/30 pl-10 pr-10 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/40 focus:bg-black/50"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear project search"
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center text-zinc-600 transition hover:bg-white/10 hover:text-white"
          >
            <AppIcon icon={Cancel01Icon} size={14} />
          </button>
        ) : null}
      </label>

      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {query.trim() ? `${resultCount} of ${totalCount} projects` : `${totalCount} projects`}
      </span>
    </div>
  );
}
