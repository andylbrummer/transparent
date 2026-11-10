#!/usr/bin/env python3
"""
Checks for app/public/geo/craters.json.

The reference diameters and ages are those every account of these
structures gives (and Schmieder & Kring 2020 Table 1 prints): Chicxulub,
180 km across and 66 million years old, centred on the north coast of
Yucatan at the port it is named after; Vredefort, the largest and oldest
of the big ones; Barringer, "Meteor Crater", 1.2 km across in Arizona.
Positions are compared with places anyone can look up, to the paper's
arc minute.

The parser's handling of the table's irregular cells is checked directly.

Usage:
    python3 tools/pipeline/generate_craters.py
    python3 tools/pipeline/test_craters.py
"""

import json

from generate_craters import age_ma, diameter_km, dms
from generate_geo import OUTPUT_DIR, REPO_ROOT
from geo_test_support import check, finish

check(abs(dms("16°40′S") + 16.6667) < 1e-3, "16°40′S is -16.667")
check(abs(dms("S27°46′") + 27.7667) < 1e-3, "a leading hemisphere letter is read")
check(abs(dms("60°08′20′′N") - 60.1389) < 1e-3, "seconds are read")
check(abs(dms("14°33.84′E") - 14.564) < 1e-3, "decimal minutes are read")
check(abs(dms("91°46′WW") + 91.7667) < 1e-3, "a doubled hemisphere letter is read once")
check(diameter_km("180") == 180 and diameter_km("40–90") == 40 and diameter_km("∼40 to 45") == 40,
      "a diameter range is drawn at its smaller end")
check(age_ma("66.052 ± 0.043") == 66.052 and age_ma("<1880") == 1880 and age_ma("") is None, "the first number of an age")

path = OUTPUT_DIR / "craters.json"
craters = json.loads(path.read_text())["craters"]
by_name = {c["name"]: c for c in craters}
check(path.stat().st_size < 60_000, f"under 60 kB ({path.stat().st_size} bytes)")
check(170 <= len(craters) <= 200, f"nearly all of the paper's 200 structures ({len(craters)})")
check(len(by_name) == len(craters), "no structure twice")
check(all(c["diameterKm"] >= 0.1 for c in craters), "none under 100 m")
check([c["diameterKm"] for c in craters] == sorted((c["diameterKm"] for c in craters), reverse=True), "largest first")
check(all(-180 <= c["lon"] <= 180 and -90 <= c["lat"] <= 90 for c in craters), "every position is on the globe")
check(all(c["ageMa"] is None or 0 < c["ageMa"] < 3500 for c in craters), "ages between now and the oldest rocks")
check([c["name"] for c in craters[:3]] == ["Vredefort", "Sudbury", "Chicxulub"], "the three largest are Vredefort, Sudbury, Chicxulub")

# (name, lon, lat, tolerance deg, diameter km, age Ma, age tolerance)
KNOWN = [
    ("Chicxulub", -89.5, 21.3, 0.2, 180, 66.05, 0.1),             # Chicxulub Puerto: 21.29 N, 89.6 W
    ("Vredefort", 27.5, -27.0, 0.2, 250, 2023, 5),                 # Vredefort town: 27.0 S, 27.37 E
    ("Sudbury", -81.18, 46.6, 0.2, 200, 1850, 2),                  # Sudbury, Ontario: 46.49 N, 81.0 W
    ("Manicouagan", -68.7, 51.38, 0.2, 100, 215.5, 1),             # the ring lake in Quebec
    ("Popigai", 111.0, 71.5, 0.7, 100, 36.6, 1),
    ("Nördlinger Ries (Ries crater)", 10.57, 48.88, 0.2, 24, 14.8, 0.2),   # Noerdlingen: 48.85 N, 10.49 E
    ("Barringer (Meteor Crater)", -111.02, 35.03, 0.05, 1.186, 0.056, 0.01),
    ("Bosumtwi", -1.42, 6.53, 0.1, 10.5, 1.13, 0.1),               # Lake Bosumtwi, Ghana: 6.50 N, 1.41 W
    ("Lonar", 76.52, 19.98, 0.05, 1.83, 0.576, 0.01),              # Lonar Lake, India: 19.98 N, 76.51 E
    ("Gosses Bluff (Tnorala)", 132.32, -23.83, 0.05, 22, None, None),
]
for name, lon, lat, tolerance, diameter, age, age_tolerance in KNOWN:
    check(name in by_name, f"{name} is listed")
    if name not in by_name:
        continue
    c = by_name[name]
    check(abs(c["lon"] - lon) <= tolerance and abs(c["lat"] - lat) <= tolerance, f"{name} at {lon}, {lat} ({c['lon']}, {c['lat']})")
    check(c["diameterKm"] == diameter, f"{name} is {diameter} km across ({c['diameterKm']})")
    if age is not None:
        check(abs(c["ageMa"] - age) <= age_tolerance, f"{name} is {age} Ma old ({c['ageText']})")

# Orientation: no hemisphere lost. Chicxulub west and north, Vredefort east and south.
check(by_name["Chicxulub"]["lon"] < 0 < by_name["Chicxulub"]["lat"], "Chicxulub is in the north-west quadrant")
check(by_name["Vredefort"]["lat"] < 0 < by_name["Vredefort"]["lon"], "Vredefort is in the south-east quadrant")
# The recent falls too small to be craters on a globe are left out, as documented.
check("Chelyabinsk" not in by_name and "Carancas" not in by_name, "the metre-scale falls are left out")

# The panel's caption states the count before any data loads.
caption = (REPO_ROOT / "app/src/layers/craters/layer.ts").read_text()
check(f"the {len(craters)} proven impact structures" in caption, f"the app's caption says {len(craters)} structures")

finish()
