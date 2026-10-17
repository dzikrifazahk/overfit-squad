"""HR performance facts derived from the revenue data: KPI scorecards, AKHLAK
behaviour scores, team engagement, partner sales-force aggregates, stock availability."""

import calendar

import numpy as np
import pandas as pd

from . import config as C
from .catalog import SCORECARDS


def channel_stock(clusters: list[str], lk: dict, rng) -> pd.DataFrame:
    rows = []
    garut = lk["demo_cluster"]["Garut"]
    for m in C.MONTHS:
        v = np.clip(rng.normal(96.5, 1.2, len(clusters)), 88, 99.9)
        df = pd.DataFrame({"period": pd.Timestamp(m), "cluster_id": clusters, "recharge_availability_pct": v.round(1)})
        if m.year == 2026 and m.month in (9, 10):
            df.loc[df["cluster_id"] == garut, "recharge_availability_pct"] = 92.8 if m.month == 9 else 88.9
        rows.append(df)
    return pd.concat(rows, ignore_index=True)


def behavior_scores(emp: pd.DataFrame, rng) -> pd.DataFrame:
    values = ["amanah", "kompeten", "harmonis", "loyal", "adaptif", "kolaboratif"]
    rows = []
    for q, q_end in (("2026Q1", "2026-03-31"), ("2026Q2", "2026-06-30"), ("2026Q3", "2026-09-30")):
        e = emp[(emp["hire_date"] <= q_end) & (emp["exit_date"].isna() | (emp["exit_date"] > q_end))]
        person = pd.Series(rng.normal(0, 0.25, len(e)), index=e["employee_id"])
        df = pd.DataFrame({"quarter": q, "employee_id": e["employee_id"].to_numpy()})
        for v in values:
            df[v] = np.clip(2.0 + person.to_numpy() + rng.normal(0, 0.2, len(e)), 0, 3).round(2)
        df["akhlak_avg"] = df[values].mean(axis=1).round(2)
        rows.append(df)
    return pd.concat(rows, ignore_index=True)


def kpi_scores(emp, ta, monthly, target, stock, behavior) -> pd.DataFrame:
    """Monthly scorecards for line roles, computed from each person's assigned geography."""
    m = monthly.merge(target, on=["period", "desa_kode", "cluster_id", "branch_id"])
    m["net_add"] = m["new_subs"] - m["churned_subs"]
    cols = ["rev_total", "rev_total_target", "rev_data", "rev_data_target", "rev_home_bb", "rev_home_bb_target",
            "rev_b2b", "rev_b2b_target", "net_add", "net_add_target", "active_outlets", "active_outlets_target"]
    by_level = {
        "district": m.groupby(["period", "district_kode"])[cols].sum(),
        "cluster": m.groupby(["period", "cluster_id"])[cols].sum(),
        "province": m.groupby(["period", "province_kode"])[cols].sum(),
    }
    akhlak = behavior.sort_values("quarter").groupby("employee_id")["akhlak_avg"].last()
    stock_ix = stock.set_index(["period", "cluster_id"])["recharge_availability_pct"]
    geo_of = {k: g for k, g in ta.groupby(["employee_id", "geo_level"])["geo_kode"]}
    emp_active = emp[emp["role_id"].isin(SCORECARDS)]
    rows = []
    for mo in C.HR_SCORE_MONTHS:
        period = pd.Timestamp(mo)
        month_end = pd.Timestamp(mo.year, mo.month, calendar.monthrange(mo.year, mo.month)[1])
        e = emp_active[(emp_active["hire_date"] <= month_end - pd.Timedelta(days=14))
                       & (emp_active["exit_date"].isna() | (emp_active["exit_date"] > month_end))]
        for p in e.itertuples():
            if p.role_id == "SS":
                geo = geo_of.get((p.employee_id, "district"), [])
                agg = by_level["district"].loc[period].reindex(geo).sum()
            elif p.role_id in ("CSM", "CO"):
                agg = by_level["cluster"].loc[(period, p.org_unit_id)]
            else:
                geo = geo_of.get((p.employee_id, "province"), [])
                agg = by_level["province"].loc[period].reindex(geo).sum()
            cluster = p.org_unit_id if p.org_unit_id.startswith("CL") else None
            for kpi, weight in SCORECARDS[p.role_id]:
                if kpi == "AKHLAK":
                    tgt, act = 2.0, float(akhlak.get(p.employee_id, 2.0))
                elif kpi == "RECHARGE_AVAIL":
                    tgt, act = 97.0, float(stock_ix.get((period, cluster), 97.0))
                else:
                    col = {"REV_TOTAL": "rev_total", "REV_DATA": "rev_data", "REV_HOME_BB": "rev_home_bb",
                           "REV_B2B": "rev_b2b", "NET_ADD": "net_add", "OUTLET_ACTIVE": "active_outlets"}[kpi]
                    tgt, act = float(agg[f"{col}_target"]), float(agg[col])
                ach = act / tgt * 100 if tgt else None
                rows.append({"period": period, "employee_id": p.employee_id, "role_id": p.role_id,
                             "org_unit_id": p.org_unit_id, "kpi_id": kpi, "weight_pct": weight,
                             "target_value": round(tgt, 2), "actual_value": round(act, 2),
                             "achievement_pct": None if ach is None else round(ach, 1),
                             # Scorecard convention: achievement capped to 0-150% before weighting.
                             "score_pct": None if ach is None else round(min(max(ach, 0.0), 150.0), 1)})
    return pd.DataFrame(rows)


def engagement(org_unit: pd.DataFrame, emp: pd.DataFrame, lk: dict, rng) -> pd.DataFrame:
    active = emp[emp["status"] == "active"].groupby("org_unit_id").size()
    rows = []
    for u in org_unit[org_unit["level"].isin(["cluster", "branch", "region"])].itertuples():
        invited = int(active.get(u.org_unit_id, 0))
        garut = u.org_unit_id == lk["demo_cluster"]["Garut"]
        respondents = invited if garut else int(round(invited * rng.uniform(0.75, 0.95)))
        score = 66.0 if garut else rng.normal(80, 4.5)
        rows.append({"survey_period": "2026H1", "org_unit_id": u.org_unit_id, "invited": invited,
                     "respondents": respondents, "engagement_score": round(float(np.clip(score, 50, 95)), 1),
                     "enps": int(np.clip(rng.normal(25, 12) - (20 if score < 70 else 0), -40, 70))})
    return pd.DataFrame(rows)


def partner_sf_monthly(sf: pd.DataFrame, lk: dict, rng) -> pd.DataFrame:
    garut = lk["demo_cluster"]["Garut"]
    rows = []
    for i, mo in enumerate(C.MONTHS):
        start = pd.Timestamp(mo)
        days = C.MTD_DAYS if i == len(C.MONTHS) - 1 else calendar.monthrange(mo.year, mo.month)[1]
        end = start + pd.Timedelta(days=days - 1)
        on = sf[(sf["join_date"] <= end) & (sf["exit_date"].isna() | (sf["exit_date"] > end))]
        g = on.groupby("cluster_id")
        head = g.size()
        new12 = on[(end - on["join_date"]).dt.days < 365].groupby("cluster_id").size()
        hires = sf[(sf["join_date"] >= start) & (sf["join_date"] <= end)].groupby("cluster_id").size()
        exits = sf[(sf["exit_date"] >= start) & (sf["exit_date"] <= end)].groupby("cluster_id").size()
        df = pd.DataFrame({"headcount_eom": head})
        df["hires"] = hires.reindex(df.index, fill_value=0)
        df["exits"] = exits.reindex(df.index, fill_value=0)
        df["pct_tenure_lt_12m"] = (new12.reindex(df.index, fill_value=0) / head * 100).round(1)
        work_days = round(days * 22 / 30)
        df["outlet_visits"] = (head * work_days * rng.normal(16, 1.5, len(df))).round().astype(int)
        ecr = rng.normal(0.72, 0.03, len(df))
        if mo.year == 2026 and mo.month in (9, 10):
            ecr[df.index == garut] = 0.57 if mo.month == 9 else 0.54
        df["effective_call_rate"] = ecr.round(3)
        df = df.reset_index().rename(columns={"index": "cluster_id"})
        df.insert(0, "period", start)
        rows.append(df)
    out = pd.concat(rows, ignore_index=True)
    out["partner_id"] = out["cluster_id"].map(sf.groupby("cluster_id")["partner_id"].first())
    return out
