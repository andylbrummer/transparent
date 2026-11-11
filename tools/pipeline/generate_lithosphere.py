#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: how thick the lithosphere is.

Writes app/public/geo/lithosphere.png, the depth of the base of the
lithosphere - the cold, rigid plate - below the surface, from the
surface-wave model CAM2023:

    Priestley, K., Ho, T., Takei, Y. & McKenzie, D. (2024), The thermal and
    anisotropic structure of the top 300 km of the mantle, Earth Planet.
    Sci. Lett. 626, 118525, doi:10.1016/j.epsl.2023.118525. Files from the
    EarthScope Earth Model Collaboration (EMC), CAM2023.emc.2025-01-13.tgz.
    No licence is stated; the README and the EMC ask that the paper and
    the EMC be cited.

The file used is CAM2023_lithosphere.xyz: latitude, longitude, depth (km)
of the thermal lithosphere-asthenosphere boundary on a 2-degree grid of
cell centres (latitude -89..89, longitude -179..179), 16,200 points.

The image is 180 x 90, one pixel per grid cell (its centre at the cell's
centre, longitude -180..180 left to right, north up), grey:
    round(255 * depth / DEPTH_SCALE_KM).
The app blends between neighbouring cells; it does not invent finer detail.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_lithosphere.py
"""

import json
import tarfile
from pathlib import Path

import numpy as np
from PIL import Image

from fetch_cache import cached_fetch

CAM2023_URL = "https://data.earthscope.org/archive/seismology/products/emc/data/CAM2022/CAM2023.emc.2025-01-13.tgz"
MEMBER = "CAM2023.emc/CAM2023_lithosphere.xyz"
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PNG = REPO_ROOT / "app/public/geo/lithosphere.png"
WIDTH, HEIGHT = 180, 90
# Deepest in the model is 263 km; app/src/layers/lithosphere/ramp.ts reads the same scale.
DEPTH_SCALE_KM = 300.0


def read_grid() -> np.ndarray:
    """Depth (km) as a HEIGHT x WIDTH array, row 0 the northernmost cells, column 0 the westernmost."""
    with tarfile.open(cached_fetch(CAM2023_URL, "lithosphere/CAM2023.emc.2025-01-13.tgz")) as archive:
        member = archive.extractfile(MEMBER)
        if member is None:
            raise SystemExit(f"{MEMBER} missing from the archive")
        rows = np.loadtxt(member)
    if rows.shape != (WIDTH * HEIGHT, 3):
        raise SystemExit(f"expected {WIDTH * HEIGHT} rows of lat lon depth, got {rows.shape}")
    depth = np.full((HEIGHT, WIDTH), np.nan)
    row = np.rint((89 - rows[:, 0]) / 2).astype(int)
    col = np.rint((rows[:, 1] + 179) / 2).astype(int)
    depth[row, col] = rows[:, 2]
    if np.isnan(depth).any():
        raise SystemExit("the grid has holes")
    return depth


def depth_code(depth_km: np.ndarray) -> np.ndarray:
    return np.rint(255 * np.clip(depth_km, 0, DEPTH_SCALE_KM) / DEPTH_SCALE_KM).astype(np.uint8)


def main() -> None:
    depth = read_grid()
    Image.fromarray(depth_code(depth), mode="L").save(OUT_PNG, optimize=True)
    print(json.dumps({"file": str(OUT_PNG.relative_to(REPO_ROOT)), "bytes": OUT_PNG.stat().st_size, "minKm": depth.min(), "maxKm": depth.max()}))


if __name__ == "__main__":
    main()
