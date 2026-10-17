"""In-memory snapshot of the `tpc` semantic views.

The demo dataset is small (a few hundred thousand derived rows), so the agent loads the views it
needs from BigQuery once (in parallel), keeps them in memory and refreshes them in the background.
Tools then answer in milliseconds instead of issuing 2-4 s BigQuery jobs per call.
"""

import os
import threading
import time
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from .bq import CURRENT_PERIOD, query, table

TTL_SECONDS = int(os.getenv("TPC_SNAPSHOT_TTL", "3600"))
OWNER_KPIS = ("REV_TOTAL", "REV_DATA", "OUTLET_ACTIVE", "RECHARGE_AVAIL", "NETWORK_AVAIL", "NET_ADD")

_lock = threading.Lock()
_snap: dict | None = None
_loaded_at = 0.0
_refreshing = False


def norm(s: str) -> str:
    return unicodedata.normalize("NFD", (s or "").lower()).encode("ascii", "ignore").decode().strip()


def _load() -> dict:
    sql = {
        "att": f"""SELECT level, id, period, name, raw_pct, adj_pct, rev_total, rev_target, rev_expected, gap_total,
                   gap_target_above_potential, gap_non_controllable, gap_controllable
                   FROM {table('attainment_mat')}
                   WHERE period >= DATE_SUB(@p, INTERVAL 3 MONTH) AND (level != 'district' OR period = @p)""",
        "drivers": f"SELECT * FROM {table('cluster_drivers_mat')}",
        "team": f"SELECT * FROM {table('v_team_health')}",
        "owners": f"""SELECT org_unit_id, org_level, kpi_id, kpi_name, raci, role_id, role_title, employee_id, full_name
                      FROM {table('v_kpi_owner')} WHERE kpi_id IN UNNEST(@kpis) ORDER BY org_level, kpi_id, raci""",
        "org": f"SELECT org_unit_id, level, name, parent_org_unit_id, province_kode FROM {table('org_unit')}",
        "org_geo": f"SELECT org_unit_id, geo_kode, geo_level FROM {table('org_unit_geo')}",
        # Villages (~84k) are not cached; desa names are resolved with a direct query when needed.
        "geo": f"""SELECT geo_kode, level, name, parent_kode, province_kode, regency_kode FROM {table('geo_region')}
                   WHERE level != 'village'""",
        "emp": f"SELECT employee_id, full_name, role_id, org_unit_id FROM {table('employee')} WHERE status = 'active'",
        "ss": f"""SELECT og.org_unit_id AS cluster_id, e.full_name, t.assignment_type,
                  STRING_AGG(g.name, ', ' ORDER BY g.name) AS kecamatan
                  FROM {table('territory_assignment')} t JOIN {table('employee')} e USING (employee_id)
                  JOIN {table('geo_region')} g ON g.geo_kode = t.geo_kode
                  JOIN {table('org_unit_geo')} og ON og.geo_kode = g.regency_kode AND og.geo_level = 'regency'
                  WHERE t.geo_level = 'district' GROUP BY 1, 2, 3""",
        "events": f"""SELECT DISTINCT og.org_unit_id AS cluster_id, e.event_id, e.event_type, e.title, e.start_date, e.end_date,
                      DATE_DIFF(e.end_date, e.start_date, DAY) + 1 AS duration_days, e.est_revenue_loss_idr, e.owner_role_id
                      FROM {table('shock_event')} e JOIN {table('shock_event_area')} sa USING (event_id)
                      JOIN {table('geo_region')} g ON g.geo_kode = sa.desa_kode
                      JOIN {table('org_unit_geo')} og ON og.geo_kode = g.regency_kode AND og.geo_level = 'regency'""",
    }
    params = {"att": {"p": CURRENT_PERIOD}, "owners": {"kpis": list(OWNER_KPIS)}}
    with ThreadPoolExecutor(max_workers=len(sql)) as ex:
        futures = {k: ex.submit(query, q, bulk=k in ("att", "geo"), **params.get(k, {})) for k, q in sql.items()}
        raw = {k: f.result() for k, f in futures.items()}

    s: dict = {"loaded_at": time.time()}
    s["att"] = {(r["level"], r["id"], r["period"]): r for r in raw["att"]}
    s["drivers"] = {(r["cluster_id"], r["period"]): r for r in raw["drivers"]}
    s["team"] = {r["org_unit_id"]: r for r in raw["team"]}
    owners = defaultdict(list)
    for r in raw["owners"]:
        owners[r["org_unit_id"]].append(r)
    s["owners"] = dict(owners)
    s["org"] = {r["org_unit_id"]: r for r in raw["org"]}
    org_children = defaultdict(list)
    for r in raw["org"]:
        if r["parent_org_unit_id"]:
            org_children[r["parent_org_unit_id"]].append(r["org_unit_id"])
    s["org_children"] = dict(org_children)
    s["cluster_regencies"] = defaultdict(list)
    s["regency_cluster"] = {}
    for r in sorted(raw["org_geo"], key=lambda x: x["geo_kode"]):
        if r["geo_level"] == "regency":
            s["cluster_regencies"][r["org_unit_id"]].append(r["geo_kode"])
            s["regency_cluster"][r["geo_kode"]] = r["org_unit_id"]
    s["geo"] = {r["geo_kode"]: r for r in raw["geo"]}
    geo_children = defaultdict(list)
    for r in raw["geo"]:
        if r["level"] in ("regency", "district") and r["parent_kode"]:
            geo_children[r["parent_kode"]].append(r["geo_kode"])
    s["geo_children"] = dict(geo_children)
    s["emp"] = {(r["org_unit_id"], r["role_id"]): r for r in raw["emp"]}
    ss = defaultdict(list)
    for r in raw["ss"]:
        ss[r["cluster_id"]].append({k: r[k] for k in ("full_name", "kecamatan", "assignment_type")})
    s["ss"] = dict(ss)
    ev = defaultdict(list)
    for r in raw["events"]:
        ev[r["cluster_id"]].append({k: v for k, v in r.items() if k != "cluster_id"})
    s["events"] = dict(ev)
    # Name index for find_region / name resolution: (rank, level, id, normalised name, display name, province).
    rank = {"cluster": 0, "regency": 1, "province": 2, "district": 3}
    names = [(0, "cluster", r["org_unit_id"], norm(r["name"].replace("Cluster ", "")), r["name"], r["province_kode"])
             for r in raw["org"] if r["level"] == "cluster"]
    for r in raw["geo"]:
        short = r["name"]
        # Provinces are also indexed without their administrative prefix, so "Jakarta" is an exact match for DKI Jakarta.
        for prefix in ("Kabupaten Administrasi ", "Kota Administrasi ", "Kabupaten ", "Kota ",
                       "Daerah Khusus Ibukota ", "Daerah Istimewa ", "Provinsi "):
            short = short.removeprefix(prefix)
        names.append((rank[r["level"]], r["level"], r["geo_kode"], norm(short), r["name"], r["province_kode"]))
    s["names"] = names
    return s


def get() -> dict:
    """Return the snapshot, loading it synchronously the first time and refreshing in the background after TTL."""
    global _snap, _loaded_at, _refreshing
    if _snap is None:
        with _lock:
            if _snap is None:
                _snap = _load()
                _loaded_at = time.time()
    elif time.time() - _loaded_at > TTL_SECONDS and not _refreshing:
        _refreshing = True

        def refresh() -> None:
            global _snap, _loaded_at, _refreshing
            try:
                _snap, _loaded_at = _load(), time.time()
            finally:
                _refreshing = False

        threading.Thread(target=refresh, daemon=True).start()
    return _snap


def warm_up_async() -> None:
    threading.Thread(target=get, daemon=True).start()


def resolve_cluster(place: str) -> tuple[str | None, list[dict]]:
    """Map a cluster id, Kemendagri code or place name to a cluster id. Returns (cluster_id, candidates)."""
    s = get()
    p = place.strip()
    if p in s["org"] and s["org"][p]["level"] == "cluster":
        return p, []
    if p in s["geo"]:
        reg = s["geo"][p]["regency_kode"]
        return s["regency_cluster"].get(reg), []
    if p.count(".") == 3:  # desa code: map through its regency
        return s["regency_cluster"].get(".".join(p.split(".")[:2])), []
    q = norm(p).removeprefix("cluster ").removeprefix("kabupaten ").removeprefix("kab. ").removeprefix("kota ")
    q = q.removeprefix("desa ").removeprefix("kecamatan ").removeprefix("kec. ")
    hits = [n for n in s["names"] if n[3] == q] or [n for n in s["names"] if q and q in n[3]]
    if not hits:  # last resort: village names are only in BigQuery
        rows = query(f"""SELECT geo_kode, name, regency_kode, province_kode FROM {table('geo_region')}
                         WHERE level = 'village' AND LOWER(name) = @q LIMIT 6""", q=q)
        cands = [{"level": "village", "id": r["geo_kode"], "name": r["name"], "province_kode": r["province_kode"]} for r in rows]
        return (s["regency_cluster"].get(rows[0]["regency_kode"]) if len(rows) == 1 else None), cands
    hits.sort(key=lambda n: (n[0], len(n[3])))
    cands = [{"level": n[1], "id": n[2], "name": n[4], "province_kode": n[5]} for n in hits[:6]]
    for n in hits:
        if n[1] == "cluster":
            return n[2], cands
        if n[1] in ("regency", "district", "village"):
            return s["regency_cluster"].get(s["geo"][n[2]]["regency_kode"]), cands
    return None, cands


def ancestors(org_unit_id: str) -> list[str]:
    org, chain, cur = get()["org"], [], org_unit_id
    while cur:
        chain.append(cur)
        cur = org.get(cur, {}).get("parent_org_unit_id")
    return chain


def current_period() -> str:
    return CURRENT_PERIOD.isoformat()
