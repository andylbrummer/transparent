#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the Milky Way, as HiPS tiles.

Writes app/public/sky/milkyway/Norder{k}/Dir0/Npix{n}.jpg, orders 0 to 2,
from NASA's Deep Star Maps 2020 (NASA/Goddard Space Flight Center
Scientific Visualization Studio, E. Wright, svs.gsfc.nasa.gov/4851;
public domain, credit requested, with Gaia DR2: ESA/Gaia/DPAC): the
"milkyway" map - the summed light of the 1.7 billion Gaia DR2, Tycho-2
and Hipparcos-2 stars too faint to plot one by one - in celestial (ICRF)
coordinates, at 16384x8192 (1.3 arc minutes a pixel).

The app draws it like any other sky survey (app/src/layers/sky-survey),
so it loads only the tiles in view, at the order the zoom needs: order 1
(7 arc minutes a pixel) for a whole phone screen, order 2 (1.7 arc
minutes) zoomed in, where the dust lanes, the star clouds and the
Magellanic Clouds show their structure. Order 3 would only add grain:
at the source's 1.3 arc minutes the map breaks up into single faint
stars, which the denoising below smooths away.

A tile is one HEALPix pixel as a 512x512 image, HEALPix v along its rows
from the left and u down its columns from the top (tileImageXy in
app/src/layers/sky-survey/hips.ts; test_hips_orientation.py). Order 2 is
sampled from the source, bilinearly, in linear light; each lower order
averages its four children, also in linear light, before tone mapping.

Tone mapping: the EXR is linear light. A black level - the faint, even
floor of unresolved stars far from the plane - is subtracted so the map
adds nothing to the view where there is no Milky Way to see, eased in
just above that level so faint grain does not become speckle, then an
exposure and a gamma bring the band up, and a shoulder compresses the
bulge's core rather than cutting it flat. The levels are measured on a
2048x1024 reduction, so every order is mapped the same way.

Usage:
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install OpenEXR numpy pillow healpy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_milkyway.py   # about three minutes, 10 GB of memory

Raw downloads are cached in tools/pipeline/.cache/ (the EXR is 434 MB).
"""

import shutil
from collections.abc import Callable
from pathlib import Path

import healpy as hp
import numpy as np
import OpenEXR
from PIL import Image

from fetch_cache import cached_fetch

SOURCE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_16k.exr"

TILE_PX = 512
TILE_BITS = 9  # 2**9 = TILE_PX: a tile's pixels are HEALPix pixels nine orders down.
MAX_ORDER = 2
# Denoising, in source pixels: at 1.3' a pixel the map is grainy with single faint stars, which the app's own
# catalogue already draws. Where the band is bright, a light blur keeps the dust lanes sharp; where the light is
# near the black level, a wide one, so the floor fades evenly to black instead of becoming a field of speckle.
FINE_SIGMA_PX = 1.0
WIDE_SIGMA_PX = 6.0
# The fine blur takes over between the black level and this far (a fraction of white) above it.
FINE_ABOVE_BLACK = 0.15
# The tone curve's shoulder starts here: above it the bulge's core is compressed rather than cut flat at white.
SHOULDER = 0.6
# The levels are measured at this width: the reduction the map was first tuned on.
LEVELS_WIDTH = 2048
# Linear level treated as black: two thirds of the sky - everything well off the galactic plane - is at or under it.
BLACK_PERCENTILE = 66
# Linear level, after the black is removed, that maps to white: only the bulge's core exceeds it.
WHITE_PERCENTILE = 99.9
GAMMA = 2.0
# Just above black the response is eased in (x^2 / (x + TOE)): a hard cut there would turn the grain of the
# faintest regions into speckle with sharp edges, which the eye reads as structure.
TOE = 0.03
JPEG_QUALITY = 85

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "milkyway"


def tile_path(root: Path, order: int, ipix: int) -> Path:
    return root / f"Norder{order}" / f"Dir{ipix // 10000 * 10000}" / f"Npix{ipix}.jpg"


def read_exr(path: Path) -> np.ndarray:
    """Linear RGB, float32, rows top (north) to bottom."""
    with OpenEXR.File(str(path)) as exr:
        channels = exr.channels()
        if "RGB" in channels:
            return np.asarray(channels["RGB"].pixels, dtype=np.float32)
        if "RGBA" in channels:
            return np.asarray(channels["RGBA"].pixels, dtype=np.float32)[..., :3]
        return np.stack([np.asarray(channels[c].pixels, dtype=np.float32) for c in "RGB"], axis=-1)


def measure_levels(linear: np.ndarray) -> tuple[float, float]:
    """(black, white above black), linear, from the map averaged down to LEVELS_WIDTH."""
    factor = linear.shape[1] // LEVELS_WIDTH
    height = linear.shape[0] // factor
    small = linear.reshape(height, factor, LEVELS_WIDTH, factor, 3).mean(axis=(1, 3))
    luminance = small.mean(axis=-1)
    black = float(np.percentile(luminance, BLACK_PERCENTILE))
    white = float(np.percentile(luminance, WHITE_PERCENTILE)) - black
    print(f"black {black:.5f}  white {white + black:.5f} (linear)")
    return black, white


def tone_map(linear: np.ndarray, black: float, white: float) -> np.ndarray:
    luminance = linear.mean(axis=-1)
    # Scale each pixel by its luminance's change, so removing the floor does not shift colours.
    lifted = np.clip(luminance - black, 0, None)
    scale = np.divide(lifted, luminance, out=np.zeros_like(luminance), where=luminance > 0)
    level = lifted / white
    eased = level * level / (level + TOE) * (1 + TOE)
    eased = np.where(eased < SHOULDER, eased, SHOULDER + (1 - SHOULDER) * np.tanh((eased - SHOULDER) / (1 - SHOULDER)))
    scale *= np.divide(eased, level, out=np.zeros_like(level), where=level > 0)
    return np.clip(linear * scale[..., None] / white, 0, 1) ** (1 / GAMMA)


def gaussian_blur(linear: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian: wrapping in r.a. (columns), clamped at the poles (rows)."""
    radius = int(3 * sigma + 0.5)
    weights = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    weights /= weights.sum()
    across = np.zeros_like(linear)
    for offset, weight in zip(range(-radius, radius + 1), weights):
        across += weight * np.roll(linear, offset, axis=1)
    padded = np.pad(across, ((radius, radius), (0, 0), (0, 0)), mode="edge")
    del across
    blurred = np.zeros_like(linear)
    for start, weight in enumerate(weights):
        blurred += weight * padded[start : start + linear.shape[0]]
    return blurred


def denoise(linear: np.ndarray, black: float, white: float) -> np.ndarray:
    """The fine blur where the band is bright, the wide one where the light is near black, blended between."""
    fine = gaussian_blur(linear, FINE_SIGMA_PX)
    wide = gaussian_blur(linear, WIDE_SIGMA_PX)
    weight = np.clip((wide.mean(axis=-1) - black) / (FINE_ABOVE_BLACK * white), 0, 1)[..., None]
    fine -= wide
    fine *= weight
    fine += wide
    return fine


def tile_pixel_offsets() -> np.ndarray:
    """Each image pixel's nested HEALPix index within its tile, [row, column]: row u, column v, bits interleaved."""
    u, v = np.meshgrid(np.arange(TILE_PX, dtype=np.int64), np.arange(TILE_PX, dtype=np.int64), indexing="ij")
    sub = np.zeros_like(u)
    for bit in range(TILE_BITS):
        sub |= ((u >> bit) & 1) << (2 * bit)
        sub |= ((v >> bit) & 1) << (2 * bit + 1)
    return sub


def sample_tile(linear: np.ndarray, ipix: int, offsets: np.ndarray) -> np.ndarray:
    """The order-MAX_ORDER tile `ipix`, bilinear from the plate carree (r.a. 0 at the centre, increasing left)."""
    height, width = linear.shape[:2]
    nside = 2 ** (MAX_ORDER + TILE_BITS)
    ra, dec = hp.pix2ang(nside, ipix * 4**TILE_BITS + offsets, nest=True, lonlat=True)
    x = (width / 2 - ra / 360 * width - 0.5) % width
    y = np.clip(height / 2 - dec / 180 * height - 0.5, 0, height - 1)
    # A tiny negative x wraps to exactly `width` in floating point: the index wraps with it.
    x0 = np.floor(x).astype(np.int64) % width
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[..., None].astype(np.float32)
    fy = (y - y0)[..., None].astype(np.float32)
    x1 = (x0 + 1) % width
    y1 = np.minimum(y0 + 1, height - 1)
    top = linear[y0, x0] * (1 - fx) + linear[y0, x1] * fx
    bottom = linear[y1, x0] * (1 - fx) + linear[y1, x1] * fx
    return top * (1 - fy) + bottom * fy


def parent_tile(children: list[np.ndarray]) -> np.ndarray:
    """A tile from its four children (nested order 4p + i): child i holds u's top bit i & 1 and v's i >> 1."""
    half = TILE_PX // 2
    parent = np.empty((TILE_PX, TILE_PX, 3), dtype=np.float32)
    for i, child in enumerate(children):
        row, column = (i & 1) * half, (i >> 1) * half
        parent[row : row + half, column : column + half] = child.reshape(half, 2, half, 2, 3).mean(axis=(1, 3))
    return parent


def load_denoised() -> tuple[np.ndarray, float, float]:
    """(the source in linear light, denoised; black; white above black)."""
    linear = read_exr(cached_fetch(SOURCE_URL, "milkyway_2020_16k.exr", timeout=1800))
    print(f"source {linear.shape[1]}x{linear.shape[0]}, linear range {linear.min():.4f}..{linear.max():.4f}")
    black, white = measure_levels(linear)
    return denoise(linear, black, white), black, white


def save_tile(root: Path, order: int, ipix: int, display: np.ndarray) -> int:
    """Write one tile of display values 0..1 as its HiPS JPEG; its size in bytes."""
    path = tile_path(root, order, ipix)
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray((np.clip(display, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    image.save(path, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return path.stat().st_size


def write_tiles(root: Path, top_tile: Callable[[int], np.ndarray], to_display: Callable[[np.ndarray], np.ndarray]) -> None:
    """
    Every tile of orders 0 to MAX_ORDER under `root`, replacing what is there: `top_tile` makes each tile of
    MAX_ORDER, each lower order averages its four children in the same space, `to_display` turns a tile into
    display values 0..1 for the JPEG.
    """
    if root.exists():
        shutil.rmtree(root)
    sizes = {order: 0 for order in range(MAX_ORDER + 1)}
    # One order-0 tile at a time: its order-2 descendants as float are about 50 MB.
    per_base = 4**MAX_ORDER
    for base in range(12):
        level = [top_tile(base * per_base + k) for k in range(per_base)]
        for order in range(MAX_ORDER, -1, -1):
            first = base * 4**order
            for k, tile in enumerate(level):
                sizes[order] += save_tile(root, order, first + k, to_display(tile))
            if order > 0:
                level = [parent_tile(level[4 * k : 4 * k + 4]) for k in range(len(level) // 4)]
        print(f"order-0 tile {base} done")
    for order, size in sizes.items():
        print(f"order {order}: {12 * 4**order} tiles, {size / 2**20:.1f} MB")
    print(f"wrote {root.relative_to(REPO_ROOT)} ({sum(sizes.values()) / 2**20:.1f} MB)")


def main() -> None:
    linear, black, white = load_denoised()
    offsets = tile_pixel_offsets()
    write_tiles(OUTPUT, lambda ipix: sample_tile(linear, ipix, offsets), lambda tile: tone_map(tile, black, white))


if __name__ == "__main__":
    main()
