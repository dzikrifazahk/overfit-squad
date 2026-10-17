"use client";

import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import { pct } from "./format";
import { causeOf, digestText, draftPlan, ESCALATION_HOURS, MAX_INTERRUPTS_PER_DAY, morningP1s, peopleIndex } from "./proactive";
import type {
  AgentReply, Alert, AuditEntry, ChatMessage, DesaPoint, Doc, Layer, Metrics, PhoneAction, PhoneMessage, Plan, Selection, Task,
} from "./types";

export type State = {
  m: Metrics | null;
  desa: DesaPoint[];
  docs: Doc[];
  persona: string;
  now: string;
  layer: Layer;
  selection: Selection;
  highlight: string[];
  tab: "map" | "detail" | "inbox" | "guide";
  inboxView: "all" | "pending" | "alerts" | "audit";
  chatOpen: boolean;
  chat: ChatMessage[];
  alerts: Alert[];
  plans: Plan[];
  tasks: Task[];
  phone: PhoneMessage[];
  audit: AuditEntry[];
  seq: number;
  digestRun: boolean;
  injected: boolean;
  chatBusy: boolean;
  agentSource: "adk" | "mock" | null;
};

export type Action =
  | { type: "LOAD"; m: Metrics; desa: DesaPoint[]; docs: Doc[] }
  | { type: "PERSONA"; id: string }
  | { type: "LAYER"; layer: Layer }
  | { type: "SELECT"; selection: Selection }
  | { type: "TAB"; tab: State["tab"] }
  | { type: "INBOX_VIEW"; view: State["inboxView"] }
  | { type: "CHAT_OPEN"; open: boolean }
  | { type: "CHAT_USER"; text: string }
  | { type: "CHAT_AGENT"; reply: AgentReply }
  | { type: "STREAM_START" }
  | { type: "STREAM_STATUS"; text: string }
  | { type: "STREAM_DELTA"; text: string }
  | { type: "STREAM_MAP"; map: NonNullable<AgentReply["map"]> }
  | { type: "STREAM_DONE"; reply: AgentReply }
  | { type: "CHAT_ERROR"; text: string }
  | { type: "RUN_DIGEST" }
  | { type: "INJECT" }
  | { type: "ADVANCE"; hours: number }
  | { type: "PHONE"; msgId: string; action: PhoneAction }
  | { type: "PROPOSE_PLAN"; clusterId: string }
  | { type: "DECIDE_PLAN"; planId: string; approve: boolean };

const START = "2026-10-17T06:55:00+07:00";

export const initialState: State = {
  m: null, desa: [], docs: [], persona: "", now: START, layer: "adjusted",
  selection: { level: "national", kode: null }, highlight: [], tab: "map", inboxView: "all", chatOpen: true,
  chat: [], alerts: [], plans: [], tasks: [], phone: [], audit: [], seq: 0,
  digestRun: false, injected: false, chatBusy: false, agentSource: null,
};

const iso = (d: Date) => d.toISOString();
const addHours = (s: string, h: number) => iso(new Date(new Date(s).getTime() + h * 3600e3));

function interruptsToday(s: State, to: string) {
  return s.phone.filter((p) => p.to === to && p.tier === "P1").length;
}

function clusterCentroid(s: State, clusterId: string): [number, number] {
  const c = s.m!.clusters[clusterId];
  const pts = s.desa.filter((d) => c.regencies.some((r) => d.kode.startsWith(r + ".")));
  if (!pts.length) return [-2.5, 118];
  return [pts.reduce((a, p) => a + p.lat, 0) / pts.length, pts.reduce((a, p) => a + p.lng, 0) / pts.length];
}

function withPlan(s: State, plan: Plan, actor: string): State {
  const name = peopleIndex(s.m!)[plan.approver]?.name ?? plan.approver;
  const msg: PhoneMessage = {
    id: `msg-${s.seq + 1}`, to: plan.approver, time: s.now, tier: "info",
    text: `📝 Draft: ${plan.title}\n${plan.rationale}\n` + plan.items.map((i, k) => `${k + 1}. ${i.text}${i.needsApprovalFrom ? ` (needs approval from ${i.needsApprovalFrom})` : ""}`).join("\n"),
    buttons: [
      { label: "✅ Approve", action: { type: "APPROVE_PLAN", planId: plan.id } },
      { label: "✖️ Reject", action: { type: "REJECT_PLAN", planId: plan.id } },
    ],
  };
  return {
    ...s, seq: s.seq + 1, plans: [plan, ...s.plans], phone: [...s.phone, msg],
    alerts: s.alerts.map((a) => (a.id === plan.alertId ? { ...a, status: "action_proposed" } : a)),
    audit: [audit(s, actor, "plan_drafted", `${plan.title} → awaiting approval from ${name}`), ...s.audit],
  };
}

function applyMap(s: State, map: NonNullable<AgentReply["map"]>): State {
  const next: State = { ...s, tab: "map" }; // show the user where the agent is looking
  if (map.layer) next.layer = map.layer;
  if (map.focus) next.selection = map.focus;
  if (map.highlight) next.highlight = map.highlight;
  return next;
}

/** Completes the last agent message (streamed or not) with the final reply and applies its side effects. */
function finishReply(s: State, r: AgentReply): State {
  const last = s.chat.length - 1;
  const meta = [r.refused ? "blocked by guardrail" : "", r.tools?.length ? `tools: ${[...new Set(r.tools)].join(", ")}` : ""].filter(Boolean).join(" · ");
  let next: State = {
    ...s, chatBusy: false, agentSource: r.source ?? s.agentSource,
    chat: s.chat.map((c, i) => (i === last ? { ...c, streaming: false, status: undefined, text: c.text || r.text, citations: r.citations, meta } : c)),
  };
  if (r.map) next = applyMap(next, r.map);
  if (r.plan && !next.plans.some((p) => p.id === r.plan!.id)) next = withPlan(next, r.plan, "Agent");
  return next;
}

function audit(s: State, actor: string, action: string, detail: string): AuditEntry {
  return { id: `au-${s.audit.length + 1}-${s.seq}`, time: s.now, actor, action, detail };
}

function decidePlan(s: State, planId: string, approve: boolean): State {
  const plan = s.plans.find((p) => p.id === planId);
  if (!plan || plan.status !== "pending") return s;
  const idx = peopleIndex(s.m!);
  const who = idx[s.persona]?.name ?? s.persona;
  let tasks = s.tasks;
  if (approve) {
    const alert = s.alerts.find((a) => a.id === plan.alertId);
    const [lat, lng] = alert?.lat ? [alert.lat, alert.lng!] : clusterCentroid(s, plan.clusterId);
    tasks = [...plan.items.map((it, i) => ({
      id: `task-${it.id}`, planId, clusterId: plan.clusterId, text: it.text, status: "open" as const,
      lat: lat + Math.sin(i * 1.3) * 0.03, lng: lng + Math.cos(i * 1.3) * 0.03,
    })), ...s.tasks];
  }
  return {
    ...s, tasks,
    plans: s.plans.map((p) => (p.id === planId ? { ...p, status: approve ? "approved" : "rejected" } : p)),
    alerts: s.alerts.map((a) => (a.id === plan.alertId ? { ...a, status: approve ? "approved" : "acked" } : a)),
    phone: s.phone.map((p) => (p.buttons?.some((b) => "planId" in b.action && b.action.planId === planId) ? { ...p, done: true } : p)),
    audit: [audit(s, who, approve ? "plan_approved" : "plan_rejected", `${plan.title} (${plan.items.length} steps)`), ...s.audit],
  };
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "LOAD": {
      const rina = a.m.personas.find((p) => p.role_id === "RGM")!;
      return { ...s, m: a.m, desa: a.desa, docs: a.docs, persona: rina.employee_id };
    }
    case "PERSONA":
      return { ...s, persona: a.id };
    case "LAYER":
      return { ...s, layer: a.layer };
    case "SELECT":
      return { ...s, selection: a.selection, highlight: [] };
    case "TAB":
      return { ...s, tab: a.tab };
    case "CHAT_OPEN":
      return { ...s, chatOpen: a.open };
    case "INBOX_VIEW":
      return { ...s, inboxView: a.view };
    case "CHAT_USER":
      return { ...s, chatOpen: true, chatBusy: true, chat: [...s.chat, { id: `c${s.chat.length}`, role: "user", text: a.text }] };
    case "CHAT_ERROR": {
      const last = s.chat[s.chat.length - 1];
      const chat = last?.streaming ? s.chat.slice(0, -1) : s.chat; // drop the half-streamed placeholder
      return { ...s, chatBusy: false, chat: [...chat, { id: `c${chat.length}`, role: "agent", text: a.text, meta: "error" }] };
    }
    case "CHAT_AGENT":
      return finishReply({ ...s, chat: [...s.chat, { id: `c${s.chat.length}`, role: "agent", text: "" }] }, a.reply);
    case "STREAM_START":
      return { ...s, chatOpen: true, chatBusy: true, chat: [...s.chat, { id: `c${s.chat.length}`, role: "agent", text: "", streaming: true, status: "Thinking…" }] };
    case "STREAM_STATUS":
      return { ...s, chat: s.chat.map((c, i) => (i === s.chat.length - 1 && c.streaming ? { ...c, status: a.text } : c)) };
    case "STREAM_DELTA":
      return { ...s, chat: s.chat.map((c, i) => (i === s.chat.length - 1 && c.streaming ? { ...c, text: c.text + a.text } : c)) };
    case "STREAM_MAP":
      return applyMap(s, a.map);
    case "STREAM_DONE":
      return finishReply(s, a.reply);
    case "RUN_DIGEST": {
      if (!s.m || s.digestRun) return s;
      const now = "2026-10-17T07:00:00+07:00";
      let st: State = { ...s, now, digestRun: true };
      const msgs: PhoneMessage[] = [];
      for (const p of s.m.personas.filter((p) => ["RGM", "BM", "CSM"].includes(p.role_id))) {
        msgs.push({ id: `msg-${st.seq + msgs.length + 1}`, to: p.employee_id, time: now, tier: "digest", text: digestText(s.m, p.employee_id).text });
      }
      st = { ...st, seq: st.seq + msgs.length, phone: [...st.phone, ...msgs] };
      const alerts: Alert[] = [];
      for (const c of morningP1s(s.m)) {
        if (!c.owner || interruptsToday(st, c.owner.employee_id) >= MAX_INTERRUPTS_PER_DAY) continue;
        const id = `al-${st.seq + alerts.length + 1}`;
        alerts.push({
          id, tier: "P1", clusterId: c.id, geoKode: c.regencies[0], recipient: c.owner.employee_id, createdAt: now, status: "notified",
          title: `P1: ${c.name} at ${pct(c.raw)} of target`,
          body: `Month-end projection ${pct(c.raw)}; adjusted ${pct(c.adj)} — ${causeOf(c) === "controllable" ? "gap is mostly controllable" : "team is short-staffed"}.`,
        });
      }
      const p1msgs: PhoneMessage[] = alerts.map((al, i) => ({
        id: `msg-${st.seq + alerts.length + i + 1}`, to: al.recipient, time: now, tier: "P1",
        text: `🔴 ${al.title}\n${al.body}\nWhy: controllable drivers are worsening. Impact: month-end gap risk. Next step: open the chat → "draft an action plan".`,
        buttons: [
          { label: "👍 Ack", action: { type: "ACK", alertId: al.id } },
          { label: "Not my territory", action: { type: "NOT_MINE", alertId: al.id } },
        ],
      }));
      return {
        ...st, seq: st.seq + alerts.length * 2, alerts: [...alerts, ...st.alerts], phone: [...st.phone, ...p1msgs],
        audit: [audit(st, "Proactive runner", "digest_sent", `${msgs.length} morning digests, ${alerts.length} P1 alerts`), ...st.audit],
      };
    }
    case "INJECT": {
      if (!s.m || s.injected) return s;
      const ev = s.m.inject;
      const c = s.m.clusters[ev.cluster_id];
      const now = s.now < "2026-10-17T10:15:00+07:00" ? "2026-10-17T10:15:00+07:00" : s.now;
      const id = `al-${s.seq + 1}`;
      const alert: Alert = {
        id, tier: "P1", clusterId: c.id, geoKode: ev.desa_kode, lat: ev.lat, lng: ev.lng, recipient: c.owner!.employee_id,
        createdAt: now, status: "notified", question: "Is this drop caused by a site outage?",
        title: `P1: Village ${ev.desa_name} (District ${ev.district_name})`,
        body: `Data revenue today is down ${Math.abs(ev.change_pct)}% vs the 7-day average. Network data: no outage recorded (availability normal).`,
      };
      const msg: PhoneMessage = {
        id: `msg-${s.seq + 2}`, to: alert.recipient, time: now, tier: "P1",
        text: `🔴 ${alert.title}\n${alert.body}\n❓ ${alert.question}`,
        buttons: [
          { label: "Yes, site outage", action: { type: "ANSWER", alertId: id, answer: "outage" } },
          { label: "No", action: { type: "ANSWER", alertId: id, answer: "not_outage" } },
          { label: "Don't know", action: { type: "ANSWER", alertId: id, answer: "unknown" } },
        ],
      };
      return {
        ...s, now, injected: true, seq: s.seq + 2, tab: "map", alerts: [alert, ...s.alerts], phone: [...s.phone, msg],
        selection: { level: "regency", kode: c.regencies[0] }, highlight: [ev.desa_kode],
        audit: [audit(s, "Proactive runner", "alert_p1", `${alert.title} → ${c.owner!.name}`), ...s.audit],
      };
    }
    case "ADVANCE": {
      if (!s.m) return s;
      const now = addHours(s.now, a.hours);
      const idx = peopleIndex(s.m);
      let st: State = { ...s, now };
      for (const al of s.alerts) {
        if (al.tier !== "P1" || al.status !== "notified" || al.escalatedTo) continue;
        if (new Date(now).getTime() - new Date(al.createdAt).getTime() < ESCALATION_HOURS * 3600e3) continue;
        const bm = s.m.units[s.m.clusters[al.clusterId].branch_id]?.BM;
        if (!bm) continue;
        st = {
          ...st, seq: st.seq + 1,
          alerts: st.alerts.map((x) => (x.id === al.id ? { ...x, status: "escalated", escalatedTo: bm.employee_id } : x)),
          phone: [...st.phone, {
            id: `msg-${st.seq + 1}`, to: bm.employee_id, time: now, tier: "P1",
            text: `⏫ Escalation (one time): ${al.title} has not been acknowledged by ${idx[al.recipient]?.name} for ${ESCALATION_HOURS} hours.\n${al.body}`,
            buttons: [{ label: "👍 Ack", action: { type: "ACK", alertId: al.id } }],
          }],
          audit: [audit(st, "Proactive runner", "escalated_l1", `${al.title} → ${bm.name}`), ...st.audit],
        };
      }
      return st;
    }
    case "PHONE": {
      if (!s.m) return s;
      const act = a.action;
      const idx = peopleIndex(s.m);
      const who = idx[s.persona]?.name ?? s.persona;
      let st: State = { ...s, phone: s.phone.map((p) => (p.id === a.msgId ? { ...p, done: true } : p)) };
      if (act.type === "ACK") {
        return { ...st, alerts: st.alerts.map((x) => (x.id === act.alertId ? { ...x, status: "acked" } : x)),
          audit: [audit(st, who, "alert_acked", act.alertId), ...st.audit] };
      }
      if (act.type === "NOT_MINE") {
        return { ...st, alerts: st.alerts.map((x) => (x.id === act.alertId ? { ...x, status: "resolved" } : x)),
          audit: [audit(st, who, "ownership_flagged", `${act.alertId}: "not my territory" → Sales Planning data-correction queue`), ...st.audit] };
      }
      if (act.type === "APPROVE_PLAN" || act.type === "REJECT_PLAN") return decidePlan(st, act.planId, act.type === "APPROVE_PLAN");
      if (act.type === "ANSWER") {
        const al = st.alerts.find((x) => x.id === act.alertId)!;
        st = { ...st, alerts: st.alerts.map((x) => (x.id === al.id ? { ...x, status: "acked", answer: act.answer } : x)),
          audit: [audit(st, who, "question_answered", `${al.title}: ${act.answer}`), ...st.audit] };
        if (act.answer === "outage") {
          const rnom = s.m.units[s.m.units[s.m.clusters[al.clusterId].branch_id].region_id!].RNOM!;
          return { ...st, seq: st.seq + 1,
            alerts: st.alerts.map((x) => (x.id === al.id ? { ...x, status: "resolved" } : x)),
            phone: [...st.phone, { id: `msg-${st.seq + 1}`, to: rnom.employee_id, time: st.now, tier: "P1",
              text: `🛠️ Site outage reported by ${who}: ${al.title}. Please verify; the gap is provisionally marked non-controllable (SOP-03).`,
              buttons: [{ label: "👍 Ack", action: { type: "ACK", alertId: al.id } }] }],
            audit: [audit(st, "Policy engine", "reclassified", `${al.title} → non-controllable, rerouted to ${rnom.name}`), ...st.audit] };
        }
        const plan = draftPlan(s.m, al.clusterId, `plan-${st.seq + 1}`, st.now, al);
        return withPlan({ ...st, seq: st.seq + 1 }, plan, "Agent");
      }
      return st;
    }
    case "PROPOSE_PLAN": {
      if (!s.m) return s;
      const plan = draftPlan(s.m, a.clusterId, `plan-${s.seq + 1}`, s.now);
      return { ...withPlan({ ...s, seq: s.seq + 1 }, plan, "Agent"), tab: "inbox" };
    }
    case "DECIDE_PLAN":
      return decidePlan(s, a.planId, a.approve);
  }
}

const Ctx = createContext<{ s: State; d: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, d] = useReducer(reducer, initialState);
  useEffect(() => {
    Promise.all([
      fetch("/data/metrics.json").then((r) => r.json()),
      fetch("/data/desa_jabar.json").then((r) => r.json()),
      fetch("/data/docs.json").then((r) => r.json()),
    ]).then(([m, desa, docs]) => d({ type: "LOAD", m, desa, docs }));
  }, []);
  return <Ctx.Provider value={{ s, d }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
