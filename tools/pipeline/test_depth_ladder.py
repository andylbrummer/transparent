#!/usr/bin/env python3
"""
Checks for app/public/geo/depth-ladder.json.

PREM's pressures and densities at its boundaries are in every textbook
(Dziewonski & Anderson 1981, Table II): 135.75 GPa at the core-mantle
boundary, 328.85 GPa at the inner core boundary, 363.85 GPa and
13.09 g/cm3 at the centre; the density steps from 5.57 to 9.90 g/cm3
from the mantle into the core. Anderson's (1982) geotherm reaches 4805 K
at the centre and steps from 2937 K to 3637 K across the boundary layer
at the base of the mantle.

Usage:
    python3 tools/pipeline/generate_depth_ladder.py
    python3 tools/pipeline/test_depth_ladder.py
"""

import json

from generate_depth_ladder import above, load_tables, sides
from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish

table = [[0.0, 1.0], [10.0, 2.0], [10.0, 5.0], [20.0, 6.0]]
check(above(table, 5.0, 1) == 1.5, "a table is read by linear interpolation")
check(above(table, 10.0, 1) == 2.0, "at a discontinuity, the shallow side")
check(above(table, 20.0, 1) == 6.0 and above(table, 0.0, 1) == 1.0, "and at its ends")

prem, geotherm = load_tables()
check(sides(prem, 2_891_000.0, 3) == [5566.45, 9903.49], "PREM's density steps from 5566 to 9903 kg/m3 at the core-mantle boundary")
check(sides(geotherm, 2_891_000.0, 1) == [2937.0, 3637.0], "Anderson's boundary layer, listed at 2886 km, is found from PREM's 2891 km")
check(len(sides(prem, 1_000_000.0, 3)) == 1, "no discontinuity at 1000 km")

data = json.loads((OUTPUT_DIR / "depth-ladder.json").read_text())
rungs = {r["depthKm"]: r for r in data["rungs"]}
check(data["earthRadiusKm"] == 6371.0, "the Earth's radius is 6371 km")
check(list(rungs) == sorted(rungs) and len(rungs) == 8, f"eight rungs, shallowest first ({list(rungs)})")
for depth in (100.0, 1000.0, 2891.0, 6371.0):
    check(depth in rungs, f"the spec's rung at {depth:g} km is there")

# (depth km, pressure GPa, density above, density below or None, temperature above, temperature below or None)
KNOWN = [
    (400.0, 13.35, 3.54, 3.72, 1683, None),
    (670.0, 23.83, 3.99, 4.38, 1830, 1980),
    (2891.0, 135.75, 5.57, 9.90, 2937, 3637),
    (5149.5, 328.85, 12.17, 12.76, 4674, None),
    (6371.0, 363.85, 13.09, None, 4805, None),
]
for depth, pressure, rho_above, rho_below, t_above, t_below in KNOWN:
    r = rungs[depth]
    check(abs(r["pressureGPa"] - pressure) < 0.01, f"{depth:g} km: {pressure} GPa ({r['pressureGPa']})")
    check(r["densityGcm3"] == [rho_above] + ([rho_below] if rho_below else []), f"{depth:g} km: density {r['densityGcm3']} g/cm3")
    check(r["temperatureK"] == [t_above] + ([t_below] if t_below else []), f"{depth:g} km: temperature {r['temperatureK']} K")
pressures = [r["pressureGPa"] for r in data["rungs"]]
check(pressures == sorted(pressures), "pressure only rises with depth")
check(all(r["temperatureK"][0] >= 1400 for r in data["rungs"]), "every rung is hotter than 1400 K")
check(abs(rungs[100.0]["pressureGPa"] - 3.12) < 0.05, f"100 km down is about 3 GPa ({rungs[100.0]['pressureGPa']})")

finish()
