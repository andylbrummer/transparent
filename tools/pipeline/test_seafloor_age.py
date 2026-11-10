#!/usr/bin/env python3
"""
Checks for the seafloor-age image: app/public/geo/seafloor-age.png against
the grid it was baked from.

Every reference age below was read from the source grid
(age.2020.1.GTS2012.6m.nc, Seton et al. 2020) at the node named, on
2026-11-09. The image holds the mean of the few nodes in each pixel, coded
to 8 bits, so it must agree to a Myr or so on smooth old seafloor and stay
under a Myr or two on a ridge axis, where one pixel spans both flanks.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_seafloor_age.py
    python3 tools/pipeline/test_seafloor_age.py     # needs numpy and pillow
"""

import numpy as np
from PIL import Image

from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish

AGE_MAX_MYR = 340.0  # generate_seafloor_age.AGE_MAX_MYR; the app's ramp.ts carries the same

path = OUTPUT_DIR / "seafloor-age.png"
image = np.array(Image.open(path))
height, width = image.shape[:2]
check(image.shape == (1024, 2048, 3), f"a 2048 x 1024 RGB image, no alpha ({image.shape})")
check(path.stat().st_size < 500_000, f"under 500 kB ({path.stat().st_size} bytes)")
check(int(image[..., 2].max()) == 0, "blue is unused")


def pixel(lon: float, lat: float) -> tuple[int, int]:
    return min(int((90.0 - lat) / 180.0 * height), height - 1), int((lon + 180.0) / 360.0 * width) % width


def age(lon: float, lat: float) -> float:
    row, column = pixel(lon, lat)
    return AGE_MAX_MYR * (int(image[row, column, 0]) / 255.0) ** 2


def covered(lon: float, lat: float) -> int:
    row, column = pixel(lon, lat)
    return int(image[row, column, 1])


# (lon, lat, age in the source grid, tolerance, what)
AGES = [
    (-42.7, 30.0, 0.11, 1.5, "the Mid-Atlantic Ridge axis at 30 N"),
    (-13.8, -30.0, 0.16, 1.5, "the Mid-Atlantic Ridge axis at 30 S"),
    (-113.3, -20.0, 0.45, 1.5, "the East Pacific Rise axis at 20 S"),
    (-129.5, 46.0, 1.03, 1.5, "the Juan de Fuca Ridge"),
    (-140.0, 40.0, 32.09, 1.5, "the north-east Pacific at 40 N 140 W"),
    (90.0, -10.0, 59.29, 2.0, "the Indian Ocean at 10 S 90 E"),
    (-30.0, -30.0, 77.93, 2.5, "the South Atlantic's western flank at 30 S 30 W"),
    (145.0, 38.0, 136.21, 3.0, "the Pacific plate off Japan, about to subduct"),
    (-93.0, 25.0, 139.45, 3.0, "the Gulf of Mexico"),
    (156.0, 18.0, 168.29, 3.0, "the Jurassic western Pacific at 18 N 156 E"),
    (28.0, 34.0, 306.37, 6.0, "the eastern Mediterranean, among the oldest floor in the grid"),
]
for lon, lat, source, tolerance, what in AGES:
    got = age(lon, lat)
    check(covered(lon, lat) == 255 and abs(got - source) <= tolerance,
          f"{what}: {source} Myr in the grid ({got:.1f} Myr, coverage {covered(lon, lat)})")

# Spreading is symmetric: along 30 S the grid's 65 Myr crust is at 26.75 W and
# 0.3 W, 12.95 and 13.5 degrees either side of the axis at 13.8 W.
west, east = age(-26.75, -30.0), age(-0.3, -30.0)
check(abs(west - 65) <= 2.5 and abs(east - 65) <= 2.5,
      f"65 Myr crust lies 1250 km west and 1300 km east of the South Atlantic ridge at 30 S ({west:.1f}, {east:.1f} Myr)")
profile = [age(lon, -30.0) for lon in (-13.8, -17.0, -20.0, -23.0, -26.75, -30.0)]
check(profile == sorted(profile), f"crust ages steadily away from the ridge ({', '.join(f'{a:.0f}' for a in profile)} Myr)")

check(covered(-98.0, 38.0) == 0 and covered(88.0, 32.0) == 0 and covered(25.0, 0.0) == 0,
      "no ocean crust under Kansas, Tibet or the Congo")
# Off the crust the red channel repeats the nearest crust, never a made-up zero.
check(100 < age(-98.0, 38.0) < 200, f"Kansas carries the age of the nearest ocean floor, not zero ({age(-98.0, 38.0):.0f} Myr)")

coverage = image[..., 1].astype(float) / 255.0
area = np.cos(np.radians(90 - (np.arange(height) + 0.5) * 180 / height))[:, None]
share = float((coverage * area).sum() / (area.sum() * width))
check(0.55 <= share <= 0.60, f"ocean crust is 57 % of the sphere, as in the grid ({100 * share:.1f} %)")

# The antimeridian: the Pacific floor is continuous across it.
ages = AGE_MAX_MYR * (image[..., 0].astype(float) / 255.0) ** 2
both = (image[:, 0, 1] == 255) & (image[:, -1, 1] == 255)
jump = np.abs(ages[:, 0] - ages[:, -1])[both]
check(both.sum() > 300 and float(np.median(jump)) < 1.0,
      f"no seam at 180 degrees: neighbouring pixels across it differ by {float(np.median(jump)):.2f} Myr at the median")
covered_ages = ages[image[..., 1] == 255]
check(float(covered_ages.max()) > 300 and float(np.percentile(covered_ages, 99)) < 200,
      "ages run past 300 Myr, 99 % of the floor is under 200")

finish()
