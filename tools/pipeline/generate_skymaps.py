#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: all-sky maps beyond visible light.

Writes app/public/sky/maps/<name>.jpg, each a plate carree in GALACTIC
coordinates laid out as render/sky-map.ts expects: longitude 0 (the
Galactic centre) in the middle and increasing to the LEFT, north at the
top. Pixel (i, j) of a W x H image is centred on

    l = 180 - (i + 0.5) * 360 / W        b = 90 - (j + 0.5) * 180 / H

The maps are drawn as light added over a dark sky, so every colour scale
starts at black; the microwave-background maps, which have a sign, are
black at zero, blue below and red above.

    name          what                                   source (all public; see docs/data-sources/deep-sky.md)
    cmb-cobe      CMB anisotropy, 53 GHz, 10 deg beam    COBE DMR 4-year sky maps in HEALPix, NASA LAMBDA
    cmb-dipole    the same with the 3.36 mK dipole kept   COBE DMR 4-year sky maps (sky-cube pixels), NASA LAMBDA
    cmb-wmap      CMB anisotropy, 1 deg                  WMAP 9-year ILC map, NASA LAMBDA
    cmb-planck    CMB anisotropy, 5 arcmin               Planck 2018 SMICA map (ESA/Planck), NASA/IPAC IRSA mirror
    radio-408     408 MHz radio continuum                Haslam et al. 1982 as reprocessed by Remazeilles et al. 2015, LAMBDA
    hi-21cm       neutral hydrogen column density        HI4PI Collaboration 2016, LAMBDA
    dust-100um    far-infrared dust emission, 100 um     IRAS/IRIS (Miville-Deschenes & Lagache 2005), LAMBDA
    near-ir       starlight at 1.25, 2.2 and 3.5 um      COBE DIRBE Zodi-Subtracted Mission Average, LAMBDA
    h-alpha       ionised hydrogen, 656.3 nm             Finkbeiner 2003 composite (VTSS, SHASSA, WHAM), LAMBDA
    xray-rosat    diffuse soft X-rays, 0.25/0.75/1.5 keV ROSAT All-Sky Survey (Snowden et al. 1997), via NASA SkyView
    gamma-fermi   gamma rays above 1 GeV                 Fermi-LAT (bands 4 and 5 of NASA SkyView's Fermi survey)
    galaxies-2mass  galaxies per square degree, Ks < 13.5  2MASS Extended Source Catalog (Jarrett et al. 2000), NASA/IPAC IRSA

How each is scaled (linear / logarithmic / asinh, range, colours) is in
MAPS below; test_skymaps.py checks known features at known galactic
coordinates in every baked image, and the CMB maps against their source
pixels.

Usage (needs healpy and astropy; the Planck and HI4PI downloads are 2.0 and 0.6 GB):
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install numpy pillow astropy healpy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_skymaps.py            # everything
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_skymaps.py cmb-cobe   # some

Raw downloads are cached in tools/pipeline/.cache/skymaps/.
"""

import csv
import sys
import tarfile
import urllib.parse
from pathlib import Path

import healpy as hp
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from PIL import Image

from fetch_cache import CACHE_DIR, cached_fetch

WIDTH, HEIGHT = 2048, 1024
JPEG_QUALITY = 84

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "sky" / "maps"

LAMBDA = "https://lambda.gsfc.nasa.gov/data/"
IRSA_PLANCK = "https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/"
SKYVIEW = "https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl"
IRSA_TAP = "https://irsa.ipac.caltech.edu/TAP/sync"

# Colour ramps: (position 0..1, (r, g, b) 0..1). All start at black.
RAMP_RADIO = [(0, (0, 0, 0)), (0.35, (0.45, 0.1, 0.0)), (0.7, (1.0, 0.55, 0.1)), (1, (1.0, 0.95, 0.75))]
RAMP_HYDROGEN = [(0, (0, 0, 0)), (0.4, (0.05, 0.25, 0.5)), (0.75, (0.2, 0.7, 0.85)), (1, (0.9, 1.0, 1.0))]
RAMP_DUST = [(0, (0, 0, 0)), (0.35, (0.4, 0.08, 0.05)), (0.7, (0.95, 0.45, 0.15)), (1, (1.0, 0.95, 0.8))]
RAMP_HALPHA = [(0, (0, 0, 0)), (0.45, (0.55, 0.03, 0.08)), (0.8, (1.0, 0.3, 0.3)), (1, (1.0, 0.85, 0.8))]
RAMP_GAMMA = [(0, (0, 0, 0)), (0.3, (0.2, 0.05, 0.45)), (0.6, (0.75, 0.2, 0.55)), (0.85, (1.0, 0.65, 0.3)), (1, (1.0, 1.0, 0.85))]
RAMP_GALAXIES = [(0, (0, 0, 0)), (0.4, (0.1, 0.2, 0.45)), (0.75, (0.55, 0.65, 0.85)), (1, (1.0, 1.0, 0.95))]
# The sign of a temperature difference: black at zero, so "no anisotropy" adds no light.
RAMP_CMB = [
    (0, (0.6, 0.9, 1.0)),
    (0.25, (0.1, 0.4, 1.0)),
    (0.5, (0, 0, 0)),
    (0.75, (1.0, 0.3, 0.05)),
    (1, (1.0, 0.9, 0.4)),
]
# Full scale of the CMB maps, microkelvin either side of zero.
CMB_RANGE_UK = 300.0
COBE_RANGE_UK = 200.0
DIPOLE_RANGE_UK = 3600.0
# Gaussian smoothing applied to the 7 deg DMR beam: the classic COBE picture is at 10 deg.
COBE_SMOOTH_FWHM_DEG = 7.0
GALAXY_K_LIMIT = 13.5
# Thermodynamic temperature per unit antenna temperature at 53 GHz for a 2.725 K black body:
# (e^x - 1)^2 / (x^2 e^x) with x = h nu / k T = 0.9334.
ANTENNA_TO_THERMODYNAMIC_53GHZ = 1.0747
# JPEG quality per map where the default would be wasteful: CMB maps are noise-like and compress badly.
JPEG_QUALITY_OVERRIDES = {"cmb-planck": 66, "cmb-wmap": 76, "gamma-fermi": 78, "xray-rosat": 78}


def grid() -> tuple[np.ndarray, np.ndarray]:
    """Galactic (l, b) in degrees of every output pixel centre, each H x W."""
    lon = 180.0 - (np.arange(WIDTH) + 0.5) * 360.0 / WIDTH
    lat = 90.0 - (np.arange(HEIGHT) + 0.5) * 180.0 / HEIGHT
    return np.meshgrid(lon, lat)


def pixel_of(lon: float, lat: float, width: int = WIDTH, height: int = HEIGHT) -> tuple[int, int]:
    """(column, row) of the pixel holding galactic (l, b)."""
    signed = (lon + 180.0) % 360.0 - 180.0
    column = int((180.0 - signed) / 360.0 * width) % width
    row = min(height - 1, max(0, int((90.0 - lat) / 180.0 * height)))
    return column, row


def sample_healpix(values: np.ndarray, nest: bool) -> np.ndarray:
    """A HEALPix map in galactic coordinates, interpolated at the output pixels; NaN where it has no data."""
    lon, lat = grid()
    theta, phi = np.radians(90.0 - lat), np.radians(lon % 360.0)
    out = hp.get_interp_val(values, theta, phi, nest=nest)
    # Interpolating across a missing pixel poisons its neighbours: fall back to the nearest pixel there.
    bad = ~np.isfinite(out)
    if bad.any():
        nearest = values[hp.ang2pix(hp.get_nside(values), theta[bad], phi[bad], nest=nest)]
        out[bad] = nearest
    return out


def read_healpix(path: Path, field: int | str = 0, hdu: int = 1) -> tuple[np.ndarray, bool]:
    """(map as float64 with NaN for missing pixels, nested?) of one column of a HEALPix FITS table."""
    with fits.open(path, memmap=True) as hdul:
        table = hdul[hdu]
        name = table.columns.names[field] if isinstance(field, int) else field
        values = np.asarray(table.data[name], dtype=np.float64).ravel()
        nest = table.header.get("ORDERING", "RING").strip().upper().startswith("NEST")
    values[(values < -1e29) | ~np.isfinite(values)] = np.nan
    return values, nest


def degrade(values: np.ndarray, nest: bool, nside: int) -> np.ndarray:
    """Average down to `nside`, so a fine map is not aliased by the coarser output grid."""
    if hp.get_nside(values) <= nside:
        return values
    order = "NESTED" if nest else "RING"
    return hp.ud_grade(np.ma.masked_invalid(values).filled(hp.UNSEEN), nside, order_in=order, order_out=order)


def ramp(t: np.ndarray, stops: list[tuple[float, tuple[float, float, float]]]) -> np.ndarray:
    """Colours (H x W x 3, 0..1) of `t` (0..1) on a piecewise-linear ramp."""
    t = np.clip(np.nan_to_num(t, nan=0.0), 0.0, 1.0)
    positions = [stop[0] for stop in stops]
    return np.stack([np.interp(t, positions, [stop[1][k] for stop in stops]) for k in range(3)], axis=-1)


def log_scale(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """0 at `low`, 1 at `high`, logarithmic between."""
    return np.log(np.clip(values, low, None) / low) / np.log(high / low)


def asinh_scale(values: np.ndarray, low: float, soft: float, high: float) -> np.ndarray:
    """0 at `low`, 1 at `high`; linear near `low`, logarithmic well above `low + soft`."""
    return np.arcsinh(np.clip(values - low, 0, None) / soft) / np.arcsinh((high - low) / soft)


def cmb_colors(microkelvin: np.ndarray, full_scale: float) -> np.ndarray:
    return ramp(0.5 + 0.5 * np.clip(microkelvin / full_scale, -1, 1), RAMP_CMB)


def lambda_file(path: str) -> Path:
    return cached_fetch(LAMBDA + path, "skymaps/" + path.rsplit("/", 1)[-1], timeout=3600)


# ---------------------------------------------------------------------------
# Microwave background


def cobe_dmr_53ghz() -> np.ndarray:
    """The 53 GHz sum map (A + B) / 2, thermodynamic microkelvin, HEALPix nside 32 NESTED, galactic."""
    archive = lambda_file("cobe/dmr/hpx4/dmr_4yr_healpix_imaps.tar.gz")
    folder = CACHE_DIR / "skymaps" / "dmr"
    if not (folder / "dmr_53a_imap_4yr.fits").exists():
        with tarfile.open(archive) as tar:
            tar.extractall(folder, filter="data")
    a, nest_a = read_healpix(folder / "dmr_53a_imap_4yr.fits", "TEMPERATURE")
    b, nest_b = read_healpix(folder / "dmr_53b_imap_4yr.fits", "TEMPERATURE")
    assert nest_a and nest_b
    return hp.reorder((a + b) / 2, n2r=True) * 1000.0


def smooth_ring(values: np.ndarray, fwhm_deg: float) -> np.ndarray:
    return hp.smoothing(values, fwhm=np.radians(fwhm_deg))


def build_cmb_cobe() -> np.ndarray:
    full = cobe_dmr_53ghz()
    # Monopole and dipole are fitted away from the Milky Way, as the DMR team did (|b| > 20 deg).
    cleaned = hp.remove_dipole(full, gal_cut=20, copy=True)
    return cmb_colors(sample_healpix(smooth_ring(np.asarray(cleaned), COBE_SMOOTH_FWHM_DEG), nest=False), COBE_RANGE_UK)


def cobe_dmr_53ghz_with_dipole() -> np.ndarray:
    """The 53 GHz (A + B) / 2 map with the dipole restored: thermodynamic microkelvin, HEALPix nside 32 RING, galactic.

    The archived DMR sky maps (COBE's own sky-cube pixels, with each pixel's coordinates in the table) had a
    nominal dipole subtracted before the map was solved; the header carries that vector and says to add its
    dot product with each pixel's pointing to restore it. That is done here.
    """
    channels = []
    for channel in ("53A", "53B"):
        with fits.open(lambda_file(f"cobe/dmr/pds4/skymaps/DMR_SKYMAP_{channel}_4YR.FITS")) as hdul:
            header, table = hdul[0].header, hdul[1].data
            pointing = lon_lat_vectors(np.asarray(table["ECLON"], dtype=float), np.asarray(table["ECLAT"], dtype=float))
            dipole = header["DIP_MAG"] * lon_lat_vectors(np.array([header["DIP_ELON"]]), np.array([header["DIP_ELAT"]]))[0]
            signal = np.asarray(table["SIGNAL"], dtype=np.float64) + pointing @ dipole
            galactic = lon_lat_vectors(np.asarray(table["GALON"], dtype=float), np.asarray(table["GALAT"], dtype=float))
        channels.append(signal)
    antenna_mk = (channels[0] + channels[1]) / 2
    # Each HEALPix pixel takes the nearest of the 6,144 cube pixels (2.6 deg across, like nside 32's 1.8 deg).
    nside = 32
    centres = np.stack(hp.pix2vec(nside, np.arange(hp.nside2npix(nside))), axis=-1)
    nearest = np.argmax(centres @ galactic.T, axis=1)
    return antenna_mk[nearest] * ANTENNA_TO_THERMODYNAMIC_53GHZ * 1000.0


def lon_lat_vectors(lon_deg: np.ndarray, lat_deg: np.ndarray) -> np.ndarray:
    lon, lat = np.radians(lon_deg), np.radians(lat_deg)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def build_cmb_dipole() -> np.ndarray:
    full = cobe_dmr_53ghz_with_dipole()
    return cmb_colors(sample_healpix(smooth_ring(full, COBE_SMOOTH_FWHM_DEG), nest=False), DIPOLE_RANGE_UK)


def wmap_ilc_uk() -> tuple[np.ndarray, bool]:
    values, nest = read_healpix(lambda_file("map/dr5/dfp/ilc/wmap_ilc_9yr_v5.fits"), "TEMPERATURE")
    return values * 1000.0, nest


def build_cmb_wmap() -> np.ndarray:
    values, nest = wmap_ilc_uk()
    return cmb_colors(sample_healpix(values, nest), CMB_RANGE_UK)


def planck_smica_uk() -> tuple[np.ndarray, bool]:
    path = cached_fetch(IRSA_PLANCK + "COM_CMB_IQU-smica_2048_R3.00_full.fits", "skymaps/COM_CMB_IQU-smica_2048_R3.00_full.fits", timeout=7200)
    values, nest = read_healpix(path, "I_STOKES")
    return degrade(values * 1e6, nest, 512), nest


def build_cmb_planck() -> np.ndarray:
    values, nest = planck_smica_uk()
    return cmb_colors(sample_healpix(values, nest), CMB_RANGE_UK)


# ---------------------------------------------------------------------------
# The Milky Way's gas, dust and stars


def build_radio_408() -> np.ndarray:
    values, nest = read_healpix(lambda_file("foregrounds/haslam_2014/haslam408_dsds_Remazeilles2014.fits"))
    # Brightness temperature in kelvin: 11 K at the coldest high-latitude sky, thousands at the Galactic centre.
    return ramp(log_scale(sample_healpix(values, nest), 11.0, 600.0), RAMP_RADIO)


def build_hi_21cm() -> np.ndarray:
    values, nest = read_healpix(lambda_file("foregrounds/HI4PI/NHI_HPX.fits"), "NHI")
    # Column density in atoms per cm2: 5e19 in the clearest windows, 2e22 through the inner Galaxy.
    return ramp(log_scale(sample_healpix(degrade(values, nest, 512), nest), 6e19, 2e22), RAMP_HYDROGEN)


def build_dust_100um() -> np.ndarray:
    values, nest = read_healpix(lambda_file("foregrounds/iris/IRIS_nohole_4_1024_v2.fits"))
    # MJy/sr: 0.5 in the cleanest cirrus-free sky, thousands in star-forming clouds.
    return ramp(log_scale(sample_healpix(degrade(values, nest, 512), nest), 0.6, 1500.0), RAMP_DUST)


def build_h_alpha() -> np.ndarray:
    values, nest = read_healpix(lambda_file("foregrounds/halpha/lambda_halpha_fwhm06_0512.fits"))
    # Rayleighs: 0.5 at high latitude, hundreds in the bright nebulae.
    return ramp(asinh_scale(sample_healpix(values, nest), 0.3, 1.5, 500.0), RAMP_HALPHA)


# COBE's quadrilateralized spherical cube: six faces of 2^(res-1) squared pixels in ecliptic coordinates.
# Unit vector of a point (xi, eta) on the tangent plane of each face (COBE's routine XYAXIS).
CUBE_FACES = (
    lambda xi, eta: (-eta, xi, 1.0),
    lambda xi, eta: (1.0, xi, eta),
    lambda xi, eta: (-xi, 1.0, eta),
    lambda xi, eta: (-1.0, -xi, eta),
    lambda xi, eta: (xi, -1.0, eta),
    lambda xi, eta: (eta, xi, -1.0),
)
# J2000 mean obliquity, degrees: ecliptic -> equatorial is a rotation about x by this angle.
OBLIQUITY_DEG = 23.4392911
ICRS_TO_GALACTIC = np.array(
    [
        [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
        [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
        [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
    ]
)


def quadcube_vectors(resolution: int) -> np.ndarray:
    """Ecliptic unit vectors (N x 3) of the pixel centres of a COBE sky cube, in pixel-number order.

    A pixel number is face * 4^(res-1) plus the bit-interleaved (x, y) position on the face, x in the even
    bits. The curvature of the cube (pixel position -> tangent plane) is the COBE "CSC" projection that
    FITS WCS standardised, so it is taken from WCSLIB through astropy rather than retyped here.
    """
    side = 2 ** (resolution - 1)
    index = np.arange(side * side)
    ix = np.zeros_like(index)
    iy = np.zeros_like(index)
    for bit in range(resolution - 1):
        ix |= ((index >> (2 * bit)) & 1) << bit
        iy |= ((index >> (2 * bit + 1)) & 1) << bit
    # Face coordinates in -1..1, then as degrees on the central face of a CSC projection (45 deg to the edge).
    x = (ix + 0.5) / side * 2 - 1
    y = (iy + 0.5) / side * 2 - 1
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---CSC", "DEC--CSC"]
    wcs.wcs.crval = [0.0, 0.0]
    wcs.wcs.crpix = [1.0, 1.0]
    # Plain degrees with longitude increasing with x, so the central face is the cube's +x face seen from inside.
    wcs.wcs.cdelt = [1.0, 1.0]
    phi, theta = wcs.all_pix2world(x * 45.0, y * 45.0, 0)
    phi, theta = np.radians(phi), np.radians(theta)
    xi = np.tan(phi)
    eta = np.tan(theta) / np.cos(phi)
    vectors = np.empty((6 * side * side, 3))
    for face, axes in enumerate(CUBE_FACES):
        vx, vy, vz = axes(xi, eta)
        block = np.stack(np.broadcast_arrays(vx, vy, vz), axis=-1).astype(np.float64)
        vectors[face * side * side : (face + 1) * side * side] = block / np.linalg.norm(block, axis=-1, keepdims=True)
    return vectors


def ecliptic_to_galactic(vectors: np.ndarray) -> np.ndarray:
    e = np.radians(OBLIQUITY_DEG)
    ecliptic_to_icrs = np.array([[1, 0, 0], [0, np.cos(e), -np.sin(e)], [0, np.sin(e), np.cos(e)]])
    return vectors @ (ICRS_TO_GALACTIC @ ecliptic_to_icrs).T


def dirbe_band(band: str) -> np.ndarray:
    """One DIRBE zodi-subtracted mission-average map, MJy/sr, as HEALPix nside 128 RING in galactic coordinates."""
    path = lambda_file(f"cobe/dirbe/zsma/DIRBE_BAND{band}_ZSMA.FITS")
    with fits.open(path) as hdul:
        data = hdul[1].data
        resolution = hdul[0].header["PIXRESOL"]
        pixel, signal = np.asarray(data["Pixel_no"]), np.asarray(data["Resid"], dtype=np.float64)
    vectors = ecliptic_to_galactic(quadcube_vectors(resolution))[pixel]
    nside = 128
    target = hp.vec2pix(nside, vectors[:, 0], vectors[:, 1], vectors[:, 2])
    good = np.isfinite(signal) & (signal > -1e10)
    total = np.bincount(target[good], weights=signal[good], minlength=hp.nside2npix(nside))
    count = np.bincount(target[good], minlength=hp.nside2npix(nside))
    values = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    # The few HEALPix pixels no cube pixel centre fell in take the mean of their neighbours.
    for empty in np.flatnonzero(count == 0):
        around = hp.get_all_neighbours(nside, empty)
        values[empty] = np.nanmean(values[around[around >= 0]])
    return values


def build_near_ir() -> np.ndarray:
    # Red, green, blue = 3.5, 2.2 and 1.25 micrometres: cool giants and dust-reddened starlight turn orange.
    channels = []
    for band, (low, soft, high) in (("3A", (0.04, 0.5, 40.0)), ("2A", (0.06, 0.8, 60.0)), ("1A", (0.08, 0.9, 60.0))):
        channels.append(np.clip(asinh_scale(sample_healpix(dirbe_band(band), nest=False), low, soft, high), 0, 1))
    return np.stack(channels, axis=-1)


# ---------------------------------------------------------------------------
# High energies (images resampled by NASA SkyView)


def skyview(survey: str) -> np.ndarray:
    """An all-sky image from SkyView in this script's own layout, rows north to south."""
    query = urllib.parse.urlencode(
        {
            "Position": "0.,0.",
            "coordinates": "Galactic",
            "survey": survey,
            "projection": "Car",
            "pixels": f"{WIDTH},{HEIGHT}",
            "size": "360,180",
            "sampler": "Clip",
            "Return": "FITS",
        }
    )
    path = cached_fetch(f"{SKYVIEW}?{query}", f"skymaps/skyview_{survey.replace(' ', '_')}_{WIDTH}.fits", timeout=1800)
    with fits.open(path) as hdul:
        header, data = hdul[0].header, np.asarray(hdul[0].data, dtype=np.float64)
    # SkyView's plate carree has l = 0 at the centre increasing to the left: check, then turn north up.
    assert header["CTYPE1"].startswith("GLON") and header["CDELT1"] < 0 and header["CDELT2"] > 0
    assert abs(header["CRVAL1"]) < 1e-9 and abs(header["CRPIX1"] - (WIDTH + 1) / 2) < 1e-6
    return data[::-1]


def box_blur(image: np.ndarray, radius: int) -> np.ndarray:
    """Mean over (2r+1)^2 pixels, wrapping in longitude: tames photon noise in the faint sky."""
    if radius <= 0:
        return image
    padded = np.concatenate([image[:, -radius:], image, image[:, :radius]], axis=1)
    padded = np.concatenate([padded[:1].repeat(radius, 0), padded, padded[-1:].repeat(radius, 0)], axis=0)
    total = np.cumsum(np.cumsum(np.nan_to_num(padded), axis=0), axis=1)
    total = np.pad(total, ((1, 0), (1, 0)))
    size = 2 * radius + 1
    summed = total[size:, size:] - total[:-size, size:] - total[size:, :-size] + total[:-size, :-size]
    return summed / (size * size)


def build_xray_rosat() -> np.ndarray:
    # Snowden et al. 1997 bands, point sources removed, 1e-6 counts/s/arcmin2:
    # R1+R2 = 1/4 keV (red), R4+R5 = 3/4 keV (green), R6+R7 = 1.5 keV (blue), the survey's own colour convention.
    # Each band runs from its 20th percentile (the faintest fifth of the sky is black) to its 99.7th.
    channels = []
    for bands in (("RASSBCK1", "RASSBCK2"), ("RASSBCK4", "RASSBCK5"), ("RASSBCK6", "RASSBCK7")):
        total = box_blur(sum(np.clip(np.nan_to_num(skyview(band)), 0, None) for band in bands), 1)
        low, high = np.percentile(total[total > 0], [20, 99.7])
        print(f"  ROSAT {'+'.join(bands)}: black at {low:.0f}, white at {high:.0f} (1e-6 counts/s/arcmin2)")
        channels.append(np.clip(asinh_scale(total, low, (high - low) / 4, high), 0, 1))
    return np.stack(channels, axis=-1)


def build_gamma_fermi() -> np.ndarray:
    # Bands 4 (1-3 GeV) and 5 (3-300 GeV), photons/cm2/s/sr, logarithmic from the median sky to the 99.9th percentile.
    total = box_blur(sum(np.clip(np.nan_to_num(skyview(band)), 0, None) for band in ("Fermi 4", "Fermi 5")), 1)
    low, high = np.percentile(total, [50, 99.9])
    print(f"  Fermi: black at {low:.3g}, white at {high:.3g} photons/cm2/s/sr")
    return ramp(log_scale(total, low, high), RAMP_GAMMA)


# ---------------------------------------------------------------------------
# Galaxies


def build_galaxies_2mass() -> np.ndarray:
    query = urllib.parse.urlencode(
        {"QUERY": f"select glon,glat,k_m_k20fe from fp_xsc where k_m_k20fe<{GALAXY_K_LIMIT}", "FORMAT": "CSV"}
    )
    path = cached_fetch(f"{IRSA_TAP}?{query}", "skymaps/xsc_k135.csv", timeout=3600)
    lon, lat = [], []
    with path.open(encoding="utf-8") as file:
        for row in csv.DictReader(file):
            lon.append(float(row["glon"]))
            lat.append(float(row["glat"]))
    nside = 128
    pixels = hp.ang2pix(nside, np.radians(90.0 - np.array(lat)), np.radians(np.array(lon)))
    counts = np.bincount(pixels, minlength=hp.nside2npix(nside)).astype(np.float64)
    # Galaxies per square degree, smoothed to 1 degree so single galaxies become a density.
    density = smooth_ring(counts / hp.nside2pixarea(nside, degrees=True), 1.0)
    return ramp(asinh_scale(sample_healpix(density, nest=False), 4.0, 12.0, 250.0), RAMP_GALAXIES)


MAPS = {
    "cmb-cobe": build_cmb_cobe,
    "cmb-dipole": build_cmb_dipole,
    "cmb-wmap": build_cmb_wmap,
    "cmb-planck": build_cmb_planck,
    "radio-408": build_radio_408,
    "hi-21cm": build_hi_21cm,
    "dust-100um": build_dust_100um,
    "near-ir": build_near_ir,
    "h-alpha": build_h_alpha,
    "xray-rosat": build_xray_rosat,
    "gamma-fermi": build_gamma_fermi,
    "galaxies-2mass": build_galaxies_2mass,
}


def main() -> None:
    wanted = sys.argv[1:] or list(MAPS)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in wanted:
        colors = MAPS[name]()
        assert colors.shape == (HEIGHT, WIDTH, 3), colors.shape
        path = OUTPUT_DIR / f"{name}.jpg"
        Image.fromarray(np.round(np.clip(colors, 0, 1) * 255).astype(np.uint8), "RGB").save(
            path, "JPEG", quality=JPEG_QUALITY_OVERRIDES.get(name, JPEG_QUALITY), optimize=True, progressive=True
        )
        print(f"wrote {path.name}: {path.stat().st_size / 1000:.0f} kB, mean level {colors.mean():.3f}")


if __name__ == "__main__":
    main()
