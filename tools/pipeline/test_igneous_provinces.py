#!/usr/bin/env python3
"""
Checks for the igneous provinces layer: app/public/geo/igneous-provinces.{png,json} against the
Johansson et al. (2018) file it was drawn from and against eruption ages measured independently.

Independent ages (U-Pb on zircon, the dates the extinction literature uses)
    * Siberian Traps: main intrusive phase from 251.9 Ma (Burgess & Bowring 2015, Science Advances 1,
      e1500470, doi:10.1126/sciadv.1500470).
    * Central Atlantic Magmatic Province: 201.6-201.0 Ma (Blackburn et al. 2013, Science 340, 941,
      doi:10.1126/science.1234204).
    * Deccan Traps: about 66.3-65.6 Ma (Schoene et al. 2019, Science 363, 862, doi:10.1126/science.aau2422).
    The file's ages are compilation ages, rounded; each must fall within 5 Myr.

Places on the provinces, from the same literature and geological maps: the Western Ghats at
Mahabaleshwar are Deccan lava; the island of Hawai'i is the young end of the Hawaiian chain. Paris
and central Australia's Alice Springs are on no volcanic province.

Usage:
    python3 tools/pipeline/generate_igneous_provinces.py
    python3 tools/pipeline/test_igneous_provinces.py
"""

import json

import numpy as np
from PIL import Image

from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish
from province_raster import HEIGHT, WIDTH

data = json.loads((OUTPUT_DIR / "igneous-provinces.json").read_text(encoding="utf-8"))
picture = np.asarray(Image.open(OUTPUT_DIR / "igneous-provinces.png").convert("RGB"))
size = (OUTPUT_DIR / "igneous-provinces.png").stat().st_size
check(picture.shape == (HEIGHT, WIDTH, 3), f"{WIDTH}x{HEIGHT} RGB")
check(size < 300_000, f"igneous-provinces.png is {size / 1024:.0f} KiB, within 300 kB")
check(data["polygons"] == 2526, f"all 2,526 polygons of v2 drawn ({data['polygons']})")
check("10.1029/2017GL076691" in data["source"] and "CC BY 3.0" in data["source"], "the source names the paper and the licence")
check(data["oldestMa"] == 300 and data["ageRangeMa"] == [0.0, 650.0], f"ages 0-650 Ma in the file, scaled to 300 ({data['ageRangeMa']})")
check(0.03 < data["share"] < 0.1, f"volcanic provinces cover {data['share']:.1%} of the surface")

labels = {label["name"]: label for label in data["labels"]}
check(len(labels) == 21, f"21 provinces named ({len(labels)})")
for name, measured in [("Siberian Traps", 251.9), ("Central Atlantic Magmatic Province", 201.3), ("Deccan Traps", 66.0)]:
    young, old = labels[name]["ageMa"]
    check(abs(old - measured) <= 5 and abs(young - measured) <= 5, f"{name}: the file's {young:g}-{old:g} Ma, measured {measured} Ma")


def at(lon: float, lat: float) -> tuple[int, int, int]:
    x = min(WIDTH - 1, int((lon + 180) / 360 * WIDTH))
    y = min(HEIGHT - 1, int((90 - lat) / 180 * HEIGHT))
    return tuple(int(v) for v in picture[y, x])


def age_at(lon: float, lat: float) -> float:
    return (at(lon, lat)[0] - 1) / 254 * data["oldestMa"]


# Norilsk was checked too and dropped, not bent: the file's Siberian Traps outlines stop about 17 km
# short of the town, the compilation's outline rather than the ground.
for place, lon, lat, name in [("Mahabaleshwar", 73.66, 17.92, "Deccan Traps")]:
    r, _, b = at(lon, lat)
    young, old = labels[name]["ageMa"]
    check(b >= 128 and abs(age_at(lon, lat) - old) < 2, f"{place} is on the {name}, drawn at {age_at(lon, lat):.0f} Ma")
r, _, b = at(-155.5, 19.6)
check(b >= 128 and age_at(-155.5, 19.6) < 3, f"the island of Hawai'i is on its chain, under 3 Ma ({age_at(-155.5, 19.6):.1f})")
for place, lon, lat in [("Paris", 2.35, 48.86), ("Alice Springs", 133.88, -23.70)]:
    check(at(lon, lat)[2] == 0, f"{place} is on no volcanic province")

order = [label["km2"] for label in data["labels"]]
check(order == sorted(order, reverse=True), "names listed largest first")
check(all(-180 <= label["lon"] <= 180 and -90 <= label["lat"] <= 90 for label in data["labels"]), "name positions on the globe")

finish()
