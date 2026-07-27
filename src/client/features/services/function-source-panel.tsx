import { CheckmarkCircle02Icon, FileCodeIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from "react";
import { api, type FunctionSource } from "../../api";
import { AppIcon, FieldLabel, shellButton } from "../../components/ui/primitives";
import { functionRuntimeFileNames, type FunctionRuntime } from "../../../shared/service-functions";
import { FunctionCodeAiPanel } from "./function-code-ai-panel";
import { FunctionSourceEditor } from "./function-source-editor";
import { FunctionRuntimeDropdown } from "./function-runtime-dropdown";

type FunctionSourceDraft = {
  runtime: FunctionRuntime;
  sourceCode: string;
};

export function FunctionSourcePanel({
  serviceId,
  serviceName,
  busy,
  doAction
}: {
  serviceId: string;
  serviceName: string;
  busy: string;
  doAction: (label: string, action: () => Promise<void>) => Promise<void>;
}) {
  const [source, setSource] = useState<FunctionSource | null>(null);
  const [draft, setDraft] = useState<FunctionSourceDraft>({ runtime: "node", sourceCode: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const result = await api.functionSource(serviceId);
        if (cancelled) return;
        setSource(result.source);
        setDraft({ runtime: result.source.runtime, sourceCode: result.source.sourceCode });
      } catch (issue) {
        if (cancelled) return;
        setError(issue instanceof Error ? issue.message : "Could not load function source");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const dirty = useMemo(() => {
    if (!source) return false;
    return draft.runtime !== source.runtime || draft.sourceCode !== source.sourceCode;
  }, [draft.runtime, draft.sourceCode, source]);

  async function saveSource() {
    await doAction("source", async () => {
      const result = await api.updateFunctionSource(serviceId, draft);
      setSource(result.source);
      setDraft({ runtime: result.source.runtime, sourceCode: result.source.sourceCode });
    });
  }

  if (loading) {
    return (
      <div className="grid min-h-[420px] place-items-center border border-zinc-800 bg-zinc-950/50">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">Loading function source...</div>
      </div>
    );
  }

  if (error) {
    return <div className="border border-rose-500/25 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">{error}</div>;
  }

  return (
    <div className="flex min-h-0 flex-col space-y-5">
      <section className="border border-zinc-800 bg-zinc-950/50 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center border border-zinc-800 bg-zinc-900 text-[#7fe3dd]">
                <AppIcon icon={FileCodeIcon} size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-hero text-xl font-bold tracking-tight text-zinc-100">{serviceName}</h2>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  {functionRuntimeFileNames[draft.runtime]}
                </div>
              </div>
            </div>
          </div>
          <button type="button" className={shellButton("primary")} onClick={() => void saveSource()} disabled={!dirty || busy === "source"}>
            <AppIcon icon={CheckmarkCircle02Icon} size={16} />
            Save source
          </button>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <FieldLabel>Runtime</FieldLabel>
            <FunctionRuntimeDropdown
              value={draft.runtime}
              onChange={(runtime) => setDraft((current) => ({ ...current, runtime }))}
              disabled={busy === "source"}
              className="w-full min-w-[220px] md:w-64"
            />
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            {source?.updatedAt ? `Saved ${new Date(source.updatedAt).toLocaleString()}` : ""}
          </div>
        </div>
        <div className="relative min-h-[420px] flex-1">
          <FunctionSourceEditor
            runtime={draft.runtime}
            value={draft.sourceCode}
            onChange={(sourceCode) => setDraft((current) => ({ ...current, sourceCode }))}
            disabled={busy === "source"}
            height="100%"
          />
          <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-20 w-[360px] max-w-[calc(100%-1.5rem)]">
            <FunctionCodeAiPanel
              serviceId={serviceId}
              runtime={draft.runtime}
              sourceCode={draft.sourceCode}
              disabled={busy === "source"}
              className="pointer-events-auto"
              onApply={(sourceCode) => setDraft((current) => ({ ...current, sourceCode }))}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
