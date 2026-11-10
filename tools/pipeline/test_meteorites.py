#!/usr/bin/env python3
"""
Checks for app/public/geo/meteorites.json.

References anyone can look up: Hoba lies where it fell, near Grootfontein,
Namibia (19.59 S 17.93 E), 60 tonnes of iron and the largest meteorite
known; Sikhote-Alin fell on 12 February 1947 in the mountains of that name
north of Vladivostok (46.16 N 134.65 E), 23 tonnes; Allende fell on
8 February 1969 at Pueblito de Allende, Chihuahua (26.97 N 105.32 W),
2 tonnes of carbonaceous chondrite; Ensisheim, Alsace (47.87 N 7.35 E),
fell in 1492 and is the oldest fall in Europe with material kept (the
table dates it 1491: see the note in docs/data-sources/events.md).

Usage:
    python3 tools/pipeline/generate_meteorites.py
    python3 tools/pipeline/test_meteorites.py
"""

import json

from generate_geo import OUTPUT_DIR, REPO_ROOT
from generate_meteorites import FIND_MIN_MASS_G, build, record
from geo_test_support import check, finish


def row(**fields: str) -> dict:
    base = {"name": "X", "nametype": "Valid", "recclass": "H5", "mass (g)": "10", "fall": "Fell", "year": "1900",
            "reclat": "1.0", "reclong": "2.0"}
    return {**base, **fields}


check(record(row()) == ["X", 1900, 1.0, 2.0, 10, "H5"], "a record is [name, year, lat, lon, mass, class]")
check(record(row(reclat="0.000000", reclong="0.000000")) is None, "0 N 0 E is a missing position")
check(record(row(reclat="", reclong="")) is None, "no position, no record")
check(record(row(**{"mass (g)": ""}))[4] is None, "an unknown mass stays null")
sample_falls, sample_finds = build([
    row(name="a"), row(name="b", fall="Found"), row(name="c", fall="Found", **{"mass (g)": "2000000"}),
    row(name="d", nametype="Relict"), row(name="e", **{"mass (g)": "500"}),
])
check([e[0] for e in sample_falls] == ["e", "a"], "falls, heaviest first; relicts left out")
check([e[0] for e in sample_finds] == ["c"], "only finds of a tonne or more")

path = OUTPUT_DIR / "meteorites.json"
data = json.loads(path.read_text())
falls = {e[0]: e for e in data["falls"]}
finds = {e[0]: e for e in data["finds"]}
check(path.stat().st_size < 80_000, f"under 80 kB ({path.stat().st_size} bytes)")
check(1000 <= len(falls) <= 1400, f"about 1,100 observed falls ({len(falls)})")
check(30 <= len(finds) <= 80, f"a few dozen finds of a tonne or more ({len(finds)})")
check(len(falls) == len(data["falls"]) and len(finds) == len(data["finds"]), "no name twice")
check(not set(falls) & set(finds), "nothing is both a fall and a find")
everything = data["falls"] + data["finds"]
check(all(-90 <= e[2] <= 90 and -180 <= e[3] <= 180 and not (e[2] == 0 and e[3] == 0) for e in everything),
      "every position is on the globe and none is 0, 0")
check(all(e[4] >= FIND_MIN_MASS_G for e in data["finds"]), "every find weighs a tonne or more")
check(all(e[1] is None or 800 <= e[1] <= data["asOf"] for e in everything), "years between 800 and the table's last fall")
check(data["asOf"] == 2013, "the table ends in 2013")

# (list, name, lat, lon, tolerance deg, year, mass g)
KNOWN = [
    (finds, "Hoba", -19.59, 17.93, 0.05, 1920, 60_000_000),
    (finds, "Cape York", 76.13, -64.93, 0.1, 1818, 58_200_000),
    (finds, "Canyon Diablo", 35.05, -111.03, 0.05, 1891, 30_000_000),   # beside Meteor Crater, 35.03 N 111.02 W
    (finds, "Willamette", 45.37, -122.58, 0.1, 1902, 15_500_000),
    (falls, "Sikhote-Alin", 46.16, 134.65, 0.05, 1947, 23_000_000),
    (falls, "Allende", 26.97, -105.32, 0.05, 1969, 2_000_000),
    # Ensisheim fell on 7 November 1492 (Julian); this table has 1491, and the file keeps what the table says.
    (falls, "Ensisheim", 47.87, 7.35, 0.05, 1491, 127_000),
    (falls, "Chelyabinsk", 54.82, 61.12, 0.4, 2013, 100_000),
    (falls, "Murchison", -36.62, 145.2, 0.1, 1969, 100_000),
    (falls, "Peekskill", 41.28, -73.92, 0.1, 1992, 12_570),
]
for group, name, lat, lon, tolerance, year, mass in KNOWN:
    check(name in group, f"{name} is listed")
    if name not in group:
        continue
    e = group[name]
    check(abs(e[2] - lat) <= tolerance and abs(e[3] - lon) <= tolerance, f"{name} at {lat}, {lon} ({e[2]}, {e[3]})")
    check(e[1] == year and e[4] == mass, f"{name}: {year}, {mass} g ({e[1]}, {e[4]})")

check(data["finds"][0][0] == "Hoba" and data["falls"][0][0] == "Sikhote-Alin", "Hoba and Sikhote-Alin head their lists")
# No hemisphere lost: Allende west and north, Murchison east and south.
check(falls["Allende"][3] < 0 < falls["Allende"][2] and falls["Murchison"][2] < 0 < falls["Murchison"][3], "signs of latitude and longitude kept")

caption = (REPO_ROOT / "app/src/layers/meteorites/layer.ts").read_text()
check(f"{len(falls):,} meteorites seen to fall" in caption, f"the app's caption says {len(falls):,} falls")
check(f"{len(finds)} largest" in caption, f"and {len(finds)} finds")

finish()
