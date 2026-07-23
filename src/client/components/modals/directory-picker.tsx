import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import type { Framework, GitHubDirectory } from "../../api";
import { ModalShell } from "./modal-shell";
import { shellButton } from "../ui/primitives";
import { DirectoryTree } from "./directory-tree";

type DirectoryPickerModalProps = {
  open: boolean;
  repoLabel: string;
  selectedPath: string;
  directoriesByPath: Record<string, GitHubDirectory[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  errorMessage: string;
  rootFramework?: Framework | null;
  onClose: () => void;
  onToggle: (path: string) => void | Promise<void>;
  onSelect: (path: string) => void;
};

export function DirectoryPickerModal({
  open,
  repoLabel,
  selectedPath,
  directoriesByPath,
  expandedPaths,
  loadingPaths,
  errorMessage,
  rootFramework,
  onClose,
  onToggle,
  onSelect
}: DirectoryPickerModalProps) {
  return (
    <ModalShell open={open} onClose={onClose} icon={FolderOpenIcon} title="Choose directory" meta="Select the folder that contains this service." width="max-w-4xl">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 border border-zinc-700 bg-zinc-900/88 px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">Current directory</div>
            <div className="mt-1 text-base text-zinc-100">{selectedPath || "."}</div>
          </div>
          <button type="button" className={shellButton("primary")} onClick={onClose}>
            Done
          </button>
        </div>

        <DirectoryTree
          repoLabel={repoLabel}
          selectedPath={selectedPath}
          directoriesByPath={directoriesByPath}
          expandedPaths={expandedPaths}
          loadingPaths={loadingPaths}
          errorMessage={errorMessage}
          footerMessage="Choose the folder that contains this service."
          rootFramework={rootFramework}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      </div>
    </ModalShell>
  );
}
