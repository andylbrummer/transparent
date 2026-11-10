#!/usr/bin/env python3
"""
Bake the thickness of the Antarctic ice and the shape of the land under it, from Bedmap3.

Outputs
    app/public/geo/antarctic-ice-thickness.png   2048x256, grey = thickness, alpha = share of the pixel under ice
    app/public/geo/antarctic-bed.png             2048x256, grey = bed elevation, alpha = share of the pixel under ice
    app/public/geo/antarctic-ice.json            how to read the two images, and the extremes of the full grid

    Both images are a strip of the equirectangular globe: longitude -180..180 left to right, latitude
    -58 (top row) to -90 (bottom row). Grey level g (0..255) stands for
        thickness = g * 20 m                 (0 .. 5100 m)
        bed       = g * 34 m - 3600 m        (-3600 .. +5070 m, relative to sea level)

Source
    Bedmap3: Pritchard, H., Fretwell, P., Fremand, A., Bodart, J., Kirkham, J., Aitken, A., et al. (2024),
    BEDMAP3 - Ice thickness, bed and surface elevation for Antarctica - gridding products (Version 1.0)
    [Data set], NERC EDS UK Polar Data Centre, doi:10.5285/2d0e4791-8e20-46a3-80e4-f5f6716025d2.
    Described in Pritchard et al. (2025), Bedmap3 updated ice bed, surface and thickness gridded datasets for
    Antarctica, Scientific Data 12, 414, doi:10.1038/s41597-025-04672-y.
    Licence: CC BY 4.0. Keyless download (2.5 GB netCDF) from
    https://ramadda.data.bas.ac.uk/repository/entry/show?entryid=2d0e4791-8e20-46a3-80e4-f5f6716025d2

What is done to it
    The 500 m grids (EPSG:3031: WGS 84 polar stereographic, true at 71 S) are averaged over blocks of 8x8
    cells (4 km), ice cells only, and each output pixel takes the bilinear value at its centre - found with
    the ellipsoidal forward projection of Snyder (1987), Map Projections: A Working Manual, eq. 21-33/34 and
    15-9. "Under ice" is Bedmap3's mask classes 1-3 (grounded ice, transiently grounded and floating ice
    shelf); bare rock and open sea are transparent. The extremes in the JSON are read from the 500 m grid.

Usage:
    python3 -m venv tools/pipeline/.cache/venv-overlays
    tools/pipeline/.cache/venv-overlays/bin/pip install numpy pillow h5py
    tools/pipeline/.cache/venv-overlays/bin/python tools/pipeline/generate_antarctic_ice.py

The netCDF is kept in tools/pipeline/.cache/ice/bedmap3.nc; it is downloaded if absent.
"""

import json
import math
import shutil
import sys
import urllib.request
from pathlib import Path

import h5py
import numpy as np
from PIL import Image

from fetch_cache import CACHE_DIR, USER_AGENT

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "app" / "public" / "geo"
BEDMAP3_URL = (
    "https://ramadda.data.bas.ac.uk/repository/entry/get/bedmap3.nc"
    "?entryid=synth%3A2d0e4791-8e20-46a3-80e4-f5f6716025d2%3AL2JlZG1hcDMubmM%3D"
)
BEDMAP3_FILE = CACHE_DIR / "ice" / "bedmap3.nc"

WIDTH = 2048
HEIGHT = 256
LAT_TOP = -58.0
LAT_BOTTOM = -90.0
THICKNESS_STEP_M = 20.0
BED_STEP_M = 34.0
BED_OFFSET_M = -3600.0
#: Cells averaged per side before sampling: 8 x 500 m = 4 km.
BLOCK = 8

WGS84_A = 6378137.0
WGS84_E = 0.0818191908426
TRUE_LATITUDE = -71.0


def polar_stereographic_south(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """EPSG:3031 x, y in metres of points given in degrees."""
    e = WGS84_E
    # The southern aspect is the northern one with the signs of latitude and longitude changed.
    phi = np.radians(-lat)
    lam = np.radians(lon)
    phi_c = math.radians(-TRUE_LATITUDE)
    t = np.tan(np.pi / 4 - phi / 2) / ((1 - e * np.sin(phi)) / (1 + e * np.sin(phi))) ** (e / 2)
    t_c = math.tan(math.pi / 4 - phi_c / 2) / ((1 - e * math.sin(phi_c)) / (1 + e * math.sin(phi_c))) ** (e / 2)
    m_c = math.cos(phi_c) / math.sqrt(1 - e * e * math.sin(phi_c) ** 2)
    rho = WGS84_A * m_c * t / t_c
    return rho * np.sin(lam), rho * np.cos(lam)


def polar_stereographic_south_inverse(x: float, y: float) -> tuple[float, float]:
    """(lon, lat) in degrees of an EPSG:3031 point."""
    e = WGS84_E
    phi_c = math.radians(-TRUE_LATITUDE)
    t_c = math.tan(math.pi / 4 - phi_c / 2) / ((1 - e * math.sin(phi_c)) / (1 + e * math.sin(phi_c))) ** (e / 2)
    m_c = math.cos(phi_c) / math.sqrt(1 - e * e * math.sin(phi_c) ** 2)
    t = math.hypot(x, y) * t_c / (WGS84_A * m_c)
    phi = math.pi / 2 - 2 * math.atan(t)
    for _ in range(8):
        phi = math.pi / 2 - 2 * math.atan(t * ((1 - e * math.sin(phi)) / (1 + e * math.sin(phi))) ** (e / 2))
    return math.degrees(math.atan2(x, y)), -math.degrees(phi)


def ensure_download() -> Path:
    if BEDMAP3_FILE.exists():
        return BEDMAP3_FILE
    BEDMAP3_FILE.parent.mkdir(parents=True, exist_ok=True)
    print(f"fetching {BEDMAP3_URL} (2.5 GB)", file=sys.stderr)
    request = urllib.request.Request(BEDMAP3_URL, headers={"User-Agent": USER_AGENT})
    partial = BEDMAP3_FILE.with_name(BEDMAP3_FILE.name + ".part")
    with urllib.request.urlopen(request, timeout=600) as response, open(partial, "wb") as out:
        shutil.copyfileobj(response, out, 1 << 22)
    partial.replace(BEDMAP3_FILE)
    return BEDMAP3_FILE


def block_means(file: h5py.File) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """
    Thickness and bed averaged over the ice cells of each BLOCK x BLOCK block (nan where it has none),
    the share of each block under ice, and the extremes of the full-resolution grid.
    """
    thickness = file["ice_thickness"]
    bed = file["bed_topography"]
    mask = file["mask"]
    x = file["x"][:].astype(np.float64)
    y = file["y"][:].astype(np.float64)
    rows, cols = thickness.shape
    out_rows, out_cols = rows // BLOCK, cols // BLOCK
    mean_thickness = np.full((out_rows, out_cols), np.nan, dtype=np.float32)
    mean_bed = np.full((out_rows, out_cols), np.nan, dtype=np.float32)
    cover = np.zeros((out_rows, out_cols), dtype=np.float32)

    thickest = (-1.0, 0, 0)
    deepest = (1e9, 0, 0)
    ice_cells = 0
    grounded_cells = 0
    thickness_sum = 0.0
    grounded_thickness_sum = 0.0
    step = BLOCK * 64
    for r0 in range(0, out_rows * BLOCK, step):
        r1 = min(r0 + step, out_rows * BLOCK)
        band = slice(r0, r1)
        m = mask[band, : out_cols * BLOCK]
        ice = (m >= 1) & (m <= 3)
        grounded = m == 1
        th = thickness[band, : out_cols * BLOCK].astype(np.float32)
        bd = bed[band, : out_cols * BLOCK].astype(np.float32)
        th[(th < 0) | ~ice] = 0.0

        ice_cells += int(ice.sum())
        grounded_cells += int(grounded.sum())
        thickness_sum += float(th[ice].sum())
        grounded_thickness_sum += float(th[grounded].sum())
        if ice.any():
            i = np.unravel_index(np.argmax(th), th.shape)
            if th[i] > thickest[0]:
                thickest = (float(th[i]), r0 + int(i[0]), int(i[1]))
        if grounded.any():
            under = np.where(grounded & (bd > -9000), bd, np.float32(1e9))
            i = np.unravel_index(np.argmin(under), under.shape)
            if under[i] < deepest[0]:
                deepest = (float(under[i]), r0 + int(i[0]), int(i[1]))

        shape = ((r1 - r0) // BLOCK, BLOCK, out_cols, BLOCK)
        count = ice.reshape(shape).sum(axis=(1, 3)).astype(np.float32)
        rows_out = slice(r0 // BLOCK, r1 // BLOCK)
        cover[rows_out] = count / (BLOCK * BLOCK)
        with np.errstate(invalid="ignore", divide="ignore"):
            mean_thickness[rows_out] = np.where(count > 0, th.reshape(shape).sum(axis=(1, 3)) / count, np.nan)
            mean_bed[rows_out] = np.where(count > 0, np.where(ice, bd, 0.0).reshape(shape).sum(axis=(1, 3)) / count, np.nan)
        print(f"  rows {r1}/{rows}", file=sys.stderr)

    def place(row: int, col: int) -> tuple[float, float]:
        lon, lat = polar_stereographic_south_inverse(x[col], y[row])
        return round(lon, 3), round(lat, 3)

    cell_km2 = 0.25
    extremes = {
        "thickestIce": {"metres": int(thickest[0]), "lon": place(thickest[1], thickest[2])[0], "lat": place(thickest[1], thickest[2])[1]},
        "deepestBedUnderGroundedIce": {
            "metres": int(deepest[0]),
            "lon": place(deepest[1], deepest[2])[0],
            "lat": place(deepest[1], deepest[2])[1],
        },
        "meanThicknessM": round(thickness_sum / ice_cells),
        "meanGroundedThicknessM": round(grounded_thickness_sum / grounded_cells),
        # Cell areas are nominal: the projection is true at 71 S and stretches by a few per cent elsewhere.
        "nominalIceAreaKm2": round(ice_cells * cell_km2),
        "grid": {"x0": float(x[0]), "y0": float(y[0]), "cellM": float(x[1] - x[0]) * BLOCK, "block": BLOCK},
    }
    return mean_thickness, mean_bed, cover, extremes


def sample(grid: np.ndarray, col: np.ndarray, row: np.ndarray, weight: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Bilinear value of `grid` at fractional (col, row), weighting each corner by `weight` there; and the weight."""
    c0 = np.floor(col).astype(np.int64)
    r0 = np.floor(row).astype(np.int64)
    fc = col - c0
    fr = row - r0
    total = np.zeros(col.shape, dtype=np.float64)
    weights = np.zeros(col.shape, dtype=np.float64)
    for dr, dc, w in ((0, 0, (1 - fr) * (1 - fc)), (0, 1, (1 - fr) * fc), (1, 0, fr * (1 - fc)), (1, 1, fr * fc)):
        r = r0 + dr
        c = c0 + dc
        inside = (r >= 0) & (r < grid.shape[0]) & (c >= 0) & (c < grid.shape[1])
        rr = np.clip(r, 0, grid.shape[0] - 1)
        cc = np.clip(c, 0, grid.shape[1] - 1)
        cell_weight = np.where(inside, weight[rr, cc], 0.0) * w
        value = np.nan_to_num(grid[rr, cc], nan=0.0)
        total += value * cell_weight
        weights += cell_weight
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(weights > 0, total / weights, 0.0), weights


def spread(values: np.ndarray, valid: np.ndarray, passes: int = 3) -> np.ndarray:
    """`values` with each invalid pixel within `passes` pixels of a valid one set to the mean of its valid neighbours; 0 beyond."""
    out = np.where(valid, values, 0).astype(np.float64)
    known = valid.copy()
    for _ in range(passes):
        total = np.zeros(out.shape)
        count = np.zeros(out.shape)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                # Longitude wraps; latitude does not.
                shifted = np.roll(np.where(known, out, 0.0), dc, axis=1)
                mask = np.roll(known, dc, axis=1)
                if dr != 0:
                    shifted = np.roll(shifted, dr, axis=0)
                    mask = np.roll(mask, dr, axis=0)
                    edge = 0 if dr == 1 else -1
                    shifted[edge, :] = 0.0
                    mask[edge, :] = False
                total += shifted
                count += mask
        fill = ~known & (count > 0)
        out[fill] = total[fill] / count[fill]
        known = known | fill
    return np.round(out).astype(np.uint8)


def main() -> None:
    with h5py.File(ensure_download(), "r") as file:
        mean_thickness, mean_bed, cover, extremes = block_means(file)

    lon = (np.arange(WIDTH) + 0.5) / WIDTH * 360.0 - 180.0
    lat = LAT_TOP + (np.arange(HEIGHT) + 0.5) / HEIGHT * (LAT_BOTTOM - LAT_TOP)
    lon2, lat2 = np.meshgrid(lon, lat)
    x, y = polar_stereographic_south(lon2, lat2)
    grid = extremes["grid"]
    # Block centres: the first lies (BLOCK - 1) / 2 cells in from the first cell's centre.
    first_x = grid["x0"] + (BLOCK - 1) / 2 * (grid["cellM"] / BLOCK)
    first_y = grid["y0"] - (BLOCK - 1) / 2 * (grid["cellM"] / BLOCK)
    col = (x - first_x) / grid["cellM"]
    row = (first_y - y) / grid["cellM"]

    thickness, alpha = sample(mean_thickness, col, row, cover)
    bed, _ = sample(mean_bed, col, row, cover)
    alpha8 = np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)
    thickness8 = np.clip(np.round(thickness / THICKNESS_STEP_M), 0, 255).astype(np.uint8)
    bed8 = np.clip(np.round((bed - BED_OFFSET_M) / BED_STEP_M), 0, 255).astype(np.uint8)
    # Outside the ice the grey level means nothing, but the app's texture filter still blends it into
    # the rim: carry the rim's own values outward so the blend does not invent thin ice or a deep bed.
    thickness8 = spread(thickness8, alpha8 > 0)
    bed8 = spread(bed8, alpha8 > 0)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, grey in (("antarctic-ice-thickness.png", thickness8), ("antarctic-bed.png", bed8)):
        Image.merge("LA", (Image.fromarray(grey, "L"), Image.fromarray(alpha8, "L"))).save(OUT_DIR / name, optimize=True)
        print(f"{name} {(OUT_DIR / name).stat().st_size} bytes")

    del extremes["grid"]
    document = {
        "source": "Bedmap3 (Pritchard et al. 2024), NERC EDS UK Polar Data Centre, doi:10.5285/2d0e4791-8e20-46a3-80e4-f5f6716025d2, CC BY 4.0",
        "strip": {"width": WIDTH, "height": HEIGHT, "latTop": LAT_TOP, "latBottom": LAT_BOTTOM},
        "thickness": {"stepM": THICKNESS_STEP_M, "offsetM": 0.0},
        "bed": {"stepM": BED_STEP_M, "offsetM": BED_OFFSET_M},
        **extremes,
    }
    (OUT_DIR / "antarctic-ice.json").write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(extremes))


if __name__ == "__main__":
    main()
