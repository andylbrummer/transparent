#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: permafrost zones of the Northern
Hemisphere.

Writes app/public/geo/permafrost.png (2048x1024, longitude -180..180 left
to right, north up) and app/public/geo/permafrost.json (areas by zone).

Source:

    Obu, J., Westermann, S., Kääb, A. & Bartsch, A. (2018), Ground
    Temperature Map, 2000-2016, Northern Hemisphere Permafrost. PANGAEA,
    https://doi.org/10.1594/PANGAEA.888600 - CC BY 3.0. The zones file
    (PERZONES, a shapefile) is used. The method and the zone areas are in
    Obu, J. et al. (2019), Northern Hemisphere permafrost map based on
    TTOP modelling for 2000-2016 at 1 km2 scale, Earth-Science Reviews
    193, 299-316.

The model gives each 1 km cell a permafrost probability (the fraction of
200 runs with the ground below 0 C, read as the share of the cell
underlain by permafrost) and classes it as the IPA map does: continuous
(> 0.9), discontinuous (0.5-0.9), sporadic (0.1-0.5) and isolated patches
(0.005-0.1). The classes were smoothed (a 5x5 filter) and drawn as
polygons; that file is what is baked here.

The polygons are in Arctic Polar Stereographic (EPSG:3995: WGS 84,
standard parallel 71 N, central meridian 0). They are filled at 2 km in
that plane, each record's holes cut from its own outer rings only, and
the picture is then sampled at the equirectangular pixels by projecting
each pixel's centre forward (Snyder 1987, Map Projections - A Working
Manual, USGS PP 1395, chapter 21, the ellipsoidal polar case) - no projection
library.

Picture channels: R the zone, 1 continuous ... 4 isolated, as 64 per step
(64, 128, 192, 255), averaged over the covered subsamples and spread into
the empty pixels beside covered ones so that a filtered edge keeps its
colour; G unused; B coverage, 0-255, from 2x2 subsamples.

Usage:
    python3 tools/pipeline/generate_permafrost.py
"""

import math
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, write_json
from province_raster import read_dbf, read_polygon_records, save_png

ZIP_URL = "https://store.pangaea.de/Publications/ObuJ-etal_2018/UiO_PEX_PERZONES_5.0_20181128_2000_2016_NH.zip"
CACHE_NAME = "subsurface/UiO_PEX_PERZONES_5.0_NH.zip"
STEM = "UiO_PEX_PERZONES_5.0_20181128_2000_2016_NH"
# EXTENT codes of the file, coldest first, and the zone each becomes.
ZONES = (("Cont", "continuous"), ("Discon", "discontinuous"), ("Spora", "sporadic"), ("Isol", "isolated"))
R_STEP = 64
WIDTH, HEIGHT = 2048, 1024

# WGS 84 and the projection's standard parallel.
A = 6378137.0
E = math.sqrt(1 / 298.257223563 * (2 - 1 / 298.257223563))
LAT_C = math.radians(71.0)
CELL_M = 2000.0
SOUTH_LIMIT = 20.0  # the file reaches 25 N; rows south of this are left empty


def _t(phi: np.ndarray) -> np.ndarray:
    s = E * np.sin(phi)
    return np.tan(np.pi / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (E / 2)


def forward(lon_deg: np.ndarray, lat_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """EPSG:3995 metres of longitudes and latitudes (degrees)."""
    m_c = math.cos(LAT_C) / math.sqrt(1 - (E * math.sin(LAT_C)) ** 2)
    t_c = float(_t(np.array(LAT_C)))
    rho = A * m_c * _t(np.radians(lat_deg)) / t_c
    lam = np.radians(lon_deg)
    return rho * np.sin(lam), -rho * np.cos(lam)


def unpack(zip_path: Path) -> Path:
    out = CACHE_DIR / "subsurface" / "perzones"
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for suffix in (".shp", ".dbf", ".prj"):
            target = out / (STEM + suffix)
            if not target.exists():
                target.write_bytes(archive.read(STEM + suffix))
    return out


def check_projection(directory: Path) -> None:
    prj = (directory / (STEM + ".prj")).read_text()
    for needed in ("Stereographic_North_Pole", '"Central_Meridian",0.0', '"Standard_Parallel_1",71.0', "WGS_1984"):
        if needed not in prj:
            raise SystemExit(f"the .prj no longer says {needed}: read it and update the projection")


def records(directory: Path) -> list[tuple[int, list[list[tuple[float, float]]]]]:
    """(zone 1..4, rings in metres) for every record."""
    codes = {code: i + 1 for i, (code, _) in enumerate(ZONES)}
    rows = read_dbf(directory / (STEM + ".dbf"))
    shapes = read_polygon_records(directory / (STEM + ".shp"))
    if len(rows) != len(shapes):
        raise SystemExit("the table and the shapes differ in length")
    return [(codes[row["EXTENT"]], rings) for row, rings in zip(rows, shapes) if rings]


def signed_area(ring: np.ndarray) -> float:
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def stereo_raster(shapes, x0: float, y1: float, width: int, height: int) -> np.ndarray:
    """Zone of each 2 km cell of the stereographic plane, 0 outside; row 0 is the top (largest y)."""
    zone = Image.new("L", (width, height), 0)
    for value, rings in shapes:
        arrays = [np.array(r, dtype=np.float64) for r in rings if len(r) >= 3]
        if not arrays:
            continue
        pix = [np.column_stack(((a[:, 0] - x0) / CELL_M, (y1 - a[:, 1]) / CELL_M)) for a in arrays]
        lo = np.floor(np.min([p.min(axis=0) for p in pix], axis=0)).astype(int) - 1
        hi = np.ceil(np.max([p.max(axis=0) for p in pix], axis=0)).astype(int) + 1
        lo, hi = np.maximum(lo, 0), np.minimum(hi, (width, height))
        if (hi <= lo).any():
            continue
        mask = Image.new("1", tuple(hi - lo), 0)
        draw = ImageDraw.Draw(mask)
        # Shapefile outer rings run clockwise (negative signed area with y up); holes are cut from this record only.
        for outer in (True, False):
            for ring, p in zip(arrays, pix):
                if (signed_area(ring) < 0) == outer:
                    draw.polygon([tuple(q) for q in (p - lo)], fill=1 if outer else 0)
        zone.paste(value, (int(lo[0]), int(lo[1]), int(hi[0]), int(hi[1])), mask)
    return np.asarray(zone)


def bake(zone: np.ndarray, x0: float, y1: float) -> np.ndarray:
    """The RGB picture: 2x2 samples a pixel, each looked up in the stereographic raster."""
    south_row = int(math.ceil((90 - SOUTH_LIMIT) / 180 * HEIGHT))
    sub = 2
    lon = -180 + (np.arange(WIDTH * sub) + 0.5) * 360 / (WIDTH * sub)
    lat = 90 - (np.arange(south_row * sub) + 0.5) * 180 / (HEIGHT * sub)
    x, y = forward(lon[None, :], lat[:, None])
    col = np.floor((x - x0) / CELL_M).astype(int)
    row = np.floor((y1 - y) / CELL_M).astype(int)
    inside = (col >= 0) & (col < zone.shape[1]) & (row >= 0) & (row < zone.shape[0])
    samples = np.zeros(col.shape, dtype=np.uint8)
    samples[inside] = zone[row[inside], col[inside]]
    blocks = samples.reshape(south_row, sub, WIDTH, sub).transpose(0, 2, 1, 3).reshape(south_row, WIDTH, sub * sub)
    covered = (blocks > 0).sum(axis=2)
    total = blocks.astype(np.float64).sum(axis=2)
    r = np.zeros((HEIGHT, WIDTH))
    b = np.zeros((HEIGHT, WIDTH))
    r[:south_row] = np.where(covered > 0, total / np.maximum(covered, 1), 0)
    b[:south_row] = covered / (sub * sub)
    empty = r == 0
    _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
    r = np.where(empty, r[iy, ix], r)
    # Spread colour only a few pixels: far from any permafrost R stays 0 and the picture compresses.
    near = ndimage.binary_dilation(~empty, iterations=3)
    r = np.where(near, r, 0)
    rgb = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    rgb[..., 0] = np.clip(np.round(r * R_STEP), 0, 255)
    rgb[..., 2] = np.round(b * 255)
    return rgb


def scale_factor(x: float, y: float) -> float:
    """The projection's scale k at a point of the plane (Snyder 1987, ch. 21; the latitude found by iteration)."""
    m_c = math.cos(LAT_C) / math.sqrt(1 - (E * math.sin(LAT_C)) ** 2)
    t_c = float(_t(np.array(LAT_C)))
    rho = math.hypot(x, y)
    if rho == 0:
        return float(m_c / t_c * (1 + E) ** ((1 + E) / 2) * (1 - E) ** ((1 - E) / 2) / 2)
    t = rho * t_c / (A * m_c)
    phi = math.pi / 2 - 2 * math.atan(t)
    for _ in range(6):
        s = E * math.sin(phi)
        phi = math.pi / 2 - 2 * math.atan(t * ((1 - s) / (1 + s)) ** (E / 2))
    return rho / (A * math.cos(phi) / math.sqrt(1 - (E * math.sin(phi)) ** 2))


def zone_areas(shapes) -> dict[str, float]:
    """km2 of each zone from the polygons themselves: each ring's plane area over k squared at its centre; holes subtract."""
    out = [0.0] * (len(ZONES) + 1)
    for value, rings in shapes:
        for ring in rings:
            a = np.array(ring, dtype=np.float64)
            if len(a) < 3:
                continue
            cx, cy = a.mean(axis=0)
            out[value] += -signed_area(a) / scale_factor(float(cx), float(cy)) ** 2 / 1e6
    return {name: round(out[i + 1]) for i, (_, name) in enumerate(ZONES)}


def picture_area_km2(rgb: np.ndarray) -> float:
    """What the baked picture covers, on a sphere of the Earth's mean radius: a check on the sampling."""
    height, width = rgb.shape[:2]
    edges = np.radians(90 - np.arange(height + 1) * 180 / height)
    rows = (np.sin(edges[:-1]) - np.sin(edges[1:])) / 2 / width
    return float((rgb[..., 2] / 255 * rows[:, None]).sum() * 4 * math.pi * 6371.0**2)


def main() -> None:
    directory = unpack(cached_fetch(ZIP_URL, CACHE_NAME))
    check_projection(directory)
    shapes = records(directory)
    xs = np.concatenate([np.array(r)[:, 0] for _, rings in shapes for r in rings])
    ys = np.concatenate([np.array(r)[:, 1] for _, rings in shapes for r in rings])
    x0, y1 = math.floor(xs.min() / CELL_M) * CELL_M, math.ceil(ys.max() / CELL_M) * CELL_M
    width, height = int(math.ceil((xs.max() - x0) / CELL_M)), int(math.ceil((y1 - ys.min()) / CELL_M))
    zone = stereo_raster(shapes, x0, y1, width, height)
    areas = zone_areas(shapes)
    rgb = bake(zone, x0, y1)
    save_png(rgb, OUTPUT_DIR / "permafrost.png")
    write_json(OUTPUT_DIR / "permafrost.json", {
        "source": "Obu et al. 2018, Northern Hemisphere permafrost zones, PANGAEA 888600 (CC BY 3.0)",
        "zones": [name for _, name in ZONES],
        "rStep": R_STEP,
        "areaKm2": areas,
        "records": len(shapes),
    })
    print(f"{len(shapes)} polygons; zone areas {areas} km2; the picture holds {picture_area_km2(rgb):.3g} km2", file=sys.stderr)


if __name__ == "__main__":
    main()
