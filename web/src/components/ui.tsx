"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Circle } from "@/lib/ajo";

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

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

const INKS = ["#25316e", "#b2402a", "#5d6b3a", "#9a6a1c", "#4a5560"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ address, size = 36, ring = false }: { address: string; size?: number; ring?: boolean }) {
  return (
    <span
      title={address}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] font-mono font-medium uppercase text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: INKS[hash(address) % INKS.length],
        outline: ring ? "1.5px solid var(--stamp)" : undefined,
        outlineOffset: ring ? 2 : undefined,
      }}
    >
      {address.slice(1, 3)}
    </span>
  );
}

const STATUS: Record<Circle["status"], { label: string; cls: string }> = {
  Open: { label: "Enrolling", cls: "text-ochre border-ochre" },
  Active: { label: "Running", cls: "text-indigo border-indigo" },
  Completed: { label: "Settled", cls: "text-stamp border-stamp" },
};

export function StatusBadge({ status }: { status: Circle["status"] }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-block rounded-[2px] border-[1.5px] px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export function Progress({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "gold" }) {
  const n = Math.max(1, max);
  return (
    <div className="flex h-1.5 gap-[2px]" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={`flex-1 ${i < value ? (tone === "gold" ? "bg-ochre" : "bg-ink") : "bg-line"}`}
        />
      ))}
    </div>
  );
}

export function Score({ score }: { score: number | null }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="figure text-6xl leading-none">{score === null ? "—" : score}</span>
      {score !== null && <span className="font-mono text-xs text-muted">/100</span>}
    </div>
  );
}

export function Alert({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" }) {
  const t =
    tone === "error" ? "border-stamp text-stamp" : tone === "success" ? "border-indigo text-indigo" : "border-ink-2";
  return <div className={`break-words border-l-2 bg-paper-2/60 px-4 py-3 text-sm ${t}`}>{children}</div>;
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--ink)" strokeWidth="1.2" />
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={16 + Math.cos(a) * 11}
            cy={16 + Math.sin(a) * 11}
            r={i === 0 ? 3 : 2.2}
            fill={i === 0 ? "var(--stamp)" : "var(--ink)"}
          />
        );
      })}
    </svg>
  );
}

export type Cell = { state: "pot" | "paid" | "due" | "empty"; turn?: boolean };

function CellMark({ cell }: { cell: Cell }) {
  if (cell.state === "pot")
    return (
      <span className="inline-flex h-8 w-8 -rotate-12 items-center justify-center rounded-full border-[1.5px] border-stamp font-mono text-[8px] font-medium tracking-[0.1em] text-stamp">
        POT
      </span>
    );
  if (cell.state === "paid")
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-label="paid" className="text-indigo">
        <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (cell.state === "due")
    return cell.turn ? (
      <span
        aria-label="due, receives pot"
        className="inline-block h-8 w-8 rounded-full border-[1.5px] border-dashed border-stamp"
      />
    ) : (
      <span aria-label="due" className="inline-block h-4 w-4 rounded-[2px] border border-dashed border-muted" />
    );
  return <span className="text-line">·</span>;
}

export function Passbook({
  rows,
  rounds,
  current = null,
  cells,
  end,
}: {
  rows: { key: string; label: ReactNode }[];
  rounds: number;
  current?: number | null;
  cells: Cell[][];
  end?: ReactNode[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink/70">
            <th className="sticky left-0 z-10 bg-card py-2 pr-4 text-left font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-muted">
              Member
            </th>
            {Array.from({ length: rounds }, (_, r) => (
              <th
                key={r}
                className={`w-12 py-2 text-center font-mono text-[10px] font-normal tracking-[0.08em] ${
                  r === current ? "bg-paper-2 text-ink" : "text-muted"
                }`}
              >
                {String(r + 1).padStart(2, "0")}
              </th>
            ))}
            {end && (
              <th className="py-2 pl-4 text-left font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-muted">
                Note
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key} className="border-b border-line last:border-b-0">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-card py-2.5 pr-4">{row.label}</td>
              {Array.from({ length: rounds }, (_, r) => (
                <td key={r} className={`h-12 text-center align-middle ${r === current ? "bg-paper-2" : ""}`}>
                  <span className="inline-flex items-center justify-center">
                    <CellMark cell={cells[i]?.[r] ?? { state: "empty" }} />
                  </span>
                </td>
              ))}
              {end && (
                <td className="whitespace-nowrap py-2.5 pl-4 font-mono text-[11px] text-muted">{end[i]}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
