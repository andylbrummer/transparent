#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: undersea communication cables.

Writes app/public/geo/cables.json: the routes of the world's submarine
telecommunication cables, their landing points, and per cable its name,
length, ready-for-service year and whether it is still only planned.

Source: TeleGeography's Submarine Cable Map as its public GitHub
repository (telegeography/www.submarinecablemap.com) stood at its last
archived commit, SNAPSHOT_COMMIT, of 14 November 2022 - read from a fork,
because TeleGeography has since deleted the repository.

LICENCE - READ THIS. That repository's README and LICENSE file put the
map and its data under Creative Commons BY-NC-SA 3.0: attribution,
NON-COMMERCIAL, share-alike. That is more restrictive than anything else
in this project, so the bake is kept in a file of its own and nothing
else is mixed into it.

It is also FROZEN. TeleGeography now says (its submarine cable FAQ, read
2026-11-10) that "the raw, geocoded data underlying TeleGeography's
interactive maps is available via an annual license" and that it no
longer maintains a GitHub repository. The JSON the live site serves
today is therefore NOT openly licensed and must not be baked from; only
the 2022 snapshot, published under the Creative Commons licence, may be.
Cables laid since November 2022 are missing, and cables planned then are
still marked planned.

The freer candidate does not hold up: OpenStreetMap (ODbL) has about
240,000 km of `communication=line` ways under water, a sixth of the
1.4 million km in service, almost all of it in European waters and with
no MAREA, 2Africa or trans-Pacific system at all (measured 2026-11-10
with Overpass).

The routes are TeleGeography's stylised cartography, not surveyed cable
positions: landing points are right to the town, the path between them is
a drawing. The app says so.

Lengths and years are the operators' figures as TeleGeography lists them
("6,605 km", 2018); a cable without a stated length gets the length of its
drawn route, marked as such (`lengthIsDrawn`).

Output:

    {source, licence, asOf, quantumPerDegree,
     cables: [{name, lengthKm, lengthIsDrawn?, year, planned, lon, lat}],   # longest first
     lines: [[cable index, lon0, lat0, dlon, dlat, ...]],                   # generate_geo.py's encoding after the index
     landings: [{name, lon, lat, cables}]}                                  # most cables first

Usage:
    python3 tools/pipeline/generate_cables.py
"""

import json
import math
import re
import sys
import time

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, encode_polyline, write_json

# The last commit of TeleGeography's repository that any public fork holds, and the fork it is read from.
SNAPSHOT_COMMIT = "91265d812a3e5f3734d48f6069ad600f3b0bdd66"
SNAPSHOT_DATE = "2022-11-14"
API = f"https://raw.githubusercontent.com/jordi-farrpoint/www.submarinecablemap.com/{SNAPSHOT_COMMIT}/web/public/api/v3"
CACHE = "human/telegeography-2022"
# Douglas-Peucker tolerance, degrees: 0.03° is 3 km, under a pixel from anywhere the routes are seen whole.
SIMPLIFY_DEG = 0.03
EARTH_RADIUS_KM = 6371.0


def arc_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dlon = math.radians(b[0] - a[0])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def path_km(points: list) -> float:
    return sum(arc_km(a, b) for a, b in zip(points, points[1:]))


def simplify(points: list, tolerance: float) -> list:
    """Douglas-Peucker in the lon/lat plane (iterative: some lines have tens of thousands of points)."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        ax, ay = points[first][0], points[first][1]
        bx, by = points[last][0], points[last][1]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, index = 0.0, -1
        for i in range(first + 1, last):
            px, py = points[i][0] - ax, points[i][1] - ay
            d = abs(px * dy - py * dx) / norm if norm > 0 else math.hypot(px, py)
            if d > worst:
                worst, index = d, i
        if worst > tolerance:
            keep[index] = True
            stack += [(first, index), (index, last)]
    return [p for p, k in zip(points, keep) if k]


def midpoint(points: list) -> tuple[float, float]:
    """The point half way along a path."""
    half = path_km(points) / 2
    run = 0.0
    for a, b in zip(points, points[1:]):
        step = arc_km(a, b)
        if run + step >= half and step > 0:
            f = (half - run) / step
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
        run += step
    return points[0][0], points[0][1]


def wrap_lon(lon: float) -> float:
    return (lon + 180) % 360 - 180


def cable_detail(cable_id: str) -> dict:
    name = f"{CACHE}/cable/{cable_id}.json"
    fresh = not (CACHE_DIR / name).exists()
    path = cached_fetch(f"{API}/cable/{cable_id}.json", name)
    if fresh:
        time.sleep(0.05)
    return json.loads(path.read_text())


def build() -> dict:
    geo = json.loads(cached_fetch(f"{API}/cable/cable-geo.json", f"{CACHE}/cable-geo.json").read_text())
    landing_geo = json.loads(cached_fetch(f"{API}/landing-point/landing-point-geo.json", f"{CACHE}/landing-point-geo.json").read_text())

    parts_by_id: dict[str, list] = {}
    names: dict[str, str] = {}
    for feature in geo["features"]:
        cable_id = feature["properties"]["id"]
        names[cable_id] = feature["properties"]["name"]
        geometry = feature["geometry"]
        parts = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        parts_by_id.setdefault(cable_id, []).extend(parts)

    landings_count: dict[str, int] = {}
    cables = []
    for cable_id, parts in parts_by_id.items():
        detail = cable_detail(cable_id)
        for point in detail["landing_points"]:
            if not detail["is_planned"]:
                landings_count[point["id"]] = landings_count.get(point["id"], 0) + 1
        drawn_km = sum(path_km(p) for p in parts)
        match = re.fullmatch(r"([\d,]+) km", detail.get("length") or "")
        longest = max(parts, key=path_km)
        lon, lat = midpoint(longest)
        cable = {
            "name": names[cable_id],
            "lengthKm": int(match.group(1).replace(",", "")) if match else round(drawn_km),
            "year": detail.get("rfs_year"),
            "planned": bool(detail["is_planned"]),
            "lon": round(wrap_lon(lon), 2),
            "lat": round(lat, 2),
            "_parts": parts,
        }
        if not match:
            cable["lengthIsDrawn"] = True
        cables.append(cable)
    cables.sort(key=lambda c: (-c["lengthKm"], c["name"]))

    lines = []
    for index, cable in enumerate(cables):
        for part in cable.pop("_parts"):
            encoded = encode_polyline(simplify(part, SIMPLIFY_DEG))
            if encoded:
                lines.append([index] + encoded)

    landings = []
    for feature in landing_geo["features"]:
        lon, lat = feature["geometry"]["coordinates"]
        count = landings_count.get(feature["properties"]["id"], 0)
        if count == 0:
            # Only planned cables land here.
            continue
        landings.append({"name": feature["properties"]["name"], "lon": round(wrap_lon(lon), 3), "lat": round(lat, 3), "cables": count})
    landings.sort(key=lambda p: (-p["cables"], p["name"]))

    return {
        "source": f"TeleGeography, Submarine Cable Map, www.submarinecablemap.com (GitHub repository at commit {SNAPSHOT_COMMIT[:10]})",
        "licence": "CC BY-NC-SA 3.0",
        "asOf": SNAPSHOT_DATE,
        "quantumPerDegree": QUANTUM_PER_DEG,
        "cables": cables,
        "lines": lines,
        "landings": landings,
    }


def main() -> None:
    data = build()
    path = OUTPUT_DIR / "cables.json"
    write_json(path, data)
    in_service = [c for c in data["cables"] if not c["planned"]]
    print(
        f"{len(data['cables'])} cables ({len(in_service)} in service, {sum(c['lengthKm'] for c in in_service):,} km), "
        f"{len(data['lines'])} lines, {sum(len(l) // 2 for l in data['lines'])} points, {len(data['landings'])} landing points",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
