"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { liveClock } from "@/lib/format";
import { peopleIndex } from "@/lib/proactive";
import { useStore, type State } from "@/lib/store";

const TABS: { id: State["tab"]; label: string }[] = [
  { id: "map", label: "Performance Map" },
  { id: "detail", label: "Territory Details" },
  { id: "inbox", label: "Inbox & Actions" },
];

export default function TopBar() {
  const { s, d } = useStore();
  const people = s.m ? peopleIndex(s.m) : {};
  const personas = s.m?.personas.filter((p) => ["RGM", "BM", "CSM"].includes(p.role_id)) ?? [];
  const pending = s.plans.filter((p) => p.status === "pending").length + s.alerts.filter((a) => a.status === "notified" || a.status === "escalated").length;

  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
      <div className="flex items-center gap-2.5">
        <Image src="/brand/overfit-squad-256.webp" alt="Overfit Squad" width={44} height={44} priority unoptimized className="h-11 w-11" />
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight">Territory Performance Copilot</div>
          <div className="text-[11px] text-muted">by <span className="font-semibold text-brand">Overfit Squad</span> · PT Nusantara Seluler (fictional)</div>
        </div>
      </div>

      <nav className="flex rounded-full border border-line bg-white p-1" role="tablist" aria-label="Main menu">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={s.tab === t.id}
            onClick={() => d({ type: "TAB", tab: t.id })}
            className={`flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition ${
              s.tab === t.id ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-brand-soft hover:text-brand-strong"
            }`}
          >
            {t.label}
            {t.id === "inbox" && pending > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] ${s.tab === t.id ? "bg-white text-brand" : "bg-brand text-white"}`}>{pending}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex items-center justify-end gap-3">
        <LiveClock />
        <ProfileMenu />
      </div>
    </header>
  );
}

/** Profile icon; click to see who you are signed in as and switch persona. */
function ProfileMenu() {
  const { s, d } = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const people = s.m ? peopleIndex(s.m) : {};
  const personas = s.m?.personas.filter((p) => ["RGM", "BM", "CSM"].includes(p.role_id)) ?? [];
  const current = people[s.persona];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profile: ${current?.name ?? "not signed in"}`}
        title={current ? `Signed in as ${current.name}` : "Profile"}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-slate-600 transition hover:border-brand/40 hover:bg-brand-soft hover:text-brand-strong ${open ? "border-brand/40 bg-brand-soft text-brand-strong" : "border-line bg-white"}`}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="7" r="3.2" /><path d="M3.8 16.5c.6-3 3-4.6 6.2-4.6s5.6 1.6 6.2 4.6" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label="Signed in as" className="absolute right-0 top-full z-50 mt-2 w-[300px] rounded-2xl border border-line bg-white p-1.5 shadow-xl">
          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Signed in as</div>
          {personas.map((p) => {
            const active = p.employee_id === s.persona;
            return (
              <button
                key={p.employee_id}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { d({ type: "PERSONA", id: p.employee_id }); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-brand-soft ${active ? "bg-brand-soft/60" : ""}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
                  {p.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-semibold">{p.full_name}</span>
                  <span className="block truncate text-[11px] text-muted">{people[p.employee_id]?.role}</span>
                </span>
                {active && <span className="text-brand" aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Real time in the viewer's timezone, ticking every second. Empty until mounted to avoid a server/client mismatch. */
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="min-w-[178px] whitespace-nowrap text-right text-sm font-medium tabular-nums text-slate-600" title="Your local time">
      {now ? liveClock(now) : "\u00a0"}
    </span>
  );
}
