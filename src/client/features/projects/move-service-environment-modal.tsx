import { useEffect, useMemo, useState } from "react";
import type { ProjectEnvironment } from "../../api";
import { Dropdown } from "../../components/ui/dropdown";
import { SettingsDialog } from "../settings/settings-dialog";

export function MoveServiceEnvironmentModal({
  open,
  serviceName,
  currentEnvironmentId,
  environments,
  onClose,
  onMove
}: {
  open: boolean;
  serviceName: string;
  currentEnvironmentId: string;
  environments: ProjectEnvironment[];
  onClose: () => void;
  onMove: (environmentId: string) => Promise<void>;
}) {
  const [environmentId, setEnvironmentId] = useState("");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");

  const destinations = useMemo(
    () => environments.filter((environment) => environment.id !== currentEnvironmentId),
    [currentEnvironmentId, environments]
  );

  useEffect(() => {
    if (!open) {
      setEnvironmentId("");
      setMoving(false);
      setError("");
      return;
    }
    setEnvironmentId(destinations[0]?.id ?? "");
  }, [destinations, open]);

  async function move() {
    if (!environmentId) return;
    setMoving(true);
    setError("");
    try {
      await onMove(environmentId);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not move service");
    } finally {
      setMoving(false);
    }
  }

  return (
    <SettingsDialog open={open} title="Move to environment" width="max-w-md" onClose={() => {
      if (!moving) onClose();
    }}>
      <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">{serviceName}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">
        Choose the environment that should contain this service.
      </p>

      <div className="mt-5">
        <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
          Destination
        </span>
        <Dropdown
          value={environmentId}
          options={destinations.map((environment) => ({ value: environment.id, label: environment.name }))}
          onChange={setEnvironmentId}
          disabled={moving || destinations.length === 0}
          placeholder="Select environment"
          variant="monochrome"
        />
      </div>

      {error ? (
        <div role="alert" className="mt-4 border-l-2 border-rose-400 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex justify-end gap-2 border-t border-white/10 pt-4">
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center border border-white/15 px-4 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
          onClick={onClose}
          disabled={moving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center bg-white px-4 text-sm text-black transition hover:bg-zinc-200 disabled:opacity-50"
          onClick={() => void move()}
          disabled={moving || !environmentId}
        >
          {moving ? "Moving…" : "Move service"}
        </button>
      </div>
    </SettingsDialog>
  );
}
