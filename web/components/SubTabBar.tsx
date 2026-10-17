"use client";

import type { ReactNode } from "react";
import { pct, shortName } from "@/lib/format";
import { useStore, type State } from "@/lib/store";
import type { Layer } from "@/lib/types";

const LAYERS: { id: Layer; label: string; hint: string }[] = [
  { id: "raw", label: "Raw", hint: "Actual revenue / target" },
  { id: "adjusted", label: "Adjusted", hint: "(Actual + non-controllable loss) / revenue expected from territory potential" },
  { id: "bivariate", label: "Performance × Capacity", hint: "Adjusted attainment × team capacity" },
];
const INBOX_VIEWS: { id: State["inboxView"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending approval" },
  { id: "alerts", label: "Alerts" },
  { id: "audit", label: "Audit log" },
];

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function Segmented<T extends string>({ items, value, onChange, label }: {
  items: { id: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="flex rounded-2xl bg-[#f3f4f8] p-1" role="radiogroup" aria-label={label}>
      {items.map((i) => (
        <button
          key={i.id}
          role="radio"
          aria-checked={value === i.id}
          title={i.hint}
          onClick={() => onChange(i.id)}
          className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-medium transition ${value === i.id ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-ink"}`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

function Breadcrumb() {
  const { s, d } = useStore();
  const m = s.m!;
  const sel = s.selection;
  const prov = sel.kode?.split(".")[0];
  const reg = sel.level === "regency" || sel.level === "desa" ? sel.kode!.split(".").slice(0, 2).join(".") : null;
  const trail = [
    ...(prov ? [{ label: m.provinces[prov]?.name ?? prov, go: () => d({ type: "SELECT", selection: { level: "province", kode: prov } }) }] : []),
    ...(reg ? [{ label: shortName(m.regencies[reg]?.name ?? reg), go: () => d({ type: "SELECT", selection: { level: "regency", kode: reg } }) }] : []),
    ...(sel.level === "desa" ? [{ label: `Village ${s.desa.find((x) => x.kode === sel.kode)?.name ?? ""}`, go: () => {} }] : []),
  ];
  const national = s.layer === "raw" ? m.national.raw : m.national.adj;
  return (
    <nav className="flex min-w-0 items-center gap-2.5" aria-label="Breadcrumb">
      <span className="text-slate-500"><Icon size={20}><path d="M10 17s5.5-4.7 5.5-9A5.5 5.5 0 0 0 4.5 8c0 4.3 5.5 9 5.5 9z" /><circle cx="10" cy="8" r="1.9" /></Icon></span>
      <button
        onClick={() => d({ type: "SELECT", selection: { level: "national", kode: null } })}
        className={`rounded px-0.5 text-sm hover:underline ${trail.length ? "text-slate-600" : "font-bold text-ink"}`}
      >
        Indonesia
      </button>
      <span className="rounded-lg bg-[#f3f4f8] px-2.5 py-1 text-sm font-bold tabular-nums text-ink" title={`National ${s.layer === "raw" ? "raw" : "adjusted"} attainment`}>{pct(national)}</span>
      {trail.map((c, i) => (
        <span key={c.label} className="flex min-w-0 items-center gap-2.5">
          <span className="text-slate-500"><Icon size={16}><path d="M7.5 5l5 5-5 5" /></Icon></span>
          <button onClick={c.go} className={`truncate rounded px-0.5 hover:underline ${i === trail.length - 1 ? "text-lg font-bold text-ink" : "text-sm text-slate-600"}`}>{c.label}</button>
        </span>
      ))}
    </nav>
  );
}

const ACTION = "flex items-center gap-2 whitespace-nowrap rounded-2xl border px-3.5 py-2 text-[13px] font-medium transition disabled:opacity-40";

export default function SubTabBar() {
  const { s, d } = useStore();
  if (!s.m) return null;
  const mode = s.tab === "inbox"
    ? `Inbox: ${INBOX_VIEWS.find((v) => v.id === s.inboxView)?.label}`
    : `Mode: ${LAYERS.find((l) => l.id === s.layer)?.label}`;

  return (
    <div className="pointer-events-auto max-w-full overflow-hidden rounded-[28px] border border-line/80 bg-white/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-5 py-2.5">
        <Breadcrumb />
        <span className="shrink-0 rounded-xl bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand">{mode}</span>
      </div>
      <div className="border-t border-line" />
      <div className="flex items-center gap-4 p-2.5">
        {s.tab === "inbox" ? (
          <Segmented label="Inbox filter" items={INBOX_VIEWS} value={s.inboxView} onChange={(view) => d({ type: "INBOX_VIEW", view })} />
        ) : (
          <Segmented label="Map layer" items={LAYERS} value={s.layer} onChange={(layer) => d({ type: "LAYER", layer })} />
        )}

        <span className="h-9 w-px bg-line" aria-hidden="true" />

        <div className="flex items-center gap-2.5">
          <button onClick={() => d({ type: "RUN_DIGEST" })} disabled={s.digestRun} className={`${ACTION} border-line bg-white text-ink hover:bg-slate-50`}>
            <Icon><path d="M5.5 3h6l3.5 3.5V16a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M11 3v4h4" /><path d="M7 10.5h6M7 13.5h6" /></Icon>
            07:00 digest
          </button>
          <button onClick={() => d({ type: "INJECT" })} disabled={s.injected} className={`${ACTION} border-brand/25 bg-brand-soft text-brand hover:bg-brand/15`}>
            <Icon><path d="M11.5 2.5L4.5 11h4.5l-1 6.5 7-8.5H10z" /></Icon>
            Inject event
          </button>
          <button onClick={() => d({ type: "ADVANCE", hours: 4 })} className={`${ACTION} border-line bg-white text-ink hover:bg-slate-50`}>
            <Icon><path d="M3.5 5l6 5-6 5z" /><path d="M10.5 5l6 5-6 5z" /></Icon>
            +4 hours
          </button>
        </div>
      </div>
    </div>
  );
}
