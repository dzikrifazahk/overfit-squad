// Rule-based stand-in for the ADK + Gemini agent so the UI can be demoed end to end.
// Every number comes from the prepared data (never invented); the real agent calls the same
// kinds of tools (get_attainment, explain_gap, resolve_owner, team_snapshot, find_peers, search_policy_docs, draft_action_plan).
// Keywords are matched in English and Indonesian.

import { driverValue, num, pct, rupiah, shortName } from "../format";
import { CAUSE_LABEL, causeOf, draftPlan, scopeOf } from "../proactive";
import type { AgentReply, Cluster, Doc, Metrics, Selection } from "../types";

type Ctx = { m: Metrics; docs: Doc[]; persona: string; selection: Selection; now: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function findCluster(ctx: Ctx, q: string): Cluster | null {
  const text = norm(q);
  let best: Cluster | null = null;
  let bestLen = 0;
  for (const c of Object.values(ctx.m.clusters)) {
    const names = [shortName(c.name), ...c.regencies.map((r) => shortName(ctx.m.regencies[r]?.name ?? ""))];
    for (const n of names) {
      const k = norm(n);
      if (k.length > 3 && text.includes(k) && k.length > bestLen) {
        best = c;
        bestLen = k.length;
      }
    }
  }
  if (best) return best;
  const sel = ctx.selection;
  if (sel.level === "regency" && sel.kode) return ctx.m.clusters[ctx.m.regencies[sel.kode]?.cluster_id ?? ""] ?? null;
  if (sel.level === "desa" && sel.kode) {
    const reg = sel.kode.split(".").slice(0, 2).join(".");
    return ctx.m.clusters[ctx.m.regencies[reg]?.cluster_id ?? ""] ?? null;
  }
  const scope = scopeOf(ctx.m, ctx.persona);
  return scope.kind === "cluster" ? ctx.m.clusters[scope.id] : null;
}

function focus(c: Cluster): Selection {
  return { level: "regency", kode: c.regencies[0] };
}

function chain(ctx: Ctx, c: Cluster): string[] {
  const br = ctx.m.units[c.branch_id];
  const rg = br?.region_id ? ctx.m.units[br.region_id] : undefined;
  return [
    `• Accountable for cluster revenue: **${c.owner?.name ?? "vacant"}** (${c.owner?.role ?? "Cluster Sales Manager"})`,
    `• Reports to: ${br?.BM?.name ?? "-"} (Branch Manager, ${br?.name ?? ""}) → ${rg?.RGM?.name ?? "-"} (Regional General Manager)`,
    `• Active outlets & stock: Channel Officer (R), ${br?.BCM?.name ?? "-"} (Branch Channel Manager, A)`,
    `• Network (non-controllable for sales): ${rg?.RNOM?.name ?? "-"} (Regional Network Operations Manager)`,
  ];
}

function explain(ctx: Ctx, c: Cluster): AgentReply {
  const cause = causeOf(c);
  const lines = [
    `**${c.name}** — ${ctx.m.period}: raw **${pct(c.raw)}**, adjusted **${pct(c.adj)}** (${CAUSE_LABEL[cause]}).`,
    `Gap to target ${rupiah(c.rev_total_target - c.rev_total)}: target above potential ${rupiah(c.gap_target_above_potential)}, non-controllable ${rupiah(c.gap_non_controllable)}, controllable ${rupiah(Math.max(0, c.gap_controllable))}.`,
  ];
  if (c.events.length) lines.push(`Non-controllable events: ${c.events.map((e) => `${e.title} (${e.start} to ${e.end}, ~${rupiah(e.loss)})`).join("; ")}.`);
  if (c.drivers) {
    const bad = c.drivers.filter((d) => d.flag);
    if (bad.length) {
      lines.push("Drivers that worsened vs the Jun–Aug average:");
      for (const d of bad) lines.push(`• ${d.label}: ${driverValue(d.unit, d.now)} (baseline ${driverValue(d.unit, d.baseline)}, ${d.delta_pct > 0 ? "+" : ""}${num(d.delta_pct, 1)}%)${d.controllable ? "" : " — non-controllable"}`);
      if (c.events.length) lines.push("Note: the drop in ARPU / net adds coincides with the outage period, so most of it is a consequence of that event.");
    }
    const net = c.drivers.find((d) => d.key === "network_avail_pct");
    if (net && !net.flag && !c.events.length) lines.push(`The network is normal (${pct(net.now, 2)}), so this is not a coverage problem → focus on distribution and outlets.`);
  } else {
    lines.push("(Driver detail is only available for the demo province, West Java.)");
  }
  if (!c.team_gate) {
    const vac = c.vacancies.length ? `${c.vacancies.length} vacant positions (${c.vacancies.map((v) => `${v.role} ${v.days_open} days`).join(", ")})` : "no vacancies";
    lines.push(`Team: ${c.filled}/${c.planned} positions filled, ${vac}; partner sales force ${c.partner_sf.headcount} people, ${pct(c.partner_sf.pct_tenure_lt_12m, 0)} with <12 months tenure.`);
  } else {
    lines.push("Team metrics are hidden (team of fewer than 5 people, privacy rule POL-01).");
  }
  lines.push(cause === "non_controllable" ? "Recommendation: do not treat this as a team performance issue; coordinate recovery with Network Operations (SOP-03)."
    : cause === "under_resourced" ? "Recommendation: backfill first, then re-activate outlets and coach new partner staff. Ask me to “draft an action plan”."
    : cause === "controllable" ? "Recommendation: coach on the worsening drivers; the team is fully staffed. Ask me to “draft an action plan”."
    : "Recommendation: keep going and share their practices with other clusters.");
  return { text: lines.join("\n"), map: { focus: focus(c), layer: "adjusted", highlight: c.regencies }, citations: c.events.length ? ["SOP-03"] : ["SOP-01"],
    tools: ["get_attainment", "explain_gap", "team_snapshot"] };
}

function searchDocs(ctx: Ctx, q: string): AgentReply {
  const terms = [...new Set(norm(q).split(/\W+/).filter((t) => t.length > 3))];
  const scored = ctx.docs.map((d) => ({ d, s: terms.reduce((a, t) => a + (norm(d.text).split(t).length - 1), 0) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2);
  if (!scored.length) return { text: "I couldn’t find a relevant SOP. Try keywords such as escalation, outlet, stock, outage, coaching, AI policy.", tools: ["search_policy_docs"] };
  const parts = scored.map(({ d }) => {
    const sections = d.text.split(/\n(?=## )/).slice(1);
    const hits = (p: string) => terms.reduce((a, t) => a + (norm(p).split(t).length - 1), 0);
    const best = [...sections].sort((a, b) => hits(b) - hits(a))[0] ?? d.text;
    return `**${d.title}**\n${best.trim().slice(0, 900)}`;
  });
  return { text: parts.join("\n\n"), citations: scored.map(({ d }) => d.id), tools: ["search_policy_docs"] };
}

export function answer(ctx: Ctx, message: string): AgentReply {
  const q = norm(message);
  const has = (...w: string[]) => w.some((x) => q.includes(x));

  // Guardrails first: individual rankings / sanctions are refused by design (POL-01).
  if (has("ranking", "rank the", "peringkat", "terburuk", "paling jelek", "worst", "bottom", "pecat", "phk", "fire ", "terminate", "warning letter", "surat peringatan", " sp1", " sp2", " sp3", "flight risk", "resign")) {
    return {
      refused: true, citations: ["POL-01"], tools: ["policy_check"],
      text: "I can’t rank individuals, recommend warning letters / termination, or produce per-person flight-risk scores. Under policy POL-01, AI only drafts coaching material; decisions stay with managers and HR.\n\nWhat I can do instead:\n• Show the performance × capacity map per team (not per person)\n• List teams that need backfill vs coaching\n• Draft coaching notes for the team you lead",
      map: { layer: "bivariate" },
    };
  }
  if (has("bivariate", "quadrant", "kuadran", "capacity", "kapasitas", "short-staffed", "understaffed", "kurang orang")) {
    return { text: "Showing the quadrant map: adjusted attainment × team capacity. Purple = off track & short-staffed (backfill first), orange = off track with a full team (coaching), blue = on track despite being short-staffed, green = on track.", map: { layer: "bivariate" }, tools: ["set_map_view"] };
  }
  if (has("adjusted", "disesuaikan", "fair", "adil")) {
    return { text: "The map now shows **adjusted attainment** = (actual + non-controllable loss) / revenue expected from territory potential. Territories that are red on raw but neutral here should not be blamed.", map: { layer: "adjusted" }, tools: ["set_map_view"] };
  }
  if (has("raw", "mentah")) return { text: "The map now shows **raw attainment** (actual / target).", map: { layer: "raw" }, tools: ["set_map_view"] };
  if (has("sop", "procedure", "prosedur", "policy", "kebijakan", "rule", "aturan", "how do i", "bagaimana cara", "steps", "langkah", "escalat", "eskalasi")) return searchDocs(ctx, message);

  const c = findCluster(ctx, message);
  if (has("plan", "rencana", "action", "aksi", "next step")) {
    if (!c) return { text: "For which cluster? Mention the territory, for example “draft an action plan for Garut”." };
    const plan = draftPlan(ctx.m, c.id, `plan-chat-${c.id}-${Date.now() % 100000}`, ctx.now);
    return {
      text: `I drafted a plan for **${c.name}** and sent it to ${c.owner?.name} for approval (Inbox tab / phone):\n` + plan.items.map((i, k) => `${k + 1}. ${i.text} — ${i.owner}${i.needsApprovalFrom ? ` (approval: ${i.needsApprovalFrom})` : ""}`).join("\n"),
      plan, map: { focus: focus(c) }, citations: ["SOP-01", "SOP-02", "GUIDE-01"], tools: ["explain_gap", "draft_action_plan"],
    };
  }
  if (has("peer", "example", "contoh", "doing well", "berhasil", "best practice", "learn", "belajar", "sukses")) {
    if (!c) return { text: "Which cluster should I find peers for?" };
    if (!c.peers.length) return { text: `There is no cluster in the same region at ≥103% adjusted attainment to use as a peer for ${c.name}.` };
    return {
      text: `Similar clusters in the same region that are above expectation:\n` + c.peers.map((p) => `• ${p.name}: raw ${pct(p.raw)}, adjusted ${pct(p.adj)} — ${p.owner}`).join("\n") + `\nSuggestion: schedule a 30-minute sharing session between ${c.owner?.name} and ${c.peers[0].owner}.`,
      map: { highlight: c.peers.flatMap((p) => ctx.m.clusters[p.id].regencies), focus: { level: "province", kode: c.province_kode } }, tools: ["find_peers"],
    };
  }
  if (has("who", "siapa", "pic", "owner", "pemilik", "responsible", "accountable", "penanggung", "tanggung jawab")) {
    if (!c) return { text: "Which territory? For example “who owns revenue in Garut?”." };
    return { text: `KPI ownership for **${c.name}** (kpi_owner table → role → employee):\n${chain(ctx, c).join("\n")}`, map: { focus: focus(c) }, citations: ["SOP-01"], tools: ["resolve_owner"] };
  }
  if (has("team", "tim", "vacancy", "vacancies", "lowongan", "engagement", "staff", "people", "orang")) {
    if (!c) return { text: "Which cluster’s team do you want to look at?" };
    if (c.team_gate) return { text: `Team metrics for ${c.name} are hidden because the team has only ${c.team_size} people (<5). This is privacy rule POL-01, so individuals cannot be identified.`, refused: true, citations: ["POL-01"], tools: ["team_snapshot"] };
    return {
      text: `Team ${c.name}: ${c.filled}/${c.planned} positions filled (capacity ${pct(c.capacity * 100, 0)}).\n` +
        (c.vacancies.length ? `Vacancies: ${c.vacancies.map((v) => `${v.role} (${v.days_open} days${v.backfill_request_submitted ? ", backfill requested" : ", no backfill request yet"})`).join("; ")}.\n` : "No vacancies.\n") +
        `Engagement 2026H1: ${c.engagement_suppressed ? "hidden (<5 respondents)" : c.engagement}.\nPartner sales force: ${c.partner_sf.headcount} people, ${pct(c.partner_sf.pct_tenure_lt_12m, 0)} with <12 months tenure, effective call rate ${c.partner_sf.effective_call_rate.toFixed(2)}.`,
      map: { focus: focus(c), layer: "bivariate" }, citations: ["POL-01"], tools: ["team_snapshot"],
    };
  }
  if (has("summary", "ringkas", "digest", "today", "hari ini", "status")) {
    const scope = scopeOf(ctx.m, ctx.persona);
    const cs = scope.clusterIds.map((id) => ctx.m.clusters[id]).sort((a, b) => a.raw - b.raw);
    return { text: `Summary for ${scope.name}:\n` + cs.slice(0, 5).map((x) => `• ${x.name}: raw ${pct(x.raw)}, adj ${pct(x.adj)} — ${CAUSE_LABEL[causeOf(x)]}`).join("\n"), tools: ["get_attainment"] };
  }
  if (c) return explain(ctx, c);
  return {
    text: "I can help with:\n• “Why is Garut red?”\n• “Who owns revenue in Garut?”\n• “Who is doing well and could be an example for Garut?”\n• “How is the Garut team doing?”\n• “Draft an action plan for Garut”\n• “Show the adjusted map / quadrant map”\n• “What is the escalation SOP?”",
  };
}
