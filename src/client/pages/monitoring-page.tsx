import { Link } from "@tanstack/react-router";
import {
  ArrowDataTransferHorizontalIcon,
  ArrowLeft01Icon,
  ContainerIcon,
  CpuIcon,
  HardDriveIcon,
  PulseRectangleIcon,
  RamMemoryIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { type MonitoringSnapshot } from "../api";
import { BrandMark } from "../components/ui/brand-mark";
import { AppIcon } from "../components/ui/primitives";
import { usePageTitle } from "../lib/page-title";

const HISTORY_LENGTH = 60;
const TEAL = "#4FB8B2";
const PINK = "#E93D82";
const AMBER = "#F5A524";
const VIOLET = "#7871FF";

type Series = number[];

function pushSample(series: Series, value: number): Series {
  const next = [...series, value];
  return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next;
}

function formatBytes(bytes: number, fractionDigits = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${units[exponent]}`;
}

function bytesToMb(bytes: number): number {
  return bytes / 1024 ** 2;
}

function Sparkline({
  data,
  color,
  fill = true,
  max,
}: {
  data: Series;
  color: string;
  fill?: boolean;
  max?: number;
}) {
  const width = 600;
  const height = 160;
  if (data.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none">
        <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-zinc-600 font-mono text-[14px]">
          collecting samples…
        </text>
      </svg>
    );
  }

  const peak = max ?? Math.max(...data, 1);
  const stepX = width / (HISTORY_LENGTH - 1);
  const offset = (HISTORY_LENGTH - data.length) * stepX;
  const points = data.map((value, index) => {
    const x = offset + index * stepX;
    const y = height - (Math.min(value, peak) / peak) * (height - 8) - 4;
    return [x, y] as const;
  });

  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)![0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  const gradientId = `grad-${color.replace("#", "")}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1={0}
          x2={width}
          y1={height * ratio}
          y2={height * ratio}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={1}
        />
      ))}
      {fill ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Donut({ segments, centerLabel, centerValue }: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 70;
  const stroke = 26;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 180 180" className="h-44 w-44 -rotate-90">
        <circle cx={90} cy={90} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        {total > 0
          ? segments.map((segment) => {
              const fraction = segment.value / total;
              const dash = fraction * circumference;
              const element = (
                <circle
                  key={segment.label}
                  cx={90}
                  cy={90}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-consumed}
                />
              );
              consumed += dash;
              return element;
            })
          : null}
        <g className="rotate-90" transform="rotate(90 90 90)">
          <text x={90} y={84} textAnchor="middle" className="fill-zinc-100 font-hero text-[20px]">
            {centerValue}
          </text>
          <text x={90} y={104} textAnchor="middle" className="fill-zinc-500 font-mono text-[9px] uppercase tracking-[0.2em]">
            {centerLabel}
          </text>
        </g>
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {segments.map((segment) => (
          <div key={segment.label} className="inline-flex items-center gap-2 font-mono text-[11px] text-zinc-400">
            <span className="h-2.5 w-2.5" style={{ backgroundColor: segment.color }} />
            {segment.label}
            <span className="text-zinc-600">{formatBytes(segment.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MeterBar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden bg-white/5">
      <div
        className="h-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function Card({
  icon,
  title,
  meta,
  children,
}: {
  icon: unknown;
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border border-zinc-800/90 bg-zinc-950/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center border border-[#4FB8B2]/30 bg-[#4FB8B2]/10 text-[#4FB8B2]">
            <AppIcon icon={icon} size={16} />
          </div>
          <div>
            <div className="font-hero text-sm tracking-tight text-zinc-100">{title}</div>
            <div className="font-mono text-[11px] text-zinc-500">{meta}</div>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex items-center justify-center gap-4">
      {items.map((item) => (
        <div key={item.label} className="inline-flex items-center gap-2 font-mono text-[11px] text-zinc-400">
          <span className="h-2.5 w-2.5" style={{ backgroundColor: item.color }} />
          {item.label}
        </div>
      ))}
    </div>
  );
}

export function MonitoringPage() {
  usePageTitle("Monitoring");

  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const [cpuHistory, setCpuHistory] = useState<Series>([]);
  const [memHistory, setMemHistory] = useState<Series>([]);
  const [diskHistory, setDiskHistory] = useState<Series>([]);
  const [blockReadHistory, setBlockReadHistory] = useState<Series>([]);
  const [blockWriteHistory, setBlockWriteHistory] = useState<Series>([]);
  const [netInHistory, setNetInHistory] = useState<Series>([]);
  const [netOutHistory, setNetOutHistory] = useState<Series>([]);

  const lastBlock = useRef<{ read: number; write: number } | null>(null);
  const lastNet = useRef<{ in: number; out: number } | null>(null);

  useEffect(() => {
    const events = new EventSource("/api/system/monitoring/stream");

    events.addEventListener("sample", (event) => {
      const sample = JSON.parse((event as MessageEvent).data) as MonitoringSnapshot;
      setSnapshot(sample);
      setConnected(true);
      setError("");

      setCpuHistory((current) => pushSample(current, sample.cpu.usagePercent));
      setMemHistory((current) => pushSample(current, bytesToMb(sample.memory.usedBytes) / 1024));
      if (sample.disk) {
        setDiskHistory((current) => pushSample(current, bytesToMb(sample.disk!.usedBytes) / 1024));
      }

      // Block / network IO are cumulative totals; chart the per-interval delta in MB.
      const block = { read: bytesToMb(sample.blockIO.readBytes), write: bytesToMb(sample.blockIO.writeBytes) };
      if (lastBlock.current) {
        setBlockReadHistory((current) => pushSample(current, Math.max(0, block.read - lastBlock.current!.read)));
        setBlockWriteHistory((current) => pushSample(current, Math.max(0, block.write - lastBlock.current!.write)));
      }
      lastBlock.current = block;

      const net = { in: bytesToMb(sample.networkIO.inBytes), out: bytesToMb(sample.networkIO.outBytes) };
      if (lastNet.current) {
        setNetInHistory((current) => pushSample(current, Math.max(0, net.in - lastNet.current!.in)));
        setNetOutHistory((current) => pushSample(current, Math.max(0, net.out - lastNet.current!.out)));
      }
      lastNet.current = net;
    });

    events.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as { ok: boolean; detail?: string };
      if (!status.ok) setError(status.detail ?? "Monitoring failed");
    });

    events.onerror = () => setConnected(false);

    return () => events.close();
  }, []);

  const memRatio = snapshot ? snapshot.memory.usedBytes / snapshot.memory.totalBytes : 0;
  const diskRatio = snapshot?.disk ? snapshot.disk.usedBytes / snapshot.disk.totalBytes : 0;
  const blockPeak = Math.max(...blockReadHistory, ...blockWriteHistory, 1);
  const netPeak = Math.max(...netInHistory, ...netOutHistory, 1);

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
      <div aria-hidden className="hero-noise pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_0%_0%,rgba(79,184,178,0.12),transparent),radial-gradient(ellipse_70%_50%_at_100%_100%,rgba(120,113,255,0.08),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:72px_72px]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pb-24 pt-14 sm:px-6 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/90 pb-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center border border-[#4FB8B2]/35 bg-[#4FB8B2]/10 text-[#4FB8B2]">
              <BrandMark />
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-600">Aeroplane registry</div>
              <div className="font-hero text-lg tracking-tight text-zinc-100">Monitoring</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-[#4FB8B2]" : "bg-zinc-600"}`} />
              {connected ? "Live" : "Connecting"}
            </div>
            <Link
              to="/"
              className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-800 bg-zinc-900/50 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <AppIcon icon={ArrowLeft01Icon} size={14} />
              Projects
            </Link>
          </div>
        </header>

        <div>
          <h1 className="font-hero text-2xl tracking-tight text-zinc-100">Server resources</h1>
          <p className="mt-1 font-mono text-sm text-zinc-500">Watch the live usage of the machine running Aeroplane.</p>
        </div>

        {error ? (
          <div className="border border-rose-500/35 bg-rose-950/30 px-4 py-3 font-mono text-xs text-rose-300">{error}</div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card
            icon={CpuIcon}
            title="CPU Usage"
            meta={snapshot ? `${snapshot.cpu.usagePercent.toFixed(2)}% · ${snapshot.cpu.cores} cores` : "—"}
          >
            <MeterBar ratio={(snapshot?.cpu.usagePercent ?? 0) / 100} color={VIOLET} />
            <Sparkline data={cpuHistory} color={VIOLET} max={100} />
            <Legend items={[{ label: "CPU %", color: VIOLET }]} />
          </Card>

          <Card
            icon={RamMemoryIcon}
            title="Memory Usage"
            meta={
              snapshot
                ? `${formatBytes(snapshot.memory.usedBytes)} / ${formatBytes(snapshot.memory.totalBytes)}`
                : "—"
            }
          >
            <MeterBar ratio={memRatio} color={PINK} />
            <Sparkline
              data={memHistory}
              color={PINK}
              max={snapshot ? bytesToMb(snapshot.memory.totalBytes) / 1024 : undefined}
            />
            <Legend items={[{ label: "Memory (GB)", color: PINK }]} />
          </Card>

          <Card
            icon={HardDriveIcon}
            title="Disk Space"
            meta={
              snapshot?.disk
                ? `${formatBytes(snapshot.disk.usedBytes)} / ${formatBytes(snapshot.disk.totalBytes)}`
                : "unavailable"
            }
          >
            <MeterBar ratio={diskRatio} color={AMBER} />
            <Sparkline
              data={diskHistory}
              color={AMBER}
              max={snapshot?.disk ? bytesToMb(snapshot.disk.totalBytes) / 1024 : undefined}
            />
            <Legend items={[{ label: "Disk (GB)", color: AMBER }]} />
          </Card>

          <Card
            icon={ContainerIcon}
            title="Docker Disk Usage"
            meta={snapshot ? `Total: ${formatBytes(snapshot.docker.totalBytes)}` : "—"}
          >
            <div className="flex flex-1 items-center justify-center py-2">
              {snapshot && snapshot.docker.available ? (
                <Donut
                  centerLabel="Docker usage"
                  centerValue={formatBytes(snapshot.docker.totalBytes)}
                  segments={[
                    { label: "Images", value: snapshot.docker.images, color: VIOLET },
                    { label: "Containers", value: snapshot.docker.containers, color: PINK },
                    { label: "Volumes", value: snapshot.docker.volumes, color: AMBER },
                    { label: "Build cache", value: snapshot.docker.buildCache, color: TEAL },
                  ]}
                />
              ) : (
                <span className="font-mono text-xs text-zinc-600">Docker is unavailable.</span>
              )}
            </div>
          </Card>

          <Card
            icon={PulseRectangleIcon}
            title="Block I/O"
            meta={
              snapshot
                ? `Read: ${formatBytes(snapshot.blockIO.readBytes)} · Write: ${formatBytes(snapshot.blockIO.writeBytes)}`
                : "—"
            }
          >
            <div className="relative h-40">
              <div className="absolute inset-0">
                <Sparkline data={blockReadHistory} color={VIOLET} fill={false} max={blockPeak} />
              </div>
              <div className="absolute inset-0">
                <Sparkline data={blockWriteHistory} color={PINK} fill={false} max={blockPeak} />
              </div>
            </div>
            <Legend items={[{ label: "Read (MB)", color: VIOLET }, { label: "Write (MB)", color: PINK }]} />
          </Card>

          <Card
            icon={ArrowDataTransferHorizontalIcon}
            title="Network I/O"
            meta={
              snapshot
                ? `In: ${formatBytes(snapshot.networkIO.inBytes)} · Out: ${formatBytes(snapshot.networkIO.outBytes)}`
                : "—"
            }
          >
            <div className="relative h-40">
              <div className="absolute inset-0">
                <Sparkline data={netInHistory} color={VIOLET} fill={false} max={netPeak} />
              </div>
              <div className="absolute inset-0">
                <Sparkline data={netOutHistory} color={PINK} fill={false} max={netPeak} />
              </div>
            </div>
            <Legend items={[{ label: "In (MB)", color: VIOLET }, { label: "Out (MB)", color: PINK }]} />
          </Card>
        </div>
      </div>
    </main>
  );
}
