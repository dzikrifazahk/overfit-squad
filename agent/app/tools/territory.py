"""Read-only territory tools over the in-memory snapshot of the BigQuery semantic views.

Tools accept a place name, Kemendagri code or org id, and move the user's map to the place they
talk about (state["map"]), so the model rarely needs an extra round trip for find_region or set_map_view.
"""

from google.adk.tools import ToolContext

from .bq import BASELINE_PERIODS
from .snapshot import ancestors, current_period, get, norm, resolve_cluster

CAUSE_LABEL = {
    "non_controllable": "outside the team's control (network outage / external event)",
    "target_above_potential": "target above territory potential",
    "under_resourced": "controllable, team short-staffed (backfill first)",
    "controllable": "controllable, fully staffed (coaching)",
    "on_track": "on track",
}
HINT = {
    "non_controllable": "Do not treat as a team performance issue; coordinate recovery with Network Operations (SOP-03).",
    "target_above_potential": "Target was set above territory potential; review the target cascade, do not blame the team.",
    "under_resourced": "Backfill vacancies first, then re-activate outlets and coach new partner sales force.",
    "controllable": "Team is fully staffed: coach on the worsening drivers.",
    "on_track": "Recognise the team and share their practices.",
}
ATT_FIELDS = ("name", "raw_pct", "adj_pct", "rev_total", "rev_target", "rev_expected", "gap_total",
              "gap_target_above_potential", "gap_non_controllable", "gap_controllable")


def classify(raw_pct: float, adj_pct: float, non_controllable: float, capacity: float) -> str:
    """Deterministic cause classification shared with the UI and the proactive runner."""
    if raw_pct >= 97:
        return "on_track"
    if adj_pct >= 97:
        return "non_controllable" if non_controllable > 0 else "target_above_potential"
    return "under_resourced" if capacity < 0.9 else "controllable"


def focus_cluster(tool_context: ToolContext | None, cluster_id: str, layer: str = "adjusted") -> None:
    if tool_context is None:
        return
    regs = get()["cluster_regencies"].get(cluster_id, [])
    if regs:
        tool_context.state["map"] = {"focus": {"level": "regency", "kode": regs[0]}, "layer": layer, "highlight": regs}


def _not_found(place: str, cands: list[dict]) -> dict:
    return {"error": f"could not resolve '{place}' to a sales cluster", "candidates": cands,
            "hint": "Ask the user which one they mean, or call find_region."}


def find_region(name: str) -> dict:
    """Finds provinces, kabupaten/kota, kecamatan, desa or sales clusters by (partial) name.
    Only needed when a name is ambiguous; the other tools already accept names.

    Args:
        name: Place or cluster name, without prefixes like "Kabupaten" or "Kota".

    Returns:
        dict with 'matches': list of {level, id, name, cluster_id, province}.
    """
    s = get()
    q = norm(name)
    hits = sorted((n for n in s["names"] if q and q in n[3]), key=lambda n: (n[3] != q, n[0], len(n[3])))[:8]
    out = []
    for _, level, id_, _, display, prov in hits:
        if level == "cluster":
            cluster = id_
        elif level == "province":
            cluster = None
        else:
            cluster = s["regency_cluster"].get(s["geo"][id_]["regency_kode"])
        out.append({"level": level, "id": id_, "name": display, "cluster_id": cluster,
                    "province": s["geo"].get(prov, {}).get("name")})
    return {"matches": out}


def _resolve_any(place: str) -> tuple[str, str] | None:
    """Resolve to (level, id) for get_attainment."""
    s = get()
    p = place.strip()
    if norm(p) in ("id", "indonesia", "nasional", "national"):
        return "national", "ID"
    if p in s["org"]:
        return s["org"][p]["level"], p
    if p in s["geo"] and s["geo"][p]["level"] in ("province", "regency", "district"):
        return s["geo"][p]["level"], p
    q = norm(p).removeprefix("provinsi ").removeprefix("region ").removeprefix("branch ")
    # An exact province name ("Gorontalo", "Yogyakarta") beats a same-named city or cluster.
    exact = sorted((n for n in s["names"] if n[3] == q and n[1] != "village"), key=lambda n: (n[1] != "province", n[0]))
    partial = sorted((n for n in s["names"] if q and q in n[3] and n[1] != "village"), key=lambda n: (n[0], len(n[3])))
    for n in exact or partial:
        return n[1], n[2]
    return None


def get_attainment(place: str, tool_context: ToolContext) -> dict:
    """Revenue vs target for any territory: raw and potential-adjusted attainment, gap split, 4-month trend
    and its weakest sub-areas. Use for "how is X doing", "which areas are red", national/region overviews.

    raw_pct = actual / target. adj_pct = (actual + non-controllable loss) / revenue expected from territory potential.
    Current period is October 2026 month-to-date (through 16 Oct).

    Args:
        place: A name ("Jawa Barat", "Garut", "Indonesia") or id ('ID', 'R05', 'BR32', 'CL3201', '32', '32.05', '32.05.18').

    Returns:
        dict with 'level', 'current', 'trend' and 'weakest_children' (up to 6, lowest raw first).
    """
    s = get()
    hit = _resolve_any(place)
    if not hit:
        return {"error": f"unknown place '{place}'", "candidates": find_region(place)["matches"]}
    level, id_ = hit
    periods = sorted({k[2] for k in s["att"]}, reverse=True)
    rows = [s["att"][(level, id_, p)] for p in periods if (level, id_, p) in s["att"]]
    if not rows:
        return {"error": f"no data for {level} {id_}"}
    org = s["org"]
    if level == "national":
        kids, kid_level = [u for u, r in org.items() if r["level"] == "region"], "region"
    elif level in ("region", "branch"):
        branches = s["org_children"].get(id_, []) if level == "region" else [id_]
        kids, kid_level = [c for b in branches for c in s["org_children"].get(b, [])], "cluster"
    elif level == "cluster":
        kids, kid_level = [d for r in s["cluster_regencies"].get(id_, []) for d in s["geo_children"].get(r, [])], "district"
    elif level in ("province", "regency"):
        kids, kid_level = s["geo_children"].get(id_, []), "regency" if level == "province" else "district"
    else:
        kids, kid_level = [], ""
    cur = current_period()
    weakest = sorted((s["att"][(kid_level, k, cur)] for k in kids if (kid_level, k, cur) in s["att"]), key=lambda r: r["raw_pct"])[:6]

    # Move the map to the place.
    if level == "cluster":
        focus_cluster(tool_context, id_)
    elif level in ("province", "regency", "district"):
        code = id_ if level != "district" else s["geo"][id_]["regency_kode"]
        tool_context.state["map"] = {"focus": {"level": "province" if level == "province" else "regency", "kode": code},
                                     "layer": "adjusted", "highlight": [id_] if level == "district" else []}
    elif level in ("region", "branch"):
        prov = org[id_]["province_kode"] or org[s["org_children"][id_][0]]["province_kode"]
        tool_context.state["map"] = {"focus": {"level": "province", "kode": prov}, "layer": "adjusted", "highlight": []}
    else:
        tool_context.state["map"] = {"focus": {"level": "national", "kode": None}, "layer": "adjusted", "highlight": []}
    return {"level": level, "id": id_,
            "current": {k: rows[0][k] for k in ATT_FIELDS},
            "trend": [{"period": r["period"], "raw_pct": r["raw_pct"], "adj_pct": r["adj_pct"]} for r in rows],
            "weakest_children": [{"level": kid_level, "id": r["id"], "name": r["name"], "raw_pct": r["raw_pct"], "adj_pct": r["adj_pct"]} for r in weakest]}


def gap_analysis(cluster_id: str) -> dict:
    """Pure function used by explain_gap and draft_action_plan."""
    s = get()
    cur = current_period()
    a = s["att"][("cluster", cluster_id, cur)]
    now = s["drivers"][(cluster_id, cur)]
    base = [s["drivers"][(cluster_id, p.isoformat())] for p in BASELINE_PERIODS]
    spec = [("outlet_active_pct", "Active NusaPOS outlets (%)", True, True), ("stock_pct", "Recharge stock availability (%)", True, True),
            ("ecr", "Effective call rate (partner sales force)", True, True), ("net_adds_per_1k", "Net adds per 1,000 subscribers", True, True),
            ("churn_pct", "Monthly churn (%)", False, True), ("arpu", "Mobile ARPU (Rp)", True, True),
            ("network_avail_pct", "Network availability (%)", True, False)]
    drivers = []
    for key, label, higher_is_better, controllable in spec:
        b = sum(r[key] for r in base) / len(base)
        rel = (now[key] - b) / abs(b) if b else 0.0
        worse = (now[key] < 97) if key == "network_avail_pct" else (rel < -0.05 if higher_is_better else rel > 0.10)
        drivers.append({"driver": label, "now": round(now[key], 2), "baseline_jun_aug": round(b, 2),
                        "change_pct": round(rel * 100, 1), "worse": worse, "controllable_by_sales": controllable})
    events = [e for e in s["events"].get(cluster_id, []) if e["end_date"] >= "2026-09-01"]
    t = s["team"][cluster_id]
    team = {k: t[k] for k in ("planned", "filled", "capacity", "open_vacancies", "vacancies", "engagement_score", "suppressed")}
    team["partner_sales_force"] = {"headcount": now["partner_sf_headcount"], "pct_tenure_lt_12m": now["partner_sf_pct_new"]}
    cause = classify(a["raw_pct"], a["adj_pct"], a["gap_non_controllable"], t["capacity"])
    return {"cluster_id": cluster_id, "cluster": a["name"], "attainment": {k: a[k] for k in ATT_FIELDS if k != "name"},
            "cause": cause, "cause_label": CAUSE_LABEL[cause], "drivers": drivers,
            "non_controllable_events": events, "team": team, "recommendation_hint": HINT[cause]}


def explain_gap(place: str, tool_context: ToolContext) -> dict:
    """Explains WHY a sales cluster is above/below target: driver changes vs the Jun-Aug baseline,
    non-controllable events (outages, competitor promos), team capacity and a cause classification.
    Use for "why is X red/down/missing target". Also moves the map to the cluster.

    Args:
        place: Cluster id ('CL3201'), kabupaten/kecamatan/desa code, or a place name ("Garut").

    Returns:
        dict with attainment, cause, drivers (flagged when worse), events, team, recommendation_hint.
    """
    cid, cands = resolve_cluster(place)
    if not cid:
        return _not_found(place, cands)
    focus_cluster(tool_context, cid)
    return gap_analysis(cid)


def resolve_owner(place: str, tool_context: ToolContext) -> dict:
    """Who is accountable/responsible for a cluster's revenue KPIs, up the management chain (cluster, branch,
    region), the Sales Supervisors per kecamatan, and the Network Operations owner for network issues.
    Use for "who owns", "who is responsible", "siapa PIC" questions.

    Args:
        place: Cluster id, region code or place name ("Garut").

    Returns:
        dict with 'chain', 'owners' (kpi, raci, role, person, org_unit) and 'sales_supervisors'.
    """
    cid, cands = resolve_cluster(place)
    if not cid:
        return _not_found(place, cands)
    s = get()
    chain = ancestors(cid)[:3]
    owners = [{k: r[k] for k in ("org_unit_id", "org_level", "kpi_id", "raci", "role_title", "full_name")}
              for u in chain for r in s["owners"].get(u, [])]
    focus_cluster(tool_context, cid)
    return {"chain": [{"org_unit_id": u, "name": s["org"][u]["name"], "level": s["org"][u]["level"]} for u in chain],
            "owners": owners, "sales_supervisors": s["ss"].get(cid, []),
            "note": "Ownership is attached to roles; 'interim_cover' means the Cluster Sales Manager covers a vacant Sales Supervisor territory."}


def peers_of(cluster_id: str) -> list[dict]:
    s = get()
    region = ancestors(cluster_id)[2]
    cur = current_period()
    out = []
    for b in s["org_children"].get(region, []):
        for c in s["org_children"].get(b, []):
            a = s["att"].get(("cluster", c, cur))
            if c != cluster_id and a and a["adj_pct"] >= 103:
                owner = s["emp"].get((c, "CSM"), {}).get("full_name")
                out.append({"cluster_id": c, "name": a["name"], "raw_pct": a["raw_pct"], "adj_pct": a["adj_pct"], "owner": owner})
    return sorted(out, key=lambda r: -r["adj_pct"])[:3]


def find_peers(place: str, tool_context: ToolContext) -> dict:
    """Finds similar clusters in the same region that are above their potential-based expectation,
    with their owner, as best-practice peers (e.g. for a sharing session).

    Args:
        place: Cluster id or place name of the cluster that needs help.

    Returns:
        dict with 'peers' (up to 3) ordered by adjusted attainment.
    """
    cid, cands = resolve_cluster(place)
    if not cid:
        return _not_found(place, cands)
    s = get()
    peers = peers_of(cid)
    regs = s["cluster_regencies"]
    tool_context.state["map"] = {"focus": {"level": "province", "kode": s["org"][cid]["province_kode"]}, "layer": "adjusted",
                                 "highlight": [r for p in peers for r in regs.get(p["cluster_id"], [])] + regs.get(cid, [])}
    return {"for_cluster": s["org"][cid]["name"], "peers": peers}


def set_map_view(level: str, code: str, layer: str, highlight_codes: list[str], tool_context: ToolContext) -> dict:
    """Changes the user's map explicitly, e.g. to switch layer ("tampilkan peta kuadran/adjusted/raw") or show a place
    no other tool covered. Other tools already move the map to the place they analyse.

    Args:
        level: 'national', 'province', 'regency' or 'desa'.
        code: Kemendagri code ('32', '32.05', '32.05.18.2004'), 'ID' for national, or a cluster id ('CL3201').
        layer: 'raw', 'adjusted' or 'bivariate' (performance x team capacity).
        highlight_codes: Region codes to outline (may be empty).

    Returns:
        dict with the map state sent to the UI.
    """
    s = get()
    code = (code or "").strip()
    # Normalise whatever id the model passes into a map focus (the level is derived from the code).
    if level == "national" or code in ("", "ID"):
        focus = {"level": "national", "kode": None}
    elif code in s["org"]:
        unit = s["org"][code]
        if unit["level"] == "cluster":
            regs = s["cluster_regencies"].get(code, [])
            focus, highlight_codes = {"level": "regency", "kode": regs[0]}, highlight_codes or regs
        else:
            prov = unit["province_kode"] or s["org"][s["org_children"][code][0]]["province_kode"]
            focus = {"level": "province", "kode": prov}
    else:
        depth = code.count(".")
        if depth == 2:  # kecamatan: show its kabupaten and outline the kecamatan
            focus, highlight_codes = {"level": "regency", "kode": code.rsplit(".", 1)[0]}, highlight_codes or [code]
        else:
            focus = {"level": {0: "province", 1: "regency"}.get(depth, "desa"), "kode": code}
    state = {"focus": focus, "layer": layer if layer in ("raw", "adjusted", "bivariate") else "adjusted", "highlight": highlight_codes}
    tool_context.state["map"] = state
    return {"status": "ok", "map": state}
