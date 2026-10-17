"""Build an "everything except Indonesia" mask for the web map.

    uv run --with shapely python scripts/build_mask.py

Unions the 38 province polygons (data/geo/provinces.geojson) into one national outline, buffers it slightly
to close slivers between provinces, simplifies it, and writes a world polygon with Indonesia cut out as holes
to web/public/data/mask.geojson.
"""

import json
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]

fc = json.loads((ROOT / "data/geo/provinces.geojson").read_text())
provinces = [shape(f["geometry"]).buffer(0) for f in fc["features"]]
indonesia = unary_union(provinces).buffer(0.03).buffer(-0.02).simplify(0.01, preserve_topology=True)
parts = list(indonesia.geoms) if isinstance(indonesia, MultiPolygon) else [indonesia]
parts = [p for p in parts if p.area > 0.0005]  # drop specks
outline = MultiPolygon([Polygon(p.exterior) for p in parts])

mask = box(-180, -85, 180, 85).difference(outline)
out = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"name": "outside-indonesia"}, "geometry": mapping(mask)}]}
dst = ROOT / "web/public/data/mask.geojson"
dst.write_text(json.dumps(out, separators=(",", ":")))
print(f"{len(parts)} islands kept, bounds {outline.bounds}, {dst.stat().st_size / 1e3:.0f} KB")
