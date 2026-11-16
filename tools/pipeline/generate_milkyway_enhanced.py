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

- Galaxies: Gaia records only the stars it resolves, so Andromeda and
  the other bright galaxies are all but missing from the source. Every
  galaxy in the Updated Nearby Galaxy Catalog (Karachentsev et al. 2013)
  big enough to resolve here and bright enough to show on a plate is cut
  from the Digitized Sky Survey's colour tiles - the same HEALPix tiles at
  the same order, pixel for pixel - with the plate's sky measured around
  it and taken off, stretched, and screened over the starlight. Galaxies
  beyond the catalogue's 11 Mpc (M87, M104 just inside it) are under 8'.

Every step is a function of position on the sky, applied tile by tile,
so no seam can open between tiles. Lower orders average their children
after the finish, in display values.

Usage (the venv of generate_milkyway.py, plus astropy for the FITS map):
    tools/pipeline/.cache/venv/bin/pip install OpenEXR numpy pillow healpy astropy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_milkyway_enhanced.py   # about four minutes
"""

import functools
import math
from collections import defaultdict
from dataclasses import dataclass

import healpy as hp
import numpy as np
from PIL import Image

from fetch_cache import cached_fetch

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
from sky_catalog_support import number, sexagesimal_dec, sexagesimal_ra, vizier_rows

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
# Galaxies, from the DSS colour tiles at MAX_ORDER, which share these tiles' layout (test_milkyway.py checks it).
DSS_COLOR_BASE = "https://cdn.skies.esac.esa.int/DSSColor"
# Diameters (a26, the 26.5 mag/arcsec2 isophote): 8' is five tile pixels. Above 300' are the Magellanic Clouds and
# the Sagittarius dwarf, which the Gaia map already resolves into stars.
GALAXY_MIN_ARCMIN = 8.0
GALAXY_MAX_ARCMIN = 300.0
# Mean B surface brightness inside a26, mag/arcsec2: the dwarf spheroidals (Sculptor, Draco, 26.5-27.5) are star
# fields on a plate, not galaxies; the spirals, Centaurus A and Fornax are brighter than this.
GALAXY_MAX_SURFACE_MAG = 25.5
# The cut-out, in diameters from the centre: whole to CORE, feathered to nothing over FEATHER beyond.
GALAXY_CORE = 0.5
GALAXY_FEATHER = 0.15
# The plate's sky, measured as the median over this ring (in diameters), plus FLOOR for its grain.
GALAXY_SKY_RING = (0.8, 1.4)
GALAXY_FLOOR = 4 / 255
# Light above the sky, stretched as 1 - exp(-GAIN * light): the discs show, the cores roll off short of white.
GALAXY_GAIN = 4.0
# A saturated star on a plate prints as a dark ring: any pixel darker than the median of this square is lifted to it.
PLATE_HOLE_PX = 5


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
    galactic = tile_vectors(ipix, offsets) @ ICRS_TO_GALACTIC.T
    theta, phi = hp.vec2ang(galactic.reshape(-1, 3))
    return hp.get_interp_val(values, theta, phi, nest=nest).reshape(offsets.shape)


@dataclass(frozen=True)
class Galaxy:
    name: str
    centre: np.ndarray  # ICRS unit vector
    diameter_deg: float
    sky: np.ndarray  # the plate's RGB around it, 0-1


def tile_vectors(ipix: int, offsets: np.ndarray) -> np.ndarray:
    """ICRS unit vector of each pixel of order-MAX_ORDER tile `ipix`."""
    nside = 2 ** (MAX_ORDER + TILE_BITS)
    return np.stack(hp.pix2vec(nside, ipix * 4**TILE_BITS + offsets, nest=True), axis=-1)


@functools.cache
def dss_tile(ipix: int) -> np.ndarray:
    path = cached_fetch(f"{DSS_COLOR_BASE}/Norder{MAX_ORDER}/Dir0/Npix{ipix}.jpg", f"hips/DSSColor-{MAX_ORDER}-{ipix}.jpg")
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255


def dss_at(sub_pixels: np.ndarray) -> np.ndarray:
    """DSS colour at HEALPix pixels of order MAX_ORDER + TILE_BITS: row u from the even bits, column v from the odd."""
    tiles, sub = np.divmod(sub_pixels, 4**TILE_BITS)
    u = sum(((sub >> (2 * bit)) & 1) << bit for bit in range(TILE_BITS))
    v = sum(((sub >> (2 * bit + 1)) & 1) << bit for bit in range(TILE_BITS))
    out = np.empty((len(sub_pixels), 3), dtype=np.float32)
    for tile in np.unique(tiles):
        here = tiles == tile
        out[here] = dss_tile(int(tile))[u[here], v[here]]
    return out


def plate_sky(centre: np.ndarray, diameter_deg: float) -> np.ndarray:
    """Median DSS colour over the ring around a galaxy: one value for the whole galaxy, so no tile edge shows in it."""
    nside = 2 ** (MAX_ORDER + TILE_BITS)
    inner, outer = (math.radians(r * diameter_deg) for r in GALAXY_SKY_RING)
    ring = np.setdiff1d(hp.query_disc(nside, centre, outer, nest=True), hp.query_disc(nside, centre, inner, nest=True))
    return np.median(dss_at(ring), axis=0)


def discernible_galaxies() -> list[Galaxy]:
    rows = vizier_rows("J/AJ/145/101/catalog", "karachentsev_ungc.tsv", "-out=Name,RAJ2000,DEJ2000,a26,Bmag,Dist")
    galaxies = []
    for row in rows:
        diameter, b_mag = number(row["a26"]), number(row["Bmag"])
        if diameter is None or b_mag is None or not row["RAJ2000"] or not GALAXY_MIN_ARCMIN <= diameter <= GALAXY_MAX_ARCMIN:
            continue
        surface_mag = b_mag + 2.5 * math.log10(math.pi * (diameter * 30) ** 2)
        if surface_mag > GALAXY_MAX_SURFACE_MAG:
            continue
        centre = np.array(hp.ang2vec(sexagesimal_ra(row["RAJ2000"]), sexagesimal_dec(row["DEJ2000"]), lonlat=True))
        galaxies.append(Galaxy(row["Name"], centre, diameter / 60, plate_sky(centre, diameter / 60)))
    print(f"{len(galaxies)} galaxies: {', '.join(g.name for g in galaxies)}")
    return galaxies


def galaxies_by_tile(galaxies: list[Galaxy]) -> dict[int, list[Galaxy]]:
    """The order-MAX_ORDER tiles each galaxy's cut-out touches."""
    by_tile: dict[int, list[Galaxy]] = defaultdict(list)
    for galaxy in galaxies:
        radius = math.radians((GALAXY_CORE + GALAXY_FEATHER) * galaxy.diameter_deg)
        for tile in hp.query_disc(2**MAX_ORDER, galaxy.centre, radius, inclusive=True, nest=True):
            by_tile[int(tile)].append(galaxy)
    return by_tile


def fill_plate_holes(light: np.ndarray) -> np.ndarray:
    """Each pixel at least the median of the PLATE_HOLE_PX square around it: holes filled, bright detail kept."""
    half = PLATE_HOLE_PX // 2
    padded = np.pad(light, ((half, half), (half, half), (0, 0)), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, (PLATE_HOLE_PX, PLATE_HOLE_PX), axis=(0, 1))
    return np.maximum(light, np.median(windows, axis=(-2, -1)))


def galaxy_light(ipix: int, galaxies: list[Galaxy], offsets: np.ndarray) -> np.ndarray:
    """The galaxies' own light over tile `ipix`, display values; where cut-outs overlap, the sky of the one nearer its own centre wins."""
    vectors = tile_vectors(ipix, offsets)
    weight = np.zeros(offsets.shape, dtype=np.float32)
    sky = np.zeros((*offsets.shape, 3), dtype=np.float32)
    for galaxy in galaxies:
        reach = np.degrees(np.arccos(np.clip(vectors @ galaxy.centre, -1, 1))) / galaxy.diameter_deg
        edge = np.clip((GALAXY_CORE + GALAXY_FEATHER - reach) / GALAXY_FEATHER, 0, 1)
        mine = edge * edge * (3 - 2 * edge)
        nearer = mine > weight
        weight[nearer] = mine[nearer]
        sky[nearer] = galaxy.sky
    light = fill_plate_holes(np.clip(dss_tile(ipix) - sky - GALAXY_FLOOR, 0, None))
    return (1 - np.exp(-GALAXY_GAIN * light)) * weight[..., None]


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
    galaxies = galaxies_by_tile(discernible_galaxies())
    offsets = tile_pixel_offsets()

    def top_tile(ipix: int) -> np.ndarray:
        display = tone_map(sample_tile(linear, ipix, offsets), black, white)
        structure_tile = sample_tile(structure, ipix, offsets)
        finished = finish(display, structure_tile, sample_tile(surround, ipix, offsets), halpha_at(halpha, ipix, offsets))
        if ipix not in galaxies:
            return finished
        # Screen blend, as for the hydrogen.
        return 1 - (1 - finished) * (1 - galaxy_light(ipix, galaxies[ipix], offsets))

    write_tiles(OUTPUT, top_tile, lambda tile: tile)


if __name__ == "__main__":
    main()
