"""Build the static JSON the Next.js prototype reads (web/public/data/).

    python3 scripts/build_web_data.py

Reads data/synthetic/*.parquet, data/geo/*.geojson, data/docs/sop/*.md and data/demo_manifest.json.
Values are for October 2026 month-to-date (the demo "today" is 2026-10-17).
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SYN = ROOT / "data" / "synthetic"
OUT = ROOT / "web" / "public" / "data"
DEMO_PROVINCE = "32"
OCT = pd.Timestamp("2026-10-01").date()
BASELINE = [pd.Timestamp(m).date() for m in ("2026-06-01", "2026-07-01", "2026-08-01")]


def read(name: str) -> pd.DataFrame:
    return pd.read_parquet(SYN / f"{name}.parquet")


def rdp(points: np.ndarray, eps: float) -> np.ndarray:
    """Iterative Ramer-Douglas-Peucker simplification."""
    if len(points) < 5:
        return points
    keep = np.zeros(len(points), bool)
    keep[[0, -1]] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        seg = points[s + 1:e]
        a, b = points[s], points[e]
        d = b - a
        norm = np.hypot(*d)
        cross = d[0] * (seg[:, 1] - a[1]) - d[1] * (seg[:, 0] - a[0])
        dist = np.abs(cross) / norm if norm else np.hypot(*(seg - a).T)
        i = int(np.argmax(dist))
        if dist[i] > eps:
            keep[s + 1 + i] = True
            stack += [(s, s + 1 + i), (s + 1 + i, e)]
    return points[keep]


def simplify_geojson(src: Path, dst: Path, eps: float, min_area: float) -> None:
    fc = json.loads(src.read_text())
    for f in fc["features"]:
        polys = []
        for poly in f["geometry"]["coordinates"]:
            ring = np.array(poly[0])
            w, h = np.ptp(ring[:, 0]), np.ptp(ring[:, 1])
            if w * h < min_area:  # drop tiny islets
                continue
            r = rdp(ring, eps)
            if len(r) >= 4:
                polys.append([np.round(r, 3).tolist()])
        if not polys:  # keep at least the largest ring
            big = max(f["geometry"]["coordinates"], key=lambda p: len(p[0]))
            polys = [[np.round(np.array(big[0]), 3).tolist()]]
        f["geometry"]["coordinates"] = polys
    dst.write_text(json.dumps(fc, separators=(",", ":")))


def attainment(df: pd.DataFrame, key: str) -> pd.DataFrame:
    g = df.groupby(key)[["rev_total", "rev_total_target", "rev_total_expected", "rev_shock_loss_est"]].sum()
    g["raw"] = (g["rev_total"] / g["rev_total_target"] * 100).round(1)
    g["adj"] = ((g["rev_total"] + g["rev_shock_loss_est"]) / g["rev_total_expected"] * 100).round(1)
    # Gap vs target split: target above potential / non-controllable shocks / controllable remainder.
    g["gap_total"] = g["rev_total_target"] - g["rev_total"]
    g["gap_target_above_potential"] = (g["rev_total_target"] - g["rev_total_expected"]).clip(lower=0)
    g["gap_non_controllable"] = g["rev_shock_loss_est"]
    g["gap_controllable"] = g["rev_total_expected"] - g["rev_total"] - g["rev_shock_loss_est"]
    return g


def records(g: pd.DataFrame, cols) -> dict:
    return {k: {c: (None if pd.isna(v) else (int(v) if isinstance(v, (np.integer,)) else (float(v) if isinstance(v, np.floating) else v)))
                for c, v in row.items() if c in cols} for k, row in g.iterrows()}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    simplify_geojson(ROOT / "data/geo/provinces.geojson", OUT / "provinces.geojson", eps=0.02, min_area=0.002)
    simplify_geojson(ROOT / "data/geo/regencies.geojson", OUT / "regencies.geojson", eps=0.006, min_area=0.0004)

    geo = read("geo_region")
    names = geo.set_index("geo_kode")["name"]
    monthly, target = read("revenue_monthly"), read("revenue_target_monthly")
    m = monthly.merge(target, on=["period", "desa_kode", "cluster_id", "branch_id"])
    oct_ = m[m["period"] == OCT]
    cols = ["name", "rev_total", "rev_total_target", "rev_total_expected", "rev_shock_loss_est", "raw", "adj",
            "gap_total", "gap_target_above_potential", "gap_non_controllable", "gap_controllable", "cluster_id"]

    org = read("org_unit")
    org_geo = read("org_unit_geo")
    reg_cluster = org_geo[org_geo["geo_level"] == "regency"].set_index("geo_kode")["org_unit_id"]

    prov = attainment(oct_, "province_kode")
    prov["name"] = names.reindex(prov.index).to_numpy()
    reg = attainment(oct_, "regency_kode")
    reg["name"] = names.reindex(reg.index).to_numpy()
    reg["cluster_id"] = reg_cluster.reindex(reg.index).to_numpy()
    jab = oct_[oct_["province_kode"] == DEMO_PROVINCE]
    dist = attainment(jab, "district_kode")
    dist["name"] = names.reindex(dist.index).to_numpy()
    desa = attainment(jab, "desa_kode")
    desa["name"] = names.reindex(desa.index).to_numpy()
    gpos = geo.set_index("geo_kode")[["lat", "lng"]]
    desa_pts = [{"kode": k, "name": r["name"], "lat": round(float(gpos.at[k, "lat"]), 5),
                 "lng": round(float(gpos.at[k, "lng"]), 5), "raw": float(r["raw"]), "adj": float(r["adj"]),
                 "rev": int(r["rev_total"])} for k, r in desa.iterrows()]

    # --- people & capacity per cluster ---
    emp, pos, vac = read("employee"), read("position"), read("vacancy")
    roles = read("role").set_index("role_id")
    active = emp[emp["status"] == "active"].copy()
    as_of = pd.Timestamp("2026-10-16")
    active["tenure_months"] = ((as_of - pd.to_datetime(active["hire_date"])).dt.days / 30.4).round(1)
    eng = read("engagement_survey").set_index("org_unit_id")
    sfm = read("partner_sf_monthly")
    stock = read("channel_stock_monthly")
    ev, ev_area = read("shock_event"), read("shock_event_area")
    ev_area = ev_area.merge(monthly[monthly["period"] == OCT][["desa_kode", "cluster_id"]], on="desa_kode")
    ta = read("territory_assignment")

    cl_att = attainment(oct_, "cluster_id")
    br_att = attainment(oct_, "branch_id")
    reg_unit = org.set_index("org_unit_id")
    region_of_branch = reg_unit["parent_org_unit_id"]
    rg_att = attainment(oct_.assign(region_id=oct_["branch_id"].map(region_of_branch)), "region_id")

    def holder(unit, role):
        e = active[(active["org_unit_id"] == unit) & (active["role_id"] == role)]
        return None if e.empty else {"employee_id": e.iloc[0]["employee_id"], "name": e.iloc[0]["full_name"],
                                     "role": roles.at[role, "title"], "role_id": role}

    def driver_row(cid):
        cur = monthly[(monthly["cluster_id"] == cid)]
        def stat(period_list):
            d = cur[cur["period"].isin(period_list)]
            g = d.groupby("period")[["active_outlets", "registered_outlets", "subs_active", "new_subs", "churned_subs",
                                     "rev_data", "rev_voice_sms", "rev_digital", "rev_postpaid"]].sum()
            days = d.groupby("period")["days_covered"].first()
            mobile = g[["rev_data", "rev_voice_sms", "rev_digital", "rev_postpaid"]].sum(axis=1) / days * 30.4
            w = d.groupby("period").apply(lambda x: np.average(x["network_availability_pct"], weights=x["rev_total"] + 1),
                                          include_groups=False)
            return {"outlet_active_pct": float((g["active_outlets"] / g["registered_outlets"]).mean() * 100),
                    "net_adds_per_1k": float(((g["new_subs"] - g["churned_subs"]) / g["subs_active"] * 1000 / days * 30.4).mean()),
                    "churn_pct": float((g["churned_subs"] / g["subs_active"] / days * 30.4 * 100).mean()),
                    "arpu": float((mobile / g["subs_active"]).mean()),
                    "network_avail_pct": float(w.mean())}
        now, base = stat([OCT]), stat(BASELINE)
        st = stock[stock["cluster_id"] == cid].set_index("period")["recharge_availability_pct"]
        sf = sfm[sfm["cluster_id"] == cid].set_index("period")
        now["stock_pct"], base["stock_pct"] = float(st[OCT]), float(st[BASELINE].mean())
        now["ecr"], base["ecr"] = float(sf.at[OCT, "effective_call_rate"]), float(sf.loc[BASELINE, "effective_call_rate"].mean())
        spec = [("outlet_active_pct", "Active NusaPOS outlets", "%", True, True),
                ("stock_pct", "Recharge stock availability", "%", True, True),
                ("ecr", "Effective call rate (partner sales force)", "ratio", True, True),
                ("net_adds_per_1k", "Net adds per 1,000 subscribers", "", True, True),
                ("churn_pct", "Monthly churn", "%", False, True),
                ("arpu", "Mobile ARPU", "Rp", True, True),
                ("network_avail_pct", "Network availability", "%", True, False)]
        out = []
        for key, label, unit, higher, ctrl in spec:
            delta = now[key] - base[key]
            rel = delta / abs(base[key]) if base[key] else 0
            bad = (rel < -0.05) if higher else (rel > 0.10)
            if key == "network_avail_pct":
                bad = now[key] < 97
            out.append({"key": key, "label": label, "unit": unit, "now": round(now[key], 3), "baseline": round(base[key], 3),
                        "delta_pct": round(rel * 100, 1), "flag": bool(bad), "controllable": ctrl})
        return out

    clusters = {}
    cl_rows = org[org["level"] == "cluster"]
    for c in cl_rows.itertuples():
        planned = int((pos["org_unit_id"] == c.org_unit_id).sum())
        team = active[active["org_unit_id"] == c.org_unit_id]
        filled = len(team)
        v = vac[vac["org_unit_id"] == c.org_unit_id]
        e = eng.loc[c.org_unit_id] if c.org_unit_id in eng.index else None
        sf_now = sfm[(sfm["cluster_id"] == c.org_unit_id) & (sfm["period"] == OCT)].iloc[0]
        a = cl_att.loc[c.org_unit_id]
        capacity = filled / planned if planned else 1
        clusters[c.org_unit_id] = {
            "id": c.org_unit_id, "name": c.name, "branch_id": c.parent_org_unit_id, "province_kode": c.province_kode,
            "regencies": org_geo[(org_geo["org_unit_id"] == c.org_unit_id)]["geo_kode"].tolist(),
            "raw": float(a["raw"]), "adj": float(a["adj"]),
            "rev_total": int(a["rev_total"]), "rev_total_target": int(a["rev_total_target"]),
            "rev_total_expected": int(a["rev_total_expected"]), "rev_shock_loss_est": int(a["rev_shock_loss_est"]),
            "gap_target_above_potential": float(a["gap_target_above_potential"]),
            "gap_non_controllable": float(a["gap_non_controllable"]), "gap_controllable": float(a["gap_controllable"]),
            "capacity": round(capacity, 2), "planned": planned, "filled": filled,
            "quadrant": ("performing" if a["adj"] >= 97 else "missing") + "_" + ("staffed" if capacity >= 0.9 else "understaffed"),
            "owner": holder(c.org_unit_id, "CSM"),
            "team_size": filled,
            "team_gate": filled < 5,
            "members": [] if filled < 5 else [
                {"name": t.full_name, "role": roles.at[t.role_id, "title"], "tenure_months": float(t.tenure_months),
                 "employment_type": t.employment_type} for t in team.itertuples()],
            "pct_tenure_lt_12m": None if filled < 5 else round(float((team["tenure_months"] < 12).mean() * 100), 0),
            "vacancies": [{"role": roles.at[r.role_id, "title"], "days_open": int(r.days_open),
                           "backfill_request_submitted": bool(r.backfill_request_submitted)} for r in v.itertuples()],
            "engagement": None if e is None or e["respondents"] < 5 else float(e["engagement_score"]),
            "engagement_suppressed": bool(e is None or e["respondents"] < 5),
            "partner_sf": {"headcount": int(sf_now["headcount_eom"]), "pct_tenure_lt_12m": float(sf_now["pct_tenure_lt_12m"]),
                           "effective_call_rate": float(sf_now["effective_call_rate"])},
            "events": [{"event_id": r.event_id, "type": r.event_type, "title": r.title, "start": str(r.start_date),
                        "end": str(r.end_date), "loss": int(r.est_revenue_loss_idr)}
                       for r in ev[ev["event_id"].isin(ev_area[ev_area["cluster_id"] == c.org_unit_id]["event_id"])].itertuples()],
        }
        if c.province_kode == DEMO_PROVINCE:
            clusters[c.org_unit_id]["drivers"] = driver_row(c.org_unit_id)
        ser = m[m["cluster_id"] == c.org_unit_id].groupby("period")[["rev_total", "rev_total_target", "rev_total_expected", "rev_shock_loss_est"]].sum()
        clusters[c.org_unit_id]["series"] = [
            {"period": str(p)[:7], "raw": round(r.rev_total / r.rev_total_target * 100, 1),
             "adj": round((r.rev_total + r.rev_shock_loss_est) / r.rev_total_expected * 100, 1)} for p, r in ser.iterrows()]

    # Capacity & quadrant per regency/province (from clusters).
    for k in reg.index:
        c = clusters[reg.at[k, "cluster_id"]]
        reg.at[k, "capacity"] = c["capacity"]
    prov_cap = {}
    for p in prov.index:
        cs = [c for c in clusters.values() if c["province_kode"] == p]
        prov_cap[p] = round(sum(c["filled"] for c in cs) / max(1, sum(c["planned"] for c in cs)), 2)
    prov["capacity"] = pd.Series(prov_cap)

    # Peers: same region, adjusted >= 103, best first.
    region_of_cluster = {cid: region_of_branch[c["branch_id"]] for cid, c in clusters.items()}
    for cid, c in clusters.items():
        peers = sorted([o for o in clusters.values() if o["id"] != cid and region_of_cluster[o["id"]] == region_of_cluster[cid]
                        and o["adj"] >= 103], key=lambda o: -o["adj"])[:3]
        c["peers"] = [{"id": o["id"], "name": o["name"], "adj": o["adj"], "raw": o["raw"],
                       "owner": o["owner"]["name"] if o["owner"] else None} for o in peers]

    # Owner chain per cluster/branch/region.
    chains = {}
    for b in org[org["level"] == "branch"].itertuples():
        chains[b.org_unit_id] = {"name": b.name, "region_id": b.parent_org_unit_id,
                                 "BM": holder(b.org_unit_id, "BM"), "BCM": holder(b.org_unit_id, "BCM"),
                                 "BSM": holder(b.org_unit_id, "BSM"),
                                 "raw": float(br_att.at[b.org_unit_id, "raw"]), "adj": float(br_att.at[b.org_unit_id, "adj"])}
    for r in org[org["level"] == "region"].itertuples():
        chains[r.org_unit_id] = {"name": r.name, "RGM": holder(r.org_unit_id, "RGM"), "RNOM": holder(r.org_unit_id, "RNOM"),
                                 "RHRBP": holder(r.org_unit_id, "RHRBP"),
                                 "raw": float(rg_att.at[r.org_unit_id, "raw"]), "adj": float(rg_att.at[r.org_unit_id, "adj"])}
    # Sales Supervisor per kecamatan (demo province).
    ss = ta[(ta["geo_level"] == "district") & ta["geo_kode"].str.startswith(DEMO_PROVINCE + ".")]
    ss = ss.merge(emp[["employee_id", "full_name", "role_id"]], on="employee_id")
    dist["owner"] = ss.set_index("geo_kode").reindex(dist.index)["full_name"].to_numpy()
    dist["owner_type"] = ss.set_index("geo_kode").reindex(dist.index)["assignment_type"].to_numpy()

    manifest = json.loads((ROOT / "data/demo_manifest.json").read_text())
    inj = manifest["live_inject_event"]
    inj["desa_name"] = names[inj["desa_kode"]]
    inj["district_name"] = names[".".join(inj["desa_kode"].split(".")[:3])]
    inj["lat"], inj["lng"] = float(gpos.at[inj["desa_kode"], "lat"]), float(gpos.at[inj["desa_kode"], "lng"])
    personas = manifest["personas"]

    docs = [{"id": p.stem.split("_")[0], "title": p.read_text().splitlines()[0].lstrip("# "), "text": p.read_text()}
            for p in sorted((ROOT / "data/docs/sop").glob("*.md"))]

    payload = {
        "as_of": "2026-10-16", "period": "2026-10 (MTD through 16 Oct)",
        "national": {k: float(v) for k, v in attainment(oct_.assign(n="ID"), "n").iloc[0][["raw", "adj"]].items()},
        "provinces": records(prov, cols + ["capacity"]),
        "regencies": records(reg, cols + ["capacity"]),
        "districts": records(dist, cols + ["owner", "owner_type"]),
        "clusters": clusters, "units": chains, "personas": personas, "inject": inj,
        "manifest": {"planted": manifest["planted_anomalies"], "guardrails": manifest["guardrail_cases"]},
    }
    (OUT / "metrics.json").write_text(json.dumps(payload, default=str, separators=(",", ":")))
    (OUT / "desa_jabar.json").write_text(json.dumps(desa_pts, separators=(",", ":")))
    (OUT / "docs.json").write_text(json.dumps(docs, separators=(",", ":")))
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:22s} {f.stat().st_size / 1e6:6.2f} MB")


if __name__ == "__main__":
    main()
