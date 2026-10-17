"""Monthly revenue/targets per desa, daily series, outlets and planted shocks.

Model per desa d, month t, stream s:
    expected[d,t,s] = base[d,s] * trend[s,t] * season[t] * day_frac[t]   (pure territory potential)
    actual          = expected * cluster_effect * desa_effect * noise * controllable_effects * shocks
    target          = expected * plan_uplift * target_noise (* inflation for some branches)
rev_shock_loss_est holds revenue lost to NON-controllable events so that
    adjusted_attainment = (actual + shock_loss) / expected.
"""

import calendar
from datetime import date

import numpy as np
import pandas as pd

from . import config as C
from .names import outlet_names

PREPAID = ["data", "voice_sms", "digital"]
STREAMS = PREPAID + ["postpaid", "home_bb", "b2b"]
T = len(C.MONTHS)
MONTH_IDX = {m: i for i, m in enumerate(C.MONTHS)}
OUTAGE_DAYS = (date(2026, 10, 3), date(2026, 10, 11))  # Cianjur, 9 days
OUTAGE_RETAINED = 0.25  # share of prepaid revenue still earned on an outage day


def day_weights(days: pd.DatetimeIndex) -> np.ndarray:
    weekday = np.array([0.98, 0.98, 0.98, 0.99, 1.03, 1.05, 1.02])[days.dayofweek]
    payday = np.where((days.day >= 25) | (days.day <= 2), 1.06, 1.0)
    return weekday * payday


def month_days(m: date) -> pd.DatetimeIndex:
    last = C.MTD_DAYS if m == C.MONTHS[-1] else calendar.monthrange(m.year, m.month)[1]
    return pd.date_range(m, periods=last, freq="D")


def _outage_factor() -> float:
    days = month_days(C.MONTHS[-1])
    w = day_weights(days)
    hit = (days.date >= OUTAGE_DAYS[0]) & (days.date <= OUTAGE_DAYS[1])
    return float((w[~hit].sum() + OUTAGE_RETAINED * w[hit].sum()) / w.sum())


def build_monthly(pot: pd.DataFrame, lk: dict, rng: np.random.Generator) -> dict:
    n = len(pot)
    cluster = pot["regency_kode"].map(lk["cluster_of_regency"]).to_numpy()
    branch = np.array(["BR" + p for p in pot["province_kode"]])
    demo = lk["demo_cluster"]
    urban = pot["urban"].to_numpy()
    t3 = (pot["cohort"] == "3t").to_numpy()
    inc = pot["income_factor"].to_numpy()
    pop = pot["population"].astype(float).to_numpy()
    cov = pot["has_4g_coverage"].to_numpy()

    # --- baseline (Jan 2026) per desa ---
    prov_share = pot["province_kode"].map(
        {p: s for p, s in zip(sorted(pot["province_kode"].unique()), rng.uniform(0.36, 0.50, 38))}).to_numpy()
    penetration = np.select([t3, urban], [0.6, 1.2], 0.95)
    subs_base = pop * penetration * prov_share * np.where(cov, 1.0, 0.3)
    arpu = 43_000 * np.sqrt(inc) * np.select([t3, urban], [0.8, 1.1], 0.95)
    mobile = subs_base * arpu
    shares = {"voice_sms": np.where(urban, 0.06, 0.10), "digital": np.full(n, 0.08),
              "postpaid": np.where(urban, 0.07, 0.02)}
    shares["data"] = 1 - shares["voice_sms"] - shares["digital"] - shares["postpaid"]
    base = {s: mobile * shares[s] for s in ("data", "voice_sms", "digital", "postpaid")}
    hh = pot["households"].to_numpy()
    base["home_bb"] = hh * np.select([t3, urban], [0.005, 0.18], 0.05) * 0.6 * 213_500 * inc ** 0.3
    base["b2b"] = mobile * np.where(urban, 0.08, 0.03)

    rel = np.arange(T) - C.FY2026_START_INDEX
    season = np.array([C.SEASONALITY[m.month] for m in C.MONTHS])
    day_frac = np.array([C.MTD_DAYS / calendar.monthrange(m.year, m.month)[1] if i == T - 1 else 1.0
                         for i, m in enumerate(C.MONTHS)])
    expected = {s: base[s][:, None] * ((1 + C.STREAM_TREND[s]) ** rel)[None, :] * (season * day_frac)[None, :]
                for s in STREAMS}

    # --- effects ---
    clusters = np.unique(cluster)
    ce_map = dict(zip(clusters, rng.lognormal(0, 0.035, len(clusters))))
    ce_map.update({demo["Tasikmalaya"]: 1.12, demo["Bekasi"]: 0.93, demo["Sukabumi"]: 1.03,
                   demo["Garut"]: 1.0, demo["Cianjur"]: 1.0})
    ce = np.array([ce_map[c] for c in cluster])
    de = rng.lognormal(0, 0.04, n)
    noise_m = rng.lognormal(0, 0.03, (n, T))
    noise_f = rng.lognormal(0, 0.015, (n, T))
    actual = {s: expected[s] * (ce * de)[:, None] * (noise_m if s in PREPAID else noise_f) for s in STREAMS}

    # Planted, CONTROLLABLE: Garut outlet deactivation hits prepaid from Aug 2026.
    is_garut = cluster == demo["Garut"]
    for m, f in ((date(2026, 8, 1), 0.97), (date(2026, 9, 1), 0.90), (date(2026, 10, 1), 0.86)):
        for s in PREPAID:
            actual[s][is_garut, MONTH_IDX[m]] *= f

    # Planted, NON-controllable shocks (loss recorded for adjusted attainment).
    loss = np.zeros((n, T))
    net_avail = np.clip(np.select([t3, urban], [97.8, 99.6], 99.3)[:, None] + rng.normal(0, 0.15, (n, T)), 90, 99.99)
    events, event_area = [], []

    def apply_shock(mask, month_idx, factor, ev):
        for s in PREPAID:
            before = actual[s][mask, month_idx].copy()
            actual[s][mask, month_idx] *= factor
            loss[mask, month_idx] += before - actual[s][mask, month_idx]
        ev["est_revenue_loss_idr"] = int(loss[mask, month_idx].sum())
        events.append(ev)
        event_area.extend((ev["event_id"], k) for k in pot.loc[mask, "desa_kode"])

    cianjur_regency = C.DEMO_CLUSTERS["Cianjur"][0]
    cj = pot[pot["regency_kode"] == cianjur_regency]
    hit_districts = (cj.groupby("district_kode")["population"].sum().astype(float)
                     .sort_values(ascending=False).index[:8])
    cj_mask = pot["district_kode"].isin(hit_districts).to_numpy()
    of = _outage_factor()
    apply_shock(cj_mask, T - 1, of, {
        "event_id": "EVT001", "event_type": "site_outage", "controllable_by_sales": False,
        "title": "Fiber backbone cut + power outage, Cianjur south", "regency_kode": cianjur_regency,
        "start_date": OUTAGE_DAYS[0], "end_date": OUTAGE_DAYS[1], "affected_streams": ",".join(PREPAID),
        "description": "9-day outage on 31 sites after a landslide cut the fiber backbone; prepaid usage collapsed in 8 kecamatan.",
        "owner_role_id": "RNOM"})
    net_avail[cj_mask, T - 1] = 100 * (1 - 9 / C.MTD_DAYS * 0.85)

    bekasi_mask = cluster == demo["Bekasi"]
    for i, m in enumerate((date(2026, 9, 1), date(2026, 10, 1))):
        apply_shock(bekasi_mask, MONTH_IDX[m], 0.97, {
            "event_id": f"EVT00{2 + i}", "event_type": "competitor_promo", "controllable_by_sales": False,
            "title": "Competitor unlimited-data promo, Bekasi", "regency_kode": ",".join(C.DEMO_CLUSTERS["Bekasi"]),
            "start_date": m, "end_date": date(2026, 10, 16) if i else date(2026, 9, 30),
            "affected_streams": ",".join(PREPAID),
            "description": "Aggressive competitor price promo; ~3% prepaid revenue impact.", "owner_role_id": "BMO"})

    # A few random non-controllable events elsewhere (floods, landslides, outages).
    reg_pool = sorted(set(pot.loc[~pot["province_kode"].isin(C.JAVA_PROVINCES), "regency_kode"]))
    for k, rk in enumerate(rng.choice(reg_pool, 8, replace=False)):
        mi = int(rng.integers(C.FY2026_START_INDEX, T - 1))
        ds = pot.loc[pot["regency_kode"] == rk, "district_kode"].unique()
        hit = rng.choice(ds, max(1, len(ds) // 3), replace=False)
        mask = pot["district_kode"].isin(hit).to_numpy()
        kind = rng.choice(["flood", "landslide", "site_outage"])
        m = C.MONTHS[mi]
        apply_shock(mask, mi, float(rng.uniform(0.82, 0.94)), {
            "event_id": f"EVT{4 + k:03d}", "event_type": kind, "controllable_by_sales": False,
            "title": f"{kind.replace('_', ' ').title()} in {rk}", "regency_kode": rk,
            "start_date": m, "end_date": date(m.year, m.month, int(rng.integers(5, 25))),
            "affected_streams": ",".join(PREPAID), "description": f"Synthetic {kind} event.",
            "owner_role_id": "RNOM"})
        net_avail[mask, mi] -= rng.uniform(3, 12)

    # --- subscribers ---
    subs_trend = 1.002 ** rel
    subs = subs_base[:, None] * subs_trend[None, :] * np.sqrt(ce)[:, None] * rng.lognormal(0, 0.01, (n, T))
    new = subs * 0.035 * rng.lognormal(0, 0.08, (n, T)) * day_frac
    churn = subs * 0.031 * rng.lognormal(0, 0.08, (n, T)) * day_frac
    for m, sf, nf, cf in ((date(2026, 9, 1), 0.96, 0.78, 1.30), (date(2026, 10, 1), 0.94, 0.72, 1.35)):
        i = MONTH_IDX[m]
        subs[is_garut, i] *= sf
        new[is_garut, i] *= nf
        churn[is_garut, i] *= cf
    churn[cj_mask, T - 1] *= 1.15

    # --- targets ---
    tn_map = dict(zip(clusters, rng.normal(1, 0.015, len(clusters))))
    tn = np.array([tn_map[c] for c in cluster])
    uplift = np.where(np.arange(T) < C.FY2026_START_INDEX, 1.02, 1.03)
    infl = pd.Series(branch).str[2:].map(C.INFLATED_TARGET_BRANCHES).fillna(1.0).to_numpy()
    tgt_factor = tn[:, None] * uplift[None, :]
    fy26 = np.arange(T) >= C.FY2026_START_INDEX
    tgt_factor[:, fy26] *= infl[:, None]
    tgt_factor[cluster == demo["Tasikmalaya"], :] = np.where(fy26, 1.077, 1.02)

    return {"pot": pot, "cluster": cluster, "branch": branch, "expected": expected, "actual": actual,
            "loss": loss, "net_avail": net_avail, "subs": subs, "new": new, "churn": churn,
            "subs_base": subs_base, "tgt_factor": tgt_factor, "day_frac": day_frac,
            "events": events, "event_area": event_area, "cianjur_mask": cj_mask}


def build_outlets(pot: pd.DataFrame, lk: dict, partners_sf: pd.DataFrame, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    """NusaPOS outlets for the demo province, with monthly activity for all 13 months."""
    v = pot[pot["province_kode"] == C.DEMO_PROVINCE]
    counts = rng.poisson(v["population"].astype(float).to_numpy() / 1200)
    rows = v.loc[v.index.repeat(counts)].reset_index(drop=True)
    n = len(rows)
    rows["outlet_id"] = [f"OUT{i:06d}" for i in range(1, n + 1)]
    rows["outlet_name"] = outlet_names(rng, n)
    rows["outlet_type"] = rng.choice(["konter_pulsa", "warung", "minimarket", "agen"], n, p=[0.45, 0.35, 0.08, 0.12])
    rows["cluster_id"] = rows["regency_kode"].map(lk["cluster_of_regency"])
    rows["lat"] = rows["lat"] + rng.normal(0, 0.004, n)
    rows["lng"] = rows["lng"] + rng.normal(0, 0.004, n)
    rows["nusapos_enabled"] = rng.random(n) < 0.85
    rows["registered_date"] = pd.Timestamp("2025-10-01") - pd.to_timedelta(rng.integers(0, 2000, n), unit="D")
    active_sf = partners_sf[partners_sf["status"] == "active"]
    sf_by_cluster = active_sf.groupby("cluster_id")["sf_id"].apply(list)
    partner_by_cluster = active_sf.groupby("cluster_id")["partner_id"].first()
    rows["partner_id"] = rows["cluster_id"].map(partner_by_cluster)
    rows["sf_id"] = [sf_by_cluster[c][i % len(sf_by_cluster[c])] for i, c in enumerate(rows["cluster_id"])]
    outlet = rows[["outlet_id", "outlet_name", "outlet_type", "desa_kode", "district_kode", "regency_kode",
                   "cluster_id", "partner_id", "sf_id", "lat", "lng", "nusapos_enabled", "registered_date"]].copy()
    outlet["coord_quality"] = "synthetic_scatter"

    propensity = rng.normal(0, 0.6, n)
    garut = (outlet["cluster_id"] == lk["demo_cluster"]["Garut"]).to_numpy()
    act = []
    for i, m in enumerate(C.MONTHS):
        p = np.full(n, 0.80)
        if m >= date(2026, 8, 1):
            p[garut] = {8: 0.74, 9: 0.62, 10: 0.58}[m.month]
        logit = np.log(p / (1 - p)) + propensity
        active = rng.random(n) < 1 / (1 + np.exp(-logit))
        frac = C.MTD_DAYS / calendar.monthrange(m.year, m.month)[1] if i == T - 1 else 1.0
        value = np.where(active, rng.lognormal(np.log(6e6), 0.6, n) * frac, 0).round(-3)
        act.append(pd.DataFrame({"period": pd.Timestamp(m), "outlet_id": outlet["outlet_id"],
                                 "is_active": active, "recharge_value_idr": value.astype(np.int64),
                                 "txn_count": (value / 25_000).round().astype(np.int32)}))
    return outlet, pd.concat(act, ignore_index=True)


def monthly_tables(r: dict, outlet: pd.DataFrame, outlet_act: pd.DataFrame, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    pot = r["pot"]
    n = len(pot)
    registered = rng.poisson(pot["population"].astype(float).to_numpy() / 1200)
    active_rate = np.clip(rng.normal(0.80, 0.03, (n, T)), 0.5, 0.95)
    active_outlets = np.round(registered[:, None] * active_rate)
    # Demo province: counts come from the outlet table so drill-downs reconcile.
    demo_mask = (pot["province_kode"] == C.DEMO_PROVINCE).to_numpy()
    reg_cnt = outlet.groupby("desa_kode").size()
    act = outlet_act.merge(outlet[["outlet_id", "desa_kode"]], on="outlet_id")
    act_cnt = act[act["is_active"]].groupby(["desa_kode", "period"]).size().unstack(fill_value=0)
    desa_demo = pot.loc[demo_mask, "desa_kode"]
    registered[demo_mask] = desa_demo.map(reg_cnt).fillna(0).to_numpy()
    ac = act_cnt.reindex(index=desa_demo, columns=[pd.Timestamp(m) for m in C.MONTHS], fill_value=0)
    active_outlets[demo_mask, :] = ac.to_numpy()

    keys = pd.DataFrame({"desa_kode": pot["desa_kode"], "district_kode": pot["district_kode"],
                         "regency_kode": pot["regency_kode"], "province_kode": pot["province_kode"],
                         "cluster_id": r["cluster"], "branch_id": r["branch"]})
    actual_rows, target_rows = [], []
    for i, m in enumerate(C.MONTHS):
        a = keys.copy()
        a.insert(0, "period", pd.Timestamp(m))
        a["is_mtd"] = i == T - 1
        a["days_covered"] = C.MTD_DAYS if i == T - 1 else calendar.monthrange(m.year, m.month)[1]
        for s in STREAMS:
            a[f"rev_{s}"] = r["actual"][s][:, i].round().astype(np.int64)
        a["rev_total"] = a[[f"rev_{s}" for s in STREAMS]].sum(axis=1)
        a["rev_shock_loss_est"] = r["loss"][:, i].round().astype(np.int64)
        a["subs_active"] = r["subs"][:, i].round().astype(np.int64)
        a["new_subs"] = r["new"][:, i].round().astype(np.int64)
        a["churned_subs"] = r["churn"][:, i].round().astype(np.int64)
        a["registered_outlets"] = registered.astype(np.int32)
        a["active_outlets"] = active_outlets[:, i].astype(np.int32)
        a["data_payload_tb"] = (r["actual"]["data"][:, i] / 4e6).round(3)
        a["network_availability_pct"] = r["net_avail"][:, i].round(2)
        actual_rows.append(a)

        t = keys[["desa_kode", "cluster_id", "branch_id"]].copy()
        t.insert(0, "period", pd.Timestamp(m))
        f = r["tgt_factor"][:, i]
        for s in STREAMS:
            t[f"rev_{s}_target"] = (r["expected"][s][:, i] * f).round().astype(np.int64)
        t["rev_total_target"] = t[[f"rev_{s}_target" for s in STREAMS]].sum(axis=1)
        t["rev_total_expected"] = sum(r["expected"][s][:, i] for s in STREAMS).round().astype(np.int64)
        t["subs_active_target"] = (r["subs_base"] * 1.002 ** (i - C.FY2026_START_INDEX) * 1.01).round().astype(np.int64)
        t["net_add_target"] = (r["subs_base"] * 0.004 * r["day_frac"][i]).round().astype(np.int64)
        t["active_outlets_target"] = np.round(registered * 0.80).astype(np.int32)
        target_rows.append(t)
    return pd.concat(actual_rows, ignore_index=True), pd.concat(target_rows, ignore_index=True)


def daily_tables(r: dict, monthly: pd.DataFrame, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Daily per desa (demo province, Jul 2026 - MTD) and per cluster (all, Jan 2026 - MTD).
    Daily values are monthly values spread over days, so they always reconcile."""
    pot = r["pot"]
    cj = set(pot.loc[r["cianjur_mask"], "desa_kode"])
    desa_rows, cluster_rows = [], []
    for m in C.MONTHS[C.FY2026_START_INDEX:]:
        days = month_days(m)
        w0 = day_weights(days)
        mm = monthly[monthly["period"] == pd.Timestamp(m)]
        if m >= C.DAILY_DESA_START:
            d = mm[mm["province_kode"] == C.DEMO_PROVINCE].reset_index(drop=True)
            nd, D = len(d), len(days)
            w = w0[None, :] * rng.lognormal(0, 0.04, (nd, D))
            wp = w.copy()
            if m == C.MONTHS[-1]:
                hit_day = (days.date >= OUTAGE_DAYS[0]) & (days.date <= OUTAGE_DAYS[1])
                hit_desa = d["desa_kode"].isin(cj).to_numpy()
                wp[np.ix_(hit_desa, hit_day)] *= OUTAGE_RETAINED
            wp /= wp.sum(axis=1, keepdims=True)
            w /= w.sum(axis=1, keepdims=True)
            out = {"date": np.repeat(days.values[None, :], nd, 0).ravel(),
                   "desa_kode": np.repeat(d["desa_kode"].to_numpy(), D),
                   "cluster_id": np.repeat(d["cluster_id"].to_numpy(), D)}
            for s in PREPAID:
                out[f"rev_{s}"] = (d[f"rev_{s}"].to_numpy()[:, None] * wp).ravel().round()
            other = d[["rev_postpaid", "rev_home_bb", "rev_b2b"]].sum(axis=1).to_numpy()
            out["rev_other"] = (other[:, None] * w).ravel().round()
            avail = np.full((nd, D), 99.5) + rng.normal(0, 0.2, (nd, D))
            if m == C.MONTHS[-1]:
                avail[np.ix_(hit_desa, hit_day)] = rng.uniform(5, 25, (hit_desa.sum(), hit_day.sum()))
            out["network_availability_pct"] = np.clip(avail, 0, 100).ravel().round(2)
            dd = pd.DataFrame(out)
            dd["rev_total"] = dd[[f"rev_{s}" for s in PREPAID] + ["rev_other"]].sum(axis=1)
            desa_rows.append(dd)
        # Cluster daily: aggregate desa daily where available, else spread monthly cluster totals.
        agg = mm.groupby("cluster_id")[["rev_total", "rev_data", "rev_voice_sms", "rev_digital"]].sum()
        if m >= C.DAILY_DESA_START:
            from_desa = dd.groupby(["cluster_id", "date"])[["rev_total", "rev_data", "rev_voice_sms", "rev_digital"]].sum()
            agg = agg.drop(from_desa.index.get_level_values(0).unique())
        nc, D = len(agg), len(days)
        w = w0[None, :] * rng.lognormal(0, 0.025, (nc, D))
        w /= w.sum(axis=1, keepdims=True)
        cd = {"date": np.repeat(days.values[None, :], nc, 0).ravel(),
              "cluster_id": np.repeat(agg.index.to_numpy(), D)}
        for col in ("rev_total", "rev_data", "rev_voice_sms", "rev_digital"):
            cd[col] = (agg[col].to_numpy()[:, None] * w).ravel().round()
        cluster_rows.append(pd.DataFrame(cd))
        if m >= C.DAILY_DESA_START:
            cluster_rows.append(from_desa.reset_index())
    desa_daily = pd.concat(desa_rows, ignore_index=True)
    cluster_daily = pd.concat(cluster_rows, ignore_index=True).sort_values(["cluster_id", "date"], ignore_index=True)
    for df in (desa_daily, cluster_daily):
        for c in df.columns:
            if c.startswith("rev_"):
                df[c] = df[c].astype(np.int64)
    return desa_daily, cluster_daily
