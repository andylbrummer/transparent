#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the Milky Way, enhanced - the sky
as an astronomy book prints it.

Writes app/public/sky/milkyway-enhanced/Norder{k}/Dir0/Npix{n}.jpg, the
same HiPS tiles as generate_milkyway.py (orders 0 to 2, same layout, same
16k Deep Star Map source), finished for looks rather than for measure:

- Colour noise: each pixel keeps its own brightness but takes its colour
  from the sky a few arc minutes around it, so raising the saturation
  brings out the star clouds' colours, not the speckle of single pixels.
- Local contrast: the sky's structure a few arc minutes across is pushed
  away from the mean of the sky around it (a Gaussian about a degree
  wide), so dust lanes cut darker and star clouds stand out - the unsharp
  mask a photographer runs on a Milky Way mosaic. Single-pixel grain is
  finer than the structure and is not pushed with it.
- Colour: saturation is raised, so the star clouds' own colours read -
  the old, yellow bulge against the bluer clouds of Cygnus and Carina.
- Glowing gas: Gaia sees only stars, not the hydrogen they light. The
  Finkbeiner (2003) all-sky H-alpha map (VTSS, SHASSA, WHAM, 6'; LAMBDA,
  NASA; public domain) is laid over the starlight in the red-magenta of
  H-alpha on colour film: Orion and Barnard's Loop, the Gum Nebula,
  Carina, Cygnus and the North America Nebula. At 6' it is soft beside
  the starlight's 1.7', as nebulae are.

Every step is a function of position on the sky, applied tile by tile,
so no seam can open between tiles. Lower orders average their children
after the finish, in display values.

Usage (the venv of generate_milkyway.py, plus astropy for the FITS map):
    tools/pipeline/.cache/venv/bin/pip install OpenEXR numpy pillow healpy astropy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_milkyway_enhanced.py   # about four minutes
"""

import healpy as hp
import numpy as np

from generate_milkyway import (
    LEVELS_WIDTH,
    MAX_ORDER,
    REPO_ROOT,
    TILE_BITS,
    gaussian_blur,
    load_denoised,
    sample_tile,
    tile_pixel_offsets,
    tone_map,
    write_tiles,
)
from generate_skymaps import ICRS_TO_GALACTIC, asinh_scale, lambda_file, read_healpix

OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "milkyway-enhanced"
HALPHA_FILE = "foregrounds/halpha/lambda_halpha_fwhm06_0512.fits"

# Colour noise: a pixel's colour is the mean over a Gaussian this wide, in source pixels (3 px there is 4').
CHROMA_SIGMA_PX = 3.0
# Local contrast pushes the sky's structure - its brightness over a Gaussian 1.5 px wide on an 8192-wide
# reduction, 4' - away from the surround, a Gaussian 5 px wide on the LEVELS_WIDTH reduction, 53'. Finer than
# the structure is single-pixel grain, which passes through unpushed.
STRUCTURE_WIDTH = 8192
STRUCTURE_SIGMA_PX = 1.5
SURROUND_SIGMA_PX = 5.0
# How far the structure is pushed from its surround: 0 leaves it, 1 doubles its difference.
LOCAL_CONTRAST = 0.8
# Saturation: 1 leaves colours as Gaia's star colours make them.
SATURATION = 1.7
# H-alpha, Rayleighs: none below FLOOR (the faint glow that fills whole constellations), soft from there, full at
# FULL; then raised to CURVE, so the nebulae stand out as knots and filaments rather than a red wash.
HALPHA_FLOOR_R = 3.0
HALPHA_SOFT_R = 12.0
HALPHA_FULL_R = 800.0
HALPHA_CURVE = 1.4
# H-alpha on colour film: deep red, a touch of magenta from H-beta.
HALPHA_COLOUR = np.array([1.0, 0.12, 0.2], dtype=np.float32)
HALPHA_GAIN = 0.8


def smooth_colour(linear: np.ndarray) -> np.ndarray:
    """Each pixel's own brightness in the colour of its neighbourhood, in place: chroma denoising."""
    colour = gaussian_blur(linear, CHROMA_SIGMA_PX)
    luminance = linear.mean(axis=-1, keepdims=True)
    smoothed = colour.mean(axis=-1, keepdims=True)
    colour *= np.divide(luminance, smoothed, out=np.zeros_like(luminance), where=smoothed > 0)
    linear[...] = colour
    return linear


def brightness_map(linear: np.ndarray, black: float, white: float, width: int, sigma: float) -> np.ndarray:
    """Display brightness averaged over a Gaussian `sigma` pixels wide, as a `width`-wide plate carree with one channel."""
    factor = linear.shape[1] // width
    height = linear.shape[0] // factor
    small = linear.reshape(height, factor, width, factor, 3).mean(axis=(1, 3))
    brightness = tone_map(small, black, white).mean(axis=-1, keepdims=True)
    return gaussian_blur(brightness, sigma)


def halpha_rayleighs() -> tuple[np.ndarray, bool]:
    values, nest = read_healpix(lambda_file(HALPHA_FILE))
    return np.nan_to_num(values, nan=0.0), nest


def halpha_at(halpha: tuple[np.ndarray, bool], ipix: int, offsets: np.ndarray) -> np.ndarray:
    """H-alpha, Rayleighs, at each pixel of order-MAX_ORDER tile `ipix` (the map is galactic, the tiles ICRS)."""
    values, nest = halpha
    nside = 2 ** (MAX_ORDER + TILE_BITS)
    icrs = np.stack(hp.pix2vec(nside, ipix * 4**TILE_BITS + offsets, nest=True), axis=-1)
    galactic = icrs @ ICRS_TO_GALACTIC.T
    theta, phi = hp.vec2ang(galactic.reshape(-1, 3))
    return hp.get_interp_val(values, theta, phi, nest=nest).reshape(offsets.shape)


def finish(display: np.ndarray, structure: np.ndarray, surround: np.ndarray, rayleighs: np.ndarray) -> np.ndarray:
    """A tile of tone-mapped starlight, finished: local contrast, saturation, then the glowing hydrogen."""
    brightness = display.mean(axis=-1, keepdims=True)
    pushed = np.clip(brightness + LOCAL_CONTRAST * (structure - surround), 0, None)
    scaled = display * np.divide(pushed, brightness, out=np.zeros_like(brightness), where=brightness > 0)
    saturated = np.clip(pushed + SATURATION * (scaled - pushed), 0, 1)
    glow = (asinh_scale(rayleighs, HALPHA_FLOOR_R, HALPHA_SOFT_R, HALPHA_FULL_R).clip(0, 1) ** HALPHA_CURVE).astype(np.float32)
    # Screen blend: light added to light, never past white.
    return 1 - (1 - saturated) * (1 - HALPHA_GAIN * glow[..., None] * HALPHA_COLOUR)


def main() -> None:
    linear, black, white = load_denoised()
    smooth_colour(linear)
    structure = brightness_map(linear, black, white, STRUCTURE_WIDTH, STRUCTURE_SIGMA_PX)
    surround = brightness_map(linear, black, white, LEVELS_WIDTH, SURROUND_SIGMA_PX)
    halpha = halpha_rayleighs()
    offsets = tile_pixel_offsets()

    def top_tile(ipix: int) -> np.ndarray:
        display = tone_map(sample_tile(linear, ipix, offsets), black, white)
        structure_tile = sample_tile(structure, ipix, offsets)
        return finish(display, structure_tile, sample_tile(surround, ipix, offsets), halpha_at(halpha, ipix, offsets))

    write_tiles(OUTPUT, top_tile, lambda tile: tile)


if __name__ == "__main__":
    main()
