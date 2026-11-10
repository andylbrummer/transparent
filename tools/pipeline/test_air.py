#!/usr/bin/env python3
"""
Checks for app/public/geo/airports.json and air-routes.json.

Airport positions (OurAirports) are held against a second source,
Natural Earth's airports, for every IATA code both carry; a few are
pinned to the cities they serve. Routes: London-New York must be there,
flown in 2014 by several airlines, and nothing may claim to be newer
than the database is.

Usage:
    python3 tools/pipeline/generate_air.py
    python3 tools/pipeline/test_air.py
"""

import json

from fetch_cache import cached_fetch
from generate_air import LONG_HAUL_KM, MIN_AIRLINES
from generate_cables import arc_km
from generate_geo import NATURAL_EARTH_BASE, OUTPUT_DIR
from geo_test_support import check, finish

airports_path = OUTPUT_DIR / "airports.json"
airports = json.loads(airports_path.read_text())["airports"]
by_code = {a["iata"]: a for a in airports}
check(airports_path.stat().st_size < 120_000, f"airports.json under 120 kB ({airports_path.stat().st_size} bytes)")
check(1000 <= len(airports) <= 1400 and len(by_code) == len(airports), f"about 1,150 large airports, no code twice ({len(airports)})")
check([a["rank"] for a in airports] == sorted(a["rank"] for a in airports), "best rank first")
for code, city, lon, lat in (("AUS", "Austin", -97.67, 30.19), ("LHR", "London", -0.46, 51.47), ("HND", "Tokyo", 139.78, 35.55), ("SYD", "Sydney", 151.18, -33.95)):
    a = by_code[code]
    check(arc_km((a["lon"], a["lat"]), (lon, lat)) < 5 and city in a["city"], f"{code} is {city}'s airport, where it should be")

reference = json.loads(cached_fetch(f"{NATURAL_EARTH_BASE}/ne_10m_airports.geojson", "human/ne_10m_airports.geojson").read_text(encoding="utf-8"))
offsets = []
for feature in reference["features"]:
    code = feature["properties"].get("iata_code")
    if code in by_code:
        lon, lat = feature["geometry"]["coordinates"][:2]
        offsets.append((arc_km((by_code[code]["lon"], by_code[code]["lat"]), (lon, lat)), code))
offsets.sort()
check(len(offsets) > 500, f"{len(offsets)} airports are also in Natural Earth")
within = sum(1 for off, _ in offsets if off < 5)
check(within / len(offsets) > 0.97, f"{within} of them within 5 km of Natural Earth's position ({within / len(offsets):.1%}; worst {offsets[-1][1]} {offsets[-1][0]:.0f} km)")

routes_path = OUTPUT_DIR / "air-routes.json"
data = json.loads(routes_path.read_text())
check(routes_path.stat().st_size < 80_000, f"air-routes.json under 80 kB ({routes_path.stat().st_size} bytes)")
check(data["dataDate"] == "2014-06" and "ODbL" in data["licence"], "the file says it is ODbL data of June 2014")
codes = [a[0] for a in data["airports"]]
pairs = {tuple(sorted((codes[a], codes[b]))): n for a, b, n in data["routes"]}
check(len(pairs) == len(data["routes"]), "no pair twice")
check(pairs.get(("JFK", "LHR"), 0) >= 5, f"London-New York was flown by {pairs.get(('JFK', 'LHR'))} airlines")
check(("LHR", "SIN") in pairs and ("LAX", "SYD") in pairs, "the long hauls are there: London-Singapore, Los Angeles-Sydney")
position = {a[0]: (a[1], a[2]) for a in data["airports"]}
check(all(n >= MIN_AIRLINES or arc_km(position[a], position[b]) >= LONG_HAUL_KM for (a, b), n in pairs.items()),
      f"every route has {MIN_AIRLINES} airlines or is over {LONG_HAUL_KM} km")
check(max(arc_km(position[a], position[b]) for a, b in pairs) < 16500, "no route longer than the longest ever flown non-stop")
check(all(arc_km(position[c], (by_code[c]["lon"], by_code[c]["lat"])) < 1 for c in codes if c in by_code), "route ends sit on the airports of the airport layer")

finish()
