#!/usr/bin/env python3
"""
Checks for the mantle flow pipeline.

The generated flow must show the textbook picture any whole-mantle flow
model driven by tomography gives: the mid mantle rising over the two
large low-shear-velocity provinces under Africa and the Pacific, and
sinking where old slabs lie - the Farallon slab under North America and
the Tethyan slabs under India - while the shallow mantle under the
Pacific is dragged along with the plate.

Usage:
    python3 tools/pipeline/generate_mantle_flow.py --hc-dir HC   # writes app/public/geo/
    python3 tools/pipeline/test_mantle_flow.py
"""

import json
import math

from generate_geo import OUTPUT_DIR
from generate_mantle_flow import POINTS_PER_SHELL, SHELL_DEPTHS_KM
from generate_plate_motion import east_north_velocity, unit
from geo_test_support import check, finish

flow = json.loads((OUTPUT_DIR / "mantle-flow.json").read_text(encoding="utf-8"))
q = flow["quantumPerDegree"]
shells = {s["depthKm"]: s for s in flow["shells"]}
COLUMNS = ("lon", "lat", "east10", "north10", "up10")

check(sorted(shells) == sorted(SHELL_DEPTHS_KM), f"one shell per depth {SHELL_DEPTHS_KM}")
check(all(len(s[c]) == POINTS_PER_SHELL for s in shells.values() for c in COLUMNS), "every shell has full columns")


def points_near(shell: dict, lon: float, lat: float, radius_deg: float = 12):
    centre = unit(lon, lat)
    for i in range(len(shell["lon"])):
        p = unit(shell["lon"][i] / q, shell["lat"][i] / q)
        if math.degrees(math.acos(max(-1.0, min(1.0, sum(a * b for a, b in zip(centre, p)))))) < radius_deg:
            yield i


def mean_up_mm_yr(shell: dict, lon: float, lat: float) -> float:
    ups = [shell["up10"][i] / 10 for i in points_near(shell, lon, lat)]
    return sum(ups) / len(ups)


mid = shells[1450]
for name, lon, lat, rising in [("Africa", 20, -15, True), ("the Pacific", -160, -10, True),
                               ("North America", -80, 35, False), ("India", 75, 10, False)]:
    up = mean_up_mm_yr(mid, lon, lat)
    check(up > 5 if rising else up < -5, f"at 1450 km the mantle {'rises' if rising else 'sinks'} under {name} ({up:+.1f} mm/yr)")

# Pacific angular velocity, Argus, Gordon & DeMets (2011), Table 1.
w = math.radians(0.651)
pacific = tuple(w * c for c in unit(114.70, -63.58))
shallow = shells[300]
alignment = []
for i in points_near(shallow, -165, 10, 20):
    lon, lat = shallow["lon"][i] / q, shallow["lat"][i] / q
    pe, pn = east_north_velocity(pacific, lon, lat)
    fe, fn = shallow["east10"][i], shallow["north10"][i]
    alignment.append((pe * fe + pn * fn) / math.hypot(pe, pn) / max(math.hypot(fe, fn), 1e-9))
mean_alignment = sum(alignment) / len(alignment)
check(mean_alignment > 0.8, f"at 300 km under the central Pacific the mantle moves with the plate (cos {mean_alignment:.2f})")

for depth, shell in shells.items():
    speeds = [math.hypot(e, n) / 10 for e, n in zip(shell["east10"], shell["north10"])]
    mean = sum(speeds) / len(speeds)
    check(2 < mean < 60, f"mean horizontal flow at {depth} km is a few cm/yr ({mean:.1f} mm/yr)")

finish()
