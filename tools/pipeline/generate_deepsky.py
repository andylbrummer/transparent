#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the faint and invisible sky.

Writes app/public/sky/deep/*.json (and two packed point clouds, *.bin):
catalogued objects by position, each from a published catalogue. All
positions are ICRS / J2000, in millidegrees.

    dso            Messier, NGC and IC objects        OpenNGC (M. Verga), CC BY-SA 4.0
    xray-hard      hard X-ray sources, 14-195 keV     Swift-BAT 157-month survey (Lien et al. 2025)
    xray-uhuru     the first X-ray sky, 2-6 keV       Fourth Uhuru catalogue (Forman et al. 1978)
    xray-binaries  X-ray binaries of the Galaxy       Liu, van Paradijs & van den Heuvel 2006, 2007
    xray-rosat     soft X-ray sources, 0.1-2.4 keV    ROSAT All-Sky Survey Bright Source Catalogue (Voges et al. 1999)
    gamma          gamma-ray sources, 0.1-100 GeV     Fermi-LAT 4FGL-DR4 (Ballet et al. 2023)
    pulsars        radio pulsars and magnetars        ATNF Pulsar Catalogue (Manchester et al. 2005)
    exoplanets     stars with confirmed planets       NASA Exoplanet Archive, Planetary Systems Composite
    exoplanet-candidates  stars with planet candidates  NASA Exoplanet Archive: TESS TOIs, Kepler KOIs, K2
    nearby         every star within 10 parsecs       The 10 parsec sample (Reyle et al. 2021)
    galaxies       galaxies within 11 Mpc             Updated Nearby Galaxy Catalog (Karachentsev et al. 2013)
    clusters       rich clusters of galaxies          Abell, Corwin & Olowin 1989
    quasars        bright quasars and active nuclei   Veron-Cetty & Veron 2010, 13th edition
    lss            43,000 galaxies with redshifts     2MASS Redshift Survey (Huchra et al. 2012)
    globulars      the Milky Way's globular clusters  Harris 1996 (2010 edition)
    snr            supernova remnants of the Galaxy   Green 2017 (June 2017 version)
    landmarks      single famous objects, directions  SIMBAD; Planck 2018; Schoenrich et al. 2010; JPL Horizons

Catalogues come from NASA's HEASARC (TAP), the CfA mirror of VizieR and
SIMBAD, the NASA Exoplanet Archive (TAP), OpenNGC's GitHub repository and
JPL Horizons. HEASARC serves all positions in J2000, including the
catalogues published in B1950 (4U, Abell). Abell's are precessed here
from his B1950 columns instead (sky_catalog_support.b1950_to_j2000);
test_deepsky.py checks known objects of every catalogue against
independent positions.

Each file holds columns (ra, dec in millidegrees; cls, an index into
`classes`; val, one number per object whose meaning `value` states),
`labels` ([index, text, priority], most important first) and, where sizes
are known, `ellipses` ([index, major arcmin, minor arcmin, position angle
east of north or -1]). How a class or value is drawn is the app's choice
(app/src/layers/deep-sky/). The names given to famous objects (FAMOUS_*)
are the ones in common use; each is attached to a catalogue entry by its
designation, and the position always comes from the catalogue.

Usage:
    python3 tools/pipeline/generate_deepsky.py            # everything
    python3 tools/pipeline/generate_deepsky.py dso gamma  # some

Raw downloads are cached in tools/pipeline/.cache/deepsky/. Standard library only.
"""

import csv
import json
import math
import re
import struct
import sys
import urllib.parse
from pathlib import Path

from fetch_cache import cached_fetch
from sky_catalog_support import (
    Catalogue,
    b1950_to_j2000,
    galactic_to_icrs,
    heasarc_rows,
    number,
    sexagesimal_dec,
    sexagesimal_ra,
    simbad_position,
    vizier_rows,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "sky" / "deep"

# Positions that move are carried to this epoch, like the stars (generate_stars.py).
EPOCH_YEAR = 2026.0
LIGHT_YEARS_PER_PARSEC = 3.261563777

OPENNGC_URL = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/"

# ---------------------------------------------------------------------------
# Messier, NGC, IC


DSO_MAG_LIMIT = 11.5
# Nebulae often have no magnitude; a big one is kept for its size.
DSO_NEBULA_MIN_ARCMIN = 15.0
# Objects at least this large get their true outline drawn.
DSO_OUTLINE_MIN_ARCMIN = 4.0
DSO_CLASSES = ["galaxy", "open", "globular", "nebula", "planetary", "snr", "dark", "other"]
OPENNGC_TYPES = {
    "G": "galaxy",
    "GPair": "galaxy",
    "GTrpl": "galaxy",
    "GGroup": "galaxy",
    "OCl": "open",
    "*Ass": "open",
    "GCl": "globular",
    "Cl+N": "nebula",
    "HII": "nebula",
    "EmN": "nebula",
    "RfN": "nebula",
    "Neb": "nebula",
    "PN": "planetary",
    "SNR": "snr",
    "DrkN": "dark",
    "**": "other",
}


# Where OpenNGC lists several common names and the first is not the usual one: which to show (0-based).
DSO_PREFERRED_NAME = {
    "NGC6705": 1,  # Wild Duck Cluster
    "NGC0650": 2,  # Little Dumbbell Nebula
    "NGC6618": 3,  # omega Nebula
    "NGC2070": 1,  # Tarantula Nebula
    "NGC1976": 1,  # Orion Nebula
    "NGC6302": 1,  # Butterfly Nebula
}


def catalogue_name(name: str) -> str:
    """'NGC0224' -> 'NGC 224', 'IC0434' -> 'IC 434'; other designations as they are."""
    match = re.fullmatch(r"(NGC|IC)0*(\d+)(.*)", name)
    return f"{match.group(1)} {match.group(2)}{match.group(3)}" if match else name


def build_dso() -> Catalogue:
    rows: list[dict[str, str]] = []
    for file in ("NGC.csv", "addendum.csv"):
        path = cached_fetch(OPENNGC_URL + file, f"deepsky/openngc_{file}")
        rows += list(csv.DictReader(path.read_text(encoding="utf-8").splitlines(), delimiter=";"))
    out = Catalogue(
        "OpenNGC by Mattia Verga and contributors, CC BY-SA 4.0, https://github.com/mattiaverga/OpenNGC",
        DSO_CLASSES,
        "V magnitude x 10 (B where OpenNGC has no V; 999 where it has neither)",
    )
    kept = []
    for row in rows:
        cls = OPENNGC_TYPES.get(row["Type"])
        if cls is None and row["M"] and row["Type"] != "Dup":
            # M73 is four stars (OpenNGC type 'Other'), but it is on Messier's list.
            cls = "other"
        if cls is None or not row["RA"] or not row["Dec"]:
            continue
        mag = number(row["V-Mag"])
        if mag is None:
            mag = number(row["B-Mag"])
        major = number(row["MajAx"])
        messier = int(row["M"]) if row["M"] else None
        names = [name.strip() for name in row["Common names"].split(",")] if row["Common names"] else [""]
        common = names[DSO_PREFERRED_NAME.get(row["Name"], 0)]
        wanted = (
            messier is not None
            or bool(common)
            or (mag is not None and mag <= DSO_MAG_LIMIT)
            or (cls in ("nebula", "snr", "dark") and major is not None and major >= DSO_NEBULA_MIN_ARCMIN)
        )
        if wanted:
            kept.append((mag if mag is not None else 99.0, row, cls, mag, major, messier, common))
    kept.sort(key=lambda entry: (entry[0], entry[1]["Name"]))
    for _, row, cls, mag, major, messier, common in kept:
        index = out.add(sexagesimal_ra(row["RA"]), sexagesimal_dec(row["Dec"]), cls, 999 if mag is None else round(mag * 10))
        designation = f"M{messier}" if messier is not None else catalogue_name(row["Name"])
        rank = mag if mag is not None else 12.0
        if messier is not None:
            # Messier's objects come first: where the Orion Nebula and a neighbouring cluster compete, M42 wins.
            out.label(index, f"{designation} {common}".strip(), rank - 2)
        elif common:
            out.label(index, common, rank + 1.5)
        elif mag is not None and mag <= 9.0:
            out.label(index, designation, rank + 4)
        if major is not None and major >= DSO_OUTLINE_MIN_ARCMIN:
            minor = number(row["MinAx"])
            angle = number(row["PosAng"])
            if minor is None or (angle is None and abs(minor - major) > 0.01 * major):
                # Without both a minor axis and its orientation the honest outline is the circle of the major axis.
                out.ellipse(index, major, major, None)
            else:
                out.ellipse(index, major, minor, angle if angle is not None else 0)
    return out


# ---------------------------------------------------------------------------
# X-rays

BAT_CLASSES = ["xrb", "pulsar-snr", "star", "agn", "beamed-agn", "cluster", "unknown"]
BAT_TYPES = {
    "LMXB": "xrb",
    "HMXB": "xrb",
    "XRB": "xrb",
    "Pulsar": "pulsar-snr",
    "SNR": "pulsar-snr",
    "CV": "star",
    "Nova": "star",
    "Symbiotic star": "star",
    "Star": "star",
    "star": "star",
    "Beamed AGN": "beamed-agn",
    "Blazar": "beamed-agn",
    "FSRQ": "beamed-agn",
    "Possible Blazar": "beamed-agn",
    "Galaxy Cluster": "cluster",
    "Compact group of galaxies": "cluster",
    "Galaxy in Group of Galaxies": "cluster",
}
BAT_AGN_PREFIXES = ("Sy", "LINER", "Other AGN", "Galaxy", "Starburst", "Interacting", "Tidal")


def flux_value(flux: float | None, unit: float) -> int:
    """log10(flux / unit) x 100, or -1 where the catalogue has no flux."""
    return -1 if flux is None or flux <= 0 else max(0, round(math.log10(flux / unit) * 100))


def build_xray_hard() -> Catalogue:
    rows = heasarc_rows("swbat157m", ["name", "ra", "dec", "flux", "source_type", "ctrpart_name"])
    out = Catalogue(
        "Swift-BAT 157-Month All-Sky Hard X-Ray Survey (Lien et al. 2025), via NASA HEASARC table swbat157m",
        BAT_CLASSES,
        "log10(14-195 keV flux / 1e-12 erg cm-2 s-1) x 100; -1: none given",
    )
    rows.sort(key=lambda row: -(number(row["flux"]) or 0))
    per_class: dict[str, int] = {}
    for row in rows:
        kind = row["source_type"] or "Unknown"
        cls = BAT_TYPES.get(kind) or ("agn" if kind.startswith(BAT_AGN_PREFIXES) else "unknown")
        flux = number(row["flux"])
        index = out.add(float(row["ra"]), float(row["dec"]), cls, flux_value(flux, 1e-12))
        seen = per_class.get(cls, 0)
        per_class[cls] = seen + 1
        # The brightest of each kind are named: 40 binaries, a dozen or so of the rest.
        quota = {"xrb": 40, "agn": 25, "beamed-agn": 12, "cluster": 12, "pulsar-snr": 14, "star": 8, "unknown": 0}[cls]
        if flux is not None and seen < quota and row["ctrpart_name"]:
            out.label(index, row["ctrpart_name"], -math.log10(flux))
    return out


def uhuru_common_name(comments: str | None) -> str | None:
    """The familiar name in the 4U comments column, when it is of the 'Sco X-1' / 'GX5-1' kind."""
    if not comments:
        return None
    match = re.search(r"\b([A-Z]{3})\s?X-?(\d)\b", comments)
    if match:
        return f"{match.group(1).capitalize()} X-{match.group(2)}"
    match = re.search(r"\bGX\s?(\d+(?:\.\d+)?[+-]\d+(?:\.\d+)?)", comments)
    return f"GX {match.group(1)}" if match else None


def build_xray_uhuru() -> Catalogue:
    rows = heasarc_rows("uhuru4", ["name", "ra", "dec", "count_rate", "comments"])
    out = Catalogue(
        "Fourth Uhuru Catalog of X-ray Sources (Forman et al. 1978, ApJS 38, 357), via NASA HEASARC table uhuru4",
        ["source"],
        "log10(2-6 keV intensity in Uhuru counts/s) x 100 (the Crab is 947 counts/s)",
    )
    rows.sort(key=lambda row: -(number(row["count_rate"]) or 0))
    for order, row in enumerate(rows):
        rate = number(row["count_rate"])
        index = out.add(float(row["ra"]), float(row["dec"]), "source", max(0, round(math.log10(max(rate or 1, 1)) * 100)))
        if order < 60:
            name = re.sub(r"^4U", "4U ", row["name"] or "")
            common = uhuru_common_name(row["comments"])
            out.label(index, f"{common} ({name})" if common else name, order)
    return out


def familiar_xray_name(row: dict[str, str | None], alternatives: list[str]) -> str:
    """'Cyg X-1' or 'GX 301-2' where the catalogue lists one among the alternative names, else its own name."""
    for key in alternatives:
        name = row[key]
        if name and (re.search(r" X-\d", name) or name.startswith("GX ")):
            return name
    return row["name"] or ""


def build_xray_binaries() -> Catalogue:
    out = Catalogue(
        "Liu, van Paradijs & van den Heuvel: Catalogue of high-mass X-ray binaries in the Galaxy (4th ed., 2006) and "
        "of low-mass X-ray binaries (4th ed., 2007), via NASA HEASARC tables hmxbcat and lmxbcat",
        ["hmxb", "lmxb"],
        "log10(largest 2-10 keV flux in microjansky) x 100; -1: none given",
    )
    entries = []
    for row in heasarc_rows("hmxbcat", ["name", "alt_name_1", "alt_name_2", "alt_name_3", "ra", "dec", "fx", "fx_max"]):
        name = familiar_xray_name(row, ["alt_name_1", "alt_name_2", "alt_name_3"])
        entries.append(("hmxb", row, name, max(number(row["fx"]) or 0, number(row["fx_max"]) or 0)))
    for row in heasarc_rows("lmxbcat", ["name", "alt_name_1", "alt_name_2", "ra", "dec", "flux", "flux_max"]):
        name = familiar_xray_name(row, ["alt_name_1", "alt_name_2"])
        entries.append(("lmxb", row, name, max(number(row["flux"]) or 0, number(row["flux_max"]) or 0)))
    entries.sort(key=lambda entry: -entry[3])
    for order, (cls, row, name, flux) in enumerate(entries):
        if row["ra"] is None or row["dec"] is None:
            continue
        index = out.add(float(row["ra"]), float(row["dec"]), cls, flux_value(flux or None, 1.0))
        if order < 70:
            out.label(index, name, order)
    return out


def write_cloud(name: str, source: str, value: str, points: list[tuple[float, float, int]]) -> dict:
    """Pack a big point cloud: per point uint16 ra (65536 per turn), int16 dec (32767 per 90 deg), uint16 value."""
    packed = bytearray()
    for ra, dec, val in points:
        packed += struct.pack("<HhH", round(ra / 360 * 65536) % 65536, round(dec / 90 * 32767), max(0, min(65535, val)))
    (OUTPUT_DIR / f"{name}.bin").write_bytes(bytes(packed))
    return {
        "source": source,
        "frame": "ICRS",
        "count": len(points),
        "file": f"{name}.bin",
        "layout": "little-endian records: uint16 ra (65536 per turn), int16 dec (32767 per 90 deg), uint16 value",
        "value": value,
    }


def build_xray_rosat() -> dict:
    rows = heasarc_rows("rassbsc", ["ra", "dec", "count_rate"])
    points = [(float(r["ra"]), float(r["dec"]), round((number(r["count_rate"]) or 0) * 100)) for r in rows]
    points.sort(key=lambda point: -point[2])
    return write_cloud(
        "xray-rosat",
        "ROSAT All-Sky Survey Bright Source Catalogue (Voges et al. 1999, A&A 349, 389), via NASA HEASARC table rassbsc",
        "PSPC count rate, 0.1-2.4 keV, in 0.01 counts/s (capped at 655)",
        points,
    )


# ---------------------------------------------------------------------------
# Gamma rays

GAMMA_CLASSES = ["pulsar", "snr-pwn", "blazar", "agn", "galaxy", "binary", "globular", "unassociated"]
GAMMA_TYPES = {
    "psr": "pulsar",
    "msp": "pulsar",
    "pwn": "snr-pwn",
    "snr": "snr-pwn",
    "spp": "snr-pwn",
    "bll": "blazar",
    "fsrq": "blazar",
    "bcu": "blazar",
    "rdg": "agn",
    "agn": "agn",
    "sey": "agn",
    "nlsy1": "agn",
    "css": "agn",
    "ssrq": "agn",
    "gal": "galaxy",
    "sbg": "galaxy",
    "sfr": "galaxy",
    "hmb": "binary",
    "lmb": "binary",
    "bin": "binary",
    "nov": "binary",
    "glc": "globular",
    "gc": "pulsar-none",
}


def build_gamma() -> Catalogue:
    rows = heasarc_rows(
        "fermilpsc", ["name", "ra", "dec", "energy_flux", "source_type", "assoc_name", "extended_source_name"]
    )
    out = Catalogue(
        "Fermi Large Area Telescope Fourth Source Catalog, Data Release 4 (4FGL-DR4; Abdollahi et al. 2022, "
        "Ballet et al. 2023), via NASA HEASARC table fermilpsc",
        GAMMA_CLASSES,
        "log10(100 MeV-100 GeV energy flux / 1e-13 erg cm-2 s-1) x 100",
    )
    rows.sort(key=lambda row: -(number(row["energy_flux"]) or 0))
    for order, row in enumerate(rows):
        kind = (row["source_type"] or "").lower()
        cls = GAMMA_TYPES.get(kind, "unassociated")
        if cls == "pulsar-none":
            # 'GC' is the Galactic centre source itself: no class of ours; keep it among the unassociated.
            cls = "unassociated"
        flux = number(row["energy_flux"])
        index = out.add(float(row["ra"]), float(row["dec"]), cls, flux_value(flux, 1e-13))
        name = row["extended_source_name"] or row["assoc_name"]
        if name and name.startswith("PSR "):
            name = FAMOUS_PULSARS.get(name[4:], name)
        if order < 90 and name:
            out.label(index, name, order)
    return out


# ---------------------------------------------------------------------------
# Pulsars

PULSAR_CLASSES = ["normal", "millisecond", "magnetar"]
MILLISECOND_LIMIT_S = 0.030
# Catalogue J name -> the name the pulsar is known by.
FAMOUS_PULSARS = {
    "J0534+2200": "Crab pulsar",
    "J0835-4510": "Vela pulsar",
    "J0633+1746": "Geminga",
    "J1921+2153": "PSR B1919+21 · first pulsar found",
    "J1915+1606": "Hulse–Taylor pulsar B1913+16",
    "J0737-3039A": "Double pulsar J0737−3039",
    "J0437-4715": "PSR J0437−4715",
    "J1939+2134": "PSR B1937+21",
    "J1300+1240": "PSR B1257+12",
    "J1808-2024": "SGR 1806−20",
    "J1907+0919": "SGR 1900+14",
    "J1856-3754": "RX J1856.5−3754",
    "J0030+0451": "PSR J0030+0451",
    "J0740+6620": "PSR J0740+6620",
    "J0952-0607": "PSR J0952−0607",
    "J0540-6919": "PSR B0540−69 (LMC)",
    "J1614-2230": "PSR J1614−2230",
    "J0348+0432": "PSR J0348+0432",
    "J2144-3933": "PSR J2144−3933",
    "J1809-1943": "XTE J1810−197",
}


def build_pulsars() -> Catalogue:
    rows = heasarc_rows(
        "atnfpulsar", ["name", "alt_name", "ra", "dec", "period", "pulsar_type", "flux_1400_mhz", "discovery_date"]
    )
    out = Catalogue(
        "ATNF Pulsar Catalogue (Manchester, Hobbs, Teoh & Hobbs 2005, AJ 129, 1993; "
        "https://www.atnf.csiro.au/research/pulsar/psrcat), via NASA HEASARC table atnfpulsar",
        PULSAR_CLASSES,
        "log10(spin period in milliseconds) x 100; -1: no period published",
    )
    rows = [row for row in rows if row["ra"] is not None and row["dec"] is not None]
    rows.sort(key=lambda row: -(number(row["flux_1400_mhz"]) or 0))
    fastest = min((row for row in rows if number(row["period"])), key=lambda row: number(row["period"]))
    for order, row in enumerate(rows):
        period = number(row["period"])
        kind = row["pulsar_type"] or ""
        if "AXP" in kind:
            cls = "magnetar"
        elif period is not None and period < MILLISECOND_LIMIT_S:
            cls = "millisecond"
        else:
            cls = "normal"
        value = -1 if period is None else round(math.log10(period * 1000) * 100)
        index = out.add(float(row["ra"]), float(row["dec"]), cls, value)
        j_name = (row["name"] or "").replace("PSR ", "")
        if j_name in FAMOUS_PULSARS:
            out.label(index, FAMOUS_PULSARS[j_name], list(FAMOUS_PULSARS).index(j_name) / 10)
        elif row is fastest:
            out.label(index, f"PSR {j_name} · fastest known, {1 / period:.0f} Hz", 2.5)
        elif order < 45 and not j_name.endswith("_P"):
            # The brightest at 1400 MHz, under the B1950 names they are still known by.
            out.label(index, row["alt_name"] or row["name"], 10 + order)
        elif cls == "magnetar":
            out.label(index, row["alt_name"] or row["name"], 100 + order)
    return out


# ---------------------------------------------------------------------------
# Exoplanet hosts

EXOPLANET_QUERY = (
    "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query="
    + urllib.parse.quote("select hostname,ra,dec,sy_pnum,sy_dist,sy_vmag,discoverymethod from pscomppars")
    + "&format=csv"
)
EXOPLANET_CLASSES = ["transit", "radial-velocity", "imaging", "microlensing", "other"]
EXOPLANET_METHODS = {
    "Transit": "transit",
    "Radial Velocity": "radial-velocity",
    "Imaging": "imaging",
    "Microlensing": "microlensing",
}
# Hosts named whatever their brightness: firsts and the systems people know.
FAMOUS_HOSTS = [
    "51 Peg",
    "TRAPPIST-1",
    "Proxima Cen",
    "tau Cet",
    "55 Cnc",
    "HD 209458",
    "HD 189733",
    "Kepler-186",
    "Kepler-452",
    "KOI-351",
    "Kepler-16",
    "Kepler-22",
    "eps Eri",
    "bet Pic",
    "HR 8799",
    "GJ 1214",
    "GJ 667 C",
    "WASP-12",
    "WASP-39",
    "WASP-121",
    "K2-18",
    "LHS 1140",
    "TOI-700",
    "Barnard's star",
    "PSR B1257+12",
    "ups And",
    "47 UMa",
    "70 Vir",
    "HD 10180",
    "Kepler-11",
    "Kepler-444",
    "CoRoT-7",
    "OGLE-2005-BLG-390L",
    "2MASS J12073346-3932539",
    "Teegarden's Star",
    "GJ 876",
    "GJ 581",
    "GJ 436",
    "alf Tau",
    "gam Cep",
    "HD 80606",
    "HAT-P-7",
    "TrES-2",
    "LTT 9779",
    "TOI-1338 A",
]


# The archive files Kepler-90 under its Kepler Object of Interest number.
HOST_DISPLAY_NAMES = {"KOI-351": "Kepler-90"}


def build_exoplanets() -> Catalogue:
    path = cached_fetch(EXOPLANET_QUERY, "deepsky/exoplanet_pscomppars.csv")
    planets = list(csv.DictReader(path.read_text(encoding="utf-8").splitlines()))
    hosts: dict[str, dict] = {}
    for planet in planets:
        if not planet["ra"] or not planet["dec"]:
            continue
        host = hosts.setdefault(
            planet["hostname"],
            {
                "ra": float(planet["ra"]),
                "dec": float(planet["dec"]),
                "planets": 0,
                "methods": [],
                "dist": number(planet["sy_dist"]),
                "vmag": number(planet["sy_vmag"]),
            },
        )
        host["planets"] += 1
        host["methods"].append(planet["discoverymethod"])
    out = Catalogue(
        "NASA Exoplanet Archive, Planetary Systems Composite Parameters table (pscomppars), "
        "https://exoplanetarchive.ipac.caltech.edu, doi:10.26133/NEA13",
        EXOPLANET_CLASSES,
        "number of confirmed planets",
    )
    order = sorted(hosts, key=lambda name: (-hosts[name]["planets"], hosts[name]["vmag"] or 99, name))
    for name in order:
        host = hosts[name]
        # A system found by several methods is filed under its first planet's.
        cls = EXOPLANET_METHODS.get(host["methods"][0], "other")
        index = out.add(host["ra"], host["dec"], cls, host["planets"])
        count = host["planets"]
        text = f"{greek(HOST_DISPLAY_NAMES.get(name, name))} · {count} planet{'s' if count > 1 else ''}"
        if name in FAMOUS_HOSTS:
            out.label(index, text, FAMOUS_HOSTS.index(name) / 10)
        elif count >= 5:
            out.label(index, text, 10 - count)
        elif host["vmag"] is not None and host["vmag"] <= 5.0:
            out.label(index, text, 10 + host["vmag"])
        elif host["dist"] is not None and host["dist"] <= 6.0:
            out.label(index, text, 16 + host["dist"])
    return out


# ---------------------------------------------------------------------------
# Exoplanet candidates: signals each mission's team counts as a planet, not yet confirmed or ruled out


def archive_query(adql: str) -> str:
    return "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=" + urllib.parse.quote(adql) + "&format=csv"


# Mission, query, the column naming the host, how a host is shown. TESS's own team disposition (TFOPWG): PC planet
# candidate, APC ambiguous planet candidate; the rest are confirmed (CP, KP, in `exoplanets`) or false (FP, FA).
CANDIDATE_SOURCES = [
    (
        "tess",
        archive_query("select toi,tid,ra,dec from toi where tfopwg_disp in ('PC','APC')"),
        "tid",
        lambda row: f"TOI-{row['toi'].split('.')[0]}",
    ),
    (
        "kepler",
        archive_query("select kepoi_name,kepid,ra,dec from cumulative where koi_disposition = 'CANDIDATE'"),
        "kepid",
        lambda row: f"KOI-{int(row['kepoi_name'][1:].split('.')[0])}",
    ),
    (
        "k2",
        archive_query("select pl_name,hostname,ra,dec from k2pandc where default_flag = 1 and disposition = 'CANDIDATE'"),
        "hostname",
        lambda row: row["hostname"],
    ),
]
# Hosts with this many candidates or more are named.
CANDIDATE_LABEL_MIN = 3


def build_exoplanet_candidates() -> Catalogue:
    out = Catalogue(
        "NASA Exoplanet Archive: TESS Project Candidates (toi, TFOPWG PC and APC), Kepler Objects of Interest "
        "cumulative table (CANDIDATE), K2 Planets and Candidates (CANDIDATE), https://exoplanetarchive.ipac.caltech.edu",
        [mission for mission, *_ in CANDIDATE_SOURCES],
        "number of planet candidates at the star",
    )
    for mission, url, host_column, host_name in CANDIDATE_SOURCES:
        path = cached_fetch(url, f"deepsky/candidates_{mission}.csv")
        hosts: dict[str, dict] = {}
        for row in csv.DictReader(path.read_text(encoding="utf-8").splitlines()):
            if not row["ra"] or not row["dec"]:
                continue
            host = hosts.setdefault(row[host_column], {"ra": float(row["ra"]), "dec": float(row["dec"]), "count": 0, "name": host_name(row)})
            host["count"] += 1
        for host in sorted(hosts.values(), key=lambda h: (-h["count"], h["name"])):
            index = out.add(host["ra"], host["dec"], mission, host["count"])
            if host["count"] >= CANDIDATE_LABEL_MIN:
                out.label(index, f"{host['name']} · {host['count']} candidates", 10 - host["count"])
    return out


# ---------------------------------------------------------------------------
# The 10 parsec sample

NEARBY_CLASSES = ["star", "low-mass", "brown-dwarf", "white-dwarf"]
NEARBY_TYPES = {"*": "star", "LM": "low-mass", "BD": "brown-dwarf", "WD": "white-dwarf"}
NEARBY_LABEL_LIMIT_PC = 5.0
GREEK = {
    "alf": "α", "bet": "β", "gam": "γ", "del": "δ", "eps": "ε", "zet": "ζ", "eta": "η", "tet": "θ", "iot": "ι",
    "kap": "κ", "lam": "λ", "mu.": "μ", "nu.": "ν", "ksi": "ξ", "omi": "ο", "pi.": "π", "rho": "ρ", "sig": "σ",
    "tau": "τ", "ups": "υ", "phi": "φ", "chi": "χ", "psi": "ψ", "ome": "ω",
}  # fmt: skip


def greek(name: str) -> str:
    """SIMBAD's 'alf Cen A' -> 'α Cen A'."""
    head = name[:3]
    return GREEK[head] + name[3:].replace("0", "", 1) if head in GREEK and name[3:4] in " 0" else name


# Proper names that say more than the Bayer letter; elsewhere 'α Cen A' beats 'Rigil Kentaurus'.
NEARBY_PROPER_NAMES = ("Sirius", "Procyon", "Proxima", "Altair", "Vega", "Fomalhaut", "Pollux", "Arcturus", "Capella")
NEARBY_NAKED_EYE_MAG = 4.0
NEARBY_CATALOGUE_PREFIXES = ("HD ", "GJ ", "G ", "BD", "L ", "LP ", "LHS ")


def nearby_name(object_name: str, common: str) -> str:
    """The catalogue's common name, except that a Bayer designation outranks an obscure proper name."""
    if common.startswith(NEARBY_PROPER_NAMES):
        return common
    # 'HD 95735' is better known as Lalande 21185; 'Wolf 359' is better known than its variable-star name CN Leo.
    if common and object_name.startswith(NEARBY_CATALOGUE_PREFIXES):
        return common
    return greek(object_name)


def build_nearby() -> Catalogue:
    rows = vizier_rows("J/A+A/650/A201/tablea1", "reyle_10pc.tsv")
    out = Catalogue(
        "The 10 parsec sample in the Gaia era (Reyle et al. 2021, A&A 650, A201; 2023 update), CDS J/A+A/650/A201",
        NEARBY_CLASSES,
        "distance in hundredths of a light-year",
    )
    objects = []
    for row in rows:
        cls = NEARBY_TYPES.get(row["ObjType"])
        parallax = number(row["plx"])
        if cls is None or not parallax or not row["RAICRS"]:
            continue
        ra, dec = float(row["RAICRS"]), float(row["DEICRS"])
        years = EPOCH_YEAR - float(row["Epoch"])
        pm_ra, pm_dec = number(row["pmRA"]) or 0.0, number(row["pmDE"]) or 0.0
        cos_dec = math.cos(math.radians(dec))
        if cos_dec > 1e-6:
            ra += pm_ra * years / 3.6e6 / cos_dec
        dec += pm_dec * years / 3.6e6
        name = nearby_name(row["ObjName"], row["Common"])
        objects.append((1000 / parallax, ra % 360, dec, cls, name, number(row["Vmag"])))
    objects.sort()
    for parsecs, ra, dec, cls, name, vmag in objects:
        light_years = parsecs * LIGHT_YEARS_PER_PARSEC
        index = out.add(ra, dec, cls, round(light_years * 100))
        if parsecs <= NEARBY_LABEL_LIMIT_PC or (vmag is not None and vmag <= NEARBY_NAKED_EYE_MAG):
            out.label(index, f"{name} · {light_years:.1f} ly", parsecs)
    return out


# ---------------------------------------------------------------------------
# Galaxies of the Local Volume

GALAXY_CLASSES = ["local-group", "nearby"]
# The Local Group's zero-velocity surface lies about a megaparsec out (Karachentsev et al. 2009).
LOCAL_GROUP_LIMIT_MPC = 1.4


def galaxy_name(name: str) -> str:
    """'MESSIER031' -> 'M31', 'NGC0224' -> 'NGC 224'."""
    match = re.fullmatch(r"MESSIER0*(\d+)", name)
    if match:
        return f"M{match.group(1)}"
    match = re.fullmatch(r"(NGC|IC|UGC|UGCA|DDO|ESO|KK|KKH|KKR|KDG|PGC)\s*0*(\d.*)", name)
    if match:
        return f"{match.group(1)} {match.group(2)}"
    # 'LeoI' -> 'Leo I', 'BootesIII' -> 'Bootes III'
    return re.sub(r"(?<=[a-z])(?=[IVX]+$)", " ", name)


def build_galaxies() -> Catalogue:
    rows = vizier_rows("J/AJ/145/101/catalog", "karachentsev_ungc.tsv", "-out=Name,RAJ2000,DEJ2000,a26,Bmag,Dist")
    out = Catalogue(
        "Updated Nearby Galaxy Catalog (Karachentsev, Makarov & Kaisina 2013, AJ 145, 101), CDS J/AJ/145/101",
        GALAXY_CLASSES,
        "distance in hundredths of a megaparsec",
    )
    galaxies = []
    for row in rows:
        distance = number(row["Dist"])
        # The catalogue's first entry is the Milky Way itself, placed at its centre.
        if distance is None or not row["RAJ2000"] or row["Name"].replace(" ", "") == "MilkyWay":
            continue
        mag = number(row["Bmag"])
        galaxies.append((mag if mag is not None else 99.0, distance, row))
    galaxies.sort(key=lambda entry: (entry[0], entry[2]["Name"]))
    for mag, distance, row in galaxies:
        cls = "local-group" if distance <= LOCAL_GROUP_LIMIT_MPC else "nearby"
        index = out.add(sexagesimal_ra(row["RAJ2000"]), sexagesimal_dec(row["DEJ2000"]), cls, round(distance * 100))
        name = galaxy_name(row["Name"])
        text = f"{name} · {distance * 1000:.0f} kpc" if distance < 1 else f"{name} · {distance:.1f} Mpc"
        if cls == "local-group":
            out.label(index, text, min(mag, 20) / 4)
        elif mag <= 10.5:
            out.label(index, text, 5 + mag)
        size = number(row["a26"])
        if size is not None and size >= 20:
            # The Holmberg diameter (to 26.5 mag/arcsec2), as a circle: the catalogue's axis ratio is not carried here.
            out.ellipse(index, size, size, None)
    return out


# ---------------------------------------------------------------------------
# Abell clusters

CLUSTER_CLASSES = ["rich-0", "rich-1", "rich-2", "rich-3", "rich-4", "rich-5"]
# Abell number (S: southern supplement) -> the name in use.
FAMOUS_CLUSTERS = {
    "ABELL1656": "Coma cluster",
    "ABELL426": "Perseus cluster",
    "ABELL2151": "Hercules cluster",
    "ABELL1367": "Leo cluster",
    "ABELL2065": "Corona Borealis cluster",
    "ABELL1060": "Hydra cluster",
    "ABELL3526": "Centaurus cluster",
    "ABELL3558": "Shapley 8 · Shapley supercluster",
    "ABELL3627": "Norma cluster",
    "ABELL373S": "Fornax cluster",
    "ABELL2199": "Abell 2199",
    "ABELL2142": "Abell 2142",
    "ABELL2029": "Abell 2029",
    "ABELL2218": "Abell 2218",
    "ABELL1689": "Abell 1689",
    "ABELL2744": "Abell 2744 · Pandora's cluster",
    "ABELL370": "Abell 370",
    "ABELL1795": "Abell 1795",
    "ABELL2256": "Abell 2256",
    "ABELL2319": "Abell 2319",
    "ABELL85": "Abell 85",
    "ABELL262": "Abell 262",
    "ABELL754": "Abell 754",
    "ABELL3266": "Abell 3266",
    "ABELL3667": "Abell 3667",
    "ABELL2163": "Abell 2163",
    "ABELL520": "Abell 520",
    "ABELL2052": "Abell 2052",
    "ABELL119": "Abell 119",
    "ABELL400": "Abell 400",
    "ABELL496": "Abell 496",
    "ABELL3571": "Abell 3571",
    "ABELL3376": "Abell 3376",
    "ABELL2634": "Abell 2634",
    "ABELL2666": "Abell 2666",
    "ABELL194": "Abell 194",
    "ABELL779": "Abell 779",
    "ABELL1185": "Abell 1185",
    "ABELL2147": "Abell 2147",
    "ABELL2197": "Abell 2197",
    "ABELL3574": "Abell 3574",
    "ABELL3565": "Abell 3565",
    "ABELL569": "Abell 569",
    "ABELL539": "Abell 539",
    "ABELL548": "Abell 548",
    "ABELL1644": "Abell 1644",
    "ABELL1736": "Abell 1736",
    "ABELL3158": "Abell 3158",
    "ABELL3128": "Abell 3128",
    "ABELL3395": "Abell 3395",
    "ABELL3391": "Abell 3391",
    "ABELL3581": "Abell 3581",
    "ABELL4038": "Abell 4038",
    "ABELL2877": "Abell 2877",
    "ABELL2063": "Abell 2063",
    "ABELL2107": "Abell 2107",
    "ABELL2255": "Abell 2255",
    "ABELL1314": "Abell 1314",
    "ABELL1228": "Abell 1228",
    "ABELL347": "Abell 347",
}


def build_clusters() -> Catalogue:
    rows = heasarc_rows("abell", ["name", "ra", "dec", "ra_1950", "dec_1950", "rich", "dist", "redshift"])
    out = Catalogue(
        "A Catalog of Rich Clusters of Galaxies (Abell, Corwin & Olowin 1989, ApJS 70, 1), "
        "via NASA HEASARC table abell",
        CLUSTER_CLASSES,
        "Abell distance class 1 (nearest) to 7; 0: none given",
    )
    rows.sort(key=lambda row: (int(number(row["dist"]) or 9), -(number(row["rich"]) or 0), row["name"]))
    for row in rows:
        rich = int(number(row["rich"]) or 0)
        # Abell's positions are B1950. HEASARC's J2000 columns are the catalogue's printed ones, cut to the arcminute
        # (half an arcminute too near the equator on average); precessing the B1950 columns here does better.
        ra, dec = b1950_to_j2000(float(row["ra_1950"]), float(row["dec_1950"]))
        index = out.add(ra, dec, f"rich-{max(0, min(5, rich))}", int(number(row["dist"]) or 0))
        key = (row["name"] or "").replace(" ", "")
        if key in FAMOUS_CLUSTERS:
            out.label(index, FAMOUS_CLUSTERS[key], list(FAMOUS_CLUSTERS).index(key) / 10)
    # The nearest rich cluster has no Abell number: its galaxies cover too much sky for his counting circle.
    virgo = simbad_position("NAME Virgo Cluster")
    out.label(out.add(virgo[0], virgo[1], "rich-1", 1), "Virgo cluster", 0.05)
    return out


# ---------------------------------------------------------------------------
# Quasars

QUASAR_CLASSES = ["quasar", "blazar", "active-galaxy"]
QUASAR_MAG_LIMIT = 16.5
QUASAR_TYPES = {"Q": "quasar", "Q2": "quasar", "BL": "blazar", "BL?": "blazar", "HP": "blazar"}
FAMOUS_QUASARS = {
    "3C 273": "3C 273",
    "3C 279": "3C 279",
    "3C 48": "3C 48",
    "3C 454.3": "3C 454.3",
    "3C 345": "3C 345",
    "BL Lac": "BL Lacertae",
    "OJ 287": "OJ 287",
    "MARK 421": "Markarian 421",
    "MARK 501": "Markarian 501",
    "MARK 231": "Markarian 231",
    "PKS 2155-304": "PKS 2155−304",
    "Q 0957+561A": "Twin Quasar Q0957+561",
    "Q 2237+0305": "Einstein Cross",
    "APM 08279+5255": "APM 08279+5255",
    "S5 0014+81": "S5 0014+81",
    "TON 618": "TON 618",
    "PG 1634+706": "PG 1634+706",
    "HS 1946+7658": "HS 1946+7658",
    "PKS 0537-441": "PKS 0537−441",
    "PKS 1510-08": "PKS 1510−089",
    "NGC 1275": "NGC 1275 · Perseus A",
    "NGC 4151": "NGC 4151",
    "NGC 1068": "NGC 1068 · M77",
    "NGC 5128": "Centaurus A",
    "NGC 4486": "M87 · Virgo A",
    "3C 405": "Cygnus A",
}


FAMOUS_QUASARS_UPPER = {name.upper(): text for name, text in FAMOUS_QUASARS.items()}


def veron_name(name: str) -> str:
    """The catalogue pads names for sorting ('3C  48.0', 'MARK  421'): one space, no '.0'."""
    return re.sub(r"\.0$", "", re.sub(r"\s+", " ", name.strip()))


def build_quasars() -> Catalogue:
    # The whole table (169,000 rows) is past the service's row limit: ask for the bright and the famous only.
    patterns = " or ".join("name like '" + name.replace(" ", "%") + "%'" for name in FAMOUS_QUASARS)
    rows = heasarc_rows(
        "veroncat",
        ["name", "ra", "dec", "app_mag", "redshift", "object_type"],
        f"(app_mag > 5 and app_mag <= {QUASAR_MAG_LIMIT} and object_type in ('Q','Q2','BL','BL?','HP')) or {patterns}",
    )
    out = Catalogue(
        "A catalogue of quasars and active nuclei, 13th edition (Veron-Cetty & Veron 2010, A&A 518, A10), "
        "via NASA HEASARC table veroncat",
        QUASAR_CLASSES,
        "redshift x 1000; -1: none given",
    )
    kept = []
    for row in rows:
        mag = number(row["app_mag"])
        kind = (row["object_type"] or "").strip()
        famous = FAMOUS_QUASARS_UPPER.get(veron_name(row["name"] or "").upper())
        # Magnitudes under 5 in this table are blanks stored as 0.
        bright = mag is not None and 5 < mag <= QUASAR_MAG_LIMIT and kind in QUASAR_TYPES
        if famous or bright:
            kept.append((mag if mag and mag > 5 else 20.0, row, kind, famous))
    kept.sort(key=lambda entry: (entry[0], entry[1]["name"]))
    for mag, row, kind, famous in kept:
        z = number(row["redshift"])
        index = out.add(
            float(row["ra"]), float(row["dec"]), QUASAR_TYPES.get(kind, "active-galaxy"), -1 if z is None else round(z * 1000)
        )
        suffix = "" if z is None else f" · z {z:.3f}" if z < 1 else f" · z {z:.2f}"
        if famous:
            out.label(index, famous + suffix, list(FAMOUS_QUASARS.values()).index(famous) / 10)
        elif mag <= 14.5:
            out.label(index, veron_name(row["name"]) + suffix, mag)
    return out


# ---------------------------------------------------------------------------
# 2MASS Redshift Survey


def build_lss() -> dict:
    rows = heasarc_rows("twomassrsc", ["ra", "dec", "radial_velocity"])
    points = []
    for row in rows:
        velocity = number(row["radial_velocity"])
        if velocity is None:
            continue
        # A few Local Group galaxies approach us; they sit at the near end of the scale.
        points.append((float(row["ra"]), float(row["dec"]), max(0, round(velocity))))
    points.sort(key=lambda point: point[2])
    return write_cloud(
        "lss",
        "2MASS Redshift Survey (Huchra et al. 2012, ApJS 199, 26), via NASA HEASARC table twomassrsc",
        "heliocentric radial velocity cz in km/s (0 for the few approaching galaxies)",
        points,
    )


# ---------------------------------------------------------------------------
# Globular clusters, supernova remnants


def build_globulars() -> Catalogue:
    rows = heasarc_rows("globclust", ["name", "alt_name", "ra", "dec", "vmag", "helio_distance", "half_light_radius"])
    out = Catalogue(
        "Catalog of Parameters for Milky Way Globular Clusters (Harris 1996, AJ 112, 1487; 2010 edition), "
        "via NASA HEASARC table globclust",
        ["globular"],
        "integrated V magnitude x 10; 999: none given",
    )
    rows.sort(key=lambda row: number(row["vmag"]) if number(row["vmag"]) is not None else 99)
    for row in rows:
        mag = number(row["vmag"])
        index = out.add(float(row["ra"]), float(row["dec"]), "globular", 999 if mag is None else round(mag * 10))
        distance = number(row["helio_distance"])
        name = (row["alt_name"] or row["name"] or "").replace("M ", "M")
        if name.startswith("omega"):
            name = "ω Centauri"
        text = name if distance is None else f"{name} · {distance * LIGHT_YEARS_PER_PARSEC:.0f} kly"
        if mag is not None and mag <= 8.6:
            out.label(index, text, mag)
        radius = number(row["half_light_radius"])
        if radius is not None and radius >= 1.0:
            # The half-light radius: half the cluster's light comes from inside this circle.
            out.ellipse(index, 2 * radius, 2 * radius, None)
    return out


SNR_CLASSES = ["shell", "filled", "composite", "uncertain"]


def build_snr() -> Catalogue:
    rows = heasarc_rows("snrgreen", ["name", "ra", "dec", "type", "flux_1_ghz", "alt_names", "major_diameter", "minor_diameter"])
    out = Catalogue(
        "A Catalogue of Galactic Supernova Remnants (Green D.A., June 2017 version; 2019, J. Astrophys. Astron. 40, 36), "
        "via NASA HEASARC table snrgreen",
        SNR_CLASSES,
        "log10(1 GHz flux density in millijansky) x 100; -1: none given",
    )
    rows.sort(key=lambda row: -(number(row["flux_1_ghz"]) or 0))
    for order, row in enumerate(rows):
        kind = row["type"] or "?"
        cls = "uncertain" if "?" in kind else {"S": "shell", "F": "filled", "C": "composite"}.get(kind, "uncertain")
        index = out.add(float(row["ra"]), float(row["dec"]), cls, flux_value(number(row["flux_1_ghz"]), 1.0))
        major = number(row["major_diameter"])
        minor = number(row["minor_diameter"])
        if major is not None and major >= 3:
            # Green gives no orientation: an elongated remnant is drawn as the circle of its mean diameter.
            mean = major if minor is None else math.sqrt(major * minor)
            out.ellipse(index, mean, mean, None)
        if row["alt_names"]:
            # 'Vela (XYZ)', 'Crab Nebula, 3C144, SN1054': the first name is the one in use.
            name = re.sub(r"\s*\(XYZ\)", "", row["alt_names"].split(",")[0]).strip().strip("()")
            out.label(index, name, order)
    return out


# ---------------------------------------------------------------------------
# Landmarks

LANDMARK_CLASSES = ["black-hole", "supernova", "messenger", "field", "structure", "direction", "spacecraft"]
# (label, SIMBAD identifier, class, priority)
SIMBAD_LANDMARKS = [
    ("Sgr A* · the Galaxy's central black hole", "Sgr A*", "black-hole", 0),
    ("M87* · first black hole imaged", "M 87", "black-hole", 1),
    ("Cygnus X-1 · first black hole identified", "Cyg X-1", "black-hole", 1),
    ("V404 Cygni", "V404 Cyg", "black-hole", 4),
    ("A0620−00", "V616 Mon", "black-hole", 4),
    ("SN 1987A", "SN 1987A", "supernova", 1),
    ("SN 1054 · Crab", "M 1", "supernova", 2),
    ("SN 1572 · Tycho's supernova", "SN 1572", "supernova", 2),
    ("SN 1604 · Kepler's supernova", "SN 1604", "supernova", 2),
    ("SN 1006", "SN 1006", "supernova", 3),
    ("Cassiopeia A", "Cas A", "supernova", 2),
    ("SN 1885A · in Andromeda", "SN 1885A", "supernova", 5),
    ("Eta Carinae", "eta Car", "supernova", 3),
    ("NGC 1068 · neutrino source (IceCube)", "NGC 1068", "messenger", 2),
    ("TXS 0506+056 · neutrino blazar (IceCube)", "TXS 0506+056", "messenger", 2),
    ("GW170817 · neutron stars merging, NGC 4993", "NGC 4993", "messenger", 1),
    ("Hubble Deep Field", "NAME HDF", "field", 3),
    ("Hubble Ultra Deep Field", "NAME HUDF", "field", 2),
    ("Lockman Hole", "NAME Lockman Hole", "field", 5),
    ("Great Attractor", "NAME Great Attractor", "structure", 1),
    ("Shapley supercluster", "NAME Shapley Supercluster", "structure", 2),
    ("Bullet cluster", "NAME Bullet Cluster", "structure", 3),
    ("Boötes void", "NAME Bootes Void", "structure", 4),
]
# Planck 2018 results I (arXiv:1807.06205, table 3 and sect. 5.1): the Sun's motion against the microwave
# background, 369.82 km/s toward galactic (l, b) = (264.021, 48.253).
CMB_DIPOLE_GALACTIC = (264.021, 48.253)
# Schoenrich, Binney & Dehnen 2010 (MNRAS 403, 1829, abstract): the Sun's velocity (U, V, W) against the
# local standard of rest, km/s, U toward the Galactic centre, V along the rotation, W toward the north pole.
SOLAR_MOTION_UVW = (11.1, 12.24, 7.25)
# The CMB Cold Spot (Cruz et al. 2005, MNRAS 356, 29, abstract): galactic b = -57, l = 209.
COLD_SPOT_GALACTIC = (209.0, -57.0)
HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
SPACECRAFT = [("Voyager 1", "-31"), ("Voyager 2", "-32"), ("New Horizons", "-98"), ("Pioneer 10", "-23")]


def horizons_direction(command: str, name: str) -> tuple[float, float, float]:
    """Geocentric astrometric (ra, dec) in degrees and distance in au on 1 January of EPOCH_YEAR, from JPL Horizons."""
    year = int(EPOCH_YEAR)
    params = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'500@399'",
        "START_TIME": f"'{year}-01-01'",
        "STOP_TIME": f"'{year}-01-02'",
        "STEP_SIZE": "'1 d'",
        "QUANTITIES": "'1,20'",
        "ANG_FORMAT": "DEG",
        "CSV_FORMAT": "YES",
    }
    url = HORIZONS_API + "?" + urllib.parse.urlencode(params)
    text = cached_fetch(url, f"deepsky/horizons_{name.replace(' ', '_')}_{year}.txt").read_text(encoding="utf-8")
    start = text.index("$$SOE") + 5
    fields = [field.strip() for field in text[start : text.index("$$EOE")].strip().splitlines()[0].split(",")]
    # date, sun flag, moon flag, RA, Dec, delta, deldot
    return float(fields[3]), float(fields[4]), float(fields[5])


def build_landmarks() -> Catalogue:
    out = Catalogue(
        "Positions: SIMBAD (CDS, Wenger et al. 2000). CMB dipole: Planck 2018 results I. Solar apex: Schoenrich, "
        "Binney & Dehnen 2010. CMB Cold Spot: Cruz et al. 2005. Spacecraft: JPL Horizons.",
        LANDMARK_CLASSES,
        "none (0)",
    )
    for text, identifier, cls, priority in SIMBAD_LANDMARKS:
        ra, dec = simbad_position(identifier)
        out.label(out.add(ra, dec, cls, 0), text, priority)
    ra, dec = galactic_to_icrs(*CMB_DIPOLE_GALACTIC)
    out.label(out.add(ra, dec, "direction", 0), "CMB dipole · we move this way at 370 km/s", 1)
    out.label(out.add((ra + 180) % 360, -dec, "direction", 0), "CMB dipole · receding", 4)
    u, v, w = SOLAR_MOTION_UVW
    apex = (math.degrees(math.atan2(v, u)) % 360, math.degrees(math.atan2(w, math.hypot(u, v))))
    ra, dec = galactic_to_icrs(*apex)
    out.label(out.add(ra, dec, "direction", 0), "Solar apex · the Sun's way among the stars", 2)
    out.label(out.add((ra + 180) % 360, -dec, "direction", 0), "Solar antapex", 5)
    ra, dec = galactic_to_icrs(*COLD_SPOT_GALACTIC)
    out.label(out.add(ra, dec, "structure", 0), "CMB Cold Spot", 3)
    for name, command in SPACECRAFT:
        ra, dec, distance = horizons_direction(command, name)
        out.label(out.add(ra, dec, "spacecraft", 0), f"{name} · {distance:.0f} au", 2)
    return out


BUILDERS = {
    "dso": build_dso,
    "xray-hard": build_xray_hard,
    "xray-uhuru": build_xray_uhuru,
    "xray-binaries": build_xray_binaries,
    "xray-rosat": build_xray_rosat,
    "gamma": build_gamma,
    "pulsars": build_pulsars,
    "exoplanets": build_exoplanets,
    "exoplanet-candidates": build_exoplanet_candidates,
    "nearby": build_nearby,
    "galaxies": build_galaxies,
    "clusters": build_clusters,
    "quasars": build_quasars,
    "lss": build_lss,
    "globulars": build_globulars,
    "snr": build_snr,
    "landmarks": build_landmarks,
}


def main() -> None:
    wanted = sys.argv[1:] or list(BUILDERS)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in wanted:
        built = BUILDERS[name]()
        data = built.to_json() if isinstance(built, Catalogue) else built
        path = OUTPUT_DIR / f"{name}.json"
        path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
        count = data.get("count", len(data.get("ra", [])))
        extra = f" + {(OUTPUT_DIR / data['file']).stat().st_size} bytes packed" if "file" in data else ""
        print(f"wrote {path.name}: {count} objects, {len(data.get('labels', []))} labels, {path.stat().st_size} bytes{extra}")


if __name__ == "__main__":
    main()
