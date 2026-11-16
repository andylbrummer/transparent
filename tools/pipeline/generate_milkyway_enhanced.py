#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the Milky Way, enhanced - the sky
as an astronomy book prints it.

Writes app/public/sky/milkyway-enhanced/Norder{k}/Dir{d}/Npix{n}.jpg, the
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
- Close-ups: beyond order 2, tiles are written only around the galaxies,
  each down to the order where it is about a thousand pixels across (at
  most order 8, 1.6" a pixel, the plates' own sharpness). galaxies.json
  lists them, with the galaxies' names for the sky's labels; the app asks
  for no other deep tile and draws the sky elsewhere from order 2.

Every step is a function of position on the sky, applied tile by tile,
so no seam can open between tiles. Lower orders average their children
after the finish, in display values.

Usage (the venv of generate_milkyway.py, plus astropy for the FITS map):
    tools/pipeline/.cache/venv/bin/pip install OpenEXR numpy pillow healpy astropy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_milkyway_enhanced.py   # about four minutes
"""

import csv
import functools
import json
import math
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
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
    TILE_PX,
    gaussian_blur,
    load_denoised,
    sample_tile,
    save_tile,
    tile_pixel_offsets,
    tone_map,
    write_tiles,
)
from generate_deepsky import DSO_PREFERRED_NAME, OPENNGC_URL, catalogue_name
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
# Light above the sky, lifted as (1 - exp(-GAIN * light)) / (1 - exp(-GAIN)): the faint discs show from afar, and
# close up the bright ones keep their arms and dust lanes rather than burning to white.
GALAXY_GAIN = 2.0
# A saturated star on a plate prints as a dark ring: any pixel darker than the median of this square is lifted to it.
PLATE_HOLE_PX = 5
# Close-ups: each galaxy is written deeper than the whole sky, down to the shallowest order at which it is CLOSEUP_PX
# across - a phone screen's height or more - but no deeper than CLOSEUP_MAX_ORDER: DSS goes to order 9 (0.8" a
# pixel), but its plates resolve about 2", so order 8 (1.6") holds all the detail there is.
CLOSEUP_PX = 1024
CLOSEUP_MAX_ORDER = 8
# The side of an order-0 tile, degrees.
ORDER0_DEG = math.degrees(math.sqrt(math.pi / 3))
# The galaxies' names and positions, and which tiles exist beyond MAX_ORDER: the app asks only for those.
GALAXIES_FILE = OUTPUT / "galaxies.json"
DSS_FETCH_THREADS = 8
# Names for the labels where neither catalogue has the usual one: the UNGC's short forms, and NGC 253, whose
# common names in OpenNGC are the Sculptor Filament (a different thing) and the Silver Coin.
GALAXY_LABELS = {
    "HolmII": "Holmberg II",
    "LeoI": "Leo I",
    "Fornax": "Fornax Dwarf",
    "NGC0253": "Sculptor Galaxy",
}


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
    galactic = tile_vectors(MAX_ORDER, ipix, offsets) @ ICRS_TO_GALACTIC.T
    theta, phi = hp.vec2ang(galactic.reshape(-1, 3))
    return hp.get_interp_val(values, theta, phi, nest=nest).reshape(offsets.shape)


@dataclass(frozen=True)
class Galaxy:
    name: str
    label: str  # as the sky's names give it: 'M31 Andromeda Galaxy', a common name, or 'NGC 253'
    centre: np.ndarray  # ICRS unit vector
    diameter_deg: float
    sky: np.ndarray  # the plate's RGB around it, 0-1


def tile_vectors(order: int, ipix: int, offsets: np.ndarray) -> np.ndarray:
    """ICRS unit vector of each pixel of tile `ipix` of `order`."""
    nside = 2 ** (order + TILE_BITS)
    return np.stack(hp.pix2vec(nside, ipix * 4**TILE_BITS + offsets, nest=True), axis=-1)


def dss_tile_path(order: int, ipix: int):
    return cached_fetch(f"{DSS_COLOR_BASE}/Norder{order}/Dir{ipix // 10000 * 10000}/Npix{ipix}.jpg", f"hips/DSSColor-{order}-{ipix}.jpg")


@functools.cache
def dss_tile(order: int, ipix: int) -> np.ndarray:
    return np.asarray(Image.open(dss_tile_path(order, ipix)).convert("RGB"), dtype=np.float32) / 255


def deinterleave(local: np.ndarray | int, bits: int) -> tuple:
    """A nested pixel's place within an ancestor `bits` orders up: row u from the even bits, column v from the odd."""
    u = sum(((local >> (2 * bit)) & 1) << bit for bit in range(bits))
    v = sum(((local >> (2 * bit + 1)) & 1) << bit for bit in range(bits))
    return u, v


def dss_at(sub_pixels: np.ndarray) -> np.ndarray:
    """DSS colour at HEALPix pixels of order MAX_ORDER + TILE_BITS."""
    tiles, sub = np.divmod(sub_pixels, 4**TILE_BITS)
    u, v = deinterleave(sub, TILE_BITS)
    out = np.empty((len(sub_pixels), 3), dtype=np.float32)
    for tile in np.unique(tiles):
        here = tiles == tile
        out[here] = dss_tile(MAX_ORDER, int(tile))[u[here], v[here]]
    return out


def plate_sky(centre: np.ndarray, diameter_deg: float) -> np.ndarray:
    """Median DSS colour over the ring around a galaxy: one value for the whole galaxy, so no tile edge shows in it."""
    nside = 2 ** (MAX_ORDER + TILE_BITS)
    inner, outer = (math.radians(r * diameter_deg) for r in GALAXY_SKY_RING)
    ring = np.setdiff1d(hp.query_disc(nside, centre, outer, nest=True), hp.query_disc(nside, centre, inner, nest=True))
    return np.median(dss_at(ring), axis=0)


def openngc_labels() -> dict[str, str]:
    """OpenNGC's objects named as the deep-sky layer names them: 'M31 Andromeda Galaxy', else a common name, else 'NGC 253'."""
    labels = {}
    for file in ("NGC.csv", "addendum.csv"):
        path = cached_fetch(OPENNGC_URL + file, f"deepsky/openngc_{file}")
        for row in csv.DictReader(path.read_text(encoding="utf-8").splitlines(), delimiter=";"):
            names = [name.strip() for name in row["Common names"].split(",")] if row["Common names"] else [""]
            common = names[DSO_PREFERRED_NAME.get(row["Name"], 0)]
            if row["M"]:
                # The UNGC names some of Messier's galaxies by his number: MESSIER031.
                labels[row["Name"]] = labels[f"MESSIER{int(row['M']):03d}"] = f"M{int(row['M'])} {common}".strip()
            else:
                labels[row["Name"]] = common or catalogue_name(row["Name"])
    return labels


def discernible_galaxies() -> list[Galaxy]:
    rows = vizier_rows("J/AJ/145/101/catalog", "karachentsev_ungc.tsv", "-out=Name,RAJ2000,DEJ2000,a26,Bmag,Dist")
    labels = openngc_labels()
    galaxies = []
    for row in rows:
        diameter, b_mag = number(row["a26"]), number(row["Bmag"])
        if diameter is None or b_mag is None or not row["RAJ2000"] or not GALAXY_MIN_ARCMIN <= diameter <= GALAXY_MAX_ARCMIN:
            continue
        surface_mag = b_mag + 2.5 * math.log10(math.pi * (diameter * 30) ** 2)
        if surface_mag > GALAXY_MAX_SURFACE_MAG:
            continue
        centre = np.array(hp.ang2vec(sexagesimal_ra(row["RAJ2000"]), sexagesimal_dec(row["DEJ2000"]), lonlat=True))
        label = GALAXY_LABELS.get(row["Name"]) or labels.get(row["Name"]) or catalogue_name(row["Name"])
        galaxies.append(Galaxy(row["Name"], label, centre, diameter / 60, plate_sky(centre, diameter / 60)))
    print(f"{len(galaxies)} galaxies: {', '.join(g.label for g in galaxies)}")
    return galaxies


def touched_tiles(galaxy: Galaxy, order: int) -> np.ndarray:
    """The tiles of `order` the galaxy's cut-out touches."""
    radius = math.radians((GALAXY_CORE + GALAXY_FEATHER) * galaxy.diameter_deg)
    return hp.query_disc(2**order, galaxy.centre, radius, inclusive=True, nest=True)


def galaxies_by_tile(galaxies: list[Galaxy], order: int) -> dict[int, list[Galaxy]]:
    by_tile: dict[int, list[Galaxy]] = defaultdict(list)
    for galaxy in galaxies:
        for tile in touched_tiles(galaxy, order):
            by_tile[int(tile)].append(galaxy)
    return by_tile


def closeup_order(galaxy: Galaxy) -> int:
    """The shallowest order at which the galaxy is CLOSEUP_PX across, beyond MAX_ORDER and at most CLOSEUP_MAX_ORDER."""
    wanted = math.ceil(math.log2(CLOSEUP_PX * ORDER0_DEG / (TILE_PX * galaxy.diameter_deg)))
    return min(CLOSEUP_MAX_ORDER, max(MAX_ORDER + 1, wanted))


def closeup_tiles(galaxies: list[Galaxy]) -> dict[int, list[int]]:
    """Per order beyond MAX_ORDER, the tiles written: each galaxy's, down to its close-up order."""
    tiles: dict[int, set[int]] = defaultdict(set)
    for galaxy in galaxies:
        for order in range(MAX_ORDER + 1, closeup_order(galaxy) + 1):
            tiles[order].update(int(tile) for tile in touched_tiles(galaxy, order))
    return {order: sorted(tiles[order]) for order in sorted(tiles)}


def fill_plate_holes(light: np.ndarray) -> np.ndarray:
    """Each pixel at least the median of the PLATE_HOLE_PX square around it: holes filled, bright detail kept."""
    half = PLATE_HOLE_PX // 2
    padded = np.pad(light, ((half, half), (half, half), (0, 0)), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, (PLATE_HOLE_PX, PLATE_HOLE_PX), axis=(0, 1))
    return np.maximum(light, np.median(windows, axis=(-2, -1)))


def galaxy_light(order: int, ipix: int, galaxies: list[Galaxy], offsets: np.ndarray) -> np.ndarray:
    """
    The galaxies' own light over tile `ipix` of `order`, display values. Where cut-outs overlap, the darkest of their
    skies is taken off: M32's ring of sky lies on Andromeda's disc, and taking that off would cut a hole in Andromeda.
    """
    vectors = tile_vectors(order, ipix, offsets)
    weight = np.zeros(offsets.shape, dtype=np.float32)
    sky = np.ones((*offsets.shape, 3), dtype=np.float32)
    for galaxy in galaxies:
        reach = np.degrees(np.arccos(np.clip(vectors @ galaxy.centre, -1, 1))) / galaxy.diameter_deg
        edge = np.clip((GALAXY_CORE + GALAXY_FEATHER - reach) / GALAXY_FEATHER, 0, 1)
        mine = edge * edge * (3 - 2 * edge)
        weight = np.maximum(weight, mine)
        inside = mine > 0
        sky[inside] = np.minimum(sky[inside], galaxy.sky)
    # The light above the plate's sky, back to the full range, then lifted: white stays white.
    light = np.clip((dss_tile(order, ipix) - sky - GALAXY_FLOOR) / (1 - sky - GALAXY_FLOOR), 0, 1)
    # Outside every cut-out there is no sky to take off: nothing there for the hole filling to spread inward.
    light[weight == 0] = 0
    light = fill_plate_holes(light)
    return (1 - np.exp(-GALAXY_GAIN * light)) / (1 - math.exp(-GALAXY_GAIN)) * weight[..., None]


def screen(under: np.ndarray, over: np.ndarray) -> np.ndarray:
    """Light added to light, never past white."""
    return 1 - (1 - under) * (1 - over)


def window_of_ancestor(tile: np.ndarray, order: int, ipix: int) -> np.ndarray:
    """
    The part of order-MAX_ORDER `tile` under deeper tile `ipix` of `order`, at full tile size, sampled as the app
    draws a deep tile it has not got from that ancestor: bilinear between texel centres, clamped at the edge.
    """
    depth = order - MAX_ORDER
    u0, v0 = deinterleave(ipix % 4**depth, depth)
    scale = 2**depth
    within = (np.arange(TILE_PX) + 0.5) / scale - 0.5

    def taps(start: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        x = start * TILE_PX / scale + within
        low = np.floor(x).astype(np.int64)
        t = (x - low).astype(np.float32)
        return np.clip(low, 0, TILE_PX - 1), np.clip(low + 1, 0, TILE_PX - 1), t

    r0, r1, tr = taps(u0)
    c0, c1, tc = taps(v0)
    rows = tile[r0] * (1 - tr)[:, None, None] + tile[r1] * tr[:, None, None]
    return rows[:, c0] * (1 - tc)[None, :, None] + rows[:, c1] * tc[None, :, None]


def write_closeups(galaxies: list[Galaxy], backgrounds: dict[int, np.ndarray], offsets: np.ndarray) -> dict[int, list[int]]:
    """
    The close-up tiles: the finished sky of their order-MAX_ORDER ancestor before its galaxies, as the app would
    draw it there, with the galaxies screened over it at the DSS tiles' own order. Outside the cut-outs a close-up is
    then its ancestor, so none shows an edge against the sky drawn from the ancestor beside it.
    """
    tiles = closeup_tiles(galaxies)
    wanted = [(order, ipix) for order, pixels in tiles.items() for ipix in pixels]
    with ThreadPoolExecutor(DSS_FETCH_THREADS) as pool:
        list(pool.map(lambda tile: dss_tile_path(*tile), wanted))
    for order, pixels in tiles.items():
        here = galaxies_by_tile(galaxies, order)
        size = 0
        for ipix in pixels:
            ancestor = ipix >> (2 * (order - MAX_ORDER))
            under = window_of_ancestor(backgrounds[ancestor], order, ipix)
            size += save_tile(OUTPUT, order, ipix, screen(under, galaxy_light(order, ipix, here[ipix], offsets)))
        dss_tile.cache_clear()
        print(f"order {order}: {len(pixels)} close-up tiles, {size / 2**20:.1f} MB")
    return tiles


def finish(display: np.ndarray, structure: np.ndarray, surround: np.ndarray, rayleighs: np.ndarray) -> np.ndarray:
    """A tile of tone-mapped starlight, finished: local contrast, saturation, then the glowing hydrogen."""
    brightness = display.mean(axis=-1, keepdims=True)
    pushed = np.clip(brightness + LOCAL_CONTRAST * (structure - surround), 0, None)
    scaled = display * np.divide(pushed, brightness, out=np.zeros_like(brightness), where=brightness > 0)
    saturated = np.clip(pushed + SATURATION * (scaled - pushed), 0, 1)
    glow = (asinh_scale(rayleighs, HALPHA_FLOOR_R, HALPHA_SOFT_R, HALPHA_FULL_R).clip(0, 1) ** HALPHA_CURVE).astype(np.float32)
    return screen(saturated, HALPHA_GAIN * glow[..., None] * HALPHA_COLOUR)


def main() -> None:
    linear, black, white = load_denoised()
    smooth_colour(linear)
    structure = brightness_map(linear, black, white, STRUCTURE_WIDTH, STRUCTURE_SIGMA_PX)
    surround = brightness_map(linear, black, white, LEVELS_WIDTH, SURROUND_SIGMA_PX)
    halpha = halpha_rayleighs()
    galaxies = discernible_galaxies()
    by_tile = galaxies_by_tile(galaxies, MAX_ORDER)
    offsets = tile_pixel_offsets()
    # The finished sky under each galaxy before it is screened on: the close-ups are drawn over it.
    backgrounds: dict[int, np.ndarray] = {}

    def top_tile(ipix: int) -> np.ndarray:
        display = tone_map(sample_tile(linear, ipix, offsets), black, white)
        structure_tile = sample_tile(structure, ipix, offsets)
        finished = finish(display, structure_tile, sample_tile(surround, ipix, offsets), halpha_at(halpha, ipix, offsets))
        if ipix not in by_tile:
            return finished
        backgrounds[ipix] = finished
        return screen(finished, galaxy_light(MAX_ORDER, ipix, by_tile[ipix], offsets))

    write_tiles(OUTPUT, top_tile, lambda tile: tile)
    tiles = write_closeups(galaxies, backgrounds, offsets)
    GALAXIES_FILE.write_text(
        json.dumps(
            {
                "wholeSkyOrder": MAX_ORDER,
                "tiles": {str(order): pixels for order, pixels in tiles.items()},
                "galaxies": [
                    {
                        "label": galaxy.label,
                        "ra": round(float(np.degrees(np.arctan2(galaxy.centre[1], galaxy.centre[0])) % 360), 4),
                        "dec": round(float(np.degrees(np.arcsin(galaxy.centre[2]))), 4),
                        "diameterDeg": round(galaxy.diameter_deg, 4),
                    }
                    for galaxy in sorted(galaxies, key=lambda galaxy: -galaxy.diameter_deg)
                ],
            },
            separators=(",", ":"),
        )
    )
    print(f"wrote {GALAXIES_FILE.relative_to(REPO_ROOT)}: {sum(len(p) for p in tiles.values())} close-up tiles")


if __name__ == "__main__":
    main()
