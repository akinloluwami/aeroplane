import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { SettingsDialog } from "../settings/settings-dialog";

export function CreateEnvironmentModal({
  open,
  onClose,
  onCreate
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setError("");
      setSaving(false);
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError("");
    try {
      await onCreate(name.trim());
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not create environment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDialog open={open} title="New environment" width="max-w-md" onClose={() => {
      if (!saving) onClose();
    }}>
      <form onSubmit={(event) => void submit(event)}>
        <p className="text-sm leading-6 text-zinc-500">
          Create another place to organize this project's services.
        </p>

        <label className="mt-5 block">
          <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
            Environment name
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Staging"
            autoComplete="off"
            autoFocus
            maxLength={50}
            required
            className="h-11 w-full border border-white/15 bg-white/[0.04] px-3.5 text-sm text-white outline-none transition placeholder:text-zinc-700 hover:border-white/30 focus:border-white focus:bg-white/[0.07]"
          />
        </label>

        {error ? (
          <div role="alert" className="mt-4 border-l-2 border-rose-400 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-6 border-t border-white/10 pt-4">
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center bg-white px-5 text-sm text-black transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-50"
            disabled={saving || !name.trim()}
          >
            {saving ? "Creating…" : "Create environment"}
          </button>
        </div>
      </form>
    </SettingsDialog>
  );
}
