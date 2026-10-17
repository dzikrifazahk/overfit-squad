"""Synthetic attributes for every region down to desa: population, approximate
coordinates, urban/rural cohort, network sites and market potential.

Province and regency population, area and centroids are real (cahyadsn/wilayah).
District and village population/coordinates are SYNTHETIC: allocated from the
regency with random weights and scattered around the regency centroid. They are
placeholders until real desa geometry is loaded (see docs/PROTOTYPE_DRAFT.md).
"""

import numpy as np
import pandas as pd

from . import config as C

KM_PER_DEG = 111.0


def build_regions(codes: pd.DataFrame, attrs: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    df = codes.merge(attrs, on="kode", how="left")
    reg = df["level"] == "regency"
    # A handful of source rows lack area; use the province's median regency area.
    med = df[reg].groupby("province_kode")["area_km2"].transform("median")
    df.loc[reg, "area_km2"] = df.loc[reg, "area_km2"].fillna(med).fillna(1000.0)
    prov = df["level"] == "province"
    df.loc[prov, "area_km2"] = df.loc[prov, "area_km2"].fillna(
        df[prov]["kode"].map(df[reg].groupby("province_kode")["area_km2"].sum()))

    regency = df[reg].set_index("kode")
    df = _allocate_districts(df, regency, rng)
    df = _allocate_villages(df, rng)

    df["urban"] = df["is_kelurahan"] | df["is_kota"]
    java = df["province_kode"].isin(C.JAVA_PROVINCES)
    three_t = df["province_kode"].isin(C.THREE_T_PROVINCES) & ~df["urban"]
    df["cohort"] = np.select(
        [three_t, java & df["urban"], java, df["urban"]],
        ["3t", "java_urban", "java_rural", "outside_java_urban"],
        default="outside_java_rural",
    )
    df.loc[df["level"].isin(["province", "regency"]), "cohort"] = None
    df["coord_quality"] = np.where(df["level"].isin(["province", "regency"]), "source_centroid", "synthetic_scatter")
    df["population"] = df["population"].round().astype("Int64")
    return df


def _allocate_districts(df, regency, rng):
    d = df["level"] == "district"
    dist = df[d].copy()
    w = rng.lognormal(0, 0.5, len(dist))
    dist["_w"] = w / pd.Series(w, index=dist.index).groupby(dist["regency_kode"]).transform("sum")
    reg_pop = dist["regency_kode"].map(regency["population"])
    reg_area = dist["regency_kode"].map(regency["area_km2"])
    dist["population"] = reg_pop * dist["_w"]
    aw = rng.lognormal(0, 0.4, len(dist))
    dist["area_km2"] = reg_area * aw / pd.Series(aw, index=dist.index).groupby(dist["regency_kode"]).transform("sum")
    # Scatter district points inside the regency's equivalent-area radius.
    r_km = np.sqrt(reg_area / np.pi) * 0.6 * np.sqrt(rng.random(len(dist)))
    theta = rng.random(len(dist)) * 2 * np.pi
    lat0 = dist["regency_kode"].map(regency["lat"])
    lng0 = dist["regency_kode"].map(regency["lng"])
    dist["lat"] = lat0 + r_km * np.sin(theta) / KM_PER_DEG
    dist["lng"] = lng0 + r_km * np.cos(theta) / (KM_PER_DEG * np.cos(np.radians(lat0)))
    df.loc[d, ["population", "area_km2", "lat", "lng"]] = dist[["population", "area_km2", "lat", "lng"]]
    tz = df[df["level"] == "regency"].set_index("kode")["timezone"]
    df.loc[d, "timezone"] = dist["regency_kode"].map(tz)
    return df


def _allocate_villages(df, rng):
    v = df["level"] == "village"
    vil = df[v].copy()
    dist = df[df["level"] == "district"].set_index("kode")
    w = rng.lognormal(0, 0.6, len(vil)) * np.where(vil["is_kelurahan"], 2.2, 1.0)
    vil["_w"] = w / pd.Series(w, index=vil.index).groupby(vil["district_kode"]).transform("sum")
    vil["population"] = vil["district_kode"].map(dist["population"]) * vil["_w"]
    aw = rng.lognormal(0, 0.5, len(vil)) / np.where(vil["is_kelurahan"], 2.0, 1.0)
    d_area = vil["district_kode"].map(dist["area_km2"])
    vil["area_km2"] = d_area * aw / pd.Series(aw, index=vil.index).groupby(vil["district_kode"]).transform("sum")
    r_km = np.sqrt(d_area / np.pi) * 0.8 * np.sqrt(rng.random(len(vil)))
    theta = rng.random(len(vil)) * 2 * np.pi
    lat0 = vil["district_kode"].map(dist["lat"])
    lng0 = vil["district_kode"].map(dist["lng"])
    vil["lat"] = lat0 + r_km * np.sin(theta) / KM_PER_DEG
    vil["lng"] = lng0 + r_km * np.cos(theta) / (KM_PER_DEG * np.cos(np.radians(lat0)))
    vil["timezone"] = vil["district_kode"].map(dist["timezone"])
    df.loc[v, ["population", "area_km2", "lat", "lng", "timezone"]] = vil[["population", "area_km2", "lat", "lng", "timezone"]]
    return df


def build_potential(villages: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Per-desa market potential and network footprint (all synthetic)."""
    v = villages[["kode", "province_kode", "regency_kode", "district_kode", "population", "urban", "cohort"]].copy()
    pop = v["population"].astype(float).to_numpy()
    cohort = v["cohort"].to_numpy()
    people_per_site = np.select([cohort == "3t", v["urban"].to_numpy()], [6000.0, 2200.0], 3500.0)
    v["sites_4g"] = rng.poisson(pop / people_per_site)
    v["sites_5g"] = np.where(v["urban"], rng.binomial(v["sites_4g"], 0.12), 0)
    # Desa without an own site may still be covered from a neighbour.
    covered_from_neighbour = np.select(
        [cohort == "3t", np.char.startswith(cohort.astype(str), "outside")], [0.70, 0.995], 1.0)
    v["has_4g_coverage"] = (v["sites_4g"] > 0) | (rng.random(len(v)) < covered_from_neighbour)
    v["income_factor"] = v["province_kode"].map(C.INCOME_FACTOR).fillna(C.DEFAULT_INCOME_FACTOR)
    urban_mult = np.select([cohort == "3t", v["urban"].to_numpy()], [0.6, 1.25], 0.85)
    coverage_mult = np.where(v["has_4g_coverage"], 1.0, 0.25)
    raw = pop * v["income_factor"].to_numpy() * urban_mult * coverage_mult
    v["potential_index"] = (raw / raw.mean() * 100).round(2)
    v["households"] = (pop / 3.8).round().astype(int)
    return v.rename(columns={"kode": "desa_kode"})
