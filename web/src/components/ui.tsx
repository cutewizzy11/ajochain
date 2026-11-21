"use client";

import { useEffect, useState } from "react";
import type { Circle } from "@/lib/ajo";

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function hue(addr: string) {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return h;
}

/** Deterministic, colourful avatar for a Stellar address. */
export function Avatar({ address, size = 36, ring = false }: { address: string; size?: number; ring?: boolean }) {
  const h = hue(address);
  return (
    <span
      title={address}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-mono font-semibold text-white ${
        ring ? "ring-2 ring-gold ring-offset-2 ring-offset-surface" : ""
      }`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        background: `linear-gradient(135deg, hsl(${h} 60% 42%), hsl(${(h + 50) % 360} 65% 32%))`,
      }}
    >
      {address.slice(1, 3)}
    </span>
  );
}

export function StatusBadge({ status }: { status: Circle["status"] }) {
  const s = {
    Active: "bg-brand-soft text-brand",
    Open: "bg-gold-soft text-gold",
    Completed: "bg-surface-2 text-muted",
  }[status];
  const label = { Active: "Active", Open: "Filling up", Completed: "Completed" }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "Active" ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function Progress({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "gold" }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full transition-all duration-700 ${tone === "gold" ? "bg-gold" : "bg-brand"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ScoreRing({ score, size = 96 }: { score: number | null; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = score ?? 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="-rotate-90" width={size} height={size}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={pct >= 80 ? "var(--brand)" : "var(--gold)"}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums">{score === null ? "—" : score}</span>
        {score !== null && <span className="text-[10px] uppercase tracking-wider text-muted">score</span>}
      </div>
    </div>
  );
}

export function Alert({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "error" | "success" }) {
  const s = {
    info: "border-line bg-surface-2",
    error: "border-danger/30 bg-danger-soft text-danger",
    success: "border-brand/30 bg-brand-soft text-brand",
  }[tone];
  return <div className={`rounded-xl border px-4 py-3 text-sm break-words ${s}`}>{children}</div>;
}

/** Re-renders every second; returns the current unix time in seconds. */
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function formatDuration(secs: number) {
  if (secs <= 0) return "now";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function Logo({ size = 28 }: { size?: number }) {
  // Ring of members around a pot: the ajo circle.
  const dots = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return [16 + Math.cos(a) * 11, 16 + Math.sin(a) * 11];
  });
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeDasharray="2 3" />
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" fill={i === 0 ? "var(--gold)" : "var(--brand)"} />
      ))}
      <circle cx="16" cy="16" r="4.5" fill="var(--gold)" />
    </svg>
  );
}
