#!/usr/bin/env python3
"""
Checks for app/public/geo/ship-density.jpg.

The picture must show what every chart of the world's shipping shows:
the Singapore Strait, the Strait of Gibraltar, the Gulf of Suez and the
English Channel among the busiest water there is; the great-circle track
from East Asia to North America running up past the Aleutians, busier
than the empty middle of the South Pacific; and no ships in the Sahara or
on the Tibetan plateau. The code is checked for orientation that way
(north up, Greenwich in the middle), and its scale against the constants
the app decodes with.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_ship_density.py
    python3 tools/pipeline/test_ship_density.py
"""

import re

import numpy as np
from PIL import Image

from generate_geo import REPO_ROOT
from generate_ship_density import DECADES, DENSITY_FLOOR, HEIGHT, OUTPUT, WIDTH, decode, density_per_km2, encode
from geo_test_support import check, finish

sample = np.array([[0.0, DENSITY_FLOOR * 0.5, DENSITY_FLOOR, DENSITY_FLOOR * 10, DENSITY_FLOOR * 10**DECADES, 1e12]])
codes = encode(sample)
check(codes.tolist() == [[0, 0, 1, 52, 255, 255]], f"codes: 0 below the floor, 1 at it, 51 a decade, 255 at the top and beyond ({codes.tolist()})")
check(np.allclose(decode(codes)[0, 2:5], sample[0, 2:5], rtol=0.03), "decode undoes encode to within a code's width")
area = density_per_km2(np.ones((HEIGHT, WIDTH)))
check(abs(1 / area[HEIGHT // 2, 0] - (40030 / WIDTH) ** 2) / (40030 / WIDTH) ** 2 < 0.01, "a cell on the equator is 19.5 km square")
check(area[10, 0] > 20 * area[HEIGHT // 2, 0], "cells shrink toward the poles, so equal counts are denser there")

image = Image.open(OUTPUT)
check(image.size == (WIDTH, HEIGHT) and image.mode == "L", f"{WIDTH}x{HEIGHT}, one channel")
check(OUTPUT.stat().st_size < 500_000, f"under 500 kB ({OUTPUT.stat().st_size} bytes)")
pixels = np.asarray(image)


def peak(lon: float, lat: float, reach_deg: float = 0.5) -> int:
    """The highest code within `reach_deg` of a place."""
    x = int((lon + 180) / 360 * WIDTH)
    y = int((90 - lat) / 180 * HEIGHT)
    r = max(1, round(reach_deg / 360 * WIDTH))
    return int(pixels[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1].max())


for name, lon, lat in (("the Singapore Strait", 103.8, 1.2), ("the Strait of Gibraltar", -5.6, 35.95), ("the Gulf of Suez", 32.7, 29.4),
                       ("the Dover Strait", 1.5, 51.0), ("the approach to Panama", -79.5, 8.8), ("the Strait of Hormuz", 56.4, 26.5)):
    check(peak(lon, lat) >= 200, f"{name} is among the busiest water (code {peak(lon, lat)})")
for name, lon, lat in (("the Sahara", 10.0, 22.0), ("Tibet", 88.0, 33.0), ("central Australia", 133.0, -25.0), ("the Antarctic plateau", 90.0, -80.0)):
    check(peak(lon, lat) <= 12, f"no ships in {name} (code {peak(lon, lat)})")
aleutian = max(peak(180.0, lat, 0.3) for lat in np.arange(48, 55, 0.5))
empty = peak(-125.0, -48.0, 2.0)
check(aleutian >= 120 and aleutian > empty + 40, f"the great-circle track past the Aleutians (code {aleutian}) stands out from the empty South Pacific ({empty})")
check(peak(-30.0, 0.0, 1.0) > 60 > peak(-140.0, -60.0, 1.0), "the Atlantic is busier than the far Southern Ocean")
# The source ends at 85°: row 28. JPEG rings within its 8-pixel block, so the rows tested stop one block short of the edge.
check(pixels[:24].max() <= 12 and pixels[-24:].max() <= 12, "nothing poleward of 85.8°, beyond where the source has data")
check(abs(int(pixels[:, 0].astype(int).mean()) - int(pixels[:, -1].astype(int).mean())) <= 6, "the antimeridian joins without a seam")

app = (REPO_ROOT / "app/src/layers/human-world/styles.ts").read_text()
for constant, value in (("SHIP_DENSITY_FLOOR", DENSITY_FLOOR), ("SHIP_DENSITY_DECADES", DECADES)):
    found = re.search(rf"export const {constant} = ([\d.e+-]+);", app)
    check(found is not None and float(found.group(1)) == value, f"styles.ts has {constant} = {value:g}")

finish()
