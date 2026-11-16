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
- Nebulae: the bright and famous nebulae of OpenNGC, cut from the same
  plates the same way - but in the plane a plate is crowded with the stars
  the Gaia map and the app's own stars already show, so only the gas is
  laid on: the plate is opened (eroded, then dilated) along lines in eight
  directions, a minute of arc long, and the brightest of the eight kept.
  A star fits no such line and goes; a filament fits the one along it and
  stays. Stars brighter than about 7th magnitude leave a soft remnant, at
  the place the app draws the star. The gas is already in the sky, in the
  H-alpha glow, so a nebula is only in the close-ups, and the plate is not
  added to the glow there: the glow takes the plate's structure - the
  plate against itself seen from the whole-sky tile above.
- Close-ups: beyond order 2, tiles are written only around the galaxies
  and nebulae, each down to the order where it is about a thousand pixels
  across (at most order 8, 1.6" a pixel, the plates' own sharpness).
  cutouts.json lists them, with the objects' names for the sky's labels;
  the app asks for no other deep tile and draws the sky elsewhere from
  order 2. The plate's sky is measured at each order on the plate as it is
  drawn there: in the plane, at order 2 the unresolved stars are part of
  it, and at order 8, starless, the dark between them is.

Every step is a function of position on the sky, applied tile by tile,
so no seam can open between tiles. Lower orders average their children
after the finish, in display values.

Usage (the venv of generate_milkyway.py, plus astropy for the FITS map):
    tools/pipeline/.cache/venv/bin/pip install OpenEXR numpy pillow healpy astropy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_milkyway_enhanced.py   # about four minutes
"""

import csv
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
CUTOUT_CORE = 0.5
CUTOUT_FEATHER = 0.15
# The plate's sky, measured as the median over this ring (in diameters), plus FLOOR for its grain, sampled on the
# HEALPix pixels of SKY_SAMPLE_ORDER (0.9') or the tiles' own pixels where those are coarser.
PLATE_SKY_RING = (0.8, 1.4)
SKY_SAMPLE_ORDER = 12
PLATE_FLOOR = 4 / 255
# Light above the sky, lifted as (1 - exp(-GAIN * light)) / (1 - exp(-GAIN)): the faint discs show from afar, and
# close up the bright ones keep their arms and dust lanes rather than burning to white.
PLATE_GAIN = 2.0
# A saturated star on a plate prints as a dark ring: any pixel darker than the median of this square is lifted to it.
PLATE_HOLE_PX = 5
# Close-ups: each galaxy is written deeper than the whole sky, down to the shallowest order at which it is CLOSEUP_PX
# across - a phone screen's height or more - but no deeper than CLOSEUP_MAX_ORDER: DSS goes to order 9 (0.8" a
# pixel), but its plates resolve about 2", so order 8 (1.6") holds all the detail there is.
CLOSEUP_PX = 1024
CLOSEUP_MAX_ORDER = 8
# The side of an order-0 tile, degrees.
ORDER0_DEG = math.degrees(math.sqrt(math.pi / 3))
# The cut-outs' names and positions, and which tiles exist beyond MAX_ORDER: the app asks only for those.
CUTOUTS_FILE = OUTPUT / "cutouts.json"
DSS_FETCH_THREADS = 8
# Nebulae: OpenNGC's emission, reflection and planetary nebulae, supernova remnants and clusters in nebulosity
# that have a Messier number or a common name (or one below), MIN_ARCMIN across or more: from the Veil, 3.5 deg,
# to the Crab. Smaller ones (the Ring, 1.4') are a few pixels at the plates' own sharpness.
NEBULA_TYPES = ("HII", "EmN", "RfN", "Neb", "SNR", "Cl+N", "PN")
NEBULA_MIN_ARCMIN = 8.0
# Named parts of nebulae already cut, and clusters whose glow is faint beside their stars: their names would only
# crowd the bigger ones' (Rosette A and B, in the Rosette; the Swords, in Orion's; the omicron Persei cluster).
NEBULA_SKIPPED = {"NGC2237", "NGC2246", "NGC1980", "NGC1981", "IC0348"}
# Stars off the plate: the opening's line, in arc seconds - longer than a 9th-magnitude star's image, shorter than
# the Veil's filaments - at least 3 px, in this many directions.
STAR_LINE_ARCSEC = 60.0
STAR_LINE_DIRECTIONS = 8
# A nebula's structure: plate light below this is grain, not detail, and no pixel is lit past this many times its glow.
NEBULA_GRAIN = 0.05
NEBULA_DETAIL_MAX = 4.0
# Names for the labels where OpenNGC has no usual one: the UNGC's short forms; NGC 253, whose common names in
# OpenNGC are the Sculptor Filament (a different thing) and the Silver Coin; IC 434, the strip of glow the Horsehead
# is seen against; nebulae OpenNGC lists only as their clusters; and Gem A, the Jellyfish to observers.
PLATE_LABELS = {
    "HolmII": "Holmberg II",
    "LeoI": "Leo I",
    "Fornax": "Fornax Dwarf",
    "NGC0253": "Sculptor Galaxy",
    "IC0434": "Horsehead Nebula",
    "IC0443": "Jellyfish Nebula",
    "IC1805": "Heart Nebula",
    "IC1848": "Soul Nebula",
    "NGC0281": "Pacman Nebula",
    "NGC6334": "Cat's Paw Nebula",
    "IC2177": "Seagull Nebula",
    "NGC2359": "Thor's Helmet",
    "NGC6618": "M17 Omega Nebula",
    "IC4604": "Rho Ophiuchi Nebula",
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
class Cutout:
    """An object cut from the DSS plates: a galaxy, or a nebula."""

    name: str
    kind: str  # 'galaxy', or 'nebula': a nebula's plate is drawn starless
    label: str  # as the sky's names give it: 'M31 Andromeda Galaxy', a common name, or 'NGC 253'
    centre: np.ndarray  # ICRS unit vector
    diameter_deg: float


def tile_vectors(order: int, ipix: int, offsets: np.ndarray) -> np.ndarray:
    """ICRS unit vector of each pixel of tile `ipix` of `order`."""
    nside = 2 ** (order + TILE_BITS)
    return np.stack(hp.pix2vec(nside, ipix * 4**TILE_BITS + offsets, nest=True), axis=-1)


def dss_tile_path(order: int, ipix: int):
    return cached_fetch(f"{DSS_COLOR_BASE}/Norder{order}/Dir{ipix // 10000 * 10000}/Npix{ipix}.jpg", f"hips/DSSColor-{order}-{ipix}.jpg")


def fetch_dss_tiles(order: int, pixels) -> None:
    """Download the DSS tiles not yet cached, several at a time."""
    with ThreadPoolExecutor(DSS_FETCH_THREADS) as pool:
        list(pool.map(lambda ipix: dss_tile_path(order, int(ipix)), pixels))


def line_offsets(length: int, angle: float) -> list[tuple[int, int]]:
    """The (row, column) steps of a line `length` pixels long through a pixel, at `angle` from the rows."""
    steps = np.arange(-(length // 2), length // 2 + 1)
    return sorted(set(zip(np.round(steps * math.sin(angle)).astype(int).tolist(), np.round(steps * math.cos(angle)).astype(int).tolist())))


def along_line(image: np.ndarray, offsets: list[tuple[int, int]], extreme) -> np.ndarray:
    """Each pixel's minimum or maximum (`extreme`, np.minimum or np.maximum) over the line through it; edges repeat."""
    reach = max(max(abs(dy), abs(dx)) for dy, dx in offsets)
    padded = np.pad(image, ((reach, reach), (reach, reach), (0, 0)), mode="edge")
    rows, cols = image.shape[:2]
    shifted = [padded[reach + dy : reach + dy + rows, reach + dx : reach + dx + cols] for dy, dx in offsets]
    out = shifted[0].copy()
    for view in shifted[1:]:
        extreme(out, view, out=out)
    return out


def remove_stars(plate: np.ndarray, order: int) -> np.ndarray:
    """The plate opened along lines STAR_LINE_ARCSEC long in STAR_LINE_DIRECTIONS directions, the brightest kept."""
    arcsec_per_px = ORDER0_DEG * 3600 / (TILE_PX * 2**order)
    length = 2 * max(1, round(STAR_LINE_ARCSEC / arcsec_per_px / 2)) + 1
    starless = np.zeros_like(plate)
    for k in range(STAR_LINE_DIRECTIONS):
        offsets = line_offsets(length, k * math.pi / STAR_LINE_DIRECTIONS)
        np.maximum(starless, along_line(along_line(plate, offsets, np.minimum), offsets, np.maximum), out=starless)
    return starless


def plate_tile(order: int, ipix: int, starless: bool) -> np.ndarray:
    """DSS colour tile `ipix` of `order`, 0-1, its stars removed if `starless`."""
    plate = np.asarray(Image.open(dss_tile_path(order, ipix)).convert("RGB"), dtype=np.float32) / 255
    return remove_stars(plate, order) if starless else plate


def deinterleave(local: np.ndarray | int, bits: int) -> tuple:
    """A nested pixel's place within an ancestor `bits` orders up: row u from the even bits, column v from the odd."""
    u = sum(((local >> (2 * bit)) & 1) << bit for bit in range(bits))
    v = sum(((local >> (2 * bit + 1)) & 1) << bit for bit in range(bits))
    return u, v


def sky_ring(cutout: Cutout, order: int) -> np.ndarray:
    """Pixels of tiles of `order` around a cut-out, over PLATE_SKY_RING: one per pixel of SKY_SAMPLE_ORDER, or all."""
    sample = min(order + TILE_BITS, SKY_SAMPLE_ORDER)
    inner, outer = (math.radians(r * cutout.diameter_deg) for r in PLATE_SKY_RING)
    ring = np.setdiff1d(hp.query_disc(2**sample, cutout.centre, outer, nest=True), hp.query_disc(2**sample, cutout.centre, inner, nest=True))
    return ring << (2 * (order + TILE_BITS - sample))


def plate_skies(cutouts: list[Cutout], order: int) -> dict[str, np.ndarray]:
    """
    Each cut-out's sky at `order`: the median DSS colour over the ring around it, on the plate as it is drawn at that
    order. One value per cut-out and order, so no tile edge shows in it.
    """
    rings = {cutout.name: sky_ring(cutout, order) for cutout in cutouts}
    fetch_dss_tiles(order, np.unique(np.concatenate(list(rings.values())) >> (2 * TILE_BITS)))
    # Each plate tile is read once, for every ring that crosses it.
    crossing: dict[tuple[int, bool], list[Cutout]] = defaultdict(list)
    for cutout in cutouts:
        for tile in np.unique(rings[cutout.name] >> (2 * TILE_BITS)):
            crossing[(int(tile), cutout.kind == "nebula")].append(cutout)
    colours = {cutout.name: np.empty((len(rings[cutout.name]), 3), dtype=np.float32) for cutout in cutouts}
    for (tile, starless), crossers in crossing.items():
        plate = plate_tile(order, tile, starless)
        for cutout in crossers:
            tile_of, local = np.divmod(rings[cutout.name], 4**TILE_BITS)
            here = tile_of == tile
            u, v = deinterleave(local[here], TILE_BITS)
            colours[cutout.name][here] = plate[u, v]
    return {name: np.median(ring, axis=0) for name, ring in colours.items()}


def openngc_rows() -> list[dict[str, str]]:
    rows = []
    for file in ("NGC.csv", "addendum.csv"):
        path = cached_fetch(OPENNGC_URL + file, f"deepsky/openngc_{file}")
        rows += csv.DictReader(path.read_text(encoding="utf-8").splitlines(), delimiter=";")
    return rows


def openngc_labels() -> dict[str, str]:
    """OpenNGC's objects named as the deep-sky layer names them: 'M31 Andromeda Galaxy', else a common name, else 'NGC 253'."""
    labels = {}
    for row in openngc_rows():
        names = [name.strip().removeprefix("the ") for name in row["Common names"].split(",")] if row["Common names"] else [""]
        common = names[DSO_PREFERRED_NAME.get(row["Name"], 0)]
        if row["M"]:
            # The UNGC names some of Messier's galaxies by his number: MESSIER031.
            labels[row["Name"]] = labels[f"MESSIER{int(row['M']):03d}"] = f"M{int(row['M'])} {common}".strip()
        else:
            labels[row["Name"]] = common or catalogue_name(row["Name"])
    return labels


def discernible_galaxies(labels: dict[str, str]) -> list[Cutout]:
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
        label = PLATE_LABELS.get(row["Name"]) or labels.get(row["Name"]) or catalogue_name(row["Name"])
        galaxies.append(Cutout(row["Name"], "galaxy", label, centre, diameter / 60))
    print(f"{len(galaxies)} galaxies: {', '.join(g.label for g in galaxies)}")
    return galaxies


def discernible_nebulae(labels: dict[str, str]) -> list[Cutout]:
    nebulae: dict[str, Cutout] = {}
    for row in openngc_rows():
        size = number(row["MajAx"])
        named = row["M"] or row["Common names"] or row["Name"] in PLATE_LABELS
        if row["Type"] not in NEBULA_TYPES or not named or size is None or size < NEBULA_MIN_ARCMIN or row["Name"] in NEBULA_SKIPPED:
            continue
        label = PLATE_LABELS.get(row["Name"]) or labels[row["Name"]]
        centre = np.array(hp.ang2vec(sexagesimal_ra(row["RA"]), sexagesimal_dec(row["Dec"]), lonlat=True))
        # One cut-out per name, the larger: OpenNGC has the Eastern Veil twice, as NGC 6992 and NGC 6995 within it.
        if label not in nebulae or nebulae[label].diameter_deg < size / 60:
            nebulae[label] = Cutout(row["Name"], "nebula", label, centre, size / 60)
    print(f"{len(nebulae)} nebulae: {', '.join(nebulae)}")
    return list(nebulae.values())


def touched_tiles(cutout: Cutout, order: int) -> np.ndarray:
    """The tiles of `order` a cut-out touches."""
    radius = math.radians((CUTOUT_CORE + CUTOUT_FEATHER) * cutout.diameter_deg)
    return hp.query_disc(2**order, cutout.centre, radius, inclusive=True, nest=True)


def cutouts_by_tile(cutouts: list[Cutout], order: int) -> dict[int, list[Cutout]]:
    by_tile: dict[int, list[Cutout]] = defaultdict(list)
    for cutout in cutouts:
        for tile in touched_tiles(cutout, order):
            by_tile[int(tile)].append(cutout)
    return by_tile


def closeup_order(cutout: Cutout) -> int:
    """The shallowest order at which the object is CLOSEUP_PX across, beyond MAX_ORDER and at most CLOSEUP_MAX_ORDER."""
    wanted = math.ceil(math.log2(CLOSEUP_PX * ORDER0_DEG / (TILE_PX * cutout.diameter_deg)))
    return min(CLOSEUP_MAX_ORDER, max(MAX_ORDER + 1, wanted))


def closeup_tiles(cutouts: list[Cutout]) -> dict[int, list[int]]:
    """Per order beyond MAX_ORDER, the tiles written: each cut-out's, down to its close-up order."""
    tiles: dict[int, set[int]] = defaultdict(set)
    for cutout in cutouts:
        for order in range(MAX_ORDER + 1, closeup_order(cutout) + 1):
            tiles[order].update(int(tile) for tile in touched_tiles(cutout, order))
    return {order: sorted(tiles[order]) for order in sorted(tiles)}


def fill_plate_holes(light: np.ndarray) -> np.ndarray:
    """Each pixel at least the median of the PLATE_HOLE_PX square around it: holes filled, bright detail kept."""
    half = PLATE_HOLE_PX // 2
    padded = np.pad(light, ((half, half), (half, half), (0, 0)), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, (PLATE_HOLE_PX, PLATE_HOLE_PX), axis=(0, 1))
    return np.maximum(light, np.median(windows, axis=(-2, -1)))


def lay_on_plates(under: np.ndarray, order: int, ipix: int, cutouts: list[Cutout], skies: dict[str, np.ndarray], offsets: np.ndarray) -> np.ndarray:
    """
    Finished sky `under` tile `ipix` of `order` with the plates' own light inside the cut-outs laid on: starless
    where a nebula is. Where cut-outs overlap, the darkest of their `skies` is taken off: M32's ring of sky lies on
    Andromeda's disc, and taking that off would cut a hole in Andromeda.

    A galaxy's light is lifted and added (screened): Gaia all but missed it, so nothing under it is the galaxy. A
    nebula's gas is already under it, in the H-alpha glow, at the whole sky's resolution: added, it would count
    twice and print the bright ones white. What the plate has that the glow lacks is its structure, so the glow is
    multiplied by the plate's light against the same plate seen from the whole-sky tile above - the glow's colour
    and brightness kept, the plate's filaments and dark lanes drawn into it, half the plate's colour with them.
    """
    vectors = tile_vectors(order, ipix, offsets)
    weight = {"galaxy": np.zeros(offsets.shape, dtype=np.float32), "nebula": np.zeros(offsets.shape, dtype=np.float32)}
    sky = np.ones((*offsets.shape, 3), dtype=np.float32)
    for cutout in cutouts:
        reach = np.degrees(np.arccos(np.clip(vectors @ cutout.centre, -1, 1))) / cutout.diameter_deg
        edge = np.clip((CUTOUT_CORE + CUTOUT_FEATHER - reach) / CUTOUT_FEATHER, 0, 1)
        mine = edge * edge * (3 - 2 * edge)
        np.maximum(weight[cutout.kind], mine, out=weight[cutout.kind])
        inside = mine > 0
        sky[inside] = np.minimum(sky[inside], skies[cutout.name])
    plate = plate_tile(order, ipix, bool(weight["nebula"].any()))
    # The light above the plate's sky, back to the full range.
    light = np.clip((plate - sky - PLATE_FLOOR) / (1 - sky - PLATE_FLOOR), 0, 1)
    # Outside every cut-out there is no sky to take off: nothing there for the hole filling to spread inward.
    light[(weight["galaxy"] == 0) & (weight["nebula"] == 0)] = 0
    light = fill_plate_holes(light)
    # Lifted, white staying white.
    galaxies = (1 - np.exp(-PLATE_GAIN * light)) / (1 - math.exp(-PLATE_GAIN)) * weight["galaxy"][..., None]
    lit = screen(under, galaxies)
    if order == MAX_ORDER or not weight["nebula"].any():
        return lit
    coarse_plate = window_of_ancestor(plate_tile(MAX_ORDER, ipix >> 2 * (order - MAX_ORDER), False), order, ipix)
    fine = light + NEBULA_GRAIN
    coarse = np.clip((coarse_plate - sky - PLATE_FLOOR) / (1 - sky - PLATE_FLOOR), 0, 1) + NEBULA_GRAIN
    brightness = fine.mean(axis=-1, keepdims=True) / coarse.mean(axis=-1, keepdims=True)
    detail = np.clip(brightness * np.sqrt((fine / coarse) / brightness), 0, NEBULA_DETAIL_MAX)
    return np.clip(lit * (1 + (detail - 1) * weight["nebula"][..., None]), 0, 1)


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


def write_closeups(cutouts: list[Cutout], backgrounds: dict[int, np.ndarray], offsets: np.ndarray) -> dict[int, list[int]]:
    """
    The close-up tiles: the finished sky of their order-MAX_ORDER ancestor before the plates' light, as the app would
    draw it there, with the plates laid on at the DSS tiles' own order. Outside the cut-outs a close-up is
    then its ancestor, so none shows an edge against the sky drawn from the ancestor beside it.
    """
    tiles = closeup_tiles(cutouts)
    # The plates seen from the whole sky, which a nebula's close-ups measure their structure against.
    fetch_dss_tiles(MAX_ORDER, sorted(backgrounds))
    for order, pixels in tiles.items():
        fetch_dss_tiles(order, pixels)
        here = cutouts_by_tile(cutouts, order)
        skies = plate_skies(list({cutout.name: cutout for ipix in pixels for cutout in here[ipix]}.values()), order)
        size = 0
        for ipix in pixels:
            ancestor = ipix >> (2 * (order - MAX_ORDER))
            under = window_of_ancestor(backgrounds[ancestor], order, ipix)
            size += save_tile(OUTPUT, order, ipix, lay_on_plates(under, order, ipix, here[ipix], skies, offsets))
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
    labels = openngc_labels()
    galaxies = discernible_galaxies(labels)
    cutouts = galaxies + discernible_nebulae(labels)
    # The whole sky has the nebulae already, in the H-alpha glow; only Gaia's missing galaxies are laid on there.
    by_tile = cutouts_by_tile(galaxies, MAX_ORDER)
    skies = plate_skies(galaxies, MAX_ORDER)
    offsets = tile_pixel_offsets()
    # The finished sky under every cut-out before the plates are laid on: the close-ups are drawn over it.
    under_closeups = set(cutouts_by_tile(cutouts, MAX_ORDER))
    backgrounds: dict[int, np.ndarray] = {}

    def top_tile(ipix: int) -> np.ndarray:
        display = tone_map(sample_tile(linear, ipix, offsets), black, white)
        structure_tile = sample_tile(structure, ipix, offsets)
        finished = finish(display, structure_tile, sample_tile(surround, ipix, offsets), halpha_at(halpha, ipix, offsets))
        if ipix in under_closeups:
            backgrounds[ipix] = finished
        if ipix not in by_tile:
            return finished
        return lay_on_plates(finished, MAX_ORDER, ipix, by_tile[ipix], skies, offsets)

    write_tiles(OUTPUT, top_tile, lambda tile: tile)
    tiles = write_closeups(cutouts, backgrounds, offsets)
    CUTOUTS_FILE.write_text(
        json.dumps(
            {
                "wholeSkyOrder": MAX_ORDER,
                "tiles": {str(order): pixels for order, pixels in tiles.items()},
                "cutouts": [
                    {
                        "label": cutout.label,
                        "kind": cutout.kind,
                        "ra": round(float(np.degrees(np.arctan2(cutout.centre[1], cutout.centre[0])) % 360), 4),
                        "dec": round(float(np.degrees(np.arcsin(cutout.centre[2]))), 4),
                        "diameterDeg": round(cutout.diameter_deg, 4),
                    }
                    for cutout in sorted(cutouts, key=lambda cutout: -cutout.diameter_deg)
                ],
            },
            separators=(",", ":"),
        )
    )
    print(f"wrote {CUTOUTS_FILE.relative_to(REPO_ROOT)}: {sum(len(p) for p in tiles.values())} close-up tiles")


if __name__ == "__main__":
    main()
