"use client";

import { askAgent } from "@/lib/chat";
import { QUADRANTS } from "@/lib/colors";
import { driverValue, num, pct, rupiah, shortName } from "@/lib/format";
import { CAUSE_LABEL, causeOf } from "@/lib/proactive";
import { useStore } from "@/lib/store";
import type { Att, Cluster, Selection } from "@/lib/types";
import { AttBadge, Card, GapBar, Pill, Sparkline } from "./ui";

function GapCard({ a }: { a: Att | Cluster }) {
  return (
    <Card title={`Gap to target ${rupiah(a.rev_total_target - a.rev_total)}`}>
      <GapBar
        parts={[
          { label: "Controllable by the team", value: a.gap_controllable, color: "#dc2626" },
          { label: "Non-controllable (outages, competitors)", value: a.gap_non_controllable, color: "#64748b" },
          { label: "Target above territory potential", value: a.gap_target_above_potential, color: "#cbd5e1" },
        ]}
      />
    </Card>
  );
}

function ClusterRow({ c, onClick }: { c: Cluster; onClick: () => void }) {
  const q = QUADRANTS[c.quadrant];
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `rgb(${q.color.join(",")})` }} title={q.label} />
      <span className="min-w-0 flex-1 truncate">{shortName(c.name)} <span className="text-muted">· {c.owner?.name ?? "-"}</span></span>
      <span className="w-14 text-right tabular-nums">{pct(c.raw)}</span>
      <span className="w-14 text-right font-semibold tabular-nums">{pct(c.adj)}</span>
    </button>
  );
}

export default function DetailPanel() {
  const { s, d } = useStore();
  const m = s.m!;
  const sel = s.selection;
  const go = (selection: Selection) => d({ type: "SELECT", selection });
  const ask = (q: string) => void askAgent(s, d, q);

  if (sel.level === "national") {
    const wrongRed = Object.entries(m.units).filter(([k, u]) => k.startsWith("BR") && u.raw < 95 && u.adj >= 97);
    const provs = Object.entries(m.provinces).sort((a, b) => a[1].raw - b[1].raw);
    return (
      <div className="scroll-thin h-full space-y-3 overflow-y-auto p-3">
        <h2 className="text-base font-semibold">Indonesia <span className="text-xs font-normal text-muted">· {m.period}</span></h2>
        <div className="flex gap-2"><AttBadge v={m.national.raw} label="Raw" /><AttBadge v={m.national.adj} label="Adjusted" /></div>
        <Card title="Assessment fairness">
          <p className="text-xs leading-relaxed">
            <b>{wrongRed.length} of 38 branches</b> look red on raw attainment (&lt;95%) but are at ≥97% of what their territory potential predicts:{" "}
            {wrongRed.map(([, u]) => u.name.replace("Branch ", "")).join(", ")}. Without adjustment, the teams there would be blamed unfairly.
          </p>
        </Card>
        <Card title="Provinces (lowest raw first)" right={<span className="text-[10px] text-muted">raw · adjusted</span>}>
          {provs.map(([k, a]) => (
            <button key={k} onClick={() => go({ level: "province", kode: k })} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-50">
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="w-14 text-right tabular-nums">{pct(a.raw)}</span>
              <span className="w-14 text-right font-semibold tabular-nums">{pct(a.adj)}</span>
            </button>
          ))}
        </Card>
      </div>
    );
  }

  if (sel.level === "province") {
    const a = m.provinces[sel.kode!];
    const br = m.units["BR" + sel.kode];
    const cs = Object.values(m.clusters).filter((c) => c.province_kode === sel.kode).sort((x, y) => x.raw - y.raw);
    return (
      <div className="scroll-thin h-full space-y-3 overflow-y-auto p-3">
        <h2 className="text-base font-semibold">{a.name}</h2>
        <div className="flex gap-2"><AttBadge v={a.raw} label="Raw" /><AttBadge v={a.adj} label="Adjusted" /></div>
        <Card title="Accountable people">
          <p className="text-xs">Branch Manager: <b>{br?.BM?.name ?? "-"}</b></p>
          <p className="text-xs text-muted">{m.units[br?.region_id ?? ""]?.name} · RGM {m.units[br?.region_id ?? ""]?.RGM?.name}</p>
        </Card>
        <GapCard a={a} />
        <Card title={`Cluster (${cs.length})`} right={<span className="text-[10px] text-muted">raw · adjusted</span>}>
          {cs.map((c) => <ClusterRow key={c.id} c={c} onClick={() => go({ level: "regency", kode: c.regencies[0] })} />)}
        </Card>
      </div>
    );
  }

  const regKode = sel.kode!.split(".").slice(0, 2).join(".");
  const reg = m.regencies[regKode];
  const c = m.clusters[reg.cluster_id!];
  const br = m.units[c.branch_id];
  const rg = m.units[br.region_id ?? ""];

  const desaBlock = sel.level === "desa" ? (() => {
    const p = s.desa.find((x) => x.kode === sel.kode);
    const kec = m.districts[sel.kode!.split(".").slice(0, 3).join(".")];
    return p ? (
      <Card title={`Village ${p.name}`}>
        <div className="flex gap-2"><AttBadge v={p.raw} label="Raw" /><AttBadge v={p.adj} label="Adjusted" /></div>
        <p className="mt-2 text-xs">Revenue MTD {rupiah(p.rev)} · District {kec?.name} ({pct(kec?.raw)} raw)</p>
        <p className="text-xs">District Sales Supervisor: <b>{kec?.owner ?? "-"}</b>{kec?.owner_type === "interim_cover" && <Pill tone="amber">interim cover, position vacant</Pill>}</p>
        <p className="mt-1 text-[10px] text-muted">Village coordinates are still synthetic (approximate).</p>
      </Card>
    ) : null;
  })() : null;

  const cause = causeOf(c);
  const q = QUADRANTS[c.quadrant];
  return (
    <div className="scroll-thin h-full space-y-3 overflow-y-auto p-3">
      <div>
        <h2 className="text-base font-semibold">{c.name}</h2>
        <p className="text-xs text-muted">{c.regencies.map((r) => m.regencies[r]?.name).join(", ")} · {br.name}</p>
      </div>
      {desaBlock}
      <div className="flex gap-2"><AttBadge v={c.raw} label="Raw (actual / target)" /><AttBadge v={c.adj} label="Adjusted (vs potential)" /></div>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={cause === "on_track" ? "green" : cause === "non_controllable" || cause === "target_above_potential" ? "slate" : "red"}>{CAUSE_LABEL[cause]}</Pill>
        <Pill tone="violet">{q.label} → {q.action}</Pill>
      </div>

      <Card title="Accountability">
        <ul className="space-y-1 text-xs">
          <li>Cluster Sales Manager: <b>{c.owner?.name ?? "vacant"}</b> <span className="text-muted">(A: revenue, net adds, outlets)</span></li>
          <li>Branch Manager: {br.BM?.name} · Channel: {br.BCM?.name}</li>
          <li>Regional GM: {rg?.RGM?.name} · Network Ops: {rg?.RNOM?.name}</li>
        </ul>
      </Card>

      <GapCard a={c} />

      <Card title="13-month trend" right={<span className="text-[10px] text-muted">— adjusted · — raw</span>}>
        <Sparkline series={c.series} />
      </Card>

      {c.drivers && (
        <Card title="Drivers vs Jun–Aug average">
          <table className="w-full text-xs">
            <tbody>
              {c.drivers.map((x) => (
                <tr key={x.key} className="border-t border-line first:border-0">
                  <td className="py-1">{x.label}{!x.controllable && <span className="text-muted"> (non-ctrl)</span>}</td>
                  <td className="py-1 text-right tabular-nums">{driverValue(x.unit, x.now)}</td>
                  <td className={`py-1 text-right tabular-nums ${x.flag ? "font-semibold text-red-600" : "text-muted"}`}>{x.delta_pct > 0 ? "+" : ""}{num(x.delta_pct, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Team & capacity">
        {c.team_gate ? (
          <p className="text-xs text-muted">🔒 Team metrics hidden: the team has only {c.team_size} people (&lt;5), per privacy policy POL-01.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            <p>Positions filled <b>{c.filled}/{c.planned}</b> (capacity {pct(c.capacity * 100, 0)}) · engagement {c.engagement_suppressed ? "🔒" : c.engagement}</p>
            {c.vacancies.map((v) => (
              <p key={v.role} className="text-red-700">• Vacant: {v.role}, {v.days_open} days {v.backfill_request_submitted ? "(backfill requested)" : "(no backfill request yet)"}</p>
            ))}
            <p>Partner sales force: {c.partner_sf.headcount} people · {pct(c.partner_sf.pct_tenure_lt_12m, 0)} &lt;12 months · effective call {c.partner_sf.effective_call_rate.toFixed(2)}</p>
            <details className="text-muted">
              <summary className="cursor-pointer">Internal team members ({c.members.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {c.members.map((p) => <li key={p.name}>{p.name} — {p.role}, {Math.round(p.tenure_months)} mo{p.employment_type === "contract" ? ", contract" : ""}</li>)}
              </ul>
            </details>
          </div>
        )}
      </Card>

      {c.events.length > 0 && (
        <Card title="Non-controllable events">
          {c.events.map((e) => <p key={e.event_id} className="text-xs">⚠️ {e.title} ({e.start} s.d. {e.end}) · est. {rupiah(e.loss)}</p>)}
        </Card>
      )}

      {c.peers.length > 0 && (
        <Card title="Peer clusters doing well">
          {c.peers.map((p) => (
            <button key={p.id} onClick={() => go({ level: "regency", kode: m.clusters[p.id].regencies[0] })} className="flex w-full justify-between rounded px-1 py-1 text-left text-xs hover:bg-slate-50">
              <span>{p.name} · {p.owner}</span><span className="tabular-nums">{pct(p.adj)} adj</span>
            </button>
          ))}
        </Card>
      )}

      <div className="flex gap-2 pb-2">
        <button onClick={() => d({ type: "PROPOSE_PLAN", clusterId: c.id })} className="flex-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-strong">Draft action plan</button>
        <button onClick={() => ask(`Why is ${shortName(c.name)} red?`)} className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium">Ask the agent</button>
      </div>
    </div>
  );
}
