#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the named features of the seabed.

Writes app/public/geo/undersea.json: trenches, ridges, fracture zones,
seamount chains, basins, abyssal plains, plateaus, rises and the named
deeps of the ocean floor, from

    IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net -
    the names approved by the GEBCO Sub-Committee on Undersea Feature
    Names, read from the gazetteer's public API at NOAA NCEI
    (www.ngdc.noaa.gov/gazetteer/api/v1/feature).

The gazetteer holds 5,311 approved features, three in ten of them single
seamounts. A globe seen whole can name a few hundred, so the bake keeps:

  - every Trench and every Deep and Hole (with its depth where the
    gazetteer records one: Challenger Deep, 10,920 m);
  - of each other kind in KINDS, the largest - by the length of the line
    or the span of the outline the gazetteer draws for it - up to the
    kind's quota; single seamounts and guyots by their relief instead.

Each feature keeps the gazetteer's own name, generic term and label point
("singlePoint"); nothing is renamed or moved. The lines the gazetteer
draws for trenches, fracture zones, ridges, rises, troughs and seamount
chains are kept too, for every feature of those kinds (not only the named
selection): fracture zones in particular are what the eye follows across
an ocean.

Output (lines delta-encoded in hundredths of a degree, as outlines.json):

    {source, asOf, quantumPerDegree,
     features: [{name, kind, lon, lat, sizeKm, maxDepthM?, reliefM?}],   # most notable first within each generic term
     lines: {trench: [[lon0, lat0, dlon, dlat, ...], ...], fracture: [...], ridge: [...]}}

Usage:
    python3 tools/pipeline/generate_undersea.py
"""

import datetime
import json
import math
import re
import sys

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, encode_polyline, write_json

API = "https://www.ngdc.noaa.gov/gazetteer/api/v1/feature?page={page}&itemsPerPage=200"
EARTH_RADIUS_KM = 6371.0

# generic term -> (kind in the output, how many to name; None: all)
KINDS: dict[str, tuple[str, int | None]] = {
    "Trench": ("trench", None),
    "Deep": ("deep", None),
    "Hole": ("deep", None),
    "Ridge": ("ridge", 45),
    "Rise": ("rise", 20),
    "Fracture Zone": ("fracture", 40),
    "Seamount Chain": ("seamounts", None),
    "Seamounts": ("seamounts", 25),
    "Basin": ("basin", 45),
    "Abyssal Plain": ("plain", 30),
    "Plateau": ("plateau", 25),
    "Trough": ("trough", 20),
    "Seamount": ("seamount", 40),
    "Guyot": ("seamount", 15),
}
# generic term -> line set drawn
LINE_SETS = {
    "Trench": "trench", "Trough": "trench",
    "Fracture Zone": "fracture",
    "Ridge": "ridge", "Rise": "ridge", "Seamount Chain": "ridge",
}


def load_features() -> list[dict]:
    first = json.loads(cached_fetch(API.format(page=1), "undersea/gebco-page-001.json").read_text())
    items = list(first["items"])
    for page in range(2, first["totalPages"] + 1):
        items += json.loads(cached_fetch(API.format(page=page), f"undersea/gebco-page-{page:03d}.json").read_text())["items"]
    if len(items) != first["totalItems"]:
        raise ValueError(f"read {len(items)} of {first['totalItems']} features")
    return items


def wkt_lines(geometries: list[str]) -> list[list[list[float]]]:
    """Every coordinate run of the WKT geometries, as [[lon, lat], ...]: the lines of a LINESTRING, the rings of a POLYGON."""
    lines = []
    for geometry in geometries:
        for run in re.findall(r"\(([^()]+)\)", geometry):
            points = [[float(v) for v in pair.split()[:2]] for pair in run.split(",")]
            if len(points) >= 2:
                lines.append(points)
    return lines


def arc_km(a: list[float], b: list[float]) -> float:
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dlon = math.radians(b[0] - a[0])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def size_km(item: dict) -> float:
    """Length of the feature's lines, or for an outline the greatest distance between two of its points."""
    lines = wkt_lines(item["geometries"])
    if not lines:
        return 0.0
    if any(g.startswith(("POLYGON", "MULTIPOLYGON")) for g in item["geometries"]):
        points = [p for line in lines for p in line]
        step = max(1, len(points) // 60)
        sample = points[::step]
        return max(arc_km(a, b) for a in sample for b in sample)
    return sum(arc_km(a, b) for line in lines for a, b in zip(line, line[1:]))


def main() -> None:
    items = load_features()
    by_kind: dict[str, list[dict]] = {}
    lines: dict[str, list[list[int]]] = {"trench": [], "fracture": [], "ridge": []}
    for item in items:
        term = item["genericTerm"]
        if term in LINE_SETS and not any(g.startswith("POLYGON") for g in item["geometries"]):
            for line in wkt_lines(item["geometries"]):
                encoded = encode_polyline(line)
                if encoded:
                    lines[LINE_SETS[term]].append(encoded)
        if term not in KINDS or item.get("singlePointLongitude") is None:
            continue
        kind, _ = KINDS[term]
        feature = {
            "name": f"{item['name'].strip()} {term}",
            "kind": kind,
            "lon": round(float(item["singlePointLongitude"]), 3),
            "lat": round(float(item["singlePointLatitude"]), 3),
            "sizeKm": round(size_km(item)),
        }
        if item.get("maxDepth"):
            feature["maxDepthM"] = int(item["maxDepth"])
        if item.get("totalRelief"):
            feature["reliefM"] = int(item["totalRelief"])
        by_kind.setdefault(term, []).append(feature)
    features = []
    for term, (kind, quota) in KINDS.items():
        # What makes a feature of its kind notable: a deep its depth, a single mountain its height, the rest their extent.
        if kind == "deep":
            order = lambda f: (-f.get("maxDepthM", 0), f["name"])  # noqa: E731
        elif kind == "seamount":
            order = lambda f: (-f.get("reliefM", 0), f["name"])  # noqa: E731
        else:
            order = lambda f: (-f["sizeKm"], f["name"])  # noqa: E731
        ranked = sorted(by_kind.get(term, []), key=order)
        features += ranked if quota is None else ranked[:quota]
    as_of = datetime.date.fromtimestamp((CACHE_DIR / "undersea" / "gebco-page-001.json").stat().st_mtime)
    write_json(OUTPUT_DIR / "undersea.json", {
        "source": "IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net",
        "asOf": as_of.isoformat(),
        "quantumPerDegree": QUANTUM_PER_DEG,
        "features": features,
        "lines": lines,
    })
    print(f"{len(items)} gazetteer features; {len(features)} named; lines: "
          + ", ".join(f"{k} {len(v)} ({sum(len(p) // 2 for p in v)} points)" for k, v in lines.items()), file=sys.stderr)


if __name__ == "__main__":
    main()
