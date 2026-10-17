"use client";

import { hhmm, pct } from "@/lib/format";
import { MAX_INTERRUPTS_PER_DAY, peopleIndex } from "@/lib/proactive";
import { useStore } from "@/lib/store";
import { Card, Pill } from "./ui";

const STATUS_TONE = {
  notified: "red", acked: "amber", action_proposed: "blue", approved: "green", escalated: "violet", resolved: "slate",
} as const;
const STATUS_LABEL = {
  notified: "sent", acked: "acknowledged", action_proposed: "plan proposed", approved: "approved", escalated: "escalated", resolved: "resolved / rerouted",
} as const;

function minutes(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export default function InboxPanel() {
  const { s, d } = useStore();
  const m = s.m!;
  const people = peopleIndex(m);
  const name = (id: string) => people[id]?.name ?? id;

  const p1 = s.alerts.filter((a) => a.tier === "P1");
  const acked = p1.filter((a) => a.status !== "notified" && a.status !== "escalated").length;
  const approved = s.plans.filter((p) => p.status === "approved");
  const tta = approved
    .map((p) => { const a = s.alerts.find((x) => x.id === p.alertId); const done = s.audit.find((x) => x.action === "plan_approved" && x.detail.startsWith(p.title)); return a && done ? minutes(a.createdAt, done.time) : null; })
    .filter((x): x is number => x !== null);
  const perPerson: Record<string, number> = {};
  for (const msg of s.phone) if (msg.tier === "P1") perPerson[msg.to] = (perPerson[msg.to] ?? 0) + 1;
  const maxInterrupts = Math.max(0, ...Object.values(perPerson));
  const wrongRed = Object.entries(m.units).filter(([k, u]) => k.startsWith("BR") && u.raw < 95 && u.adj >= 97).length;
  const pending = s.plans.filter((p) => p.status === "pending");
  const show = (section: "pending" | "alerts" | "audit") => s.inboxView === "all" || s.inboxView === section;

  return (
    <div className="scroll-thin h-full space-y-3 overflow-y-auto p-3">
      {s.inboxView === "all" && <Card title="Impact (demo simulation)">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Metric label="P1 alerts acknowledged" value={p1.length ? `${acked}/${p1.length}` : "–"} />
          <Metric label="Alert → approved action" value={tta.length ? `${Math.min(...tta)} min` : "–"} hint="manual: weekly review (days)" />
          <Metric label="Max interruptions / person / day" value={`${maxInterrupts} / ${MAX_INTERRUPTS_PER_DAY}`} />
          <Metric label="Branches wrongly red without adjustment" value={`${wrongRed} / 38`} />
          <Metric label="Plans approved" value={`${approved.length}`} />
          <Metric label="Active tasks on the map" value={`${s.tasks.filter((t) => t.status === "open").length}`} />
        </div>
      </Card>}

      {show("pending") && <Card title={`Pending approval (${pending.length})`}>
        {pending.length === 0 && <p className="text-xs text-muted">None.</p>}
        {pending.map((p) => (
          <div key={p.id} className="mb-2 rounded-lg border border-line p-2">
            <div className="text-xs font-semibold">{p.title}</div>
            <div className="text-[11px] text-muted">{p.rationale}</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11.5px]">
              {p.items.map((i) => <li key={i.id}>{i.text} <span className="text-muted">— {i.owner}, {i.due}{i.needsApprovalFrom ? `, approval: ${i.needsApprovalFrom}` : ""}</span></li>)}
            </ol>
            {s.persona === p.approver ? (
              <div className="mt-2 flex gap-2">
                <button onClick={() => d({ type: "DECIDE_PLAN", planId: p.id, approve: true })} className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-strong">Approve</button>
                <button onClick={() => d({ type: "DECIDE_PLAN", planId: p.id, approve: false })} className="rounded-full border border-line px-3 py-1 text-xs">Reject</button>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-muted">Waiting for approval from {name(p.approver)} (switch persona to approve).</p>
            )}
          </div>
        ))}
      </Card>}

      {show("alerts") && <Card title={`Alerts (${s.alerts.length})`}>
        {s.alerts.length === 0 && <p className="text-xs text-muted">None yet. Run “07:00 digest” or “Inject event”.</p>}
        {s.alerts.map((a) => (
          <div key={a.id} className="border-t border-line py-1.5 text-xs first:border-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.title}</span>
              <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
            </div>
            <div className="text-[11px] text-muted">
              {hhmm(a.createdAt)} → {name(a.recipient)}{a.escalatedTo ? ` ⏫ ${name(a.escalatedTo)}` : ""}{a.answer ? ` · answer: ${a.answer}` : ""}
            </div>
          </div>
        ))}
      </Card>}

      {show("audit") && <Card title="Audit log">
        {s.audit.length === 0 && <p className="text-xs text-muted">Empty.</p>}
        {s.audit.map((x) => (
          <div key={x.id} className="border-t border-line py-1 text-[11px] first:border-0">
            <span className="tabular-nums text-muted">{hhmm(x.time)}</span> <b>{x.actor}</b> · {x.action} · {x.detail}
          </div>
        ))}
      </Card>}
      <p className="pb-2 text-[10px] text-muted">Proactive rules (deterministic): at most {MAX_INTERRUPTS_PER_DAY} P1 interruptions per person per day, a single escalation after 4 hours without acknowledgement, alerts only go to the role that can act. National raw attainment {pct(m.national.raw)}.</p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}
