#!/usr/bin/env python3
"""
Checks for the petroleum provinces (app/public/geo/petroleum-provinces.png
and .json) against the USGS shapefile they come from.

Reference values, with where they come from:

  counts   The shapefile WEP_PRVG (USGS World Petroleum Assessment 2000),
           read on 2026-11-11: 1,023 records, 939 province codes; the
           commodity column O_G is "Oil" for 96 records, "Gas" for 37, "NA"
           for 9 and blank for the rest (not assessed).
  volumes  The same table's KWN_PET, known petroleum (cumulative production
           plus remaining reserves, million barrels of oil equivalent): the
           West Siberian Basin first, 354,730, then the Mesopotamian
           Foredeep, 343,993.
  fields   The oil and gas fields (OGIM, a separate dataset) labelled in
           the Gulf, in Siberia and in the North Sea lie in provinces the
           USGS assessed.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_petroleum_provinces.py
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_petroleum_provinces.py
"""

import json

import numpy as np
from PIL import Image

import generate_oil_gas_fields as fields_bake
import generate_petroleum_provinces as bake
import province_raster as raster
from geo_test_support import check, finish

meta = json.loads(bake.OUT_JSON.read_text())
picture = np.array(Image.open(bake.OUT_PNG))
provinces = bake.load()


def pixel(lon: float, lat: float) -> np.ndarray:
    row = min(int((90 - lat) / 180 * HEIGHT), HEIGHT - 1)
    return picture[row, int((lon + 180) / 360 * WIDTH) % WIDTH]


HEIGHT, WIDTH = bake.HEIGHT, bake.WIDTH
check(picture.shape == (HEIGHT, WIDTH, 3), f"the picture is {WIDTH} x {HEIGHT} RGB")
size = bake.OUT_PNG.stat().st_size
check(size < 450_000, f"{bake.OUT_PNG.name} under 450 kB ({size} bytes)")
check(set(np.unique(picture[..., 0]).tolist()) == {0, 1, 2, 3, 4}, "red holds the four classes and nothing")
check(meta["records"] == 1023 and len(provinces) == 1023, f"1,023 records ({meta['records']})")
check(meta["provinces"] == 939, f"939 provinces by code ({meta['provinces']})")
check(meta["counts"] == {"not assessed": 881, "Oil": 96, "Gas": 37, "NA": 9}, f"commodities as in the table ({meta['counts']})")

# Every record's class shows somewhere: a check that shapes and table rows were paired in order.
missing = 0
for row, rings in provinces:
    if not rings:
        continue
    lon, lat, _ = raster.area_centroid([rings])
    outers = [[ring] for ring in rings if len(ring) >= 3 and raster.signed_area(ring) < 0]
    if not outers:
        continue
    lon, lat = fields_bake.label_point(outers)
    if pixel(lon, lat)[2] == 0:
        missing += 1
check(missing == 0, f"a point inside each record's largest part is covered ({missing} of {len(provinces)} not)")

labels = meta["labels"]
check(labels[0]["name"] == "West Siberian Basin" and labels[0]["knownMmboe"] == 354730, "most petroleum found: the West Siberian Basin, 354,730 MMBOE")
check(labels[1]["name"] == "Mesopotamian Foredeep Basin" and labels[1]["knownMmboe"] == 343993, "then the Mesopotamian Foredeep, 343,993")
check(all(a["knownMmboe"] >= b["knownMmboe"] for a, b in zip(labels, labels[1:])), "labels in order of petroleum found")
for label in labels:
    value = pixel(label["lon"], label["lat"])
    expected = bake.CLASSES[label["commodity"].title()]
    check(value[2] > 0 and value[0] == expected, f"{label['name']} label on its province, coloured {label['commodity']} ({value[0]})")

field_labels = {f["name"]: f for f in json.loads(fields_bake.OUT_JSON.read_text())["labels"]}
for name in ("SHEDGUM", "HARADH", "BURGAN", "NORTH FIELD", "SAMOTLORSKOE", "TROLL"):
    f = field_labels[name]
    check(pixel(f["lon"], f["lat"])[0] in (2, 3, 4), f"the field {name.title()} lies in an assessed province")

finish()
