import type { ReactNode } from "react";
import { attainmentCss } from "@/lib/colors";
import { pct } from "@/lib/format";

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-3">
      {title && (
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function AttBadge({ v, label }: { v: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg border border-line px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: attainmentCss(v) }} />
        <span className="text-xl font-semibold tabular-nums">{pct(v)}</span>
      </div>
    </div>
  );
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "red" | "green" | "amber" | "blue" | "violet" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    red: "bg-red-50 text-red-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

/** Horizontal stacked bar: how the gap vs target splits into its causes. */
export function GapBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const pos = parts.map((p) => ({ ...p, value: Math.max(0, p.value) }));
  const total = pos.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return <p className="text-xs text-muted">Tidak ada gap terhadap target.</p>;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {pos.map((p) => (
          <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {pos.map((p) => (
          <div key={p.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.label}</span>
            <span className="tabular-nums text-muted">{Math.round((p.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ series }: { series: { period: string; raw: number; adj: number }[] }) {
  const w = 300, h = 64, pad = 4;
  const vals = series.flatMap((x) => [x.raw, x.adj]);
  const lo = Math.min(85, ...vals), hi = Math.max(110, ...vals);
  const x = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
  const path = (k: "raw" | "adj") => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" role="img" aria-label="Tren attainment 13 bulan">
      <line x1={pad} x2={w - pad} y1={y(100)} y2={y(100)} stroke="#cbd5e1" strokeDasharray="3 3" />
      <path d={path("raw")} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
      <path d={path("adj")} fill="none" stroke="#0f172a" strokeWidth={2} />
    </svg>
  );
}
