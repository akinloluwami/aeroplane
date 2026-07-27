import { HugeiconsIcon } from "@hugeicons/react";
import { Globe02Icon, ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { ReactNode, forwardRef, useState } from "react";
import type { Framework } from "../../api";
import { frameworkIconClassName } from "./framework-icon-colors";

export function AppIcon({ icon, className = "", size = 18 }: { icon: unknown; className?: string; size?: number }) {
  return <HugeiconsIcon icon={icon as never} size={size} strokeWidth={1.7} className={className} />;
}

export function surfaceClass(extra = "") {
  return `border border-zinc-700/90 bg-zinc-900/98 shadow-[0_24px_80px_rgba(0,0,0,0.35)] ${extra}`.trim();
}

export function shellButton(variant: "primary" | "secondary" | "ghost" | "danger" = "secondary") {
  const base = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap px-3.5 py-2.5 text-center font-mono text-[11px] font-semibold uppercase leading-none tracking-normal transition disabled:opacity-60";

  if (variant === "primary") {
    return `${base} border border-[#4FB8B2]/45 bg-[#4FB8B2]/15 text-[#7fe3dd] hover:bg-[#4FB8B2]/25`;
  }
  if (variant === "danger") {
    return `${base} border border-rose-500/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15`;
  }
  if (variant === "ghost") {
    return `${base} px-3 text-zinc-300 hover:bg-zinc-800 hover:text-white`;
  }
  return `${base} border border-zinc-800 bg-zinc-900/70 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900`;
}

export function chipClass(active: boolean) {
  return active
    ? "inline-flex items-center gap-2 border border-[#4FB8B2]/40 bg-[#4FB8B2]/14 px-3 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7fe3dd]"
    : "inline-flex items-center gap-2 border border-zinc-700 bg-zinc-900/90 px-3 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white";
}

export function statusClass(status: string) {
  if (status === "current") return "border border-violet-500/35 bg-violet-500/12 text-violet-200";
  if (status === "active" || status === "running" || status === "deployed" || status === "success") return "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "crashed") return "border border-orange-500/30 bg-orange-500/10 text-orange-300";
  if (status === "failed") return "border border-rose-500/30 bg-rose-500/10 text-rose-300";
  if (status === "aborted") return "border border-zinc-600 bg-zinc-800/80 text-zinc-200";
  if (status === "degraded") return "border border-orange-500/30 bg-orange-500/10 text-orange-300";
  if (status === "building" || status === "queued") return "border border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border border-zinc-700 bg-zinc-800/80 text-zinc-300";
}

export function StatusPill({ status }: { status: string }) {
  const label = status === "deployed" ? "deployed" : status;
  return <span className={`px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${statusClass(status)}`}>{label}</span>;
}

export function deploymentCardClass(status: string, selected: boolean) {
  if (selected) {
    if (status === "current") return "border-violet-500/40 bg-violet-950/25 text-violet-100";
    if (status === "crashed") return "border-orange-500/40 bg-orange-950/30 text-orange-100";
    if (status === "failed") return "border-rose-500/40 bg-rose-950/35 text-rose-100";
    if (status === "aborted") return "border-zinc-600 bg-zinc-800/90 text-zinc-100";
    if (status === "building" || status === "queued") return "border-amber-500/40 bg-amber-950/25 text-amber-100";
    if (status === "active" || status === "running" || status === "deployed" || status === "success") return "border-emerald-500/35 bg-emerald-950/25 text-emerald-100";
    return "border-[#4FB8B2]/35 bg-[#4FB8B2]/10 text-zinc-50";
  }

  return "border-zinc-700 bg-zinc-900/90 text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800/95";
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400">{children}</span>;
}

export const FormInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = props.type === "password";

    if (isPassword) {
      return (
        <div className="relative flex w-full items-center">
          <input
            {...props}
            type={showPassword ? "text" : "password"}
            ref={ref}
            className={`h-11 w-full border border-zinc-700 bg-zinc-900 px-3 pr-11 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-[#4FB8B2]/60 ${props.className ?? ""}`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 text-zinc-400 transition hover:text-zinc-200"
            title={showPassword ? "Hide text" : "Show text"}
          >
            <AppIcon icon={showPassword ? ViewOffSlashIcon : ViewIcon} size={16} />
          </button>
        </div>
      );
    }

    return (
      <input
        {...props}
        ref={ref}
        className={`h-11 w-full border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-[#4FB8B2]/60 ${props.className ?? ""}`}
      />
    );
  }
);

export function SectionTitle({ icon, title, meta }: { icon: unknown; title: string; meta?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 place-items-center border border-[#4FB8B2]/35 bg-[#4FB8B2]/10 text-[#7fe3dd]">
        <AppIcon icon={icon} size={18} />
      </div>
      <div>
        <h2 className="font-hero text-lg tracking-tight text-zinc-100">{title}</h2>
        {meta ? <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">{meta}</p> : null}
      </div>
    </div>
  );
}

export function BrowserIconFallback({ className = "", size = 17 }: { className?: string; size?: number }) {
  return <AppIcon icon={Globe02Icon} size={size} className={className} />;
}

export function FrameworkMark({
  framework,
  fallback,
  size = 18
}: {
  framework: Framework | null;
  fallback?: ReactNode;
  size?: number;
}) {
  if (framework?.logoUrl) {
    return (
      <img
        src={framework.logoUrl}
        alt={framework.name}
        className={`shrink-0 object-contain ${frameworkIconClassName(framework.slug)}`.trim()}
        loading="lazy"
        style={{ height: size, width: size }}
      />
    );
  }

  return <>{fallback ?? <BrowserIconFallback size={size} />}</>;
}

export function FrameworkBadge({ framework, fallbackLabel = "Service" }: { framework: Framework | null; fallbackLabel?: string }) {
  return (
    <div className="inline-flex items-center gap-2 border border-zinc-800 bg-zinc-900/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
      <div className="grid h-3.5 w-3.5 place-items-center overflow-hidden">
        <FrameworkMark framework={framework} size={14} fallback={<BrowserIconFallback size={14} />} />
      </div>
      {framework?.name ?? fallbackLabel}
    </div>
  );
}

export function InfoRow({ icon, label }: { icon: unknown | ((props: { className?: string; size?: number }) => ReactNode); label: string }) {
  return (
    <div className="flex items-center gap-3 border border-zinc-700 bg-zinc-900/85 px-3 py-3 text-sm text-zinc-200">
      {typeof icon === "function" ? icon({ size: 17 }) : <AppIcon icon={icon} size={17} />}
      <span className="truncate">{label}</span>
    </div>
  );
}
