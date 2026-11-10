#!/usr/bin/env python3
"""
Checks for app/public/geo/ocean-currents.bin and ocean-currents.json.

The reference is the ocean's circulation as every oceanography text
draws it (e.g. Talley et al., Descriptive Physical Oceanography, 6th ed.,
2011, ch. 9-13): the western boundary currents run poleward and fast -
the Gulf Stream north-east off Cape Hatteras, the Kuroshio east past
Japan, the Agulhas south-west down Africa and back on itself; the
equatorial currents run west with an eastward countercurrent between
them north of the equator; the Antarctic Circumpolar Current runs east
through Drake Passage. A mean of three years must show all of them, in
those directions, and nothing on land.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_ocean_currents.py
    python3 tools/pipeline/test_ocean_currents.py     # needs numpy
"""

import json
import math

import numpy as np

from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish

meta = json.loads((OUTPUT_DIR / "ocean-currents.json").read_text())
raw = np.frombuffer((OUTPUT_DIR / "ocean-currents.bin").read_bytes(), dtype=np.int8)
NI, NJ = meta["grid"]["ni"], meta["grid"]["nj"]
check(meta["grid"] == {"ni": 360, "nj": 181, "latFirst": 90, "latStep": -1, "lonFirst": 0, "lonStep": 1},
      "on the 1-degree grid of the app's wind particles (360 x 181 from 90 N, 0 E)")
check(raw.size == 2 * NI * NJ, f"two int8 grids ({raw.size} bytes)")
u, v = (raw.reshape(2, NJ, NI) * meta["scale"]).astype(float)
speed = np.hypot(u, v)
check(meta["period"][0].startswith("2011-12") and meta["period"][1].startswith("2014-09"), f"a mean over {meta['period']}")
check(meta["composites"] >= 30, f"of {meta['composites']} composites")


def at(lon: float, lat: float) -> tuple[float, float]:
    """(eastward, northward) m/s at a whole-degree node."""
    return float(u[90 - round(lat), round(lon) % 360]), float(v[90 - round(lat), round(lon) % 360])


def fastest(lon0: int, lon1: int, lat0: int, lat1: int) -> tuple[float, float, float]:
    """(speed, eastward, northward) of the fastest node in a box."""
    best = (0.0, 0.0, 0.0)
    for lat in range(lat0, lat1 + 1):
        for lon in range(lon0, lon1 + 1):
            e, n = at(lon, lat)
            if math.hypot(e, n) > best[0]:
                best = (math.hypot(e, n), e, n)
    return best


ocean = speed > 0
# A few ocean nodes round to no motion at all at 1 cm/s.
check(30000 < meta["oceanCells"] < 40000 and 0.97 * meta["oceanCells"] < int(ocean.sum()) <= meta["oceanCells"],
      f"about 35,000 ocean nodes ({meta['oceanCells']}, {int(ocean.sum())} of them moving)")
for lon, lat, what in [(10, 20, "the Sahara"), (-100, 40, "Kansas"), (90, 35, "Tibet"), (135, -25, "Australia"), (0, -85, "Antarctica"), (0, 89, "the Arctic beyond the product's 80 N")]:
    check(at(lon, lat) == (0.0, 0.0), f"nothing flows on {what}")

s, e, n = fastest(-78, -68, 33, 39)
check(s > 0.4 and e > 0 and n > 0, f"the Gulf Stream off Cape Hatteras runs north-east at over 0.4 m/s ({s:.2f} m/s; east {e:+.2f}, north {n:+.2f})")
s, e, n = fastest(-81, -79, 25, 31)
check(s > 0.4 and n > 0.3, f"the Florida Current runs north ({s:.2f} m/s; north {n:+.2f})")
s, e, n = fastest(132, 145, 30, 37)
check(s > 0.4 and e > 0.3, f"the Kuroshio runs east past Japan ({s:.2f} m/s; east {e:+.2f})")
s, e, n = fastest(24, 33, -37, -30)
check(s > 0.4 and e < 0 and n < 0, f"the Agulhas Current runs south-west ({s:.2f} m/s; east {e:+.2f}, north {n:+.2f})")
drake = np.mean([at(-65, lat)[0] for lat in range(-62, -56)])
check(drake > 0.08, f"the Circumpolar Current runs east through Drake Passage (mean {drake:+.2f} m/s at 65 W)")
# Its two branches straddle the equator, at about 2 N and 4 S; between them the undercurrent slows the surface.
sec = np.mean([at(lon, -4)[0] for lon in range(-140, -100)])
check(sec < -0.15, f"the South Equatorial Current runs west along 4 S in the Pacific (mean {sec:+.2f} m/s)")
sec_north = np.mean([at(lon, 2)[0] for lon in range(-140, -100)])
check(sec_north < -0.15, f"and along 2 N (mean {sec_north:+.2f} m/s)")
necc = np.mean([at(lon, 7)[0] for lon in range(-150, -110)])
check(necc > 0.1, f"the North Equatorial Countercurrent runs east along 7 N (mean {necc:+.2f} m/s)")
nec = np.mean([at(lon, 14)[0] for lon in range(140, 180)])
check(nec < -0.08, f"the North Equatorial Current runs west along 14 N (mean {nec:+.2f} m/s)")
gyre = float(np.mean(speed[90 - 35:90 - 25, 310:330][ocean[90 - 35:90 - 25, 310:330]]))
check(gyre < 0.08, f"the middle of the North Atlantic gyre is slow (mean {gyre:.3f} m/s)")
# Orientation: the fast current off a mid-latitude east coast is in the north-west Atlantic, not its mirror images.
check(fastest(-78, -68, 33, 39)[0] > 2 * fastest(68, 78, 33, 39)[0], "the Gulf Stream is in the west, not mirrored east-west")
check(fastest(-78, -68, 33, 39)[0] > 2 * fastest(-78, -68, -39, -33)[0], "nor north-south")
check(float(np.abs(raw).max()) <= 127 and float(speed.max()) <= 1.8, f"speeds fit the code ({speed.max():.2f} m/s at most)")

names = {n["name"]: n for n in meta["names"]}
check(8 <= len(names) <= 20, f"a handful of named currents ({sorted(names)})")
check("Gulf Stream" in names and "Agulhas Current" in names, "the Gulf Stream and the Agulhas are named")
check(all("Current" in n or "Stream" in n or "Throughflow" in n for n in names), "tidal races and rapids are not")
gulf = names["Gulf Stream"]
check(fastest(round(gulf["lon"]) - 5, round(gulf["lon"]) + 5, round(gulf["lat"]) - 4, round(gulf["lat"]) + 4)[0] > 0.4,
      f"the Gulf Stream's name ({gulf['lon']}, {gulf['lat']}) sits by the current drawn")
agulhas = names["Agulhas Current"]
check(fastest(round(agulhas["lon"]) - 6, round(agulhas["lon"]) + 3, round(agulhas["lat"]) - 6, round(agulhas["lat"]) + 3)[0] > 0.4,
      f"the Agulhas' name ({agulhas['lon']}, {agulhas['lat']}) sits by the current drawn")

finish()
