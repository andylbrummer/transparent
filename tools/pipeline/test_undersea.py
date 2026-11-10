#!/usr/bin/env python3
"""
Checks for app/public/geo/undersea.json against places anyone can look up.

The Mariana Trench lies east of the Mariana Islands (Guam: 13.4 N,
144.8 E); the Challenger Deep, its deepest point and the ocean's, is
10,920 m down in the GEBCO gazetteer at 11.37 N, 142.59 E; the Puerto
Rico Trench runs north of Puerto Rico (18.2 N, 66.5 W); the Emperor
Seamount Chain runs north from the bend at about 32 N, 172 E to the
Aleutian Trench; the Ninetyeast Ridge follows the 90th meridian east;
the Mid-Atlantic Ridge runs the length of the Atlantic.

Usage:
    python3 tools/pipeline/generate_undersea.py
    python3 tools/pipeline/test_undersea.py
"""

import json

from generate_geo import OUTPUT_DIR, decode_polyline
from generate_undersea import KINDS, arc_km, wkt_lines
from geo_test_support import check, finish, nearest_point_deg

check(wkt_lines(["LINESTRING (143.5 24.5, 143.7267 24.2069)"]) == [[[143.5, 24.5], [143.7267, 24.2069]]], "a LINESTRING is read")
check(len(wkt_lines(["MULTILINESTRING ((0 0, 1 1), (2 2, 3 3, 4 4))"])) == 2, "a MULTILINESTRING's parts are read apart")
check(len(wkt_lines(["POLYGON ((0 0, 1 0, 1 1, 0 0))"])[0]) == 4, "a POLYGON's ring is read")
check(abs(arc_km([0, 0], [1, 0]) - 111.19) < 0.05, "a degree of the equator is 111.19 km")

path = OUTPUT_DIR / "undersea.json"
data = json.loads(path.read_text())
features = data["features"]
by_name = {f["name"]: f for f in features}
check(path.stat().st_size < 120_000, f"under 120 kB ({path.stat().st_size} bytes)")
check(300 <= len(features) <= 500, f"some hundreds of names ({len(features)})")
check(len(by_name) == len(features), "no name twice")
check({f["kind"] for f in features} == {kind for kind, _ in KINDS.values()}, "every kind is present")
check(all(-180 <= f["lon"] <= 180 and -90 <= f["lat"] <= 90 for f in features), "every position is on the globe")

# (name, lon, lat, tolerance deg, kind)
KNOWN = [
    ("Mariana Trench", 147.8, 17.0, 0.5, "trench"),
    ("Challenger Deep", 142.59, 11.37, 0.05, "deep"),
    ("Puerto Rico Trench", -65.4, 19.9, 0.5, "trench"),
    ("Tonga Trench", -173.2, -20.4, 0.5, "trench"),
    ("Aleutian Trench", -167.4, 52.1, 3.0, "trench"),
    ("Emperor Seamount Chain", 170.6, 41.1, 0.5, "seamounts"),
    ("Ninetyeast Ridge", 88.5, -13.5, 1.0, "ridge"),
    ("Mid-Atlantic Ridge", -21.5, -0.3, 1.0, "ridge"),
    ("Mendocino Fracture Zone", -147.7, 39.0, 1.0, "fracture"),
    ("East Pacific Rise", -110.0, -15.0, 15.0, "rise"),
    ("Kerguelen Plateau", 73.0, -55.0, 8.0, "plateau"),
]
for name, lon, lat, tolerance, kind in KNOWN:
    check(name in by_name, f"{name} is named")
    if name in by_name:
        f = by_name[name]
        check(f["kind"] == kind, f"{name} is a {kind} ({f['kind']})")
        check(abs(f["lon"] - lon) <= tolerance and abs(f["lat"] - lat) <= tolerance, f"{name} at {lon}, {lat} ({f['lon']}, {f['lat']})")

check(by_name["Challenger Deep"].get("maxDepthM") == 10920, "the Challenger Deep is 10,920 m deep in the gazetteer")
deeps = [f for f in features if f["kind"] == "deep"]
check(deeps[0]["name"] == "Challenger Deep", f"the deepest deep comes first ({deeps[0]['name']})")
check(by_name["Mariana Trench"]["lon"] > 144.8 + 1 and abs(by_name["Mariana Trench"]["lat"] - 13.4) < 6, "the Mariana Trench's name is east of Guam")
check(by_name["Puerto Rico Trench"]["lat"] > 18.5, "the Puerto Rico Trench is north of Puerto Rico")
check(by_name["Mid-Atlantic Ridge"]["sizeKm"] > 10000, f"the Mid-Atlantic Ridge is the longest ridge ({by_name['Mid-Atlantic Ridge']['sizeKm']} km)")
ridges = [f for f in features if f["kind"] == "ridge"]
check(ridges[0]["name"] == "Mid-Atlantic Ridge", "and comes first of the ridges")

lines = data["lines"]
check(set(lines) == {"trench", "fracture", "ridge"}, "three sets of lines")
points = sum(len(p) // 2 for group in lines.values() for p in group)
check(2000 < points < 8000, f"a few thousand line points ({points})")
# A line that crosses the antimeridian carries on past 180 in the gazetteer, which draws the same.
check(all(-360 <= lon <= 360 and -90 <= lat <= 90 for group in lines.values() for p in group for lon, lat in decode_polyline(p)),
      "every line point is on the globe")
check(nearest_point_deg(lines["trench"], 147.0, 15.0) < 1.5, "a trench line passes east of the Marianas (15 N, 147 E)")
check(nearest_point_deg(lines["trench"], -66.0, 19.8) < 1.0, "a trench line passes north of Puerto Rico")
check(nearest_point_deg(lines["ridge"], 88.5, -13.5) < 1.0, "a ridge line follows the Ninetyeast Ridge (13.5 S, 88.5 E)")
check(nearest_point_deg(lines["ridge"], 90.0, 5.0) < 1.0, "to its northern end by the 90th meridian (5 N)")
check(nearest_point_deg(lines["ridge"], 170.0, 44.0) < 1.5, "a ridge line runs up the Emperor chain at 44 N")
check(nearest_point_deg(lines["fracture"], -140.0, 39.5) < 2.0, "a fracture-zone line runs west from Cape Mendocino at 140 W")
check(nearest_point_deg(lines["ridge"], -100.0, 40.0) > 15, "no ridge line crosses Kansas")

finish()
