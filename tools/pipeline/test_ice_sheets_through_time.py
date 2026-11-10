#!/usr/bin/env python3
"""
Data checks for generate_ice_sheets_through_time.py.

The projection is held to the ellipsoid itself: the area inside each
projected circle must equal the polar cap's area integrated on WGS 84.
The LGM slice, drawn through the projection, must agree with the LGM
layer drawn straight from longitude and latitude. Then places, by slice:
ice where the glacial record puts it, none where no Quaternary ice sheet
ever reached.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_ice_sheets_through_time.py
"""

import json
import math

import numpy as np
from PIL import Image

from generate_ice_sheets_through_time import A_M, E2, HEIGHT, META, REPO_ROOT, SLICES, WIDTH, polar_forward
from geo_test_support import check, finish

ALL = [entry[0] for entry in SLICES]
GLACIAL = ["lgm", "mis4", "mis6", "mis8", "mis10", "mis12", "mis16", "mis20-24"]

# (place, lon, lat): where ice is expected, in which slices.
ICE = [
    # Greenland's interior has held ice through the whole of the Quaternary.
    ("central Greenland", -40.0, 72.5, ALL),
    # Hudson Bay lies at the heart of the Laurentide Ice Sheet in every full glacial.
    ("Hudson Bay", -85.0, 60.0, GLACIAL),
    # Not tested: Utrecht under the MIS 6 (Saalian) ice, which built the push moraine there. The best estimate
    # puts that margin 22 km north of the city - inside what the README warns of ("general extent ... not for
    # local-scale studies"), so a place that near a margin is no test of the bake.
    # The Anglian glaciation (MIS 12) covered East Anglia.
    ("Cambridge", 0.12, 52.2, ["mis12"]),
]
# Never under a Quaternary ice sheet.
NEVER = [("Paris", 2.35, 48.86), ("Beijing", 116.4, 39.9), ("Washington, D.C.", -77.04, 38.9), ("Tokyo", 139.7, 35.7)]
# And at the LGM, as the LGM layer's own checks have it.
NOT_AT_LGM = [("Cambridge", 0.12, 52.2)]


def cap_area_m2(lat_deg: float, steps: int = 20000) -> float:
    """Area of the WGS 84 ellipsoid north of a latitude, integrated: 2 pi N cos(phi) M dphi."""
    phi = np.linspace(math.radians(lat_deg), math.pi / 2, steps + 1)
    mid = (phi[:-1] + phi[1:]) / 2
    s2 = np.sin(mid) ** 2
    n = A_M / np.sqrt(1 - E2 * s2)
    m = A_M * (1 - E2) / (1 - E2 * s2) ** 1.5
    return float(np.sum(2 * math.pi * n * np.cos(mid) * m * np.diff(phi)))


def coverage_at(image: np.ndarray, lon: float, lat: float) -> int:
    col = min(WIDTH - 1, int((lon + 180) / 360 * WIDTH))
    row = min(HEIGHT - 1, int((90 - lat) / 180 * HEIGHT))
    return int(image[row, col])


def main() -> None:
    for lat in (80.0, 60.0, 40.0):
        x, y = polar_forward(np.array([0.0, 90.0]), np.array([lat, lat]))
        rho = math.hypot(float(x[0]), float(y[0]))
        projected = math.pi * rho**2
        actual = cap_area_m2(lat)
        check(abs(projected / actual - 1) < 1e-6, f"equal area: cap north of {lat}° {projected / 1e12:.4f} vs {actual / 1e12:.4f} million km²")
        check(abs(math.hypot(float(x[1]), float(y[1])) - rho) < 1e-6, f"circles round the pole at {lat}°")
    # Longitude 90°E lies along +x, 0° along -y: the pole seen from above, Greenwich down.
    x, y = polar_forward(np.array([90.0, 0.0]), np.array([60.0, 60.0]))
    check(x[0] > 0 and abs(y[0]) < 1e-6 and y[1] < 0 and abs(x[1]) < 1e-6, "90°E to the right, Greenwich below the pole")

    meta = json.loads(META.read_text())
    slices = {entry["id"]: entry for entry in meta["slices"]}
    check(list(slices) == ALL, "18 slices, youngest first")
    ages = [(entry["youngKa"], entry["oldKa"]) for entry in meta["slices"]]
    check(all(young <= old for young, old in ages), "each age range runs young to old")
    check(all(a[0] < b[0] for a, b in zip(ages, ages[1:])), "slices in order of age")

    lgm_layer = json.loads((REPO_ROOT / "app" / "public" / "geo" / "ice-age.json").read_text())["iceAreaKm2"]
    check(abs(slices["lgm"]["areaKm2"] / lgm_layer - 1) < 0.02, f"LGM through the projection {slices['lgm']['areaKm2'] / 1e6:.1f} vs the LGM layer {lgm_layer / 1e6:.1f} million km²")
    check(slices["mis6"]["areaKm2"] > slices["lgm"]["areaKm2"], "MIS 6 ice larger than the LGM's, as the paper finds")
    for warm in ("45ka", "mis5a", "mis5c"):
        check(slices[warm]["warmPeak"] and slices[warm]["areaKm2"] < 0.5 * slices["lgm"]["areaKm2"], f"{warm}: a warm peak, under half the LGM's ice")

    images = {entry["id"]: np.asarray(Image.open(REPO_ROOT / "app" / "public" / entry["file"])) for entry in meta["slices"]}
    for image in images.values():
        assert image.shape == (HEIGHT, WIDTH)
    check(all(int(image[HEIGHT // 2 :].max()) == 0 for image in images.values()), "nothing south of the equator")
    for place, lon, lat, where in ICE:
        for slice_id in where:
            check(coverage_at(images[slice_id], lon, lat) > 200, f"{slice_id}: ice over {place}")
    for place, lon, lat in NEVER:
        check(all(coverage_at(image, lon, lat) == 0 for image in images.values()), f"never ice over {place}")
    for place, lon, lat in NOT_AT_LGM:
        check(coverage_at(images["lgm"], lon, lat) == 0, f"lgm: no ice over {place}")
    # The date line is no edge: ice in north-east Asia in MIS 6 runs across it without a gap.
    row = int((90 - 66.0) / 180 * HEIGHT)
    left, right = int(images["mis6"][row, 0]), int(images["mis6"][row, -1])
    check(left > 0 and right > 0, f"mis6: ice either side of the date line at 66°N ({left}, {right})")
    finish()


if __name__ == "__main__":
    main()
