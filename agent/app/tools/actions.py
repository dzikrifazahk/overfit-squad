"""Action drafting. The agent only DRAFTS; a human approves in the UI or on the phone, and the
approved plan becomes tasks + an audit entry (handled by the app/proactive runner, not the LLM)."""

import datetime as dt
import uuid

from google.adk.tools import ToolContext

from .snapshot import ancestors, get, resolve_cluster
from .territory import focus_cluster, gap_analysis, peers_of


def draft_action_plan(place: str, trigger: str, tool_context: ToolContext) -> dict:
    """Drafts a concrete action plan for a cluster that is behind, based on its worsening drivers,
    vacancies, non-controllable events and best-practice peers, and sends it for human approval.

    Use when the user asks for a plan / next steps / "rencana aksi", or after a P1 alert is confirmed
    not to be a network outage. The plan is NOT executed until the cluster owner approves it.

    Args:
        place: Cluster id ('CL3201') or place name ("Garut").
        trigger: Short reason, e.g. 'user request' or 'P1: data revenue drop in Desa Sindangsari'.

    Returns:
        dict with 'plan' (status 'pending') ready for the approval inbox.
    """
    cluster_id, cands = resolve_cluster(place)
    if not cluster_id:
        return {"error": f"could not resolve '{place}' to a cluster", "candidates": cands}
    s = get()
    gap = gap_analysis(cluster_id)
    chain = ancestors(cluster_id)
    owner = s["emp"].get((cluster_id, "CSM"))
    bm = s["emp"].get((chain[1], "BM"))
    hrbp = s["emp"].get((chain[2], "RHRBP"))
    peers = peers_of(cluster_id)
    worse = [d["driver"] for d in gap["drivers"] if d["worse"]]
    now = tool_context.state.get("demo_now") or dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).isoformat()
    today = dt.date.fromisoformat(now[:10])
    plan_id = f"plan-{uuid.uuid4().hex[:8]}"
    items: list[dict] = []

    def add(text: str, who: str, days: int, kind: str, approval: str | None = None) -> None:
        items.append({"id": f"{plan_id}-{len(items) + 1}", "text": text, "owner": who,
                      "due": (today + dt.timedelta(days=days)).isoformat(), "kind": kind,
                      **({"needsApprovalFrom": approval} if approval else {})})

    owner_name = owner["full_name"] if owner else "Cluster Sales Manager"
    if trigger.lower().startswith("p1"):
        add(f"Field check ({trigger.split(':', 1)[-1].strip()}): visit the top 5 outlets and confirm stock and NusaPOS activity today",
            "District Sales Supervisor", 0, "field_check")
    if gap["team"]["open_vacancies"]:
        add(f"Request backfill: {gap['team']['vacancies']}", owner_name, 1, "backfill",
            " & ".join(p["full_name"] for p in (bm, hrbp) if p))
    if any(k.startswith("Outlet") for k in worse):
        add("Re-activate 12 priority outlets per canvasser (inactive ≥30 days, ranked by 3-month recharge value) + new routes per district (SOP-02)",
            "Sales Supervisor", 7, "outlet_activation")
    if any(k.startswith("Ketersediaan stok") for k in worse):
        add("Ask the distributor to replenish recharge stock today; target availability ≥97% (SOP-02)", "Channel Officer / Branch Channel Manager", 1, "stock")
    sf = gap["team"]["partner_sales_force"]
    if any(k.startswith("Effective call") for k in worse) or (sf.get("pct_tenure_lt_12m") or 0) > 40:
        add(f"Pair new canvassers ({sf.get('pct_tenure_lt_12m')}% with <12 months tenure) with senior ones for 2 weeks; draft coaching notes (GUIDE-01)",
            owner_name, 14, "coaching")
    if peers:
        add(f"30-minute best-practice session with {peers[0]['owner']} ({peers[0]['name']}, {peers[0]['adj_pct']}% of expectation)", owner_name, 5, "peer_learning")
    for e in gap["non_controllable_events"]:
        add(f"Coordinate recovery of '{e['title']}' with Network Operations; gap marked non-controllable (SOP-03)",
            "Regional Network Operations Manager", 2, "network")
    if not items:
        add("No drivers are worsening; keep the visit rhythm and share good practices", owner_name, 7, "sustain")

    a = gap["attainment"]
    plan = {
        "id": plan_id, "clusterId": cluster_id, "createdAt": now, "status": "pending",
        "approver": owner["employee_id"] if owner else "",
        "title": f"Action plan {gap['cluster'].replace('Cluster ', '')} — {today.isoformat()}",
        "rationale": f"{gap['cluster']}: raw {a['raw_pct']}%, adjusted {a['adj_pct']}% ({gap['cause_label']})"
                     + (f"; worsening drivers: {', '.join(worse)}" if worse else "") + ".",
        "items": items,
    }
    alert_id = tool_context.state.get("active_alert_id")
    if alert_id:
        plan["alertId"] = alert_id
    tool_context.state["last_plan"] = plan
    focus_cluster(tool_context, cluster_id)
    return {"status": "pending_approval", "approver": owner_name, "plan": plan}
