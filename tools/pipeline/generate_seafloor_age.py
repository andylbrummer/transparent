#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the age of the ocean floor.

Writes app/public/geo/seafloor-age.png, an equirectangular image of the
age of the oceanic crust, which the app drapes on the far-side surface so
the spreading ridges show as what they are: bands of new seafloor, older
to either side.

Source (CC BY 4.0, https://www.earthbyte.org/webdav/ftp/earthbyte/agegrid/2020/LICENSE.txt):

    Seton, M., Mueller, R. D., Zahirovic, S., Williams, S., Wright, N.,
    Cannon, J., Whittaker, J., Matthews, K., McGirr, R. (2020). A global
    dataset of present-day oceanic crustal age and seafloor spreading
    parameters. Geochemistry, Geophysics, Geosystems 21, e2020GC009214,
    doi:10.1029/2020GC009214.
    Grid age.2020.1.GTS2012.6m.nc (EarthByte): age in Myr on the Ogg (2012)
    timescale, 6 arc-minute, gridline-registered, NaN off the ocean crust.

The image (WIDTH x HEIGHT, longitude -180..180 left to right, north up,
as the globe's surface imagery) has no alpha channel - browsers may
premultiply one away - and carries instead:

    red    the age: round(255 * sqrt(age / AGE_MAX_MYR)), so the young
           seafloor at the ridges keeps the finer steps (0.2 Myr at 10 Myr,
           1.9 Myr at 180 Myr). In pixels off the ocean crust: the code of
           the nearest crust, so that a renderer's blending across the
           coverage edge does not invent young seafloor along every coast.
    green  coverage: the share of the pixel that is ocean crust, 0..255.
    blue   0.

Each pixel is the mean age of the source nodes inside it (the grid has
1.76 nodes to a pixel each way, so one to four of them), not a point
sample of the nearest one.

Usage:
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install numpy h5py scipy pillow
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_seafloor_age.py
"""

import sys

import h5py
import numpy as np
from PIL import Image
from scipy import ndimage

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR

AGE_GRID_URL = "https://www.earthbyte.org/webdav/ftp/earthbyte/agegrid/2020/Grids/age.2020.1.GTS2012.6m.nc"

WIDTH = 2048
HEIGHT = 1024
# The grid's oldest crust is 339 Myr (eastern Mediterranean).
AGE_MAX_MYR = 340.0


def age_code(age_myr: np.ndarray) -> np.ndarray:
    return np.rint(255 * np.sqrt(np.clip(age_myr, 0, AGE_MAX_MYR) / AGE_MAX_MYR))


def code_age(code: np.ndarray) -> np.ndarray:
    """Inverse of age_code, as the app's shader computes it."""
    return AGE_MAX_MYR * (code / 255.0) ** 2


def resample(age: np.ndarray, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(mean age, share covered) per output pixel, north row first.

    `age` is [lat ascending, lon ascending] with NaN off the crust. The
    grid's first and last columns are the same meridian (-180 and 180); the
    last is dropped so no node counts twice.
    """
    age = age[:, :-1]
    lon = lon[:-1]
    column = np.floor((lon + 180.0) / 360.0 * WIDTH).astype(int) % WIDTH
    row = np.clip(np.floor((90.0 - lat) / 180.0 * HEIGHT).astype(int), 0, HEIGHT - 1)
    valid = np.isfinite(age)
    index = (row[:, None] * WIDTH + column[None, :]).ravel()
    total = np.bincount(index, minlength=WIDTH * HEIGHT).reshape(HEIGHT, WIDTH)
    covered = np.bincount(index, weights=valid.ravel(), minlength=WIDTH * HEIGHT).reshape(HEIGHT, WIDTH)
    summed = np.bincount(index, weights=np.where(valid, age, 0.0).ravel(), minlength=WIDTH * HEIGHT).reshape(HEIGHT, WIDTH)
    if total.min() == 0:
        raise ValueError("an output pixel holds no source node: the image is finer than the grid")
    with np.errstate(invalid="ignore"):
        mean = np.where(covered > 0, summed / np.maximum(covered, 1), np.nan)
    return mean, covered / total


def main() -> None:
    path = cached_fetch(AGE_GRID_URL, "agegrid/age.2020.1.GTS2012.6m.nc", timeout=600)
    with h5py.File(path, "r") as grid:
        lon, lat, age = grid["lon"][:], grid["lat"][:], grid["z"][:].astype(np.float64)
    mean, coverage = resample(age, lon, lat)
    has_age = np.isfinite(mean)
    # Off the crust: the nearest crust's age, wrapping across the antimeridian.
    tiled = np.concatenate([has_age, has_age, has_age], axis=1)
    rows, cols = ndimage.distance_transform_edt(~tiled, return_distances=False, return_indices=True)
    nearest = (rows[:, WIDTH:2 * WIDTH], cols[:, WIDTH:2 * WIDTH] % WIDTH)
    filled = mean[nearest]

    image = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    image[..., 0] = age_code(filled)
    image[..., 1] = np.rint(coverage * 255)
    out = OUTPUT_DIR / "seafloor-age.png"
    Image.fromarray(image, "RGB").save(out, optimize=True)
    # Share of the sphere, each row weighted by its latitude's area.
    area = np.cos(np.radians(90 - (np.arange(HEIGHT) + 0.5) * 180 / HEIGHT))[:, None]
    share = (coverage * area).sum() / (area.sum() * WIDTH)
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KiB); ocean crust covers {100 * share:.1f} % "
          f"of the globe, ages {np.nanmin(mean):.2f} to {np.nanmax(mean):.1f} Myr", file=sys.stderr)


if __name__ == "__main__":
    main()
