#!/usr/bin/env python3
"""
Data checks for generate_lithosphere.py.

Against an independent dataset first: under the oceans, plate cooling
makes the lithosphere thicken with the age of the seafloor, roughly as
its square root (Parsons, B. & Sclater, J.G. 1977, J. Geophys. Res. 82,
803-827). The ages are the app's own seafloor-age picture, from Seton et
al. (2020), a different dataset made from magnetic stripes, not from
seismic waves. Then the places: thick keels under the Archean cratons
(Jordan, T.H. 1978, Nature 274, 544-548; Priestley, K. & McKenzie, D.
2006, Earth Planet. Sci. Lett. 244, 285-301), thin plate at the spreading
ridges and the rifts. And the picture decodes to the file.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_lithosphere.py
"""

import numpy as np
from PIL import Image

from generate_lithosphere import DEPTH_SCALE_KM, HEIGHT, OUT_PNG, REPO_ROOT, WIDTH, read_grid
from geo_test_support import check, finish

# generate_seafloor_age.py: red = 255 * sqrt(age / AGE_MAX_MYR), green = share of the pixel that is ocean crust.
AGE_MAX_MYR = 340.0

CRATONS = [
    ("Superior craton", 55, -85),
    ("Slave craton", 65, -111),
    ("Siberian craton", 65, 110),
    ("Kaapvaal craton", -27, 26),
    ("West African craton", 12, -5),
    ("Yilgarn craton", -29, 119),
    ("Fennoscandian shield", 63, 28),
]
THIN = [
    ("East Pacific Rise, 10 S", -10, -110),
    ("Mid-Atlantic Ridge, 30 N", 30, -42),
    ("Iceland", 65, -18),
    ("Afar", 11, 41),
]


def at(depth: np.ndarray, lat: float, lon: float) -> float:
    return float(depth[int((90 - lat) // 2), int((lon + 180) // 2)])


def main() -> None:
    depth = read_grid()
    check(depth.shape == (HEIGHT, WIDTH), f"a full 2-degree grid ({depth.shape})")
    check(20 <= depth.min() and depth.max() <= 270, f"depths 20-270 km ({depth.min():.0f}-{depth.max():.0f})")

    age_png = np.asarray(Image.open(REPO_ROOT / "app/public/geo/seafloor-age.png").convert("RGB"), dtype=float)
    h, w = age_png.shape[:2]
    lats = 89 - 2 * np.arange(HEIGHT)
    lons = -179 + 2 * np.arange(WIDTH)
    ys = ((90 - lats) / 180 * h).astype(int)
    xs = ((lons + 180) / 360 * w).astype(int)
    sample = age_png[ys[:, None], xs[None, :]]
    ocean = sample[..., 1] > 250
    age = AGE_MAX_MYR * (sample[..., 0] / 255) ** 2
    r = np.corrcoef(np.sqrt(age[ocean]), depth[ocean])[0, 1]
    check(ocean.sum() > 7000, f"over 7,000 cells of ocean crust to compare ({ocean.sum()})")
    check(r > 0.7, f"under the oceans, thickness follows sqrt(seafloor age): r = {r:.2f}")
    bins = [(0, 10), (10, 30), (30, 60), (60, 100), (100, 200)]
    medians = [float(np.median(depth[ocean & (age >= lo) & (age < hi)])) for lo, hi in bins]
    check(all(a < b for a, b in zip(medians, medians[1:])), f"thicker with every older band of seafloor: {medians} km")
    check(medians[0] < 40, f"seafloor under 10 Myr old: plate under 40 km ({medians[0]:.0f} km)")

    for name, lat, lon in CRATONS:
        value = at(depth, lat, lon)
        check(value > 150, f"{name}: a keel over 150 km ({value:.0f} km)")
    for name, lat, lon in THIN:
        value = at(depth, lat, lon)
        check(value < 50, f"{name}: plate under 50 km ({value:.0f} km)")

    picture = np.asarray(Image.open(OUT_PNG), dtype=float)
    check(picture.shape == (HEIGHT, WIDTH), f"picture {picture.shape}")
    error = np.abs(picture * DEPTH_SCALE_KM / 255 - depth).max()
    check(error <= DEPTH_SCALE_KM / 255 / 2 + 1e-9, f"the picture decodes to the depths within half a step ({error:.2f} km)")
    check(OUT_PNG.stat().st_size < 20_000, f"picture under 20 kB ({OUT_PNG.stat().st_size} bytes)")
    finish()


if __name__ == "__main__":
    main()
