#!/usr/bin/env python3
"""
Reference values for the satellite layers' tests: where three satellites
are at one instant, worked out by a second implementation.

The app propagates CelesTrak GP elements with satellite.js (SGP4/SDP4 in
JavaScript) and turns the result into Earth-fixed positions with its own
frame code. This script does the same job with different code - the
python `sgp4` package (Brandon Rhodes' wrapper of Vallado's C++ SGP4) and
the frame conversions written out below from Vallado, "Fundamentals of
Astrodynamics and Applications" - and, for the ISS, asks JPL Horizons
(which keeps its own ISS ephemeris) for the same instant. The results are
written to app/src/layers/satellites/reference.fixture.ts, which
orbit-math.test.ts holds the app to.

Satellites: the ISS (low orbit, SGP4), a GPS satellite (12 h orbit, SDP4
deep-space terms with resonance) and GOES 19 (geostationary, SDP4 with
synchronous resonance). The element sets are the ones in the baked
snapshot (app/public/space/gp/), and the instant is a few hours after
their epochs.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_satellite_fixture.py

Needs: python3 -m venv tools/pipeline/.cache/venv &&
       tools/pipeline/.cache/venv/bin/pip install sgp4 numpy
"""

import csv
import io
import json
import math
import re
import urllib.parse
from importlib.metadata import version
from pathlib import Path

from sgp4 import omm
from sgp4.api import Satrec, jday

from fetch_cache import cached_fetch
from generate_satellites_snapshot import OUTPUT_DIR, REPO_ROOT

TARGET = REPO_ROOT / "app" / "src" / "layers" / "satellites" / "reference.fixture.ts"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
WHEN = (2026, 11, 9, 18, 0, 0.0)
WHEN_ISO = "2026-11-09T18:00:00Z"
# The app's default test location.
OBSERVER = (30.27, -97.74, 0.0)  # geodetic latitude, longitude (deg), height (km)
SATELLITES = [("stations", "25544"), ("gps-ops", "26407"), ("geo", "60133")]

WGS84_A = 6378.137
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)


def gmst82(jd_ut1: float) -> float:
    """Greenwich mean sidereal time, radians (IAU 1982; Vallado eq. 3-47)."""
    t = (jd_ut1 - 2451545.0) / 36525.0
    seconds = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t**3
    return math.radians((seconds % 86400.0) / 240.0) % (2 * math.pi)


def teme_to_pef(r: tuple[float, float, float], gmst: float) -> tuple[float, float, float]:
    """TEME to the pseudo Earth-fixed frame: a turn by GMST about z. Polar motion (< 0.5") is left out."""
    c, s = math.cos(gmst), math.sin(gmst)
    return (c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2])


def ecef_to_geodetic(r: tuple[float, float, float]) -> tuple[float, float, float]:
    """WGS84 latitude, longitude (deg) and height (km), by fixed-point iteration."""
    x, y, z = r
    lon = math.atan2(y, x)
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - WGS84_E2))
    for _ in range(20):
        n = WGS84_A / math.sqrt(1 - WGS84_E2 * math.sin(lat) ** 2)
        lat = math.atan2(z + n * WGS84_E2 * math.sin(lat), p)
    n = WGS84_A / math.sqrt(1 - WGS84_E2 * math.sin(lat) ** 2)
    height = p / math.cos(lat) - n
    return math.degrees(lat), math.degrees(lon), height


def geodetic_to_ecef(lat_deg: float, lon_deg: float, height: float) -> tuple[float, float, float]:
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    n = WGS84_A / math.sqrt(1 - WGS84_E2 * math.sin(lat) ** 2)
    return ((n + height) * math.cos(lat) * math.cos(lon), (n + height) * math.cos(lat) * math.sin(lon), (n * (1 - WGS84_E2) + height) * math.sin(lat))


def look_angles(sat: tuple[float, float, float]) -> tuple[float, float, float]:
    """Azimuth (clockwise from north), elevation (deg) and range (km) from OBSERVER, no refraction."""
    lat, lon = math.radians(OBSERVER[0]), math.radians(OBSERVER[1])
    o = geodetic_to_ecef(*OBSERVER)
    d = (sat[0] - o[0], sat[1] - o[1], sat[2] - o[2])
    east = -math.sin(lon) * d[0] + math.cos(lon) * d[1]
    north = -math.sin(lat) * math.cos(lon) * d[0] - math.sin(lat) * math.sin(lon) * d[1] + math.cos(lat) * d[2]
    up = math.cos(lat) * math.cos(lon) * d[0] + math.cos(lat) * math.sin(lon) * d[1] + math.sin(lat) * d[2]
    rng = math.sqrt(east * east + north * north + up * up)
    return math.degrees(math.atan2(east, north)) % 360, math.degrees(math.asin(up / rng)), rng


def find_row(group: str, norad: str) -> tuple[str, dict[str, str]]:
    text = (OUTPUT_DIR / f"{group}.csv").read_text(encoding="utf-8")
    lines = text.splitlines()
    for line, row in zip(lines[1:], csv.DictReader(io.StringIO(text))):
        if row["NORAD_CAT_ID"] == norad:
            return lines[0] + "\n" + line + "\n", row
    raise SystemExit(f"{norad} is not in {group}.csv")


def horizons(params: dict[str, str], name: str) -> str:
    query = urllib.parse.urlencode({"format": "text", **params})
    return cached_fetch(f"{HORIZONS}?{query}", f"satellites/horizons-{name}.txt").read_text(encoding="utf-8")


def horizons_iss(jd: float) -> dict[str, float]:
    """The ISS from JPL Horizons at the same instant: azimuth/elevation from OBSERVER, and its geocentric place."""
    observer = horizons(
        {
            "COMMAND": "'-125544'",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "'coord@399'",
            "COORD_TYPE": "GEODETIC",
            "SITE_COORD": f"'{OBSERVER[1]},{OBSERVER[0]},{OBSERVER[2]}'",
            "START_TIME": "'2026-11-09 18:00'",
            "STOP_TIME": "'2026-11-09 18:01'",
            "STEP_SIZE": "'1m'",
            "QUANTITIES": "'4,20'",
            "APPARENT": "AIRLESS",
            "ANG_FORMAT": "DEG",
            "CSV_FORMAT": "YES",
        },
        "iss-observer",
    )
    line = re.search(r"\$\$SOE\n(.*?)\n\$\$EOE", observer, re.S)
    if not line:
        raise SystemExit("Horizons observer table not understood:\n" + observer[-800:])
    fields = [f.strip() for f in line.group(1).split("\n")[0].split(",")]
    # date, sun flag, moon flag, azimuth, elevation, delta (au), deldot
    azimuth, elevation, delta_au = float(fields[3]), float(fields[4]), float(fields[5])
    vectors = horizons(
        {
            "COMMAND": "'-125544'",
            "EPHEM_TYPE": "VECTORS",
            "CENTER": "'500@399'",
            "REF_PLANE": "FRAME",
            "START_TIME": "'2026-11-09 18:00'",
            "STOP_TIME": "'2026-11-09 18:01'",
            "STEP_SIZE": "'1m'",
            "OUT_UNITS": "KM-S",
            "TIME_TYPE": "UT",
        },
        "iss-vectors",
    )
    # The plain table: the CSV form of it comes back without its position columns.
    found = re.search(r"\$\$SOE\n.*?\n\s*X\s*=\s*(\S+)\s+Y\s*=\s*(\S+)\s+Z\s*=\s*(\S+)", vectors)
    if not found:
        raise SystemExit("Horizons vector table not understood:\n" + vectors[-800:])
    return {
        "azimuth": azimuth,
        "elevation": elevation,
        "rangeKm": delta_au * 149597870.7,
        "icrfKm": [float(found.group(1)), float(found.group(2)), float(found.group(3))],
    }


def main() -> None:
    jd, fr = jday(*WHEN)
    gmst = gmst82(jd + fr)
    out = []
    for group, norad in SATELLITES:
        csv_text, row = find_row(group, norad)
        sat = Satrec()
        # The baked files drop the columns SGP4 does not read; the package's reader still asks for them.
        omm.initialize(sat, {"OBJECT_ID": "", "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "0", **row})
        error, r, v = sat.sgp4(jd, fr)
        if error:
            raise SystemExit(f"{norad}: sgp4 error {error}")
        ecef = teme_to_pef(r, gmst)
        lat, lon, height = ecef_to_geodetic(ecef)
        azimuth, elevation, rng = look_angles(ecef)
        out.append(
            {
                "name": row["OBJECT_NAME"],
                "norad": int(norad),
                "csv": csv_text,
                "temeKm": [round(c, 6) for c in r],
                "temeKmS": [round(c, 9) for c in v],
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "heightKm": round(height, 4),
                "azimuth": round(azimuth, 5),
                "elevation": round(elevation, 5),
                "rangeKm": round(rng, 4),
            }
        )
        print(f"{row['OBJECT_NAME']:24s} lat {lat:9.4f} lon {lon:10.4f} h {height:10.3f} km  az {azimuth:8.3f} el {elevation:8.3f} range {rng:10.2f} km")
    iss = horizons_iss(jd + fr)
    print(f"Horizons ISS             az {iss['azimuth']:8.3f} el {iss['elevation']:8.3f} range {iss['rangeKm']:10.2f} km  ICRF {iss['icrfKm']}")
    body = (
        "// Written by tools/pipeline/generate_satellite_fixture.py - do not edit.\n"
        f"// Reference: python sgp4 {version('sgp4')} (Vallado's SGP4, WGS72 constants) with TEME -> Earth-fixed by GMST (IAU 1982),\n"
        "// WGS84 geodetic coordinates, and azimuth/elevation from Austin (30.27, -97.74, 0 km), no refraction.\n"
        "// The ISS is also given as JPL Horizons has it (object -125544) at the same instant.\n\n"
        f"export const REFERENCE_TIME = '{WHEN_ISO}';\n"
        f"export const REFERENCE_OBSERVER = {{ lat: {OBSERVER[0]}, lon: {OBSERVER[1]} }};\n\n"
        f"export const REFERENCE_SATELLITES = {json.dumps(out, indent=2)};\n\n"
        f"export const HORIZONS_ISS = {json.dumps(iss, indent=2)};\n"
    )
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(body, encoding="utf-8")


if __name__ == "__main__":
    main()
