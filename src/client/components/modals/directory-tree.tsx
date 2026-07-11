import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import type { Framework, GitHubDirectory } from "../../api";
import { AppIcon, FrameworkMark } from "../ui/primitives";

type DirectoryTreeProps = {
  repoLabel: string;
  selectedPath: string;
  directoriesByPath: Record<string, GitHubDirectory[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  errorMessage?: string;
  footerMessage: string;
  rootLabel?: string;
  rootFramework?: Framework | null;
  onToggle: (path: string) => void | Promise<void>;
  onSelect: (path: string) => void;
};

export function DirectoryTree({
  repoLabel,
  selectedPath,
  directoriesByPath,
  expandedPaths,
  loadingPaths,
  errorMessage,
  footerMessage,
  rootLabel = "Repository root",
  rootFramework = null,
  onToggle,
  onSelect
}: DirectoryTreeProps) {
  function renderRows(parentPath = "", level = 0): ReactNode {
    const rows = directoriesByPath[parentPath] ?? [];

    return rows.map((directory) => {
      const isExpanded = expandedPaths.has(directory.path);
      const isSelected = selectedPath === directory.path;
      const isLoading = loadingPaths.has(directory.path);
      const children = isExpanded ? renderRows(directory.path, level + 1) : null;

      return (
        <div key={directory.path}>
          <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-4 last:border-b-0">
            <button
              type="button"
              className={`grid h-6 w-6 place-items-center rounded-md text-zinc-500 ${directory.hasChildren ? "hover:bg-zinc-900 hover:text-zinc-200" : "opacity-40"}`}
              style={{ marginLeft: `${level * 28}px` }}
              onClick={() => (directory.hasChildren ? void onToggle(directory.path) : undefined)}
            >
              {directory.hasChildren ? (
                isLoading ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border border-zinc-700 border-t-[#4FB8B2]" />
                ) : (
                  <AppIcon icon={ArrowLeft01Icon} size={14} className={isExpanded ? "rotate-90" : "-rotate-90"} />
                )
              ) : null}
            </button>
            <button
              type="button"
              className={`h-5 w-5 rounded-full border ${isSelected ? "border-[#4FB8B2] bg-[#4FB8B2]" : "border-zinc-600 bg-transparent"}`}
              onClick={() => onSelect(directory.path)}
            />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(directory.path)}>
              <div className="flex items-center gap-2">
                {directory.framework ? <FrameworkMark framework={directory.framework} size={16} fallback={null} /> : null}
                <div className="truncate text-base font-medium text-zinc-100">{directory.name}</div>
              </div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">{directory.path}</div>
            </button>
          </div>
          {children}
        </div>
      );
    });
  }

  return (
    <div className="overflow-hidden border border-zinc-700 bg-zinc-900/85">
      <div className="border-b border-zinc-800 px-4 py-4 text-base font-medium text-zinc-100">{repoLabel}</div>
      <div className="max-h-[420px] overflow-auto">
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-4">
          <div className="w-6" />
          <button
            type="button"
            className={`h-5 w-5 rounded-full border ${selectedPath === "" ? "border-[#4FB8B2] bg-[#4FB8B2]" : "border-zinc-600 bg-transparent"}`}
            onClick={() => onSelect("")}
          />
          <button type="button" className="flex-1 text-left" onClick={() => onSelect("")}>
            <div className="flex items-center gap-2">
              {rootFramework ? <FrameworkMark framework={rootFramework} size={16} fallback={null} /> : null}
              <div className="text-base font-medium text-zinc-100">{rootLabel}</div>
            </div>
          </button>
        </div>
        {renderRows("", 0)}
      </div>
      <div className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-300">{errorMessage || footerMessage}</div>
    </div>
  );
}
