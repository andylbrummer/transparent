#!/usr/bin/env python3
"""
Checks for app/public/geo/permafrost.png and permafrost.json.

The projection against its definition (Snyder 1987, USGS PP 1395, ch.
21): the pole at the origin, true scale (k = 1) on the standard parallel,
k at the pole (1 + sin 71)/2 to within the ellipsoid's difference, the
central meridian pointing down the plane.

The zones against the paper that made them (Obu et al. 2019, Earth-Sci.
Rev. 193, 299-316, section 3.2, read on 2026-11-11): continuous 10.7,
discontinuous 3.1, sporadic 3.5, isolated patches 3.5 million km2, 20.8
in all. Those are counts of the 1 km probability pixels; the file is the
smoothed polygons, so continuous, discontinuous and sporadic are held to
10%. The isolated zone is not: the polygons give 4.7 million km2, and
the paper itself finds the isolated patches overestimated (central
Alaska, its section 3.4.1); smoothing scattered pixels into polygons can
only add to that.

Places, from the same paper: no permafrost on Kodiak Island ("Permafrost
is absent south of Katmai National Park and in Kodiak Island") nor in
Spain's Sierra Nevada ("No permafrost is modelled in the Sierra
Nevada"); the North Slope of Alaska, where the extent "matches well"
Jorgenson et al. (2008), whose map has it continuous. Greenland's ice
sheet is left out (the product guide's figures mark glaciers apart).

Usage:
    python3 tools/pipeline/generate_permafrost.py
    python3 tools/pipeline/test_permafrost.py
"""

import json
import math

import numpy as np
from PIL import Image

import generate_permafrost as bake
from generate_geo import OUTPUT_DIR, REPO_ROOT
from geo_test_support import check, finish

x, y = bake.forward(np.array([0.0, 90.0, 0.0, 180.0]), np.array([90.0, 71.0, 71.0, 60.0]))
check(abs(x[0]) < 1e-6 and abs(y[0]) < 1e-6, "the pole is the origin")
m_c = math.cos(bake.LAT_C) / math.sqrt(1 - (bake.E * math.sin(bake.LAT_C)) ** 2)
check(abs(x[1] - bake.A * m_c) < 1e-3 and abs(y[1]) < 1e-6, f"71 N, 90 E: on the +x axis at a.m_c ({x[1]:.1f} m)")
check(abs(x[2]) < 1e-6 and y[2] < 0, "the central meridian runs down the plane (-y)")
check(abs(x[3]) < 1e-3 and y[3] > 0, "180 degrees runs up it")
check(abs(bake.scale_factor(float(x[1]), float(y[1])) - 1) < 1e-9, "true scale on the standard parallel")
k_pole = bake.scale_factor(0.0, 0.0)
check(abs(k_pole - (1 + math.sin(bake.LAT_C)) / 2) < 1e-3, f"k at the pole about (1 + sin 71)/2 ({k_pole:.5f})")
k_near = bake.scale_factor(1.0, 0.0)
check(abs(k_near - k_pole) < 1e-9, "the pole's k is the limit of its neighbours'")

data = json.loads((OUTPUT_DIR / "permafrost.json").read_text())
areas = data["areaKm2"]
check(data["records"] == 79239, f"79,239 polygons ({data['records']})")
check(data["zones"] == ["continuous", "discontinuous", "sporadic", "isolated"], "four zones, coldest first")
for zone, paper in (("continuous", 10.7e6), ("discontinuous", 3.1e6), ("sporadic", 3.5e6)):
    check(abs(areas[zone] / paper - 1) < 0.10, f"{zone}: {areas[zone] / 1e6:.2f} million km2, the paper {paper / 1e6} (10%)")
check(areas["isolated"] > 3.5e6, f"isolated patches: more than the paper's 3.5 million km2 ({areas['isolated'] / 1e6:.2f})")
check(areas["continuous"] > sum(areas.values()) / 2 - 1e6, "continuous permafrost is about half the region")

rgb = np.asarray(Image.open(OUTPUT_DIR / "permafrost.png").convert("RGB"))
check(rgb.shape == (1024, 2048, 3), f"2048x1024 ({rgb.shape})")
picture = bake.picture_area_km2(rgb)
polygons = sum(areas.values())
check(abs(picture / polygons - 1) < 0.03, f"the picture covers what the polygons do, within 3% ({picture / 1e6:.2f} v {polygons / 1e6:.2f} million km2)")
check(not rgb[int((90 - 15) / 180 * bake.HEIGHT):, :, 2].any(), "nothing south of 15 N")


def at(lon: float, lat: float) -> tuple[int, int]:
    """(zone 1-4 or 0, coverage 0-255) of the pixel holding a place."""
    pixel = rgb[int((90 - lat) / 180 * bake.HEIGHT), int((lon + 180) / 360 * bake.WIDTH)]
    return (round(pixel[0] / bake.R_STEP) if pixel[2] else 0), int(pixel[2])


check(at(-148.4, 70.25) == (1, 255), f"Prudhoe Bay, North Slope of Alaska: continuous ({at(-148.4, 70.25)})")
check(at(-153.4, 57.5)[1] == 0, f"Kodiak Island: none ({at(-153.4, 57.5)})")
check(at(-3.3, 37.05)[1] == 0, f"Sierra Nevada, Spain: none ({at(-3.3, 37.05)})")
check(at(-40.0, 72.5)[1] == 0, f"the middle of Greenland's ice sheet: not mapped ({at(-40.0, 72.5)})")

app = (REPO_ROOT / "app/src/layers/permafrost/zones.ts").read_text()
check(f"R_STEP = {bake.R_STEP}" in app, "the app reads R in the bake's steps")

finish()
