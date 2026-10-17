"""Internal employees (positions, vacancies, territory assignments) and the partner sales force.

Distributions are calibrated to TelkomGroup/Telkomsel 2025 disclosures where the
report cites them (gender mix, permanent share, education); span of control and
team sizes are assumptions.
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import config as C
from .names import partner_name, person_name

PERSONAS = {  # (org unit key, role_id) -> (name, gender)
    ("R05", "RGM"): ("Rina Kusumawardani", "F"),
    ("BR32", "BM"): ("Hendra Gunawan", "M"),
    ("R05", "RNOM"): ("Wahyu Nugroho", "M"),
    ("R05", "RHRBP"): ("Dewi Anggraini", "F"),
    ("Garut", "CSM"): ("Budi Santoso", "M"),
    ("Tasikmalaya", "CSM"): ("Sari Wulandari", "F"),
    ("Cianjur", "CSM"): ("Asep Supriatna", "M"),
    ("Bekasi", "CSM"): ("Andi Pratama", "M"),
}
REPORTS_TO = {"HQ_PLAN": "CSO", "HQ_CHANNEL": "CSO", "HQ_HR": "CSO", "AVP": "CSO",
              "AREA_PLAN": "AVP", "AREA_HRBP": "AVP", "RGM": "AVP",
              "RSM": "RGM", "RCM": "RGM", "RB2B": "RGM", "RHRBP": "RGM", "RNOM": "RGM", "BM": "RGM",
              "BSM": "BM", "BCM": "BM", "B2B_AM": "BM", "BMO": "BM", "BSA": "BM", "CSM": "BM",
              "SS": "CSM", "CO": "CSM"}
NEVER_VACANT = {"CSO", "AVP", "RGM", "BM", "CSM"}
SENIOR = {"CSO", "HQ_PLAN", "HQ_CHANNEL", "HQ_HR", "AVP", "AREA_PLAN", "AREA_HRBP", "RGM"}


def build_positions(org_unit: pd.DataFrame, lk: dict, regions: pd.DataFrame) -> pd.DataFrame:
    pop_by_regency = regions[regions["level"] == "regency"].set_index("kode")["population"].astype(float)
    cluster_pop = pop_by_regency.groupby(lk["cluster_of_regency"]).sum()
    prov_pop = regions[regions["level"] == "province"].set_index("kode")["population"].astype(float)
    rows = []
    for u in org_unit.itertuples():
        if u.level == "national":
            roles = ["CSO", "HQ_PLAN", "HQ_CHANNEL", "HQ_HR"]
        elif u.level == "area":
            roles = ["AVP", "AREA_PLAN", "AREA_HRBP"]
        elif u.level == "region":
            roles = ["RGM", "RSM", "RCM", "RB2B", "RHRBP", "RNOM"]
        elif u.level == "branch":
            roles = ["BM", "BSM", "BCM", "BMO", "BSA"] + ["B2B_AM"] * (2 if prov_pop[u.province_kode] > 10e6 else 1)
        else:
            pop = cluster_pop[u.org_unit_id]
            ss = int(np.clip(round(pop / 700_000) + 2, 2, 4))
            co = 2 if pop > 1_500_000 else 1
            if 1 + ss + co < 5:
                ss += 1
            if u.org_unit_id == lk["small_team_cluster"]:
                ss, co = 2, 1
            if u.org_unit_id == lk["demo_cluster"]["Garut"]:
                ss, co = 4, 2
            roles = ["CSM"] + ["SS"] * ss + ["CO"] * co
        for i, r in enumerate(roles, 1):
            rows.append({"position_id": f"P-{u.org_unit_id}-{r}-{i}", "org_unit_id": u.org_unit_id, "role_id": r})
    return pd.DataFrame(rows)


def build_people(positions: pd.DataFrame, lk: dict, rng) -> dict:
    as_of = C.AS_OF
    demo = lk["demo_cluster"]
    garut, sukabumi = demo["Garut"], demo["Sukabumi"]

    # Vacancies: planted for the demo plus a small random rate elsewhere.
    vacant = {}
    gp = positions[positions["org_unit_id"] == garut]
    vacant[gp[gp["role_id"] == "SS"]["position_id"].iloc[-1]] = (date(2026, 8, 20), "resignation")
    vacant[gp[gp["role_id"] == "CO"]["position_id"].iloc[-1]] = (date(2026, 7, 25), "transfer")
    sp = positions[(positions["org_unit_id"] == sukabumi) & (positions["role_id"] == "SS")]
    vacant[sp["position_id"].iloc[-1]] = (date(2026, 9, 1), "resignation")
    for p in positions.itertuples():
        if p.role_id in NEVER_VACANT or p.position_id in vacant or p.org_unit_id in (garut, sukabumi):
            continue
        if p.org_unit_id == lk["small_team_cluster"]:
            continue
        if rng.random() < (0.03 if p.role_id in ("SS", "CO") else 0.015):
            vacant[p.position_id] = (as_of - timedelta(days=int(rng.integers(10, 120))),
                                     rng.choice(["resignation", "transfer", "promotion"]))

    persona_key = {}
    for (key, role), who in PERSONAS.items():
        unit = demo.get(key, key)
        persona_key[(unit, role)] = who

    employees, vacancies = [], []
    eid = 0

    def new_emp(pos, hire, gender=None, name=None, persona=False):
        nonlocal eid
        eid += 1
        role = pos.role_id
        gender = gender or ("F" if rng.random() < 0.228 else "M")
        senior = role in SENIOR
        # Age mix calibrated to TelkomGroup 2025: <30 16%, 30-45 60%, >45 24%.
        lo, hi = [(23, 30), (30, 45), (45, 56)][rng.choice(3, p=[0.16, 0.60, 0.24])]
        age = min(rng.uniform(lo, hi) + (8 if senior else 0), 56)
        birth = as_of - timedelta(days=int(age * 365.25))
        hire = max(hire, birth + timedelta(days=int(21.5 * 365.25)))
        edu = rng.choice(["S1", "S2", "D3", "SMA"], p=[0.55, 0.40, 0.03, 0.02] if senior else [0.71, 0.12, 0.10, 0.07])
        emp_type = "contract" if (role in ("SS", "CO", "BSA") and rng.random() < 0.15) else "permanent"
        name = name or person_name(rng, gender)
        first = name.split()[0].lower()
        return {
            "employee_id": f"E{eid:05d}", "full_name": name, "gender": gender,
            "birth_date": birth, "hire_date": hire, "employment_type": emp_type, "education": edu,
            "role_id": role, "position_id": pos.position_id, "org_unit_id": pos.org_unit_id,
            "email": f"{first}.{eid:05d}@{C.EMAIL_DOMAIN}",
            "status": "active", "exit_date": None, "exit_reason": None,
            "training_hours_ytd": int(np.clip(rng.normal(34, 10), 4, 80)),
            "is_demo_persona": persona,
        }

    def tenure_start(role):
        years = rng.uniform(8, 24) if role in SENIOR else (rng.uniform(4, 16) if role in ("BM", "CSM") else rng.exponential(6) + 0.2)
        return as_of - timedelta(days=int(years * 365))

    for pos in positions.itertuples():
        pkey = persona_key.get((pos.org_unit_id, pos.role_id))
        if pos.position_id in vacant:
            opened, reason = vacant[pos.position_id]
            prev = new_emp(pos, tenure_start(pos.role_id))
            prev.update(status="exited", exit_date=opened, exit_reason=reason)
            employees.append(prev)
            vacancies.append({"vacancy_id": f"V{len(vacancies) + 1:04d}", "position_id": pos.position_id,
                              "org_unit_id": pos.org_unit_id, "role_id": pos.role_id, "opened_date": opened,
                              "days_open": (as_of - opened).days, "status": "open", "reason": reason,
                              "backfill_request_submitted": bool(pos.org_unit_id != garut)})
            continue
        # ~7% of filled positions turned over in the last 12 months (calibrated to 5-12%/yr).
        if pkey is None and rng.random() < 0.07:
            exit_d = as_of - timedelta(days=int(rng.integers(60, 365)))
            prev = new_emp(pos, tenure_start(pos.role_id))
            prev.update(status="exited", exit_date=exit_d, exit_reason=rng.choice(["resignation", "retirement", "transfer"]))
            employees.append(prev)
            hire = exit_d + timedelta(days=int(rng.integers(20, 60)))
        else:
            hire = tenure_start(pos.role_id)
        if pkey:
            employees.append(new_emp(pos, hire, gender=pkey[1], name=pkey[0], persona=True))
        else:
            employees.append(new_emp(pos, hire))

    emp = pd.DataFrame(employees)
    for col in ("birth_date", "hire_date", "exit_date"):
        emp[col] = pd.to_datetime(emp[col])
    # Young predecessors: keep hire before exit and at least 21.5 years after birth.
    bad = emp["exit_date"].notna() & (emp["hire_date"] >= emp["exit_date"])
    emp.loc[bad, "hire_date"] = emp.loc[bad, "exit_date"] - pd.Timedelta(days=200)
    emp.loc[bad, "birth_date"] = emp.loc[bad, "hire_date"] - pd.Timedelta(days=int(23 * 365.25))
    # Grade comes from the role; managers resolved through the position tree.
    active = emp[emp["status"] == "active"]
    holder = active.set_index(["org_unit_id", "role_id"])["employee_id"]
    holder = holder[~holder.index.duplicated()]
    parent = lk["parent"]

    def manager_of(unit, role):
        target = REPORTS_TO.get(role)
        u = unit
        while target and u is not None:
            if (u, target) in holder.index:
                return holder[(u, target)]
            u = parent.get(u)
        return None

    emp["manager_employee_id"] = [manager_of(u, r) for u, r in zip(emp["org_unit_id"], emp["role_id"])]
    vac = pd.DataFrame(vacancies)
    vac["opened_date"] = pd.to_datetime(vac["opened_date"])
    return {"employee": emp, "vacancy": vac}


def build_territory_assignment(emp: pd.DataFrame, positions: pd.DataFrame, regions: pd.DataFrame,
                               org_unit_geo: pd.DataFrame, vacancy: pd.DataFrame) -> pd.DataFrame:
    """Which geography each line employee covers. SS -> kecamatan; CSM/CO -> kab/kota; BM -> province; RGM -> provinces."""
    active = emp[emp["status"] == "active"].set_index("position_id")["employee_id"]
    vacant_pos = set(vacancy["position_id"])
    dist = regions[regions["level"] == "district"][["kode", "regency_kode", "population"]]
    cl_geo = org_unit_geo[org_unit_geo["geo_level"] == "regency"]
    rows = []
    for cid, kodes in cl_geo.groupby("org_unit_id")["geo_kode"]:
        pos = positions[positions["org_unit_id"] == cid]
        csm = active[pos[pos["role_id"] == "CSM"]["position_id"].iloc[0]]
        for k in kodes:
            rows.append((csm, k, "regency", "owner"))
            for co_pos in pos[pos["role_id"] == "CO"]["position_id"]:
                if co_pos in active.index:
                    rows.append((active[co_pos], k, "regency", "owner"))
        # Balance kecamatan across Sales Supervisor positions by population (greedy).
        ss_pos = list(pos[pos["role_id"] == "SS"]["position_id"])
        load = {p: 0.0 for p in ss_pos}
        for d in dist[dist["regency_kode"].isin(kodes)].sort_values("population", ascending=False).itertuples():
            p = min(load, key=load.get)
            load[p] += float(d.population)
            if p in vacant_pos:
                rows.append((csm, d.kode, "district", "interim_cover"))
            else:
                rows.append((active[p], d.kode, "district", "owner"))
    for unit_level, role, geo_level in (("branch", "BM", "province"), ("region", "RGM", "province")):
        g = org_unit_geo[org_unit_geo["org_unit_id"].str.match(r"^BR" if unit_level == "branch" else r"^R\d")]
        for unit, kode in zip(g["org_unit_id"], g["geo_kode"]):
            p = positions[(positions["org_unit_id"] == unit) & (positions["role_id"] == role)]["position_id"].iloc[0]
            rows.append((active[p], kode, geo_level, "owner"))
    ta = pd.DataFrame(rows, columns=["employee_id", "geo_kode", "geo_level", "assignment_type"])
    ta["valid_from"] = pd.Timestamp("2026-01-01")
    ta["valid_to"] = pd.NaT
    return ta


def build_partners(org_unit: pd.DataFrame, lk: dict, regions: pd.DataFrame, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Distributor partners and their sales-force roster (no names: partner staff are not profiled)."""
    prov_pop = regions[regions["level"] == "province"].set_index("kode")["population"].astype(float)
    pop_by_regency = regions[regions["level"] == "regency"].set_index("kode")["population"].astype(float)
    cluster_pop = pop_by_regency.groupby(lk["cluster_of_regency"]).sum()
    partners, cluster_partner = [], {}
    for b in org_unit[org_unit["level"] == "branch"].itertuples():
        n = 2 if prov_pop[b.province_kode] > 8e6 else 1
        ids = []
        for _ in range(n):
            pid = f"PRT{len(partners) + 1:03d}"
            partners.append({"partner_id": pid, "partner_name": partner_name(rng), "branch_id": b.org_unit_id,
                             "contract_start": pd.Timestamp("2024-01-01")})
            ids.append(pid)
        clusters = org_unit[org_unit["parent_org_unit_id"] == b.org_unit_id]["org_unit_id"]
        for i, c in enumerate(clusters):
            cluster_partner[c] = ids[i % n]

    garut = lk["demo_cluster"]["Garut"]
    as_of = pd.Timestamp(C.AS_OF)
    rows = []
    for c, pop in cluster_pop.items():
        head = int(np.clip(round(pop / 35_000), 8, 45))
        mean_tenure_m, attrition = (8, 0.65) if c == garut else (15, rng.uniform(0.30, 0.55))
        roles = rng.choice(["canvasser", "direct_sales", "promoter"], head, p=[0.6, 0.3, 0.1])
        tenure_days = np.minimum(rng.exponential(mean_tenure_m * 30.4, head), 6 * 365).astype(int) + 14
        if c == garut:  # planted: ~60% of the current team joined in the last 12 months
            recent = rng.random(head) < 0.6
            tenure_days = np.where(recent, rng.integers(20, 360, head), np.maximum(tenure_days, 380))
        for r, t in zip(roles, tenure_days):
            rows.append((c, r, as_of - pd.Timedelta(days=int(t)), pd.NaT))
        for _ in range(int(round(head * attrition))):
            exit_d = as_of - pd.Timedelta(days=int(rng.integers(1, 365)))
            rows.append((c, rng.choice(["canvasser", "direct_sales"]),
                         exit_d - pd.Timedelta(days=int(rng.integers(45, 500))), exit_d))
    sf = pd.DataFrame(rows, columns=["cluster_id", "sf_role", "join_date", "exit_date"])
    sf.insert(0, "sf_id", [f"SF{i:05d}" for i in range(1, len(sf) + 1)])
    sf["partner_id"] = sf["cluster_id"].map(cluster_partner)
    sf["status"] = np.where(sf["exit_date"].isna(), "active", "exited")
    return pd.DataFrame(partners), sf
