"""Territory org hierarchy: National -> Area -> Region -> Branch (province) -> Cluster (1-3 kab/kota)."""

import pandas as pd

from . import config as C

VALID_FROM = "2026-01-01"


def _short(name: str) -> str:
    for prefix in ("Kabupaten Administrasi ", "Kota Administrasi ", "Kabupaten ", "Kota "):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def _group_regencies(prov: str, regs: pd.DataFrame) -> list[tuple[str, list[str]]]:
    names = regs.set_index("kode")["name"]
    remaining = list(regs["kode"])
    groups = []
    if prov == C.DEMO_PROVINCE:
        for cname, kodes in C.DEMO_CLUSTERS.items():
            groups.append((cname, kodes))
            remaining = [k for k in remaining if k not in kodes]
    while remaining:
        n = 2 if len(remaining) == 4 else min(3, len(remaining))
        chunk, remaining = remaining[:n], remaining[n:]
        groups.append((_short(names[chunk[0]]), chunk))
    seen: dict[str, int] = {}
    out = []
    for cname, kodes in groups:
        seen[cname] = seen.get(cname, 0) + 1
        out.append((cname if seen[cname] == 1 else f"{cname} {seen[cname]}", kodes))
    return out


def build_org(regions: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    prov_names = regions[regions["level"] == "province"].set_index("kode")["name"]
    regencies = regions[regions["level"] == "regency"].sort_values("kode")
    units = [{"org_unit_id": "NAT", "level": "national", "name": f"{C.COMPANY} National Sales",
              "parent_org_unit_id": None, "province_kode": None}]
    geo = []
    for aid, name in C.AREAS.items():
        units.append({"org_unit_id": aid, "level": "area", "name": name, "parent_org_unit_id": "NAT", "province_kode": None})
    covered = []
    for rid, name, aid, provs in C.REGIONS:
        units.append({"org_unit_id": rid, "level": "region", "name": name, "parent_org_unit_id": aid, "province_kode": None})
        for p in provs:
            geo.append((aid, p, "province"))
            geo.append((rid, p, "province"))
            covered.append(p)
            bid = f"BR{p}"
            units.append({"org_unit_id": bid, "level": "branch", "name": f"Branch {prov_names[p]}",
                          "parent_org_unit_id": rid, "province_kode": p})
            geo.append((bid, p, "province"))
            for i, (cname, kodes) in enumerate(_group_regencies(p, regencies[regencies["province_kode"] == p]), 1):
                cid = f"CL{p}{i:02d}"
                units.append({"org_unit_id": cid, "level": "cluster", "name": f"Cluster {cname}",
                              "parent_org_unit_id": bid, "province_kode": p})
                geo.extend((cid, k, "regency") for k in kodes)
    assert sorted(covered) == sorted(prov_names.index), "every province must belong to exactly one region"
    org_unit = pd.DataFrame(units)
    org_unit_geo = pd.DataFrame(geo, columns=["org_unit_id", "geo_kode", "geo_level"])
    org_unit_geo["valid_from"] = VALID_FROM
    org_unit_geo["valid_to"] = None
    assert org_unit_geo[org_unit_geo["geo_level"] == "regency"]["geo_kode"].is_unique
    return org_unit, org_unit_geo


def lookups(org_unit: pd.DataFrame, org_unit_geo: pd.DataFrame) -> dict:
    cl = org_unit_geo[org_unit_geo["geo_level"] == "regency"]
    parent = org_unit.set_index("org_unit_id")["parent_org_unit_id"]
    clusters = org_unit[org_unit["level"] == "cluster"]
    names = org_unit.set_index("org_unit_id")["name"]
    by_name = {names[c]: c for c in clusters["org_unit_id"] if c.startswith(f"CL{C.DEMO_PROVINCE}")}
    return {
        "cluster_of_regency": cl.set_index("geo_kode")["org_unit_id"],
        "parent": parent,
        "names": names,
        "demo_cluster": {k: by_name[f"Cluster {k}"] for k in C.DEMO_CLUSTERS},
        "small_team_cluster": sorted(c for c in clusters["org_unit_id"] if c.startswith(f"CL{C.SMALL_TEAM_PROVINCE}"))[0],
    }
