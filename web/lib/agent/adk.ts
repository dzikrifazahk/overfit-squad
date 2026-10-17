// Calls the ADK agent server (agent/, FastAPI from get_fast_api_app) over SSE (/run_sse) and turns its events
// into StreamEvents: tool status, text deltas, map updates and a final reply.

import type { AgentReply, Metrics, Plan, Selection, StreamEvent } from "../types";

type Part = {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response?: Record<string, unknown> };
};
type AdkEvent = { author?: string; partial?: boolean; content?: { parts?: Part[] }; actions?: { stateDelta?: Record<string, unknown> } };

const TOOL_STATUS: Record<string, string> = {
  find_region: "Locating the place…",
  get_attainment: "Reading attainment figures…",
  explain_gap: "Analysing the gap and its drivers…",
  resolve_owner: "Finding who is accountable…",
  find_peers: "Looking for peer clusters…",
  team_snapshot: "Checking team capacity…",
  team_scorecard_summary: "Summarising team scorecards…",
  search_policy_docs: "Searching SOPs and policies…",
  draft_action_plan: "Drafting the action plan…",
  set_map_view: "Updating the map…",
};

function selectionLabel(m: Metrics, sel: Selection): string {
  if (sel.level === "national" || !sel.kode) return "Indonesia (national view)";
  if (sel.level === "province") return `${m.provinces[sel.kode]?.name} (province ${sel.kode})`;
  const reg = sel.kode.split(".").slice(0, 2).join(".");
  const r = m.regencies[reg];
  const base = `${r?.name} (regency ${reg}, ${r?.cluster_id ? m.clusters[r.cluster_id]?.name + " " + r.cluster_id : ""})`;
  return sel.level === "desa" ? `desa ${sel.kode} in ${base}` : base;
}

async function authHeaders(url: string): Promise<Record<string, string>> {
  // On Cloud Run with --no-allow-unauthenticated, fetch an ID token from the metadata server.
  if (!process.env.AGENT_USE_ID_TOKEN) return {};
  const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(url)}`,
    { headers: { "Metadata-Flavor": "Google" } });
  return { Authorization: `Bearer ${await r.text()}` };
}

export async function* streamAdk(
  agentUrl: string, m: Metrics,
  req: { message: string; persona: string; sessionId: string; selection: Selection; now: string },
): AsyncGenerator<StreamEvent> {
  const p = m.personas.find((x) => x.employee_id === req.persona);
  const unitName = p ? (m.clusters[p.org_unit_id]?.name ?? m.units[p.org_unit_id]?.name ?? p.org_unit_id) : "";
  const res = await fetch(`${agentUrl}/run_sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(agentUrl)) },
    body: JSON.stringify({
      app_name: "app",
      user_id: req.persona,
      session_id: req.sessionId,
      streaming: true,
      new_message: { role: "user", parts: [{ text: req.message }] },
      state_delta: {
        persona: p ? { employee_id: p.employee_id, org_unit_id: p.org_unit_id, role_id: p.role_id } : {},
        persona_label: p ? `${p.full_name}, ${p.role_id} of ${unitName} (${p.org_unit_id})` : "unknown user",
        selection_label: selectionLabel(m, req.selection),
        demo_now: req.now,
      },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`agent ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const reply: AgentReply = { text: "", tools: [] };
  const citations = new Set<string>();
  let sawPartialText = false; // streamed deltas already cover the text of the current model turn
  let streamedText = "";

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  const handle = function* (ev: AdkEvent): Generator<StreamEvent> {
    if (ev.actions?.stateDelta?.guardrail === "refused") reply.refused = true;
    if (ev.actions?.stateDelta?.map) {
      reply.map = ev.actions.stateDelta.map as AgentReply["map"];
      yield { t: "map", map: reply.map! };
    }
    for (const part of ev.content?.parts ?? []) {
      if (part.functionCall && !ev.partial) {
        reply.tools!.push(part.functionCall.name);
        yield { t: "status", text: TOOL_STATUS[part.functionCall.name] ?? "Working…" };
      }
      const fr = part.functionResponse;
      if (fr?.name === "draft_action_plan" && fr.response?.plan) reply.plan = fr.response.plan as Plan;
      if (fr?.name === "search_policy_docs") {
        for (const r of (fr.response?.results as { doc_id: string }[] | undefined) ?? []) citations.add(r.doc_id);
      }
      if (part.text && !part.thought && ev.author !== "user") {
        if (ev.partial) {
          sawPartialText = true;
          streamedText += part.text;
          yield { t: "delta", text: part.text };
        } else {
          // Final aggregate of the turn: only emit it if nothing was streamed (e.g. guardrail refusal).
          if (!sawPartialText) {
            streamedText += part.text;
            yield { t: "delta", text: part.text };
          }
          reply.text = part.text;
          sawPartialText = false;
        }
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      try {
        yield* handle(JSON.parse(data) as AdkEvent);
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
    if (done) break;
  }

  if (!reply.text) reply.text = streamedText;
  for (const id of reply.text.match(/\b(SOP|POL|GUIDE)-\d{2}\b/g) ?? []) citations.add(id);
  reply.citations = [...citations];
  if (reply.refused) reply.citations = ["POL-01"];
  if (!reply.text) reply.text = "(the agent returned no text)";
  yield { t: "done", reply: { ...reply, source: "adk" } };
}
