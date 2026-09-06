import {
  ArrowLeft01Icon,
  Cancel01Icon,
  PencilEdit02Icon
} from "@hugeicons/core-free-icons";
import { AppIcon, FieldLabel, FormInput } from "../../components/ui/primitives";
import { BuildMethodControl } from "../../components/ui/build-method-control";
import { RuntimeModeControl } from "../../components/ui/runtime-mode-control";
import type { ServiceSettingsState } from "./service-settings-state";

type ApplicationServiceSettingsPanelProps = {
  settings: ServiceSettingsState;
  branches: string[];
  branchMenuOpen: boolean;
  isGitUrlSource: boolean;
  onChange: (settings: Partial<ServiceSettingsState>) => void;
  onToggleBranchMenu: () => void;
  onSelectBranch: (branch: string) => void;
  onOpenSourcePicker: () => void;
  onDisconnectSource: () => void;
  onOpenDirectoryPicker: () => void;
};

const inputClass = "!h-9 border-white/15 bg-black text-xs";

export function ApplicationServiceSettingsPanel({
  settings,
  branches,
  branchMenuOpen,
  isGitUrlSource,
  onChange,
  onToggleBranchMenu,
  onSelectBranch,
  onOpenSourcePicker,
  onDisconnectSource,
  onOpenDirectoryPicker
}: ApplicationServiceSettingsPanelProps) {
  return (
    <>
      <div className="xl:col-span-2">
        <FieldLabel>Repository</FieldLabel>
        <div className="border border-white/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-all font-mono text-xs text-zinc-300">
              {settings.repoFullName || settings.repoUrl || "Disconnected"}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-2 border border-white/15 px-3 text-xs text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white"
                onClick={onOpenSourcePicker}
              >
                <AppIcon icon={PencilEdit02Icon} size={13} />
                Change source
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-2 px-3 text-xs text-zinc-500 transition hover:bg-white/[0.05] hover:text-white"
                onClick={onDisconnectSource}
              >
                <AppIcon icon={Cancel01Icon} size={13} />
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="relative">
        <FieldLabel>Branch</FieldLabel>
        {isGitUrlSource ? (
          <FormInput
            name="branch"
            value={settings.branch}
            onChange={(event) => onChange({ branch: event.target.value })}
            placeholder="main"
            variant="monochrome"
            className={inputClass}
          />
        ) : (
          <>
            <input type="hidden" name="branch" value={settings.branch} />
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between border border-white/15 bg-black px-3 text-left text-xs text-zinc-300 disabled:opacity-40"
              onClick={onToggleBranchMenu}
              disabled={!settings.repoFullName}
            >
              <span>{settings.branch || "Select branch"}</span>
              <AppIcon icon={ArrowLeft01Icon} size={16} className={branchMenuOpen ? "rotate-90" : "-rotate-90"} />
            </button>
          </>
        )}
        {!isGitUrlSource && branchMenuOpen ? (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-64 overflow-auto border border-white/15 bg-black p-1 shadow-[0_20px_40px_rgba(0,0,0,0.55)]">
            {(branches.length ? branches : [settings.branch]).map((branch) => (
              <button
                key={branch}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/[0.05] hover:text-white"
                onClick={() => onSelectBranch(branch)}
              >
                <span>{branch}</span>
                {settings.branch === branch ? (
                  <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-500">Current</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <FieldLabel>Directory</FieldLabel>
        {isGitUrlSource ? (
          <FormInput
            name="rootDir"
            value={settings.rootDir}
            onChange={(event) => onChange({ rootDir: event.target.value })}
            placeholder="."
            variant="monochrome"
            className={inputClass}
          />
        ) : (
          <>
            <input type="hidden" name="rootDir" value={settings.rootDir} />
            <div className="flex h-9 items-center justify-between gap-3 border border-white/15 bg-black px-3">
              <div className="truncate font-mono text-xs text-zinc-300">{settings.rootDir || "."}</div>
              <button
                type="button"
                className="inline-flex h-7 items-center justify-center gap-2 border border-white/15 px-2.5 text-xs text-zinc-400 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
                onClick={onOpenDirectoryPicker}
                disabled={!settings.repoFullName}
              >
                <AppIcon icon={PencilEdit02Icon} size={12} />
                Edit
              </button>
            </div>
          </>
        )}
      </div>

      <div>
        <FieldLabel>Service name</FieldLabel>
        <FormInput
          name="name"
          value={settings.name}
          onChange={(event) => onChange({ name: event.target.value })}
          variant="monochrome"
          className={inputClass}
        />
      </div>

      <div className="xl:col-span-2">
        <FieldLabel>Runtime mode</FieldLabel>
        <RuntimeModeControl
          value={settings.runtimeMode}
          onChange={(runtimeMode) => onChange({
            runtimeMode,
            staticOutput: runtimeMode === "worker" ? "" : settings.staticOutput
          })}
        />
      </div>

      {settings.runtimeMode !== "worker" ? (
        <div>
          <FieldLabel>App port</FieldLabel>
          <FormInput
            name="internalPort"
            type="number"
            value={settings.internalPort}
            onChange={(event) => onChange({ internalPort: Number(event.target.value) })}
            variant="monochrome"
            className={inputClass}
          />
        </div>
      ) : null}

      {!settings.staticOutput ? (
        <div className="xl:col-span-2">
          <FieldLabel>Persistent volume path</FieldLabel>
          <FormInput
            name="persistentVolumePath"
            value={settings.persistentVolumePath}
            onChange={(event) => onChange({ persistentVolumePath: event.target.value })}
            placeholder="/data"
            variant="monochrome"
            className={`${inputClass} font-mono`}
          />
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Mounts a service-specific Docker volume at this absolute container path. Stateful redeployments briefly stop the previous container to protect writable data.
          </p>
        </div>
      ) : (
        <input type="hidden" name="persistentVolumePath" value="" />
      )}

      <div className="xl:col-span-2">
        <FieldLabel>Build method</FieldLabel>
        <BuildMethodControl value={settings.buildMethod} onChange={(buildMethod) => onChange({ buildMethod })} />
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Auto uses your repository’s Dockerfile when one exists, otherwise Railpack builds the project.
        </p>
      </div>

      {settings.buildMethod !== "railpack" ? (
        <div>
          <FieldLabel>Dockerfile path</FieldLabel>
          <FormInput
            name="dockerfilePath"
            value={settings.dockerfilePath}
            onChange={(event) => onChange({ dockerfilePath: event.target.value })}
            placeholder="Dockerfile"
            variant="monochrome"
            className={inputClass}
          />
        </div>
      ) : (
        <input type="hidden" name="dockerfilePath" value={settings.dockerfilePath} />
      )}

      <div>
        <FieldLabel>Install command</FieldLabel>
        <FormInput name="installCommand" value={settings.installCommand} onChange={(event) => onChange({ installCommand: event.target.value })} placeholder="auto" variant="monochrome" className={`${inputClass} font-mono`} />
      </div>
      <div>
        <FieldLabel>Prebuild command</FieldLabel>
        <FormInput name="prebuildCommand" value={settings.prebuildCommand} onChange={(event) => onChange({ prebuildCommand: event.target.value })} placeholder="none" variant="monochrome" className={`${inputClass} font-mono`} />
      </div>
      <div>
        <FieldLabel>Build command</FieldLabel>
        <FormInput name="buildCommand" value={settings.buildCommand} onChange={(event) => onChange({ buildCommand: event.target.value })} placeholder="auto" variant="monochrome" className={`${inputClass} font-mono`} />
      </div>
      <div>
        <FieldLabel>Start command</FieldLabel>
        <FormInput name="startCommand" value={settings.startCommand} onChange={(event) => onChange({ startCommand: event.target.value })} placeholder="auto" variant="monochrome" className={`${inputClass} font-mono`} />
      </div>

      {settings.runtimeMode !== "worker" ? (
        <div>
          <FieldLabel>Static output</FieldLabel>
          <FormInput name="staticOutput" value={settings.staticOutput} onChange={(event) => onChange({ staticOutput: event.target.value })} placeholder="auto" variant="monochrome" className={inputClass} />
        </div>
      ) : (
        <input type="hidden" name="staticOutput" value={settings.staticOutput} />
      )}
    </>
  );
}
