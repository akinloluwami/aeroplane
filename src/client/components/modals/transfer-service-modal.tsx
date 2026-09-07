import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from "react";
import { api, type ProjectCard } from "../../api";
import { Dropdown } from "../ui/dropdown";
import { ModalShell } from "./modal-shell";

type TransferServiceModalProps = {
  open: boolean;
  currentProjectId: string;
  serviceName: string;
  busy: boolean;
  onClose: () => void;
  onTransfer: (targetProjectId: string) => Promise<void>;
};

export function TransferServiceModal({
  open,
  currentProjectId,
  serviceName,
  busy,
  onClose,
  onTransfer
}: TransferServiceModalProps) {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [targetProjectId, setTargetProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setProjects([]);
      setTargetProjectId("");
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void api.projects()
      .then((result) => {
        if (cancelled) return;
        const nextProjects = result.projects.filter((project) => project.id !== currentProjectId);
        setProjects(nextProjects);
        setTargetProjectId((current) => nextProjects.some((project) => project.id === current) ? current : "");
      })
      .catch((issue) => {
        if (cancelled) return;
        setError(issue instanceof Error ? issue.message : "Could not load projects");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentProjectId, open]);

  const projectOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name })),
    [projects]
  );
  const selectedProject = projects.find((project) => project.id === targetProjectId) ?? null;

  async function submitTransfer() {
    if (!targetProjectId) return;

    setError("");
    try {
      await onTransfer(targetProjectId);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not transfer service");
    }
  }

  return (
    <ModalShell
      open={open}
      title="Move service"
      meta={serviceName}
      icon={FolderOpenIcon}
      onClose={onClose}
      width="max-w-md"
      minHeight="min-h-0"
      bodyClassName="min-h-0 flex-1"
      variant="monochrome"
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">Destination project</p>
          <Dropdown
            value={targetProjectId}
            options={projectOptions}
            onChange={setTargetProjectId}
            disabled={loading || busy || projectOptions.length === 0}
            placeholder={loading ? "Loading projects..." : "Select project"}
            variant="monochrome"
            size="compact"
            className="[&>button]:!h-9"
          />
          <div className="mt-2 text-xs leading-5 text-zinc-500">
            {selectedProject
              ? `${serviceName} will move to ${selectedProject.name}.`
              : projectOptions.length > 0
                ? "Choose a project to move this service."
                : "Create another project before moving this service."}
          </div>
        </div>

        <div className="border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs leading-5 text-zinc-500">
          The service lands in the destination project's production environment. Deployments, variables, domains, backups, and runtime state stay with it.
        </div>

        {error ? <div className="border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">{error}</div> : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
          <button type="button" className="inline-flex h-9 items-center justify-center border border-white/15 px-3.5 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white disabled:opacity-40" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="inline-flex h-9 items-center justify-center bg-white px-4 text-sm text-black transition hover:bg-zinc-200 disabled:opacity-40" onClick={() => void submitTransfer()} disabled={busy || loading || !targetProjectId}>
            {busy ? "Moving…" : "Move service"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
