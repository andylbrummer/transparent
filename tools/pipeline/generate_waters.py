#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: rivers, lakes and sea ports.

Writes two files from Natural Earth (public domain):

  app/public/geo/waters.json   river centre lines (1:10m, scale rank
        MAX_RIVER_RANK and better - the Amazon down to rivers the size of
        the Thames), lake shorelines (1:50m) and the names of both.
  app/public/geo/ports.json    the 1,081 sea ports of ne_10m_ports with
        Natural Earth's scale rank (the lower, the larger the port).

River lines are simplified to SIMPLIFY_DEG and stored like the outlines
(generate_geo.py's quantised, delta-encoded polylines). A river's name
sits half way along its longest piece; pieces of one river are told
together by name. A lake's name sits at the middle of the bounding
box of its largest piece.

Output:

    waters.json  {source, quantumPerDegree,
                  rivers: [[...]], lakes: [[...]],
                  riverNames: [{name, lon, lat, rank, lengthKm}],    # longest first
                  lakeNames:  [{name, lon, lat, rank, areaKm2}]}     # largest first
    ports.json   {source, ports: [{name, lon, lat, rank}]}           # largest first

Usage:
    python3 tools/pipeline/generate_waters.py
"""

import json
import math
import sys

from fetch_cache import cached_fetch
from generate_cables import midpoint, path_km, simplify
from generate_geo import NATURAL_EARTH_BASE, OUTPUT_DIR, QUANTUM_PER_DEG, encode_polyline, line_parts, write_json

MAX_RIVER_RANK = 7
# 0.02° is about 2 km: a river's meanders are far below a pixel from across the planet.
SIMPLIFY_DEG = 0.02
# Lakes smaller than this are a dot at planet scale.
MIN_LAKE_KM2 = 300
SOURCE = "Natural Earth, naturalearthdata.com (public domain)"


def natural_earth(name: str) -> list[dict]:
    path = cached_fetch(f"{NATURAL_EARTH_BASE}/{name}.geojson", f"human/{name}.geojson")
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def ring_area_km2(ring: list) -> float:
    """Area enclosed by a ring of lon/lat on the sphere (spherical excess by the trapezoid rule)."""
    total = 0.0
    for (lon1, lat1, *_), (lon2, lat2, *_) in zip(ring, ring[1:]):
        total += math.radians(lon2 - lon1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return abs(total) * 6371.0**2 / 2


def build_rivers() -> tuple[list, list]:
    lines = []
    by_name: dict[tuple, dict] = {}
    for feature in natural_earth("ne_10m_rivers_lake_centerlines"):
        props = feature["properties"]
        if feature["geometry"] is None or props["scalerank"] > MAX_RIVER_RANK:
            continue
        for part in line_parts(feature["geometry"]):
            encoded = encode_polyline(simplify(part, SIMPLIFY_DEG))
            if encoded:
                lines.append(encoded)
            name = props.get("name_en") or props.get("name")
            if not name:
                continue
            # Namesakes (two Colorados, two Reds) are told apart by Natural Earth's river number.
            entry = by_name.setdefault((name, props.get("rivernum")), {"name": name, "rank": props["scalerank"], "lengthKm": 0.0, "_longest": part})
            entry["rank"] = min(entry["rank"], props["scalerank"])
            entry["lengthKm"] += path_km(part)
            if path_km(part) > path_km(entry["_longest"]):
                entry["_longest"] = part
    names = []
    for entry in by_name.values():
        lon, lat = midpoint(entry.pop("_longest"))
        names.append({**entry, "lon": round(lon, 2), "lat": round(lat, 2), "rank": int(entry["rank"]), "lengthKm": round(entry["lengthKm"])})
    names.sort(key=lambda n: (-n["lengthKm"], n["name"]))
    return lines, names


def build_lakes() -> tuple[list, list]:
    lines = []
    names = []
    for feature in natural_earth("ne_50m_lakes"):
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        area = sum(ring_area_km2(polygon[0]) for polygon in polygons)
        if area < MIN_LAKE_KM2:
            continue
        for polygon in polygons:
            for ring in polygon:
                encoded = encode_polyline(simplify(ring, SIMPLIFY_DEG))
                if encoded and len(encoded) >= 8:
                    lines.append(encoded)
        props = feature["properties"]
        # `name` is the full form ("Lake Victoria"); name_en drops the generic and is sometimes another name altogether.
        name = props.get("name") or props.get("name_en")
        if not name or any(n["name"] == name and n["areaKm2"] == round(area) for n in names):
            continue
        outer = max((polygon[0] for polygon in polygons), key=ring_area_km2)
        lons, lats = [p[0] for p in outer], [p[1] for p in outer]
        names.append({
            "name": name,
            "lon": round((min(lons) + max(lons)) / 2, 2),
            "lat": round((min(lats) + max(lats)) / 2, 2),
            "rank": int(props["scalerank"]),
            "areaKm2": round(area),
        })
    names.sort(key=lambda n: (-n["areaKm2"], n["name"]))
    return lines, names


def build_ports() -> list[dict]:
    ports = []
    for feature in natural_earth("ne_10m_ports"):
        lon, lat = feature["geometry"]["coordinates"][:2]
        props = feature["properties"]
        ports.append({"name": props["name"], "lon": round(lon, 3), "lat": round(lat, 3), "rank": int(props["scalerank"])})
    ports.sort(key=lambda p: (p["rank"], p["name"]))
    return ports


def main() -> None:
    rivers, river_names = build_rivers()
    lakes, lake_names = build_lakes()
    write_json(OUTPUT_DIR / "waters.json", {
        "source": SOURCE,
        "quantumPerDegree": QUANTUM_PER_DEG,
        "rivers": rivers,
        "lakes": lakes,
        "riverNames": river_names,
        "lakeNames": lake_names,
    })
    ports = build_ports()
    write_json(OUTPUT_DIR / "ports.json", {"source": SOURCE, "ports": ports})
    print(
        f"{len(rivers)} river lines ({sum(len(l) // 2 for l in rivers)} points), {len(river_names)} river names, "
        f"{len(lakes)} lake rings ({sum(len(l) // 2 for l in lakes)} points), {len(lake_names)} lake names, {len(ports)} ports",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
