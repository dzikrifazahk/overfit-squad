"""Parse the cahyadsn/wilayah SQL dumps (Kepmendagri 2025 region codes, MIT).

Only regex parsing is done on the downloaded files; nothing in them is executed.
"""

import json
import re
from pathlib import Path

import pandas as pd

_STR = r"'((?:[^'\\]|\\.|'')*)'"
_NUM = r"(-?[\d.]+(?:[eE][-+]?\d+)?|NULL)"
_CODE_ROW = re.compile(r"\('([\d.]+)'," + _STR + r"\)")
_L12_ROW = re.compile(
    r"^\('([\d.]+)'," + _STR + "," + _STR + r",\s*"
    + r",\s*".join([_NUM] * 6)
    + r",\s*'(.*)',\s*" + _NUM + r"\)[,;]\s*$"
)
LEVELS = {1: "province", 2: "regency", 3: "district", 4: "village"}


def _unescape(s: str) -> str:
    return s.replace("\\'", "'").replace("''", "'")


def _num(s: str) -> float | None:
    return None if s == "NULL" else float(s)


def load_codes(raw_dir: Path) -> pd.DataFrame:
    """All 91,599 codes: province, regency (kab/kota), district (kecamatan), village (desa/kelurahan)."""
    text = (raw_dir / "wilayah.sql").read_text(encoding="utf-8")
    rows = [(m.group(1), _unescape(m.group(2))) for m in _CODE_ROW.finditer(text)]
    df = pd.DataFrame(rows, columns=["kode", "name"]).drop_duplicates("kode")
    parts = df["kode"].str.split(".")
    df["level"] = parts.str.len().map(LEVELS)
    df["province_kode"] = parts.str[0]
    df["regency_kode"] = parts.str[:2].str.join(".").where(parts.str.len() >= 2)
    df["district_kode"] = parts.str[:3].str.join(".").where(parts.str.len() >= 3)
    df["parent_kode"] = parts.str[:-1].str.join(".").where(parts.str.len() > 1)
    is_village = df["level"] == "village"
    # Kemendagri convention: last segment 1xxx = kelurahan (urban), 2xxx = desa.
    df["is_kelurahan"] = is_village & df["kode"].str.split(".").str[-1].str.startswith("1")
    df["is_kota"] = df["regency_kode"].fillna("").str.split(".").str[1].str.startswith("7")
    return df.reset_index(drop=True)


def load_level_1_2(raw_dir: Path) -> tuple[pd.DataFrame, dict]:
    """Province/regency centroids, area, population and boundary polygons."""
    attrs, shapes = [], {}
    with (raw_dir / "wilayah_level_1_2.sql").open(encoding="utf-8") as fh:
        for line in fh:
            m = _L12_ROW.match(line.strip())
            if not m:
                continue
            kode = m.group(1)
            attrs.append({
                "kode": kode,
                "capital": _unescape(m.group(3)),
                "lat": _num(m.group(4)),
                "lng": _num(m.group(5)),
                "timezone": _num(m.group(7)),
                "area_km2": _num(m.group(8)),
                "population": _num(m.group(9)),
            })
            if m.group(10):
                shapes[kode] = _parse_rings(m.group(10))
    return pd.DataFrame(attrs), shapes


_PAIR = re.compile(r"\[(-?[\d.]+),\s*(-?[\d.]+)\]")


def _parse_rings(path: str) -> list:
    try:
        return json.loads(path)
    except json.JSONDecodeError:
        # A few source rows have stray brackets (e.g. Kota Banjar); recover the rings
        # by splitting on ring terminators and keeping the coordinate pairs.
        rings = [[[float(a), float(b)] for a, b in _PAIR.findall(chunk)] for chunk in path.split("]]")]
        return [r for r in rings if len(r) >= 4]


def _flatten_rings(node) -> list:
    """Source nesting varies (list of rings, or list of polygons of rings); return a flat list of rings."""
    if node and isinstance(node[0], (int, float)):
        return []
    if node and isinstance(node[0], list) and node[0] and isinstance(node[0][0], (int, float)):
        return [node]
    return [r for child in node for r in _flatten_rings(child)]


def to_geojson(codes: pd.DataFrame, shapes: dict, level: str) -> dict:
    """GeoJSON FeatureCollection; source rings are [lat, lng], GeoJSON wants [lng, lat]."""
    names = codes.set_index("kode")["name"]
    features = []
    for kode in codes.loc[codes["level"] == level, "kode"]:
        rings = shapes.get(kode)
        if not rings:
            continue
        polys = [[[[round(p[1], 4), round(p[0], 4)] for p in ring]] for ring in _flatten_rings(rings) if len(ring) >= 4]
        features.append({
            "type": "Feature",
            "properties": {"kode": kode, "name": names[kode], "level": level},
            "geometry": {"type": "MultiPolygon", "coordinates": polys},
        })
    return {"type": "FeatureCollection", "features": features}
