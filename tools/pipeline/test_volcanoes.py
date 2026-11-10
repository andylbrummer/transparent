#!/usr/bin/env python3
"""
Checks for app/public/geo/volcanoes.json against known volcanoes.

Positions and heights are the Global Volcanism Program's own (Volcanoes
of the World v. 5, read 2026-11-09) and are compared with places anyone
can look up: Etna is on Sicily's east coast, Fuji is 3776 m high. The
eruptions are the famous ones of the historical record with the index
(VEI) the database gives them.

Usage:
    python3 tools/pipeline/generate_volcanoes.py
    python3 tools/pipeline/test_volcanoes.py
"""

import json

from generate_geo import OUTPUT_DIR, REPO_ROOT
from geo_test_support import check, finish

path = OUTPUT_DIR / "volcanoes.json"
data = json.loads(path.read_text())
holocene, pleistocene = data["holocene"], data["pleistocene"]
q = data["quantumPerDegree"]
as_of_year = int(data["asOf"][:4])

check(path.stat().st_size < 150_000, f"under 150 kB ({path.stat().st_size} bytes)")
check(1100 < len(holocene["name"]) < 1500, f"about 1200 Holocene volcanoes ({len(holocene['name'])})")
check(1200 < len(pleistocene["name"]) < 1800, f"about 1450 Pleistocene volcanoes ({len(pleistocene['name'])})")
for table, columns in ((holocene, ("lon", "lat", "elevationM", "type", "name", "lastYear")),
                       (pleistocene, ("lon", "lat", "elevationM", "type", "name"))):
    check(len({len(table[c]) for c in columns}) == 1, f"parallel arrays of one length ({columns})")
    check(all(-180 * q <= v <= 180 * q for v in table["lon"]) and all(-90 * q <= v <= 90 * q for v in table["lat"]),
          "every position is on the globe")
    check(all(0 <= t < len(data["types"]) for t in table["type"]), "every type index names a type")
years = [y for y in holocene["lastYear"] if y != data["missingYear"]]
check(max(years) <= as_of_year, f"no eruption after the year the data were read ({max(years)} <= {as_of_year})")
check(min(years) > -12_000, f"the oldest dated eruption is Holocene ({min(years)})")
recent = sum(y >= as_of_year - 1 for y in years)
check(30 <= recent <= 110, f"some dozens of volcanoes erupted in {as_of_year - 1}-{as_of_year} ({recent})")

# (name, lon, lat, elevation m, last eruption no earlier than, type contains)
VOLCANOES = [
    ("Etna", 15.0, 37.75, 3357, 2020, "Stratovolcano"),
    ("Fujisan", 138.73, 35.36, 3776, 1707, "Stratovolcano"),
    ("Vesuvius", 14.43, 40.82, 1281, 1944, "Stratovolcano"),
    ("St. Helens", -122.18, 46.2, 2549, 2008, "Stratovolcano"),
    ("Kilauea", -155.29, 19.42, 1222, 2020, "Shield"),
    ("Erebus", 167.17, -77.53, 3794, 2020, "Stratovolcano"),
    ("Krakatau", 105.42, -6.10, None, 2018, "Caldera"),
    ("Popocatepetl", -98.62, 19.02, 5393, 2020, "Stratovolcano"),
    ("Nyiragongo", 29.25, -1.52, 3470, 2021, "Stratovolcano"),
    ("Eyjafjallajokull", -19.63, 63.63, 1651, 2010, "Stratovolcano"),
]
for name, lon, lat, elevation, since, kind in VOLCANOES:
    present = name in holocene["name"]
    check(present, f"{name} is listed")
    if not present:
        continue
    i = holocene["name"].index(name)
    check(abs(holocene["lon"][i] / q - lon) < 0.02 and abs(holocene["lat"][i] / q - lat) < 0.02,
          f"{name} at {lon}, {lat} ({holocene['lon'][i] / q}, {holocene['lat'][i] / q})")
    if elevation is not None:
        check(holocene["elevationM"][i] == elevation, f"{name} is {elevation} m high ({holocene['elevationM'][i]})")
    check(holocene["lastYear"][i] >= since, f"{name} last erupted in or after {since} ({holocene['lastYear'][i]})")
    check(kind in data["types"][holocene["type"][i]], f"{name} is a {kind} ({data['types'][holocene['type'][i]]})")

eruptions = data["eruptions"]
check(40 <= len(eruptions) <= 90, f"some dozens of Holocene eruptions of VEI 6+ ({len(eruptions)})")
check(all(e["vei"] in (6, 7, 8) for e in eruptions), "all VEI 6 or more")
# (volcano, start year, VEI, lon, lat)
ERUPTIONS = [
    ("Tambora", 1812, 7, 118.0, -8.25),
    ("Krakatau", 1883, 6, 105.42, -6.10),
    ("Pinatubo", 1991, 6, 120.35, 15.13),
    ("Novarupta", 1912, 6, -155.16, 58.27),
    ("Santa Maria", 1902, 6, -91.55, 14.76),
    ("Huaynaputina", 1600, 6, -70.85, -16.61),
    ("Rinjani", 1257, 7, 116.47, -8.42),
    ("Santorini", -1610, 7, 25.40, 36.40),
]
for name, year, vei, lon, lat in ERUPTIONS:
    found = [e for e in eruptions if e["name"] == name and e["startYear"] == year]
    check(len(found) == 1, f"{name} {year} is listed once")
    if found:
        e = found[0]
        check(e["vei"] == vei, f"{name} {year} is VEI {vei} ({e['vei']})")
        check(abs(e["lon"] - lon) < 0.05 and abs(e["lat"] - lat) < 0.05, f"{name} at {lon}, {lat} ({e['lon']}, {e['lat']})")
tambora = next(e for e in eruptions if e["name"] == "Tambora" and e["startYear"] == 1812)
check(tambora["endYear"] == 1815, f"Tambora's eruption ran to 1815 ({tambora['endYear']})")
check(not any(e["startYear"] > as_of_year for e in eruptions), "none in the future")

# The panel's caption states the count before any data loads.
total = len(holocene["name"]) + len(pleistocene["name"])
caption = (REPO_ROOT / "app/src/layers/volcanoes/layer.ts").read_text()
check(f"{total:,} volcanoes" in caption, f"the app's caption says {total:,} volcanoes")

finish()
