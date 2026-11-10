#!/usr/bin/env python3
"""
Checks for the geophysical field images: app/public/geo/fields/ and
fields.json against their sources and against what is known of the Earth.

Reference values, with where they come from:

  geoid       EGM96's extremes are textbook numbers: about -107 m south of
              India and Sri Lanka and about +85 m at New Guinea (Lemoine
              et al. 1998). The grid read here gives -106.99 m at 78.75 E,
              4.75 N and +85.39 m at 147.25 E, 8.25 S.
  Moho        CRUST1.0 cells read on 2026-11-09: 7-13 km under the open
              Pacific, over 65 km under Tibet and over 60 km under the
              Altiplano; the continental shields sit at 35-45 km.
  sediments   CRUST1.0: thickest in the Gulf of Mexico, the South Caspian
              and the Bengal fan (over 10 km), near nothing on mid-ocean
              ridges.
  heat flow   The Global Heat Flow Database, release 2024: 91,058
              measurements with a position and a positive value; the
              world median is 66 mW/m2. Iceland and the East Pacific
              Rise are hot, the Canadian shield cold.
  magnetic    EMAG2v3. The Kursk anomaly (37 E, 51.5 N) is the largest
              positive anomaly on land; the stripes of the Juan de Fuca
              plate, where Vine, Matthews and Morley's hypothesis was
              confirmed, run north-north-east, so the field there changes
              faster going east than going north.

Usage:
    python3 tools/pipeline/generate_earth_fields.py
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_earth_fields.py     # needs numpy and pillow
"""

import json
import math
import re

import numpy as np
from PIL import Image

import generate_earth_fields as bake
from generate_geo import OUTPUT_DIR, REPO_ROOT
from geo_test_support import check, finish

meta = {field["id"]: field for field in json.loads((OUTPUT_DIR / "fields.json").read_text())["fields"]}
check(sorted(meta) == ["geoid", "heat-flow", "magnetic-anomaly", "moho-depth", "sediment-thickness"], f"five fields ({sorted(meta)})")

images = {}
for name, field in meta.items():
    path = bake.FIELDS_DIR / field["file"]
    image = np.array(Image.open(path))
    images[name] = image
    check(image.shape[:2] == (field["height"], field["width"]) and image.shape[1] == 2 * image.shape[0],
          f"{field['file']}: {field['width']} x {field['height']}, 2:1")
    check(path.stat().st_size < 520_000, f"{field['file']}: under 520 kB ({path.stat().st_size} bytes)")
total = sum((bake.FIELDS_DIR / f["file"]).stat().st_size for f in meta.values())
check(total < 800_000, f"all five under 800 kB together ({total} bytes)")


def code(name: str, lon: float, lat: float) -> float:
    """The red (or grey) code at a place, 0..255."""
    image = images[name]
    height, width = image.shape[:2]
    row = min(int((90.0 - lat) / 180.0 * height), height - 1)
    column = int((lon + 180.0) / 360.0 * width) % width
    return float(image[row, column, 0] if image.ndim == 3 else image[row, column])


def covered(name: str, lon: float, lat: float) -> bool:
    image = images[name]
    height, width = image.shape[:2]
    return bool(image[min(int((90.0 - lat) / 180.0 * height), height - 1), int((lon + 180.0) / 360.0 * width) % width, 1] > 127)


# --- geoid ---------------------------------------------------------------
geoid = bake.load_egm96()
check(abs(bake.geoid_at(geoid, 78.75, 4.75) + 106.99) < 0.01, "EGM96 is -106.99 m at 78.75 E, 4.75 N, its lowest")
check(abs(bake.geoid_at(geoid, 147.25, -8.25) - 85.39) < 0.01, "EGM96 is +85.39 m at 147.25 E, 8.25 S, its highest")
check(meta["geoid"]["minAt"] == [78.75, 4.75] and meta["geoid"]["maxAt"] == [147.25, -8.25], "fields.json records where the extremes are")
geoid_m = lambda lon, lat: (code("geoid", lon, lat) - 128) / 127 * bake.GEOID_RANGE_M  # noqa: E731
for lon, lat, what in [(78.75, 4.75, "the low south of India"), (147.25, -8.25, "the high at New Guinea"),
                       (-20.0, 62.0, "the North Atlantic high by Iceland"), (-85.0, 58.0, "the Hudson Bay low"),
                       (-97.74, 30.27, "Austin"), (0.0, 0.0, "the Gulf of Guinea"), (179.9, -40.0, "the antimeridian")]:
    expected = bake.geoid_at(geoid, round(lon * 4) / 4, round(lat * 4) / 4)
    got = geoid_m(lon, lat)
    check(abs(got - expected) < 2.0, f"geoid at {what}: image {got:+.1f} m, EGM96 {expected:+.1f} m")
check(geoid_m(78.75, 4.75) < -100 and geoid_m(-78.75, 4.75) > -40, "the geoid low is in the Indian Ocean, not mirrored into the Pacific")
check(geoid_m(-20, 62) > 50 > geoid_m(-20, -62), "the Iceland high is in the north")

# --- crust ---------------------------------------------------------------
bounds = bake.load_crust1()
moho_km = lambda lon, lat: code("moho-depth", lon, lat) / 255 * bake.MOHO_MAX_KM  # noqa: E731
sediment_km = lambda lon, lat: (code("sediment-thickness", lon, lat) / 255) ** 2 * bake.SEDIMENT_MAX_KM  # noqa: E731


def crust_cell(lon: float, lat: float) -> np.ndarray:
    return bounds[min(int(90 - lat), 179), int(lon + 180) % 360]


for lon, lat, low, high, what in [(88.5, 32.5, 65, 80, "Tibet"), (-67.5, -20.5, 60, 80, "the Altiplano"),
                                  (-150.5, 0.5, 7, 13, "the central Pacific"), (-30.5, -20.5, 7, 14, "the South Atlantic"),
                                  (-95.5, 60.5, 33, 46, "the Canadian shield"), (25.5, 62.5, 40, 60, "the Baltic shield"),
                                  (134.5, -25.5, 30, 55, "central Australia")]:
    source = -crust_cell(lon, lat)[8]
    got = moho_km(lon, lat)
    check(low <= source <= high, f"CRUST1.0 Moho under {what} is {low}-{high} km deep ({source:.1f})")
    check(abs(got - source) < 0.4, f"Moho under {what}: image {got:.1f} km, CRUST1.0 {source:.1f} km")
check(moho_km(88.5, 32.5) > moho_km(-88.5, 32.5) + 20, "Tibet's root is in Asia, not mirrored into North America")
for lon, lat, low, high, what in [(-94.5, 26.5, 8, 21, "the Gulf of Mexico"), (51.5, 39.5, 12, 21, "the South Caspian"),
                                  (89.5, 20.5, 10, 21, "the Bengal fan"), (-110.5, -15.5, 0, 0.5, "the East Pacific Rise"),
                                  (-95.5, 60.5, 0, 1.0, "the Canadian shield")]:
    cell = crust_cell(lon, lat)
    source = cell[2] - cell[5]
    got = sediment_km(lon, lat)
    check(low <= source <= high, f"CRUST1.0 sediment at {what} is {low}-{high} km ({source:.2f})")
    check(abs(got - source) < 0.35, f"sediment at {what}: image {got:.2f} km, CRUST1.0 {source:.2f} km")

# --- heat flow -----------------------------------------------------------
lon, lat, q = bake.load_heat_flow()
check(len(q) == meta["heat-flow"]["measurements"] == 91058, f"91,058 measurements read ({len(q)})")
check(abs(float(np.median(q)) - 66.0) < 0.5, f"the world median is 66 mW/m2 ({np.median(q):.1f})")
heat = lambda lo, la: bake.HEAT_FLOW_MIN * (bake.HEAT_FLOW_MAX / bake.HEAT_FLOW_MIN) ** (code("heat-flow", lo, la) / 255)  # noqa: E731


def cell_median(lo: float, la: float) -> float:
    inside = (np.floor(lon) == math.floor(lo)) & (np.floor(lat) == math.floor(la))
    return float(np.median(q[inside])) if inside.any() else math.nan


cells = int((images["heat-flow"][..., 1] > 127).sum())
check(cells == meta["heat-flow"]["cells"], f"one covered pixel per cell with data ({cells})")
for lo, la, low, high, what in [(-21.5, 64.5, 100, 1000, "Iceland"), (-80.5, 48.5, 20, 60, "the Canadian shield"),
                                (11.5, 43.5, 80, 1000, "Tuscany (Larderello)"), (-128.5, 47.5, 150, 1000, "the Juan de Fuca Ridge"),
                                (-110.5, 44.5, 300, 1000, "Yellowstone"), (27.5, -26.5, 25, 70, "the Kaapvaal craton (Witwatersrand)")]:
    source = cell_median(lo, la)
    check(covered("heat-flow", lo, la) and low <= source <= high, f"heat flow at {what} is {low}-{high} mW/m2 (median {source:.0f})")
    if covered("heat-flow", lo, la):
        check(abs(math.log(heat(lo, la) / source)) < 0.02, f"heat flow at {what}: image {heat(lo, la):.0f}, database {source:.0f} mW/m2")
check(not covered("heat-flow", -150.5, -70.5) and not covered("heat-flow", 100.5, -55.5),
      "unmeasured cells of the Southern Ocean are left empty")

# --- magnetic anomaly ----------------------------------------------------
grid = bake.load_emag2()
valid = np.isfinite(grid) & (grid != 0) & (np.abs(grid) < 1e5)


def emag(lon0: float, lon1: float, lat0: float, lat1: float) -> np.ndarray:
    rows = slice(int((90 - lat1) * 30), int((90 - lat0) * 30))
    columns = slice(int((lon0 + 180) * 30), int((lon1 + 180) * 30))
    return np.where(valid[rows, columns], grid[rows, columns], np.nan)


magnetic_nt = lambda lo, la: (lambda s: math.copysign(s * s, s) * bake.MAGNETIC_RANGE_NT)((code("magnetic-anomaly", lo, la) - 128) / 127)  # noqa: E731
kursk = float(np.nanmax(emag(36.0, 38.5, 50.5, 52.5)))
check(kursk > 1500, f"the Kursk anomaly exceeds +1500 nT in EMAG2 ({kursk:.0f})")
kursk_image = max(magnetic_nt(lo, la) for lo in np.arange(36.0, 38.5, 0.1) for la in np.arange(50.5, 52.5, 0.1))
check(kursk_image > 350, f"and saturates the image's scale there ({kursk_image:.0f} nT)")
# Stripes on the Juan de Fuca plate trend NNE: more change per km eastward than northward.
box = emag(-131.0, -127.0, 44.0, 48.0)
km_per_node_east = 111.2 * math.cos(math.radians(46)) / 30
east = np.nanmean(np.abs(np.diff(box, axis=1))) / km_per_node_east
north = np.nanmean(np.abs(np.diff(box, axis=0))) / (111.2 / 30)
check(east > 1.5 * north, f"Juan de Fuca stripes: {east:.1f} nT/km eastward against {north:.1f} northward in EMAG2")
image = images["magnetic-anomaly"].astype(float)
rows = slice(int((90 - 48) / 180 * image.shape[0]), int((90 - 44) / 180 * image.shape[0]))
columns = slice(int((-131 + 180) / 360 * image.shape[1]), int((-127 + 180) / 360 * image.shape[1]))
patch = image[rows, columns]
east_image = np.abs(np.diff(patch, axis=1)).mean() / math.cos(math.radians(46))
north_image = np.abs(np.diff(patch, axis=0)).mean()
check(east_image > 1.3 * north_image, f"and in the image ({east_image:.1f} against {north_image:.1f} codes per pixel-km)")
# Image against grid: the mean anomaly and the mean size of it over 2-degree boxes. Pixel by pixel
# the two differ - the image is a 5-node average, coded to 8 bits and JPEG-compressed.
signed = (image - 128) / 127
decoded = np.sign(signed) * signed * signed * bake.MAGNETIC_RANGE_NT
for lo, la, what in [(-40.0, 30.0, "the central Atlantic"), (135.0, -25.0, "central Australia"),
                     (-100.0, 40.0, "the Great Plains"), (-150.0, 20.0, "the Pacific north of Hawaii")]:
    source = emag(lo - 1, lo + 1, la - 1, la + 1)
    box_rows = slice(int((90 - la - 1) / 180 * image.shape[0]), int((90 - la + 1) / 180 * image.shape[0]))
    box_columns = slice(int((lo + 179) / 360 * image.shape[1]), int((lo + 181) / 360 * image.shape[1]))
    got = decoded[box_rows, box_columns]
    check(abs(got.mean() - np.nanmean(source)) < 12,
          f"mean anomaly over {what}: image {got.mean():+.0f} nT, EMAG2 {np.nanmean(source):+.0f} nT")
    ratio = np.abs(got).mean() / np.nanmean(np.abs(source))
    check(0.8 < ratio < 1.1, f"mean size of the anomaly over {what}: image {np.abs(got).mean():.0f} nT, EMAG2 {np.nanmean(np.abs(source)):.0f} nT")
share = float((image == 128).mean())
check(share < 0.12, f"little of the map is exactly blank ({100 * share:.1f} %)")

# --- the app's copy of the scales -----------------------------------------
app = (REPO_ROOT / "app/src/layers/earth-fields/fields.ts").read_text()
for constant, value in [("MAGNETIC_RANGE_NT", bake.MAGNETIC_RANGE_NT), ("GEOID_RANGE_M", bake.GEOID_RANGE_M),
                        ("MOHO_MAX_KM", bake.MOHO_MAX_KM), ("SEDIMENT_MAX_KM", bake.SEDIMENT_MAX_KM),
                        ("HEAT_FLOW_MIN", bake.HEAT_FLOW_MIN), ("HEAT_FLOW_MAX", bake.HEAT_FLOW_MAX)]:
    found = re.search(rf"export const {constant} = ([\d.]+);", app)
    check(found is not None and float(found.group(1)) == value, f"fields.ts has {constant} = {value:g}")
for field in meta.values():
    check(f"file: '{field['file']}'" in app, f"fields.ts draws {field['file']}")
check("91,058 borehole and seabed measurements in 10,214 cells" in app, "the heat-flow caption's counts are the bake's")
check("lon: 78.75, lat: 4.75" in app and "lon: 147.25, lat: -8.25" in app, "the geoid's labels sit on EGM96's extremes")

finish()
