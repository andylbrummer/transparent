#!/usr/bin/env python3
"""
Checks for the plate motion pipeline.

The velocity maths is checked against motions anyone can look up in the
NNR-MORVEL56 frame: the Pacific plate carries Hawaii ~70 mm/yr toward the
west-northwest, the Nazca plate drives east into Peru, and North America
creeps west-southwest under Austin. Point-in-plate and arrow geometry are
checked on the generated file.

Usage:
    python3 tools/pipeline/generate_plate_motion.py   # writes app/public/geo/
    python3 tools/pipeline/test_plate_motion.py
"""

import json
import math

from generate_geo import OUTPUT_DIR, decode_polyline
from generate_plate_motion import (ARROW_MYR, GRID_POINTS, SphericalPolygon, east_north_velocity,
                                   fibonacci_grid, unit)
from geo_test_support import check, finish


def omega(lat: float, lon: float, deg_per_myr: float) -> tuple[float, float, float]:
    w = math.radians(deg_per_myr)
    return tuple(w * c for c in unit(lon, lat))


def speed_azimuth(pole, lon: float, lat: float) -> tuple[float, float]:
    east, north = east_north_velocity(pole, lon, lat)
    return math.hypot(east, north), math.degrees(math.atan2(east, north))


def great_circle_km(a, b) -> float:
    return 6371.0 * math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(unit(*a), unit(*b))))))


# Angular velocities from Argus, Gordon & DeMets (2011), Table 1.
PACIFIC = omega(-63.58, 114.70, 0.651)
NAZCA = omega(46.23, -101.06, 0.696)
NORTH_AMERICA = omega(-4.85, -80.64, 0.209)

speed, azimuth = speed_azimuth(PACIFIC, -155.5, 19.5)
check(65 < speed < 75 and -70 < azimuth < -55, f"Hawaii rides the Pacific plate WNW at ~70 mm/yr ({speed:.0f}, {azimuth:.0f})")
speed, azimuth = speed_azimuth(NAZCA, -85.0, -10.0)
check(60 < speed < 72 and 70 < azimuth < 85, f"Nazca drives east into Peru ({speed:.0f}, {azimuth:.0f})")
speed, azimuth = speed_azimuth(NORTH_AMERICA, -97.74, 30.27)
check(10 < speed < 20 and -130 < azimuth < -105, f"North America creeps WSW under Austin ({speed:.0f}, {azimuth:.0f})")

square = SphericalPolygon([(-10, -10), (10, -10), (10, 10), (-10, 10), (-10, -10)])
check(square.contains(unit(0, 0)) and not square.contains(unit(30, 0)) and not square.contains(unit(180, 0)),
      "a square contains its centre and not points outside or opposite")
cap = SphericalPolygon([(lon, -60) for lon in range(0, 361, 30)])
check(cap.contains(unit(45, -89)) and not cap.contains(unit(45, 0)), "a polar cap contains the pole across the antimeridian")

grid = fibonacci_grid(GRID_POINTS)
check(len(grid) == GRID_POINTS and abs(sum(lat for _, lat in grid)) < 1, "the grid is balanced between hemispheres")

motion = json.loads((OUTPUT_DIR / "plate-motion.json").read_text(encoding="utf-8"))
arrows = [decode_polyline(encoded) for encoded in motion["layers"]["plate-motion"]]
check(len(arrows) > GRID_POINTS * 0.97, f"nearly every grid point has an arrow ({len(arrows)})")
check(all(len(a) == 5 and a[1] == a[3] for a in arrows), "every arrow is base, tip, barb, tip, barb")
check(all(abs(a[1][0] - a[0][0]) < 20 for a in arrows), "no arrow wraps the antimeridian")
longest = max(great_circle_km(a[0], a[1]) for a in arrows)
# The fastest plates (Cocos, Tonga's neighbours) move ~100-160 mm/yr in NNR.
check(longest < 200 * ARROW_MYR, f"no arrow is longer than 200 mm/yr allows ({longest:.0f} km)")

near_hawaii = min(arrows, key=lambda a: great_circle_km(a[0], (-155.5, 19.5)))
length = great_circle_km(near_hawaii[0], near_hawaii[1])
check(great_circle_km(near_hawaii[0], (-155.5, 19.5)) < 600 and 50 * ARROW_MYR < length < 90 * ARROW_MYR
      and near_hawaii[1][0] < near_hawaii[0][0] and near_hawaii[1][1] > near_hawaii[0][1],
      f"the arrow by Hawaii points northwest, {length:.0f} km long")

finish()
