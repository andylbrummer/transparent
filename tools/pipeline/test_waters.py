#!/usr/bin/env python3
"""
Checks for app/public/geo/waters.json and ports.json.

Rivers are held against the cities that stand on them (Natural Earth's
populated places in app/public/geo/labels.json, a different Natural
Earth layer from the rivers): the Nile at Cairo and Khartoum, the Yangtze
at Shanghai, the Tigris at Baghdad, the Seine at Paris, the Congo at
Kinshasa. Lake areas computed from the shorelines
are held against the published ones: Superior 82,100 km², Victoria
68,900 km², Baikal 31,700 km². Ports against the same cities.

Usage:
    python3 tools/pipeline/generate_waters.py
    python3 tools/pipeline/test_waters.py
"""

import json

from generate_cables import arc_km
from generate_geo import OUTPUT_DIR
from generate_waters import ring_area_km2
from geo_test_support import check, finish, nearest_point_deg

square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
check(abs(ring_area_km2(square) - 12364) < 60, f"a 1° square on the equator is 12,364 km² ({ring_area_km2(square):.0f})")

path = OUTPUT_DIR / "waters.json"
data = json.loads(path.read_text())
check(path.stat().st_size < 400_000, f"waters.json under 400 kB ({path.stat().st_size} bytes)")
cities = {l["name"]: l for l in json.loads((OUTPUT_DIR / "labels.json").read_text())["labels"] if l["kind"] == "city"}

for city in ("Cairo", "Khartoum", "Shanghai", "Baghdad", "Paris", "Kinshasa"):
    off = nearest_point_deg(data["rivers"], cities[city]["lon"], cities[city]["lat"])
    check(off < 0.3, f"a river passes {city} ({off:.2f}° off)")
sahara = nearest_point_deg(data["rivers"], 10.0, 23.0)
check(sahara > 3, f"no river in the middle of the Sahara (nearest {sahara:.1f}° off)")

rivers = {r["name"]: r for r in reversed(data["riverNames"])}
for name in ("Nile", "Amazonas", "Yangtze", "Mississippi", "Congo", "Danube", "Volga", "Ganges", "Mekong"):
    check(name in rivers, f"the {name} is named")
check(abs(rivers["Nile"]["lon"] - 31.5) < 3 and 10 < rivers["Nile"]["lat"] < 30, "the Nile's name sits on the Nile")
check(len({(r["name"], r["lon"], r["lat"]) for r in data["riverNames"]}) == len(data["riverNames"]), "no river named twice at one place")
check(sum(1 for r in data["riverNames"] if r["name"] == "Colorado") >= 2, "namesakes (the two Colorados) are kept apart")

lakes = {l["name"]: l for l in reversed(data["lakeNames"])}
for name, published in (("Lake Superior", 82100), ("Lake Victoria", 68900), ("Lake Baikal", 31700), ("Lake Tanganyika", 32900)):
    area = lakes[name]["areaKm2"]
    check(abs(area - published) / published < 0.05, f"{name}: {area:,} km² from the shoreline, {published:,} published")
check(data["lakeNames"][0]["name"] == "Lake Superior", "the largest lake drawn is Superior (the Caspian is a sea on this map)")
check(abs(lakes["Lake Victoria"]["lon"] - 33) < 1.5 and abs(lakes["Lake Victoria"]["lat"] + 1) < 1.5, "Lake Victoria's name sits on the lake")
victoria = nearest_point_deg(data["lakes"], 32.9, -2.5)
check(victoria < 0.5, f"Lake Victoria's shore passes Mwanza ({victoria:.2f}° off)")

ports_path = OUTPUT_DIR / "ports.json"
ports = json.loads(ports_path.read_text())["ports"]
check(ports_path.stat().st_size < 80_000, f"ports.json under 80 kB ({ports_path.stat().st_size} bytes)")
check(len(ports) == 1081, f"Natural Earth's 1,081 ports ({len(ports)})")
check([p["rank"] for p in ports] == sorted(p["rank"] for p in ports), "best rank first")
for city in ("Singapore", "Shanghai", "Lisbon", "Lagos", "Mumbai"):
    at = (cities[city]["lon"], cities[city]["lat"])
    port = min(ports, key=lambda p: arc_km((p["lon"], p["lat"]), at))
    check(arc_km((port["lon"], port["lat"]), at) < 40, f"a port at {city}: {port['name']}")

finish()
