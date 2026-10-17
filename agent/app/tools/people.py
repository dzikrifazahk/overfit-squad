"""People tools. Privacy rules (POL-01) are enforced here and in SQL, not left to the prompt:
team metrics need n >= 5, team details are visible only inside the viewer's own org subtree,
and no tool returns individual scores, rankings or flight-risk."""

from google.adk.tools import ToolContext

from .bq import query, table
from .snapshot import ancestors, current_period, get, resolve_cluster
from .territory import focus_cluster


def _org_unit(place: str) -> str | None:
    s = get()
    if place in s["org"] and s["org"][place]["level"] in ("cluster", "branch"):
        return place
    return resolve_cluster(place)[0]


def _in_scope(tool_context: ToolContext, org_unit_id: str) -> bool:
    viewer_unit = (tool_context.state.get("persona") or {}).get("org_unit_id")
    return bool(viewer_unit) and viewer_unit in ancestors(org_unit_id)


def team_snapshot(place: str, tool_context: ToolContext) -> dict:
    """Team capacity and health for a cluster or branch: planned vs filled positions, open vacancies
    (and whether backfill was requested), tenure mix, attrition, engagement, partner sales-force capacity.

    Use for "how is the team", "is X short-staffed", "kenapa kurang orang". Only works for org units
    inside the current user's own area; group metrics are hidden when the team has fewer than 5 people.

    Args:
        place: Cluster/branch id ('CL3201', 'BR32') or place name ("Garut").

    Returns:
        dict with team metrics, or 'denied'/'suppressed' with the reason.
    """
    unit = _org_unit(place)
    if not unit:
        return {"error": f"could not resolve '{place}'"}
    if not _in_scope(tool_context, unit):
        return {"denied": True, "org_unit": get()["org"][unit]["name"],
                "reason": "Org unit is outside the user's own area (POL-01). Offer territory-level revenue figures instead."}
    s = get()
    t = s["team"][unit]
    clusters = [unit] if s["org"][unit]["level"] == "cluster" else s["org_children"].get(unit, [])
    drv = [s["drivers"][(c, current_period())] for c in clusters]
    sf = {"headcount": sum(d["partner_sf_headcount"] for d in drv),
          "pct_tenure_lt_12m": round(sum(d["partner_sf_pct_new"] for d in drv) / len(drv)),
          "effective_call_rate": round(sum(d["ecr"] for d in drv) / len(drv), 2)}
    if s["org"][unit]["level"] == "cluster":
        focus_cluster(tool_context, unit, layer="bivariate")
    if t["suppressed"]:
        return {"suppressed": True, "org_unit": t["name"], "team_size": t["filled"],
                "reason": "Team has fewer than 5 people; group metrics are hidden (POL-01).",
                "open_vacancies": t["open_vacancies"], "partner_sales_force": sf}
    return {**t, "partner_sales_force": sf,
            "note": "Partner sales force are distributor staff: only aggregate capacity is shown, never individuals."}


def team_scorecard_summary(place: str, tool_context: ToolContext) -> dict:
    """Distribution of the team's October scorecard achievement (how many members are below/at/above 100%)
    for a cluster or branch the user leads, to support coaching conversations. Never lists or ranks individuals.

    Args:
        place: Cluster/branch id or place name inside the user's own area.

    Returns:
        dict with counts per achievement band per KPI, or 'denied'/'suppressed'.
    """
    unit = _org_unit(place)
    if not unit or not _in_scope(tool_context, unit):
        return {"denied": True, "reason": "Outside the user's own area (POL-01)."}
    rows = query(f"""SELECT kpi_id, COUNT(*) AS n,
                       COUNTIF(score_pct < 90) AS below_90, COUNTIF(score_pct >= 90 AND score_pct < 100) AS between_90_100,
                       COUNTIF(score_pct >= 100) AS at_or_above_100
                     FROM {table('kpi_score_monthly')} s JOIN {table('org_unit')} o ON o.org_unit_id = s.org_unit_id
                     WHERE s.period = DATE '2026-10-01' AND (s.org_unit_id = @u OR o.parent_org_unit_id = @u)
                     GROUP BY kpi_id""", u=unit)
    if not rows or max(r["n"] for r in rows) < 5:
        return {"suppressed": True, "reason": "Fewer than 5 people; distribution hidden (POL-01)."}
    return {"period": "2026-10 MTD", "bands": rows, "note": "Achievement capped 0-150%. Use for coaching, never for ranking or sanctions."}
