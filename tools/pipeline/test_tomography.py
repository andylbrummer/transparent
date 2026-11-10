#!/usr/bin/env python3
"""
Checks for the tomography shells: app/public/geo/tomography/dvs-*.png and
tomography.json against the model they were baked from.

SH_SYN holds values of the SEMUCB-WM1 degree-31 expansion computed with
hc's own synthesis program (sh_syn, hc commit 7bb6d03, short format, at
the points listed) on 2026-11-09: the numpy synthesis of
generate_tomography.py must reproduce them, which pins the normalisation
and the sign conventions; the images must then hold the same numbers to
their 8 bits.

The geography checks are the features every global S-wave model agrees
on (e.g. Garnero, McNamara & Shim 2016, Nature Geoscience 9, 481): the two
large low-shear-velocity provinces at the base of the mantle under Africa
and the Pacific, fast cratonic keels and slow ridges and hotspots at
150 km.

Usage:
    python3 tools/pipeline/generate_tomography.py
    python3 tools/pipeline/test_tomography.py     # needs numpy and pillow
"""

import json
import re

import numpy as np
from PIL import Image

from generate_geo import OUTPUT_DIR, REPO_ROOT
from generate_tomography import SHELLS, load_model, synthesize
from geo_test_support import check, finish

# (depth km, lon, lat, dVs % from sh_syn)
SH_SYN = [
    (150, 20, -20, 4.9529),
    (150, -165, -10, -1.5844),
    (150, 120, 40, -0.0577),
    (150, -90, 40, 6.4875),
    (150, -155.5, 19.5, -1.9113),
    (150, -18, 65, -6.1351),
    (150, 41, 12, -3.5242),
    (150, -95, 60, 8.1612),
    (150, 120, -25, 9.4765),
    (150, 179.5, -89, 2.6317),
    (150, 0, 0, -0.1523),
    (150, -60, -20, -1.1792),
    (2850, 20, -20, -2.6729),
    (2850, -165, -10, -1.5386),
    (2850, 120, 40, 1.1085),
    (2850, -90, 40, -0.2539),
    (2850, -155.5, 19.5, -1.4361),
    (2850, -18, 65, -0.6866),
    (2850, 41, 12, 0.6866),
    (2850, -95, 60, 1.1467),
    (2850, 120, -25, 0.2860),
    (2850, 179.5, -89, 0.5971),
    (2850, 0, 0, -0.7161),
    (2850, -60, -20, -0.4035),
]

layers = load_model()
check(len(layers) == 41 and min(layers) == 75 and max(layers) == 2850, f"41 layers from 75 to 2850 km ({len(layers)})")

worst = 0.0
for depth, lon, lat, expected in SH_SYN:
    lmax, coefficients = layers[float(depth)]
    worst = max(worst, abs(float(synthesize(lmax, coefficients, np.array([lon]), np.array([lat]))[0]) - expected))
check(worst < 2e-4, f"the numpy synthesis reproduces hc's sh_syn at {len(SH_SYN)} points (worst {worst:.1e} %)")

meta = json.loads((OUTPUT_DIR / "tomography.json").read_text())
check([s["depthKm"] for s in meta["shells"]] == [d for d, _ in SHELLS], "one shell per depth, shallowest first")

images = {}
for shell in meta["shells"]:
    path = OUTPUT_DIR / "tomography" / shell["file"]
    image = np.array(Image.open(path))
    images[shell["depthKm"]] = (image, shell["rangePercent"])
    check(image.shape == (meta["height"], meta["width"]) and image.dtype == np.uint8,
          f"{shell['file']}: {meta['width']} x {meta['height']} grey ({image.shape})")
    check(path.stat().st_size < 100_000, f"{shell['file']}: under 100 kB ({path.stat().st_size} bytes)")
    check(int(image.min()) >= 1, f"{shell['file']}: code 0 is unused")
    # Nearly all of the shell is inside its scale.
    clipped = float(((image == 1) | (image == 255)).sum()) / image.size
    check(clipped < 0.04, f"{shell['file']}: {100 * clipped:.2f} % of pixels at the ends of the scale")
    # The anomaly is relative to the radial average: its mean over the sphere is the degree-0 term, near zero.
    area = np.cos(np.radians(90 - (np.arange(image.shape[0]) + 0.5) * 180 / image.shape[0]))[:, None]
    mean = float((((image.astype(float) - 128) / 127 * shell["rangePercent"]) * area).sum() / (area.sum() * image.shape[1]))
    check(abs(mean) < 0.15, f"{shell['file']}: mean over the sphere {mean:+.3f} %")


def pixel_percent(depth: int, lon: float, lat: float) -> float:
    image, range_percent = images[depth]
    height, width = image.shape
    row = min(int((90.0 - lat) / 180.0 * height), height - 1)
    column = int((lon + 180.0) / 360.0 * width) % width
    return (float(image[row, column]) - 128) / 127 * range_percent


for depth, lon, lat, expected in SH_SYN:
    if depth not in images or abs(lat) > 85:
        continue
    got = pixel_percent(depth, lon, lat)
    _, range_percent = images[depth]
    inside = max(-range_percent, min(range_percent, expected))
    # Half a pixel of offset on a degree-31 field, plus the 8-bit step.
    check(abs(got - inside) < 0.06 * range_percent + 0.05, f"{depth} km at {lon}, {lat}: image {got:+.2f} %, model {expected:+.2f} %")

# (depth, lon, lat, sign, at least this many %, what)
FEATURES = [
    (2850, 20, -20, -1, 2.0, "the African LLSVP under southern Africa"),
    (2850, -165, -10, -1, 1.0, "the Pacific LLSVP under the central Pacific"),
    (2850, 120, 40, +1, 0.8, "the fast ring of old slabs under East Asia"),
    (2850, -95, 60, +1, 0.8, "the fast ring under northern North America"),
    (150, -95, 60, +1, 5.0, "the Canadian shield's keel"),
    (150, 105, 65, +1, 5.0, "the Siberian craton's keel"),
    (150, 120, -25, +1, 5.0, "the West Australian craton's keel"),
    (150, -5, 20, +1, 5.0, "the West African craton's keel"),
    (150, -18, 65, -1, 4.0, "Iceland"),
    (150, 41, 12, -1, 2.5, "Afar"),
    (150, -105, -10, -1, 2.5, "the East Pacific Rise"),
    (150, -155.5, 19.5, -1, 1.0, "Hawaii"),
]
for depth, lon, lat, sign, least, what in FEATURES:
    got = pixel_percent(depth, lon, lat)
    check(sign * got >= least, f"{depth} km: {'fast' if sign > 0 else 'slow'} at {what} ({got:+.2f} %)")

# Orientation: the African LLSVP is slow where Africa is, not at its mirror image in longitude or latitude.
check(pixel_percent(2850, -20, -20) > pixel_percent(2850, 20, -20) + 1.0, "2850 km: not mirrored east-west about Greenwich")
check(pixel_percent(150, -95, 60) > pixel_percent(150, -95, -60) + 3.0, "150 km: not flipped north-south")

# The app's own table of slices (it builds the panel from it before any data loads) must be this one.
app_shells = [(int(d), float(r)) for d, r in re.findall(
    r"depthKm: (\d+), rangePercent: ([\d.]+)", (REPO_ROOT / "app/src/layers/tomography/shells.ts").read_text())]
check(app_shells == [(d, float(r)) for d, r in SHELLS], f"app/src/layers/tomography/shells.ts lists the same depths and scales ({app_shells})")

finish()
