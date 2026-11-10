#!/usr/bin/env python3
"""
Checks for app/public/geo/cables.json.

Known cables are pinned to what their operators publish and anyone can
look up: MAREA (Microsoft, Meta and Telxius, lit 2018) runs 6,605 km from
Virginia Beach to Bilbao; 2Africa is 45,000 km round the continent.
Positions are checked against a second source: the cities of Natural
Earth (app/public/geo/labels.json) that the cables are known to land at -
Singapore, Mumbai, Lagos, Lisbon, Sydney - must each have a landing point
and a cable's line within a few tens of kilometres.

Usage:
    python3 tools/pipeline/generate_cables.py
    python3 tools/pipeline/test_cables.py
"""

import json

from generate_cables import arc_km, simplify
from generate_geo import OUTPUT_DIR, decode_polyline
from geo_test_support import check, finish

line = [(0.0, 0.0), (1.0, 0.001), (2.0, 0.0), (3.0, 1.0), (4.0, 0.0)]
check(simplify(line, 0.03) == [(0.0, 0.0), (2.0, 0.0), (3.0, 1.0), (4.0, 0.0)], "simplify drops a point 0.001° off the line and keeps a corner")
check(abs(arc_km((0, 0), (90, 0)) - 10007.5) < 1, "a quarter of the equator is 10,007.5 km")

path = OUTPUT_DIR / "cables.json"
data = json.loads(path.read_text())
cables = data["cables"]
by_name = {c["name"]: c for c in cables}
in_service = [c for c in cables if not c["planned"]]

check(path.stat().st_size < 400_000, f"under 400 kB ({path.stat().st_size} bytes)")
check(data["licence"] == "CC BY-NC-SA 3.0", "the file states its licence")
check(400 <= len(in_service) <= 550, f"some 460 cables in service in November 2022 ({len(in_service)})")
total_km = sum(c["lengthKm"] for c in in_service)
check(1.2e6 <= total_km <= 1.6e6, f"about 1.4 million km in service ({total_km:,} km)")
check(data["asOf"] == "2022-11-14", "the file says it is the snapshot of 14 November 2022")
check(all(cables[i]["lengthKm"] >= cables[i + 1]["lengthKm"] for i in range(len(cables) - 1)), "longest first")

marea = by_name["MAREA"]
check(marea["lengthKm"] == 6605 and marea["year"] == 2018 and not marea["planned"], "MAREA: 6,605 km, lit 2018")
check(abs(marea["lat"] - 40) < 6 and -60 < marea["lon"] < -20, f"MAREA's name sits in the mid-Atlantic ({marea['lon']}, {marea['lat']})")
check(by_name["2Africa"]["lengthKm"] == 45000, "2Africa: 45,000 km")
check(any(name.startswith("SeaMeWe-") for name in by_name), "the SeaMeWe cables are there")

lines_of: dict[int, list] = {}
for encoded in data["lines"]:
    lines_of.setdefault(encoded[0], []).append(decode_polyline(encoded[1:]))
check(set(lines_of) == set(range(len(cables))), "every cable has a line and every line a cable")
marea_points = [p for part in lines_of[cables.index(marea)] for p in part]
ends = (min(marea_points), max(marea_points))
check(arc_km(ends[0], (-75.98, 36.85)) < 60, "MAREA's west end is at Virginia Beach")
check(arc_km(ends[1], (-2.93, 43.26)) < 60, "MAREA's east end is at Bilbao")
drawn = sum(arc_km(a, b) for part in lines_of[cables.index(marea)] for a, b in zip(part, part[1:]))
check(0.8 < drawn / 6605 < 1.2, f"MAREA's drawn route is about its stated length ({drawn:.0f} km)")

cities = {l["name"]: l for l in json.loads((OUTPUT_DIR / "labels.json").read_text())["labels"] if l["kind"] == "city"}
all_points = [p for parts in lines_of.values() for part in parts for p in part]
for city in ("Singapore", "Mumbai", "Lagos", "Lisbon", "Sydney"):
    at = (cities[city]["lon"], cities[city]["lat"])
    landing = min(data["landings"], key=lambda p: arc_km((p["lon"], p["lat"]), at))
    off = arc_km((landing["lon"], landing["lat"]), at)
    check(off < 40, f"a landing point at Natural Earth's {city}: {landing['name']}, {off:.0f} km off")
    check(min(arc_km(p, at) for p in all_points) < 40, f"a cable's line reaches {city}")
    landed = sum(p["cables"] for p in data["landings"] if arc_km((p["lon"], p["lat"]), at) < 40)
    check(landed >= 5, f"{landed} cable landings within 40 km of {city}")
check(data["landings"][0]["cables"] >= 10, f"the busiest landing has ten cables or more ({data['landings'][0]['name']})")
check(all(-180 <= p["lon"] <= 180 for p in data["landings"]), "landing longitudes within ±180")

finish()
