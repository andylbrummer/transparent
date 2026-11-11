#!/usr/bin/env python3
"""
Checks for the oil and gas fields (app/public/geo/oil-gas-fields.png and
.json) against the OGIM GeoPackage they come from, and against where some
famous fields are known to be.

Reference values, with where they come from:

  counts      OGIM v3.0's Oil_and_Natural_Gas_Fields table, read on
              2026-11-11: 17,742 records; source 36 (Italy, mining
              titles) 173 of them, source 232 (Mexico, areas with
              resources) 388.
  gaps        The same table has no field in China, Brazil, Venezuela,
              Argentina, Colombia or Malaysia; the layer's caption says
              so, and this holds it to the data.
  provenance  Every field in Saudi Arabia, Kuwait, Qatar and Iran comes
              from source 22 (a website, defunct since November 2021, per
              OGIM's own data catalogue); most of Russia's from source 181
              (a forum thread, "original creator unknown"). Checked here
              so the docs' flag stays true.
  places      Prudhoe Bay on Alaska's North Slope (70.3 N, 148.6 W); Troll
              in the Norwegian North Sea (60.8 N, 3.6 E); Samotlor by
              Nizhnevartovsk (61.2 N, 76.7 E); Groningen (53.2 N, 6.8 E);
              Burgan in Kuwait (29.0 N, 48.0 E); the North Field off Qatar
              (26.5 N, 51.8 E). Within a degree is enough to show the
              geometry is read the right way round.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_oil_gas_fields.py
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_oil_gas_fields.py
"""

import json
import sqlite3
import statistics

import numpy as np
from PIL import Image

import generate_oil_gas_fields as bake
import province_raster as raster
from fetch_cache import CACHE_DIR
from geo_test_support import check, finish

meta = json.loads(bake.OUT_JSON.read_text())
picture = np.array(Image.open(bake.OUT_PNG))

# --- the picture -------------------------------------------------------------
HEIGHT, WIDTH = bake.HEIGHT, bake.WIDTH
check(picture.shape == (HEIGHT, WIDTH, 3), f"the picture is {WIDTH} x {HEIGHT} RGB")
size = bake.OUT_PNG.stat().st_size
check(size < 400_000, f"{bake.OUT_PNG.name} under 400 kB ({size} bytes)")
classes = set(np.unique(picture[..., 0]).tolist())
check(classes <= {0, 1, 2, 3, 4}, f"red holds only the four fluids and nothing ({sorted(classes)})")
check(not picture[..., 1].any(), "no outlines: green is empty")

# --- the counts --------------------------------------------------------------
check(meta["records"] == 17742, f"all 17,742 records read ({meta['records']})")
check(meta["leftOut"]["36"]["records"] == 173 and meta["leftOut"]["232"]["records"] == 388,
      "Italy's 173 mining titles and Mexico's 388 'areas with resources' left out")
check(meta["drawn"] == 17742 - 173 - 388 - meta["noGeometry"] and meta["noGeometry"] == 0, f"the other {meta['drawn']} drawn, none without a shape")
check(sum(meta["fluids"].values()) == meta["drawn"], f"every drawn field has a fluid ({meta['fluids']})")

db = sqlite3.connect(f"file:{CACHE_DIR / 'oil-gas' / 'OGIM_v3.0.gpkg'}?mode=ro", uri=True)
rows = db.execute(f"SELECT COUNTRY, SRC_REF_ID, NAME, AREA_KM2, geom FROM {bake.TABLE}").fetchall()
for country in ("CHINA", "BRAZIL", "VENEZUELA", "ARGENTINA", "COLOMBIA", "MALAYSIA"):
    check(not any(country in (r[0] or "") for r in rows), f"no field in {country.title()}, as the caption says")
for country in ("SAUDI ARABIA", "KUWAIT", "QATAR", "IRAN"):
    sources = {r[1] for r in rows if country in (r[0] or "").split(", ")}
    check(sources == {"22"}, f"every field in {country.title()} is from the defunct website, source 22 ({sources})")
us_states = {state for (state,) in db.execute(f"SELECT DISTINCT STATE_PROV FROM {bake.TABLE} WHERE COUNTRY LIKE '%UNITED STATES%'")}
for state in ("OKLAHOMA", "KANSAS", "LOUISIANA"):
    check(not any(state in (s or "").upper() for s in us_states), f"no field in {state.title()}, as the caption says")
texas = {source for (source,) in db.execute(f"SELECT SRC_REF_ID FROM {bake.TABLE} WHERE STATE_PROV LIKE '%TEXAS%'")}
check(texas <= {"232", "233"}, f"Texas only in Mexican fields that cross the border ({texas})")
gulf = 0
for (geom,) in db.execute(f"SELECT geom FROM {bake.TABLE} WHERE SRC_REF_ID = '143,144,145' AND ON_OFFSHORE LIKE '%OFFSHORE%'"):
    lon, lat = bake.label_point([bake.oriented(p) for p in bake.wkb_polygons(geom)])
    gulf += -98 < lon < -80 and 23 < lat < 31
check(gulf == 0, f"no US (EIA) field offshore in the Gulf of Mexico ({gulf})")
check(any("ALASKA" in (s or "").upper() for s in us_states) and any("CALIFORNIA" in (s or "").upper() for s in us_states),
      "but Alaska and some of California are there")
russia = [r[1] for r in rows if r[0] == "RUSSIAN FEDERATION"]
check(russia.count("181") / len(russia) > 0.95, f"Russia's fields are from the forum thread, source 181 ({russia.count('181')} of {len(russia)})")

# --- the geometry ------------------------------------------------------------
# The table's own areas, where it gives them, against the areas worked out from the outlines.
ratios = []
for _, source, _, table_km2, geom in rows:
    if table_km2 and table_km2 > 5 and source not in bake.LEFT_OUT:
        polygons = [bake.oriented(p) for p in bake.wkb_polygons(geom)]
        ratios.append(bake.area_km2(polygons) / table_km2)
median = statistics.median(ratios)
check(0.97 < median < 1.03, f"areas from the outlines match the table's: median ratio {median:.3f} over {len(ratios)} fields")
check(meta["areaKm2"] > 500_000, f"{meta['areaKm2']:,} km2 of fields in all")
# Fields of a few km are drawn as at least part of a 10 km pixel: the picture holds more than their area, but not wildly.
drawn_km2 = meta["sphereShare"] * 510_065_600
check(1.0 < drawn_km2 / meta["areaKm2"] < 2.0, f"the picture covers {drawn_km2:,.0f} km2: small fields grown to a pixel")


def field_centre(name: str) -> tuple[float, float]:
    matches = [r for r in rows if r[2] and " ".join(r[2].split()) == name]
    polygons = max(([bake.oriented(p) for p in bake.wkb_polygons(r[4])] for r in matches), key=bake.area_km2)
    return bake.label_point(polygons)


for name, lon, lat in [("PRUDHOE BAY", -148.6, 70.3), ("TROLL", 3.6, 60.8), ("SAMOTLORSKOE", 76.7, 61.2),
                       ("GRONINGEN", 6.8, 53.2), ("BURGAN", 48.0, 29.0), ("NORTH FIELD", 51.8, 26.5)]:
    got = field_centre(name)
    check(abs(got[0] - lon) < 1 and abs(got[1] - lat) < 1, f"{name.title()} is where it should be ({got[0]:.2f}, {got[1]:.2f})")

# --- the labels --------------------------------------------------------------
for label in meta["labels"]:
    row = min(int((90 - label["lat"]) / 180 * HEIGHT), HEIGHT - 1)
    column = int((label["lon"] + 180) / 360 * WIDTH) % WIDTH
    check(picture[row, column, 2] > 0, f"the label {label['name']} sits on a field")
names = {label["name"] for label in meta["labels"]}
check(set(bake.NAMED) <= names, "the well-known fields named in the bake are labelled")
check(len(meta["labels"]) <= 30, f"few labels ({len(meta['labels'])})")

finish()
