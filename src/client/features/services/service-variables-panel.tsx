import { Add01Icon, CopyIcon, PencilEdit02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import type { ClipboardEvent } from "react";
import { api, type EnvVar } from "../../api";
import { AutocompleteInput } from "../../components/ui/autocomplete-input";
import { AppIcon, FormInput } from "../../components/ui/primitives";
import { EnvVarRow } from "../../components/modals/env-var-row";
import { EnvPasteDialog } from "./env-paste-dialog";
import { EnvPlainTextEditor } from "./env-plain-text-editor";
import { parseEnvText, type ParsedEnvEntry } from "./env-text-parser";

export function ServiceVariablesPanel({
  serviceId,
  env,
  suggestions,
  busy,
  doAction
}: {
  serviceId: string;
  env: EnvVar[];
  suggestions: Array<{ key: string; label: string }>;
  busy: string;
  doAction: (label: string, action: () => Promise<void>) => Promise<void>;
}) {
  const [envForm, setEnvForm] = useState({ key: "", value: "" });
  const [envSearch, setEnvSearch] = useState("");
  const [newEnvOpen, setNewEnvOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [plainTextOpen, setPlainTextOpen] = useState(false);
  const filteredEnv = env.filter((item) => item.key.toLowerCase().includes(envSearch.trim().toLowerCase()));

  async function populateEnvEntries(entries: ParsedEnvEntry[]) {
    await doAction("env", async () => {
      await Promise.all(entries.map((entry) => api.upsertEnv(serviceId, entry)));
      setEnvForm({ key: "", value: "" });
      setNewEnvOpen(false);
      setPasteOpen(false);
    });
  }

  function handleEnvPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    const entries = parseEnvText(text);
    if (entries.length === 0) return;

    event.preventDefault();

    if (entries.length === 1) {
      setNewEnvOpen(true);
      setEnvForm(entries[0]);
      return;
    }

    void populateEnvEntries(entries);
  }

  async function savePlainEnv(entries: ParsedEnvEntry[]) {
    const nextKeys = new Set(entries.map((entry) => entry.key));
    const removedEntries = env.filter((item) => !nextKeys.has(item.key));

    await doAction("env", async () => {
      await Promise.all(removedEntries.map((item) => api.deleteEnv(serviceId, item.id)));
      await Promise.all(entries.map((entry) => api.upsertEnv(serviceId, entry)));
      setPlainTextOpen(false);
    });
  }

  return (
    <section className="mx-auto max-w-5xl overflow-hidden border border-white/10 bg-black">
      <header className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl tracking-[-0.03em] text-white">Variables</h2>
          <p className="mt-1.5 text-sm text-zinc-500">
            {env.length} {env.length === 1 ? "variable" : "variables"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!plainTextOpen ? (
            <div className="relative min-w-52 flex-1 sm:flex-none">
              <AppIcon icon={Search01Icon} size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <FormInput
                value={envSearch}
                onChange={(event) => setEnvSearch(event.target.value)}
                placeholder="Search"
                variant="monochrome"
                className="!h-9 w-full border-white/15 bg-white/[0.03] pl-9 text-sm sm:w-56"
              />
            </div>
          ) : null}
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 border border-white/15 px-3.5 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
            onClick={() => {
              setNewEnvOpen(false);
              setPlainTextOpen((current) => !current);
            }}
            disabled={busy === "env"}
          >
            <AppIcon icon={PencilEdit02Icon} size={14} />
            {plainTextOpen ? "List view" : "Edit as plain"}
          </button>
          {!plainTextOpen ? (
            <>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 border border-white/15 px-3.5 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white"
                onClick={() => setPasteOpen(true)}
              >
                <AppIcon icon={CopyIcon} size={14} />
                Paste .env
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 bg-white px-3.5 text-sm text-black transition hover:bg-zinc-200"
                onClick={() => setNewEnvOpen((current) => !current)}
              >
                <AppIcon icon={Add01Icon} size={14} />
                New variable
              </button>
            </>
          ) : null}
        </div>
      </header>

      {plainTextOpen ? (
        <EnvPlainTextEditor
          key={serviceId}
          env={env}
          busy={busy === "env"}
          onCancel={() => setPlainTextOpen(false)}
          onSave={savePlainEnv}
        />
      ) : null}

      {!plainTextOpen && newEnvOpen ? (
        <form
          className="border-b border-white/10 bg-white/[0.02] p-4 sm:px-5"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void doAction("env", async () => {
              await api.upsertEnv(serviceId, envForm);
              setEnvForm({ key: "", value: "" });
              setNewEnvOpen(false);
            });
          }}
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.4fr)_auto] lg:items-end">
            <div className="space-y-1.5">
              <label htmlFor="new-variable-key" className="block text-xs text-zinc-500">Key</label>
              <FormInput
                id="new-variable-key"
                value={envForm.key}
                onChange={(event) => setEnvForm({ ...envForm, key: event.target.value })}
                onPaste={handleEnvPaste}
                placeholder="KEY"
                autoComplete="off"
                required
                variant="monochrome"
                className="!h-9 border-white/15 bg-black font-mono text-xs uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-variable-value" className="block text-xs text-zinc-500">Value</label>
              <AutocompleteInput
                id="new-variable-value"
                type="text"
                value={envForm.value}
                onChange={(val) => setEnvForm({ ...envForm, value: val })}
                onPaste={handleEnvPaste}
                suggestions={suggestions}
                placeholder="VALUE"
                autoComplete="off"
                variant="monochrome"
                className="!h-9 border-white/15 bg-black font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center bg-white px-3.5 text-sm text-black transition hover:bg-zinc-200 disabled:opacity-50"
                disabled={busy === "env"}
              >
                Save
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center border border-white/15 px-3.5 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05]"
                onClick={() => setNewEnvOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {!plainTextOpen ? (
        <div>
          {filteredEnv.length > 0 ? (
            <div className="hidden grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.4fr)_104px] gap-4 border-b border-white/10 bg-white/[0.02] px-5 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600 lg:grid">
              <span>Key</span>
              <span>Value</span>
              <span className="text-right">Actions</span>
            </div>
          ) : null}
          {filteredEnv.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-zinc-600">
              {envSearch ? "No matching variables" : "No variables"}
            </div>
          ) : (
            filteredEnv.map((item) => (
              <EnvVarRow
                key={item.id}
                item={item}
                busy={busy === "env"}
                suggestions={suggestions}
                onSave={async (key, value) => {
                  await doAction("env", async () => {
                    if (key !== item.key) {
                      await api.deleteEnv(serviceId, item.id);
                    }
                    await api.upsertEnv(serviceId, { key, value });
                  });
                }}
                onDelete={async () => {
                  await doAction("env", async () => {
                    await api.deleteEnv(serviceId, item.id);
                  });
                }}
              />
            ))
          )}
        </div>
      ) : null}

      <EnvPasteDialog
        open={pasteOpen}
        busy={busy === "env"}
        onClose={() => setPasteOpen(false)}
        onImport={populateEnvEntries}
      />
    </section>
  );
}
