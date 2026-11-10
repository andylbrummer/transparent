#!/usr/bin/env python3
"""
Data checks for generate_skymaps.py's output: is every map the right way round?

A mirrored or shifted all-sky map still looks like the sky. So each baked
image is tested for features that are NOT symmetric: a known object must
be brighter at its galactic coordinates than at the same latitude on the
other side of the Galactic centre (longitude l -> 360 - l). The microwave
background has no landmarks, so those maps are compared, pixel for pixel,
with colours recomputed from their source HEALPix maps - and with the
mirrored lookup, which must fit far worse.

Usage (same venv as generate_skymaps.py; reads the cached source maps):
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_skymaps.py
"""

import healpy as hp
import numpy as np
from astropy.io import fits
from PIL import Image

import generate_skymaps as maps
from geo_test_support import check, finish

# Galactic (l, b), degrees.
GALACTIC_CENTRE = (0.0, 0.0)
LMC = (280.47, -32.89)
SMC = (302.80, -44.30)
ORION_NEBULA = (209.01, -19.38)
BARNARDS_LOOP = (207.0, -22.5)
ZETA_OPH_NEBULA = (6.3, 23.6)
CAS_A = (111.73, -2.13)
CYG_A = (76.19, 5.76)
NORTH_POLAR_SPUR = (30.0, 40.0)
VELA_PULSAR = (263.55, -2.79)
CRAB = (184.56, -5.78)
GEMINGA = (195.13, 4.27)
QSO_3C454 = (86.11, -38.18)
VELA_REMNANT = (263.9, -3.3)
VIRGO_CLUSTER = (283.78, 74.49)
PERSEUS_CLUSTER = (150.57, -13.26)
SHAPLEY = (312.0, 30.5)
COLD_SPOT = (209.0, -57.0)
CMB_DIPOLE = (264.021, 48.253)


def load(name: str) -> np.ndarray:
    """The baked image as floats 0..1, H x W x 3."""
    return np.asarray(Image.open(maps.OUTPUT_DIR / f"{name}.jpg").convert("RGB"), dtype=np.float64) / 255.0


def patch(image: np.ndarray, where: tuple[float, float], radius_deg: float = 1.0) -> np.ndarray:
    """Mean colour within a box of +-radius around galactic (l, b)."""
    height, width = image.shape[:2]
    column, row = maps.pixel_of(where[0], where[1], width, height)
    half_rows = max(1, round(radius_deg / 180 * height))
    half_columns = max(1, round(radius_deg / 360 * width / max(0.2, np.cos(np.radians(where[1])))))
    rows = np.clip(np.arange(row - half_rows, row + half_rows + 1), 0, height - 1)
    columns = np.arange(column - half_columns, column + half_columns + 1) % width
    return image[np.ix_(rows, columns)].reshape(-1, 3).mean(axis=0)


def level(image: np.ndarray, where: tuple[float, float], radius_deg: float = 1.0) -> float:
    return float(patch(image, where, radius_deg).mean())


def mirrored(where: tuple[float, float]) -> tuple[float, float]:
    return ((360.0 - where[0]) % 360.0, where[1])


def check_feature(image: np.ndarray, name: str, what: str, where: tuple[float, float], factor: float, radius: float = 1.0) -> None:
    here, there = level(image, where, radius), level(image, mirrored(where), radius)
    check(
        here > factor * max(there, 0.004),
        f"{name}: {what} at l={where[0]:.1f} b={where[1]:.1f} is {here:.3f}, the mirrored place {there:.3f} (needs x{factor})",
    )


def layout_checks() -> None:
    total = 0
    for name in maps.MAPS:
        path = maps.OUTPUT_DIR / f"{name}.jpg"
        with Image.open(path) as image:
            check(image.size == (maps.WIDTH, maps.HEIGHT), f"{name}: {maps.WIDTH} x {maps.HEIGHT}")
        size = path.stat().st_size
        total += size
        check(size < 750_000, f"{name}: {size / 1000:.0f} kB (under 750)")
    check(total < 4_000_000, f"all maps together: {total / 1e6:.2f} MB (under 4)")
    # The pixel convention itself: l = 0 in the middle, l = +90 a quarter of the way from the left.
    check(maps.pixel_of(0, 0) == (maps.WIDTH // 2, maps.HEIGHT // 2), "layout: the Galactic centre is the middle pixel")
    check(maps.pixel_of(90, 0)[0] == maps.WIDTH // 4, "layout: longitude 90 is left of centre")
    check(maps.pixel_of(0, 89.99)[1] == 0, "layout: north is the top row")
    lon, lat = maps.grid()
    column, row = maps.pixel_of(123.4, -56.7)
    check(abs(lon[row, column] - 123.4) < 0.2 and abs(lat[row, column] + 56.7) < 0.2, "layout: grid() and pixel_of() agree")


def galaxy_checks() -> None:
    radio = load("radio-408")
    check(level(radio, GALACTIC_CENTRE) > 0.6 and level(radio, GALACTIC_CENTRE) > 3 * level(radio, (180, 0)), "radio-408: brightest toward the Galactic centre")
    check_feature(radio, "radio-408", "Cassiopeia A", CAS_A, 1.5, 0.5)
    check_feature(radio, "radio-408", "Cygnus A", CYG_A, 1.3, 0.5)
    check_feature(radio, "radio-408", "the North Polar Spur", NORTH_POLAR_SPUR, 1.25, 4.0)
    check_feature(radio, "radio-408", "the Large Magellanic Cloud", LMC, 1.15, 1.5)

    hydrogen = load("hi-21cm")
    check(level(hydrogen, GALACTIC_CENTRE) > 3 * level(hydrogen, (0, 80), 4), "hi-21cm: the plane far outshines the pole")
    check_feature(hydrogen, "hi-21cm", "the Large Magellanic Cloud", LMC, 1.5, 2.0)
    check_feature(hydrogen, "hi-21cm", "the Small Magellanic Cloud", SMC, 1.5, 1.5)

    dust = load("dust-100um")
    check(level(dust, GALACTIC_CENTRE) > 3 * level(dust, (0, 80), 4), "dust-100um: the plane far outshines the pole")
    check_feature(dust, "dust-100um", "the Large Magellanic Cloud", LMC, 1.5, 2.0)
    check_feature(dust, "dust-100um", "the Orion Nebula", ORION_NEBULA, 1.5, 0.7)
    check_feature(dust, "dust-100um", "the Small Magellanic Cloud", SMC, 1.15, 1.0)

    infrared = load("near-ir")
    brightest = np.unravel_index(np.argmax(maps.box_blur(infrared.mean(axis=-1), 6)), infrared.shape[:2])
    centre = maps.pixel_of(0, 0)
    check(abs(brightest[1] - centre[0]) < 12 and abs(brightest[0] - centre[1]) < 12, f"near-ir: the brightest patch is the Galactic centre (column {brightest[1]}, row {brightest[0]})")
    check_feature(infrared, "near-ir", "the Large Magellanic Cloud", LMC, 1.5, 1.5)
    check(level(infrared, (20, 0), 1) > 5 * level(infrared, (20, 30), 2), "near-ir: the disc is thin and bright")
    # The bulge is nearly symmetric, the disc a little brighter toward the first quadrant; neither is lopsided.
    ratio = level(infrared, (8, 3), 1) / level(infrared, (352, 3), 1)
    check(0.6 < ratio < 1.7, f"near-ir: the bulge is the same on both sides of the centre (ratio {ratio:.2f})")

    halpha = load("h-alpha")
    check_feature(halpha, "h-alpha", "the Orion Nebula", ORION_NEBULA, 2.0, 0.7)
    check_feature(halpha, "h-alpha", "Barnard's Loop", BARNARDS_LOOP, 1.5, 1.5)
    check_feature(halpha, "h-alpha", "the Zeta Ophiuchi nebula", ZETA_OPH_NEBULA, 1.5, 2.0)
    check_feature(halpha, "h-alpha", "the Large Magellanic Cloud", LMC, 1.5, 1.5)


def high_energy_checks() -> None:
    gamma = load("gamma-fermi")
    check(level(gamma, GALACTIC_CENTRE) > 0.7, "gamma-fermi: the Galactic centre is bright")
    check_feature(gamma, "gamma-fermi", "the Vela pulsar", VELA_PULSAR, 1.3, 0.6)
    check_feature(gamma, "gamma-fermi", "the Crab", CRAB, 1.5, 0.6)
    check_feature(gamma, "gamma-fermi", "Geminga", GEMINGA, 1.5, 0.6)
    check_feature(gamma, "gamma-fermi", "the blazar 3C 454.3", QSO_3C454, 2.0, 0.6)
    check_feature(gamma, "gamma-fermi", "the Large Magellanic Cloud", LMC, 1.3, 1.5)

    xray = load("xray-rosat")
    check_feature(xray, "xray-rosat", "the Vela supernova remnant", VELA_REMNANT, 1.5, 2.0)
    check_feature(xray, "xray-rosat", "the Large Magellanic Cloud", LMC, 1.2, 1.5)
    spur, other = patch(xray, (25, 45), 5), patch(xray, mirrored((25, 45)), 5)
    check(spur[1] > 1.3 * other[1], f"xray-rosat: the North Polar Spur glows at 3/4 keV (green {spur[1]:.2f} against {other[1]:.2f} mirrored)")
    # Soft X-rays are absorbed by the gas of the plane: at 1/4 keV the plane is dark and the poles bright.
    plane, above = patch(xray, (150, 0), 3)[0], patch(xray, (150, 50), 5)[0]
    check(plane < 0.7 * above, f"xray-rosat: the Galactic plane is a shadow at 1/4 keV (red {plane:.2f} in the plane, {above:.2f} at b=50)")

    galaxies = load("galaxies-2mass")
    check_feature(galaxies, "galaxies-2mass", "the Virgo cluster", VIRGO_CLUSTER, 1.25, 2.0)
    check_feature(galaxies, "galaxies-2mass", "the Perseus cluster", PERSEUS_CLUSTER, 1.5, 1.5)
    check_feature(galaxies, "galaxies-2mass", "the Shapley concentration", SHAPLEY, 1.3, 2.5)
    check(level(galaxies, (0, 0), 3) < 0.02 and level(galaxies, (0, 50), 10) > 0.05, "galaxies-2mass: the Zone of Avoidance is empty toward the Galactic centre")


def colour_error(image: np.ndarray, expected: np.ndarray, rows: np.ndarray, columns: np.ndarray, flip: bool) -> float:
    lookup = (image.shape[1] - 1 - columns) if flip else columns
    return float(np.abs(image[rows, lookup] - expected[rows, columns]).mean())


def cmb_checks() -> None:
    rng = np.random.default_rng(1)
    rows = rng.integers(100, maps.HEIGHT - 100, 20000)
    columns = rng.integers(0, maps.WIDTH, 20000)
    lon, lat = maps.grid()
    off_plane = np.abs(lat[rows, columns]) > 15
    rows, columns = rows[off_plane], columns[off_plane]

    for name, builder in (("cmb-cobe", maps.build_cmb_cobe), ("cmb-wmap", maps.build_cmb_wmap), ("cmb-planck", maps.build_cmb_planck)):
        image = load(name)
        expected = builder()
        right = colour_error(image, expected, rows, columns, flip=False)
        wrong = colour_error(image, expected, rows, columns, flip=True)
        check(right < 0.08 and wrong > 3 * right, f"{name}: matches its source map (mean colour error {right:.3f}; mirrored {wrong:.3f})")

    # The same sky, three times: COBE's blobs are WMAP's and Planck's, smoothed.
    cobe = hp.remove_dipole(maps.cobe_dmr_53ghz(), gal_cut=20, copy=True)
    cobe = maps.smooth_ring(np.asarray(cobe), maps.COBE_SMOOTH_FWHM_DEG)
    wmap, nest = maps.wmap_ilc_uk()
    wmap = maps.smooth_ring(hp.ud_grade(wmap, 32, order_in="NESTED" if nest else "RING", order_out="RING"), 10.0)
    planck, nest = maps.planck_smica_uk()
    planck = maps.smooth_ring(hp.ud_grade(planck, 32, order_in="NESTED" if nest else "RING", order_out="RING"), 10.0)
    theta, _ = hp.pix2ang(32, np.arange(hp.nside2npix(32)))
    high = np.abs(90 - np.degrees(theta)) > 30
    r_cobe = float(np.corrcoef(cobe[high], wmap[high])[0, 1])
    r_planck = float(np.corrcoef(planck[high], wmap[high])[0, 1])
    check(r_cobe > 0.5, f"cmb: COBE and WMAP agree at 10 deg away from the plane (correlation {r_cobe:.2f})")
    check(r_planck > 0.97, f"cmb: Planck and WMAP agree at 10 deg (correlation {r_planck:.3f})")

    for name in ("cmb-wmap", "cmb-planck"):
        spot = patch(load(name), COLD_SPOT, 3.0)
        check(spot[2] > 1.5 * spot[0], f"{name}: the Cold Spot at l=209 b=-57 is cold (blue {spot[2]:.2f}, red {spot[0]:.2f})")
    plane = patch(load("cmb-cobe"), (20, 0), 2.0)
    check(plane[0] > 0.9 and plane[0] > 2 * plane[2], "cmb-cobe: the Milky Way is a hot band")

    full = maps.cobe_dmr_53ghz_with_dipole()
    mono, dipole = hp.fit_dipole(full, gal_cut=20)
    amplitude = float(np.linalg.norm(dipole))
    direction_lon = float(np.degrees(np.arctan2(dipole[1], dipole[0])) % 360)
    direction_lat = float(np.degrees(np.arcsin(dipole[2] / amplitude)))
    offset = float(np.degrees(np.arccos(np.clip(np.dot(dipole / amplitude, hp.ang2vec(np.radians(90 - CMB_DIPOLE[1]), np.radians(CMB_DIPOLE[0]))), -1, 1))))
    # Planck 2018: 3362.08 uK toward (264.021, +48.253).
    check(abs(amplitude - 3362) < 40, f"cmb-dipole: amplitude {amplitude:.0f} uK (Planck 2018: 3362)")
    check(offset < 1.5, f"cmb-dipole: toward l={direction_lon:.1f} b={direction_lat:.1f}, {offset:.2f} deg from Planck's direction")
    image = load("cmb-dipole")
    ahead, behind = patch(image, CMB_DIPOLE, 3), patch(image, ((CMB_DIPOLE[0] + 180) % 360, -CMB_DIPOLE[1]), 3)
    check(ahead[0] > 0.9 and ahead[0] > 2 * ahead[2] and behind[2] > 0.9 and behind[2] > 1.5 * behind[0], "cmb-dipole: warm ahead, cool behind")


def quadcube_checks() -> None:
    # COBE's own table of pixel coordinates (DMR sky maps, resolution 6) against the geometry coded here.
    with fits.open(maps.lambda_file("cobe/dmr/pds4/skymaps/DMR_SKYMAP_53A_4YR.FITS")) as hdul:
        table = hdul[1].data
        pixel = np.asarray(table["PIXEL"])
        ecliptic = maps.lon_lat_vectors(np.asarray(table["ECLON"], dtype=float), np.asarray(table["ECLAT"], dtype=float))
        galactic = maps.lon_lat_vectors(np.asarray(table["GALON"], dtype=float), np.asarray(table["GALAT"], dtype=float))
    vectors = maps.quadcube_vectors(6)[pixel]
    worst = float(np.degrees(np.arccos(np.clip(np.sum(vectors * ecliptic, axis=-1), -1, 1))).max())
    check(worst < 0.001, f"sky cube: all 6,144 resolution-6 pixel centres match COBE's table (worst {worst * 3600:.1f} arcsec)")
    worst = float(np.degrees(np.arccos(np.clip(np.sum(maps.ecliptic_to_galactic(vectors) * galactic, axis=-1), -1, 1))).max())
    check(worst < 0.002, f"sky cube: ecliptic -> galactic matches COBE's table (worst {worst * 3600:.1f} arcsec)")


def main() -> None:
    layout_checks()
    quadcube_checks()
    galaxy_checks()
    high_energy_checks()
    cmb_checks()
    finish()


if __name__ == "__main__":
    main()
