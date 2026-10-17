// Deterministic "policy engine" + drafting helpers shared by the UI simulation and the mock agent.
// In the real build this logic lives in the proactive runner service; the LLM only phrases messages.

import { num, pct, rupiah, shortName } from "./format";
import type { Alert, Cluster, Metrics, Plan, PlanItem } from "./types";

export const MAX_INTERRUPTS_PER_DAY = 3;
export const ESCALATION_HOURS = 4;

export type Scope = { kind: "region" | "branch" | "cluster"; id: string; name: string; clusterIds: string[] };

export type PersonIndex = Record<string, { name: string; role: string; role_id: string; unit: string }>;

export function peopleIndex(m: Metrics): PersonIndex {
  const idx: PersonIndex = {};
  const add = (p: { employee_id: string; name: string; role: string; role_id: string } | null | undefined, unit: string) => {
    if (p) idx[p.employee_id] = { name: p.name, role: p.role, role_id: p.role_id, unit };
  };
  for (const c of Object.values(m.clusters)) add(c.owner, c.id);
  for (const [id, u] of Object.entries(m.units)) {
    add(u.BM, id); add(u.BCM, id); add(u.BSM, id); add(u.RGM, id); add(u.RNOM, id); add(u.RHRBP, id);
  }
  return idx;
}

export function scopeOf(m: Metrics, personaId: string): Scope {
  const p = m.personas.find((x) => x.employee_id === personaId)!;
  const all = Object.values(m.clusters);
  if (p.org_unit_id.startsWith("CL")) {
    return { kind: "cluster", id: p.org_unit_id, name: m.clusters[p.org_unit_id].name, clusterIds: [p.org_unit_id] };
  }
  if (p.org_unit_id.startsWith("BR")) {
    return { kind: "branch", id: p.org_unit_id, name: m.units[p.org_unit_id].name,
      clusterIds: all.filter((c) => c.branch_id === p.org_unit_id).map((c) => c.id) };
  }
  const branches = Object.entries(m.units).filter(([, u]) => u.region_id === p.org_unit_id).map(([id]) => id);
  return { kind: "region", id: p.org_unit_id, name: m.units[p.org_unit_id].name,
    clusterIds: all.filter((c) => branches.includes(c.branch_id)).map((c) => c.id) };
}

export type Cause = "non_controllable" | "target_above_potential" | "under_resourced" | "controllable" | "on_track";

export function causeOf(c: Cluster): Cause {
  if (c.raw >= 97) return "on_track";
  if (c.adj >= 97) return c.gap_non_controllable > 0 ? "non_controllable" : "target_above_potential";
  return c.capacity < 0.9 ? "under_resourced" : "controllable";
}

export const CAUSE_LABEL: Record<Cause, string> = {
  non_controllable: "outside the team’s control (outage / external event)",
  target_above_potential: "target above territory potential",
  under_resourced: "controllable, team short-staffed",
  controllable: "controllable, fully staffed → coaching",
  on_track: "on track",
};

export function managerOfCluster(m: Metrics, c: Cluster) {
  return m.units[c.branch_id]?.BM ?? null;
}

export function digestText(m: Metrics, personaId: string): { text: string; atRisk: Cluster[] } {
  const s = scopeOf(m, personaId);
  const cs = s.clusterIds.map((id) => m.clusters[id]);
  if (s.kind === "cluster") {
    const c = cs[0];
    const flagged = (c.drivers ?? []).filter((d) => d.flag && d.controllable).slice(0, 3);
    const lines = [
      `☀️ Morning digest — ${c.name} (${m.period})`,
      `Raw ${pct(c.raw)} · Adjusted ${pct(c.adj)} · gap ${rupiah(c.rev_total_target - c.rev_total)}`,
    ];
    if (c.raw >= 100) {
      lines.push(`🎉 Above target and at ${pct(c.adj)} of what territory potential predicts. The region suggests a best-practice sharing session with other clusters.`);
    } else {
      lines.push(`Cause: ${CAUSE_LABEL[causeOf(c)]}.`);
      if (flagged.length) lines.push("Main drivers: " + flagged.map((d) => `${d.label} ${d.delta_pct > 0 ? "+" : ""}${num(d.delta_pct, 1)}%`).join("; ") + ".");
      if (c.vacancies.length) lines.push(`Team: ${c.vacancies.length} vacant positions (${c.vacancies.map((v) => `${v.role} ${v.days_open} days`).join(", ")})${c.vacancies.some((v) => !v.backfill_request_submitted) ? ", no backfill request yet" : ""}.`);
      if (c.peers[0]) lines.push(`Closest success story: ${c.peers[0].name} (${pct(c.peers[0].adj)} of expectation, ${c.peers[0].owner}).`);
      lines.push("Type in the chat: \"draft an action plan\" for suggested steps.");
    }
    return { text: lines.join("\n"), atRisk: c.raw < 95 ? [c] : [] };
  }
  const u = m.units[s.id];
  const atRisk = cs.filter((c) => c.raw < 95).sort((a, b) => a.raw - b.raw).slice(0, 3);
  const star = [...cs].sort((a, b) => b.adj - a.adj)[0];
  const lines = [
    `☀️ Morning digest — ${s.name} (${m.period})`,
    `Raw ${pct(u.raw)} · Adjusted ${pct(u.adj)}`,
    atRisk.length ? `Needs attention (${atRisk.length}):` : "No clusters below 95%.",
    ...atRisk.map((c, i) => `${i + 1}. ${c.name} ${pct(c.raw)} (adj ${pct(c.adj)}) — ${CAUSE_LABEL[causeOf(c)]}`),
    `🎉 Recognition: ${star.name} ${pct(star.raw)} (${pct(star.adj)} of expectation) — ${star.owner?.name ?? "-"}`,
  ];
  return { text: lines.join("\n"), atRisk };
}

/** P1 alerts the 07:00 run raises: controllable clusters far below target (deterministic rule). */
export function morningP1s(m: Metrics): Cluster[] {
  return Object.values(m.clusters).filter((c) => c.province_kode === "32" && c.raw < 86 &&
    (causeOf(c) === "controllable" || causeOf(c) === "under_resourced"));
}

export function draftPlan(m: Metrics, clusterId: string, id: string, nowIso: string, alert?: Alert): Plan {
  const c = m.clusters[clusterId];
  const owner = c.owner?.name ?? "Cluster Sales Manager";
  const bm = managerOfCluster(m, c);
  const hrbp = m.units[m.units[c.branch_id]?.region_id ?? ""]?.RHRBP;
  const flagged = new Set((c.drivers ?? []).filter((d) => d.flag).map((d) => d.key));
  const items: PlanItem[] = [];
  const due = (days: number) => new Date(new Date(nowIso).getTime() + days * 864e5).toISOString().slice(0, 10);
  let n = 0;
  const add = (text: string, who: string, days: number, kind: string, needsApprovalFrom?: string) =>
    items.push({ id: `${id}-${++n}`, text, owner: who, due: due(days), kind, needsApprovalFrom });

  if (alert) {
    add(`Field check ${alert.title.replace(/^P1: /, "")}: visit the top 5 outlets and confirm stock and NusaPOS activity today`, "District Sales Supervisor", 0, "field_check");
  }
  if (c.vacancies.length) {
    add(`Request backfill: ${c.vacancies.map((v) => v.role).join(" + ")} (vacant ${Math.max(...c.vacancies.map((v) => v.days_open))} days)`,
      owner, 1, "backfill", [bm?.name, hrbp?.name].filter(Boolean).join(" & "));
  }
  if (flagged.has("outlet_active_pct")) {
    add("Re-activate 12 priority outlets per canvasser (inactive ≥30 days, ranked by 3-month recharge value) + new routes per district (SOP-02)", "Sales Supervisor", 7, "outlet_activation");
  }
  if (flagged.has("stock_pct")) {
    add("Ask the distributor to replenish recharge stock today; target availability ≥97% (SOP-02 step 3)", "Channel Officer / Branch Channel Manager", 1, "stock");
  }
  if (flagged.has("ecr") || c.partner_sf.pct_tenure_lt_12m > 40) {
    add(`Pair new canvassers (${pct(c.partner_sf.pct_tenure_lt_12m, 0)} with <12 months tenure) with senior ones for 2 weeks; draft coaching notes for 3 people (GUIDE-01)`, owner, 14, "coaching");
  }
  if (c.peers[0]) {
    add(`30-minute best-practice session with ${c.peers[0].owner} (${c.peers[0].name}, ${pct(c.peers[0].adj)} of expectation)`, owner, 5, "peer_learning");
  }
  if (c.events.length) {
    add(`Coordinate recovery with Network Operations; gap of ${rupiah(c.gap_non_controllable)} marked non-controllable (SOP-03)`, "Regional Network Operations Manager", 2, "network");
  }
  if (!items.length) add("No drivers are worsening; keep the visit rhythm and share good practices", owner, 7, "sustain");

  const why = c.drivers?.filter((d) => d.flag && d.controllable).map((d) => d.label.toLowerCase()).join(", ");
  return {
    id, clusterId, alertId: alert?.id, createdAt: nowIso, status: "pending",
    approver: c.owner?.employee_id ?? "",
    title: `Action plan ${shortName(c.name)} — ${due(0)}`,
    rationale: `${c.name}: raw ${pct(c.raw)}, adjusted ${pct(c.adj)} (${CAUSE_LABEL[causeOf(c)]})${why ? `; worsening drivers: ${why}` : ""}.`,
    items,
  };
}
