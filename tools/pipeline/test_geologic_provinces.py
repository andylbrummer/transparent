#!/usr/bin/env python3
"""
Checks for the geologic provinces and Archean crust layers: app/public/geo/provinces.{png,json} and
cratons.{png,json} against the Hasterok et al. (2022) files they were drawn from and against what is
known independently.

Independent facts used
    * "We estimate 57.5% of the Earth's surface is covered by oceanic crust." (Hasterok et al. 2022,
      abstract). The oceanic-crust class drawn must cover that share; the provinces' own area column
      gives 58.7% for crust_type "oceanic", which counts the oceanic back-arc basins too.
    * The provinces tile the Earth: their area column sums to 510.2 million km2, the Earth's area
      (510.07 million km2). Gaps in the drawing must be slivers.
    * Places that sit on Archean cratons in every geology text: the Witwatersrand gold fields
      (Johannesburg) on the Kaapvaal Craton, Kalgoorlie on the Yilgarn Craton, Marble Bar on the
      Pilbara Craton, Yellowknife on the Slave Craton, the Abitibi greenstone belt (Timmins) on the
      Superior Craton. And places that are not: Hawaii and Iceland, young volcanic islands.

Usage:
    python3 tools/pipeline/generate_geologic_provinces.py
    python3 tools/pipeline/test_geologic_provinces.py
"""

import json

import numpy as np
from PIL import Image

from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish
from province_raster import HEIGHT, WIDTH, cell_areas


def load(stem: str) -> tuple[dict, np.ndarray]:
    return json.loads((OUTPUT_DIR / f"{stem}.json").read_text(encoding="utf-8")), np.asarray(Image.open(OUTPUT_DIR / f"{stem}.png").convert("RGB"))


def at(picture: np.ndarray, lon: float, lat: float) -> tuple[int, int, int]:
    x = min(WIDTH - 1, int((lon + 180) / 360 * WIDTH))
    y = min(HEIGHT - 1, int((90 - lat) / 180 * HEIGHT))
    return tuple(int(v) for v in picture[y, x])


provinces, picture = load("provinces")
check(picture.shape == (HEIGHT, WIDTH, 3), f"provinces picture is {WIDTH}x{HEIGHT} RGB")
size = (OUTPUT_DIR / "provinces.png").stat().st_size
check(size < 300_000, f"provinces.png is {size / 1024:.0f} KiB, within 300 kB")
check(provinces["provinces"] == 921, f"all 921 provinces drawn ({provinces['provinces']})")
check(sum(c["count"] for c in provinces["classes"]) == 921, "every province in a class")
check(len(provinces["classes"]) == 11 and sum(len(c["types"]) for c in provinces["classes"]) == 15, "the source's 15 province types in 11 classes")
check("10.5281/zenodo.6586972" in provinces["source"] and "CC BY 4.0" in provinces["source"], "the source names the Zenodo record and its licence")

total_km2 = sum(provinces["crustKm2"].values())
check(abs(total_km2 / 1e6 - 510.07) < 0.5, f"the provinces' areas sum to the Earth's ({total_km2 / 1e6:.1f} million km2)")
weights = cell_areas()
covered = float(weights[picture[..., 2] >= 128].sum())
check(covered > 0.995, f"the drawing covers the Earth but for slivers ({covered:.2%})")
by_name = {c["name"]: c for c in provinces["classes"]}
ocean = by_name["oceanic crust"]["share"]
check(abs(ocean - 0.575) < 0.01, f"oceanic crust covers {ocean:.1%} of the Earth; the paper: 57.5%")
drawn = sum(c["share"] for c in provinces["classes"])
check(abs(drawn - covered) < 0.002, f"the classes' shares add up to what is covered ({drawn:.3f}, {covered:.3f})")
check(int(picture[..., 1].max()) == 0, "no outlines in the provinces picture: the app finds them from the classes")

craton_id, shield_id = by_name["craton"]["id"], by_name["shield"]["id"]
oceanic_id = by_name["oceanic crust"]["id"]
check(at(picture, -30.0, 20.0)[0] == oceanic_id, "the middle of the North Atlantic is oceanic crust")
check(at(picture, -160.0, 0.0)[0] == oceanic_id, "the middle of the Pacific is oceanic crust")

cratons, archean = load("cratons")
size = (OUTPUT_DIR / "cratons.png").stat().st_size
check(size < 300_000, f"cratons.png is {size / 1024:.0f} KiB, within 300 kB")
check(cratons["polygons"] == 114, f"all 114 Archean polygons drawn ({cratons['polygons']})")
check(sum(c["count"] for c in cratons["classes"]) == 114, "every polygon in a class")
reworked = sum(c["count"] for c in cratons["classes"] if c["reworked"])
check(reworked == 59, f"59 reworked after the Archean, as the file's column says ({reworked})")
check(0.05 < cratons["share"] < 0.12, f"Archean crust under {cratons['share']:.1%} of the surface: a small part of the continents' 34%")

PLACES = [
    ("Johannesburg (Witwatersrand)", 28.05, -26.20, "Kalahari Craton", "Kaapvaal Craton"),
    ("Kalgoorlie", 121.47, -30.75, "West Australian Craton", "Eastern Yilgarn Craton"),
    ("Marble Bar", 119.75, -21.17, "West Australian Craton", "Pilbara Craton"),
    ("Yellowknife", -114.37, 62.45, "Slave Craton", None),
    ("Timmins (Abitibi)", -81.33, 48.47, "Superior Craton", "Wawa-Abitibi Terrane"),
]
labels = {label["name"]: label for label in cratons["labels"]}
for place, lon, lat, group, member in PLACES:
    r, _, b = at(archean, lon, lat)
    check(r > 0 and b >= 128, f"{place} is on Archean crust")
    check(group in labels and (member is None or member in labels[group]["members"]), f"{place}: {group} is named{f', with {member} in it' if member else ''}")
    check(at(picture, lon, lat)[0] in (craton_id, shield_id), f"{place} is a craton or shield among the provinces too")
for place, lon, lat in [("Hawaii", -155.5, 19.6), ("Iceland", -18.6, 64.9)]:
    check(at(archean, lon, lat)[2] < 128, f"{place} is not Archean")

superior = labels["Superior Craton"]
check(-95 < superior["lon"] < -70 and 45 < superior["lat"] < 58, f"the Superior Craton's name sits south and east of Hudson Bay ({superior['lon']}, {superior['lat']})")
check(all("�" not in label["name"] and all("�" not in m for m in label["members"]) for label in cratons["labels"]), "names decode cleanly")

finish()
