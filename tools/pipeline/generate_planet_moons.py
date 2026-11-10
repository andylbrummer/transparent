#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: where the big moons of Jupiter,
Saturn and Neptune are.

Writes packages/core/src/astro/planet-moons-data.ts: for each moon a
precessing ellipse - eleven numbers - fitted here to the moon's
planet-centred positions from JPL Horizons over 1950-2050, and how well
that ellipse then reproduces Horizons (the residuals are written into the
file and tested by test_planet_moons.py).

Why a fit: the app needs the moons at any date without a network, the full
satellite theories run to hundreds of terms, and JPL's own published table
of mean elements (https://ssd.jpl.nasa.gov/sats/elem/) is this same model
rounded to 0.1 degrees. Nothing here is invented: the ellipse is a
compression of JPL's satellite ephemerides, and what it loses is measured.

The model, in the planet's equator of J2000 (z the IAU north pole, x its
ascending node on the ICRF equator), d in days of TDB from J2000:

    mean longitude        L = L0 + n d
    longitude of periapsis w = w0 + w1 d         (eccentricity e fixed)
    orbit plane           p = p0 + s sin(O), q = q0 + s cos(O), O = O0 + O1 d
                          where (p, q) = tan(i/2) (sin node, cos node)
    one libration         L += A sin(F0 + F1 d)  (only where LIBRATION names the moon)

(p0, q0) is the tilt of the Laplace plane the orbit precesses about; it
matters for Iapetus. The libration is Tethys's 70-year swing in its
resonance with Mimas.

Source: JPL Horizons (Giorgini et al., JPL Solar System Dynamics),
keyless: https://ssd.jpl.nasa.gov/api/horizons.api. Responses are cached
in tools/pipeline/.cache/horizons/.

Usage (needs numpy and scipy: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_planet_moons.py
"""

import json
import math
import re
import urllib.parse
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from fetch_cache import cached_fetch
from fetch_horizons_fixture import API

# moon -> (NAIF id, planet, planet's NAIF id)
MOONS = {
    "io": (501, "jupiter", 599),
    "europa": (502, "jupiter", 599),
    "ganymede": (503, "jupiter", 599),
    "callisto": (504, "jupiter", 599),
    "tethys": (603, "saturn", 699),
    "dione": (604, "saturn", 699),
    "rhea": (605, "saturn", 699),
    "titan": (606, "saturn", 699),
    "iapetus": (608, "saturn", 699),
    "triton": (801, "neptune", 899),
}

# Moons given one long-period libration in longitude, and a first guess at its period in years.
LIBRATION = {"tethys": 70.0}

# First guesses at how long the periapsis takes to go round, tried both ways.
PERIAPSIS_PERIODS_YEARS = [0.7, 1.0, 1.4, 2.0, 4.0, 10.0, 30.0, 150.0, 700.0]

J2000_JD = 2451545.0
DENSE_DAYS = 400
SPAN = ("1950-01-01", "2050-01-01")
SPAN_STEPS = 6000

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "packages" / "core" / "src" / "astro" / "planet-moons-data.ts"
ROTATION = REPO_ROOT / "packages" / "core" / "src" / "astro" / "planet-rotation-data.ts"


def planet_frame(planet: str) -> np.ndarray:
    """Rows: the x, y, z axes of the planet's equator of J2000 in the ICRF."""
    text = ROTATION.read_text()
    data = json.loads(re.search(r"PLANET_ROTATION = (\{.*?\n\}) as const", text, re.S).group(1))[planet]
    ra, dec = data["poleRa"][0], data["poleDec"][0]
    # At T = 0 the periodic terms are sin/cos of the angles' constants.
    for i, coefficients in enumerate(data["angles"]):
        theta = math.radians(coefficients[0])
        if i < len(data["raTerms"]):
            ra += data["raTerms"][i] * math.sin(theta)
        if i < len(data["decTerms"]):
            dec += data["decTerms"][i] * math.cos(theta)
    ra, dec = math.radians(ra), math.radians(dec)
    z = np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])
    x = np.cross([0.0, 0.0, 1.0], z)
    x /= np.linalg.norm(x)
    return np.array([x, np.cross(z, x), z])


def vectors(moon: str, code: int, centre: int, start: str, stop: str, step: str, tag: str) -> tuple[np.ndarray, np.ndarray]:
    """Days from J2000 (TDB) and planet-centred ICRF positions, km."""
    params = {
        "format": "text",
        "COMMAND": f"'{code}'",
        "CENTER": f"'500@{centre}'",
        "EPHEM_TYPE": "'VECTORS'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "VEC_TABLE": "'1'",
        "REF_PLANE": "'FRAME'",
        "REF_SYSTEM": "'ICRF'",
        "OUT_UNITS": "'KM-S'",
        "VEC_CORR": "'NONE'",
        "OBJ_DATA": "'NO'",
    }
    text = cached_fetch(f"{API}?{urllib.parse.urlencode(params)}", f"horizons/{moon}-vectors-{tag}.txt").read_text()
    lines = text.splitlines()
    assert "$$SOE" in lines, f"{moon}: Horizons answered\n{text[-1500:]}"
    # Horizons' CSV option drops the vector columns, so read its plain layout: a date line, then X = .. Y = .. Z = ..
    body = lines[lines.index("$$SOE") + 1 : lines.index("$$EOE")]
    days = np.array([float(line.split("=")[0]) for line in body[0::2]]) - J2000_JD
    xyz = np.array([[float(v) for v in re.findall(r"[XYZ] =\s*(\S+)", line)] for line in body[1::2]])
    assert xyz.shape == (len(days), 3), f"{moon}: unexpected vector table"
    return days, xyz


def model(params: np.ndarray, d: np.ndarray, libration: bool) -> np.ndarray:
    a, l0, n, e, w0, w1, p0, q0, s, o0, o1 = params[:11]
    mean_longitude = l0 + n * d
    if libration:
        mean_longitude = mean_longitude + params[11] * np.sin(params[12] + params[13] * d)
    periapsis = w0 + w1 * d
    mean_anomaly = mean_longitude - periapsis
    eccentric = mean_anomaly.copy()
    for _ in range(8):
        eccentric = eccentric - (eccentric - e * np.sin(eccentric) - mean_anomaly) / (1 - e * np.cos(eccentric))
    true_anomaly = 2 * np.arctan2(math.sqrt(1 + e) * np.sin(eccentric / 2), math.sqrt(1 - e) * np.cos(eccentric / 2))
    r = a * (1 - e * np.cos(eccentric))
    longitude = periapsis + true_anomaly
    node = o0 + o1 * d
    p = p0 + s * np.sin(node)
    q = q0 + s * np.cos(node)
    k = 1 / (1 + p * p + q * q)
    x = r * np.cos(longitude)
    y = r * np.sin(longitude)
    return np.stack(
        [
            k * (x * (1 - p * p + q * q) + y * 2 * p * q),
            k * (x * 2 * p * q + y * (1 + p * p - q * q)),
            k * (-2 * p * x + 2 * q * y),
        ],
        axis=1,
    )


def first_guess(d: np.ndarray, xyz: np.ndarray) -> np.ndarray:
    """From a dense run of a few orbits: the mean plane, the mean distance and the mean motion."""
    h = np.cross(xyz[:-1], xyz[1:]).mean(axis=0)
    h /= np.linalg.norm(h)
    inclination = math.acos(h[2])
    node = math.atan2(h[0], -h[1])
    s = math.tan(inclination / 2)
    p, q = s * math.sin(node), s * math.cos(node)
    k = 1 / (1 + p * p + q * q)
    f = k * np.array([1 - p * p + q * q, 2 * p * q, -2 * p])
    g = k * np.array([2 * p * q, 1 + p * p - q * q, 2 * q])
    longitude = np.unwrap(np.arctan2(xyz @ g, xyz @ f))
    n, l0 = np.polyfit(d, longitude, 1)
    return np.array([np.linalg.norm(xyz, axis=1).mean(), l0, n, 0.002, 0.0, 0.0, 0.0, 0.0, s, node, 0.0])


def fit(moon: str, dense: tuple[np.ndarray, np.ndarray], wide: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    d_all = np.concatenate([dense[0], wide[0]])
    xyz_all = np.concatenate([dense[1], wide[1]])
    params = first_guess(*dense)
    centre = dense[0].mean()
    scale_km = params[0]
    libration = False
    # Widen the window in steps, so the phase never slips a turn between one fit and the next.
    half_width = DENSE_DAYS / 2
    while True:
        keep = np.abs(d_all - centre) <= half_width
        d, xyz = d_all[keep], xyz_all[keep]
        if moon in LIBRATION and not libration and half_width > 12000:
            libration = True
            params = np.concatenate([params, [0.01, 0.0, 2 * math.pi / (LIBRATION[moon] * 365.25)]])
            # The swing's phase is unknown: try a few and keep the best.
            best = None
            for phase in np.linspace(0, 2 * math.pi, 8, endpoint=False):
                trial = params.copy()
                trial[12] = phase
                result = least_squares(lambda x: ((model(x, d, True) - xyz) / scale_km).ravel(), trial, x_scale="jac")
                if best is None or result.cost < best.cost:
                    best = result
            params = best.x
        else:
            starts = [params]
            if half_width == DENSE_DAYS / 2:
                # A resonance can drive the periapsis round in a year or so, either way; a fit begun
                # from a still periapsis then settles on the wrong ellipse. Begin from each rate.
                for years in PERIAPSIS_PERIODS_YEARS:
                    for sign in (1, -1):
                        for phase in (0.0, math.pi / 2, math.pi, 3 * math.pi / 2):
                            trial = params.copy()
                            trial[3], trial[4], trial[5] = 0.005, phase, sign * 2 * math.pi / (years * 365.25)
                            starts.append(trial)
            best = None
            if len(starts) > 1:
                # Rank the starts on every eighth point with few steps, then polish only the best.
                coarse = slice(None, None, 8)
                ranked = []
                for start in starts:
                    result = least_squares(
                        lambda x: ((model(x, d[coarse], libration) - xyz[coarse]) / scale_km).ravel(), start, x_scale="jac", max_nfev=40
                    )
                    ranked.append((result.cost, result.x))
                ranked.sort(key=lambda entry: entry[0])
                starts = [x for _, x in ranked[:3]]
            for start in starts:
                result = least_squares(
                    lambda x: ((model(x, d, libration) - xyz) / scale_km).ravel(), start, x_scale="jac", max_nfev=400
                )
                if best is None or result.cost < best.cost:
                    best = result
            params = best.x
        if keep.all():
            return params
        half_width *= 2.2


def normalise(params: np.ndarray) -> list[float]:
    """Positive eccentricity, tilt and libration; angles in [0, 2 pi)."""
    out = params.copy()
    if out[3] < 0:
        out[3] = -out[3]
        out[4] += math.pi
    if out[8] < 0:
        out[8] = -out[8]
        out[9] += math.pi
    if len(out) > 11 and out[11] < 0:
        out[11] = -out[11]
        out[12] += math.pi
    for i in (1, 4, 9) + ((12,) if len(out) > 11 else ()):
        out[i] %= 2 * math.pi
    return [float(v) for v in out]


def main() -> None:
    moons: dict[str, object] = {}
    frames: dict[str, list[float]] = {}
    for moon, (code, planet, centre) in MOONS.items():
        frame = planet_frame(planet)
        frames[planet] = [float(v) for v in frame.ravel()]
        dense_days, dense_icrf = vectors(moon, code, centre, "1999-06-15", "2000-07-19", "2 h", "dense")
        wide_days, wide_icrf = vectors(moon, code, centre, SPAN[0], SPAN[1], str(SPAN_STEPS), "wide")
        dense = (dense_days, dense_icrf @ frame.T)
        wide = (wide_days, wide_icrf @ frame.T)
        params = np.array(normalise(fit(moon, dense, wide)))
        libration = len(params) > 11
        error_km = np.linalg.norm(model(params, wide[0], libration) - wide[1], axis=1)
        a = params[0]
        moons[moon] = {
            "planet": planet,
            "semiMajorAxisKm": round(float(a), 3),
            "meanLongitude": [round(float(params[1]), 9), float(f"{params[2]:.13g}")],
            "eccentricity": round(float(params[3]), 8),
            "periapsis": [round(float(params[4]), 7), float(f"{params[5]:.9g}")],
            "plane": [round(float(params[6]), 9), round(float(params[7]), 9)],
            "tilt": round(float(params[8]), 9),
            "node": [round(float(params[9]), 7), float(f"{params[10]:.9g}")],
            "libration": [round(float(params[11]), 8), round(float(params[12]), 6), float(f"{params[13]:.9g}")] if libration else None,
            "fit": {
                "rmsKm": round(float(np.sqrt((error_km**2).mean())), 1),
                "maxKm": round(float(error_km.max()), 1),
                "rmsDegAlongOrbit": round(math.degrees(float(np.sqrt((error_km**2).mean())) / a), 4),
                "maxDegAlongOrbit": round(math.degrees(float(error_km.max()) / a), 4),
            },
        }
        print(f"{moon:9s} a {a:11.1f} km  P {2 * math.pi / params[2]:.6f} d  e {params[3]:.5f}  "
              f"rms {moons[moon]['fit']['rmsKm']:8.1f} km  max {moons[moon]['fit']['maxKm']:8.1f} km "
              f"({moons[moon]['fit']['maxDegAlongOrbit']:.3f} deg)")
    OUTPUT.write_text(
        "/**\n"
        " * Orbits of the big moons of Jupiter, Saturn and Neptune. GENERATED by\n"
        " * tools/pipeline/generate_planet_moons.py - do not edit.\n"
        " *\n"
        " * Each is a precessing ellipse fitted to the moon's planet-centred\n"
        " * positions from JPL Horizons over 1950-2050; `fit` is how far it then\n"
        " * strays from Horizons over that century. Radians and days of TDB from\n"
        " * J2000, in the planet's equator of J2000 (`PLANET_EQUATOR_J2000`: rows\n"
        " * are its x, y, z axes in the ICRF; z the IAU north pole, x its\n"
        " * ascending node on the ICRF equator):\n"
        " *   L = meanLongitude[0] + meanLongitude[1] d  (+ libration[0] sin(libration[1] + libration[2] d))\n"
        " *   w = periapsis[0] + periapsis[1] d\n"
        " *   (p, q) = plane + tilt (sin O, cos O), O = node[0] + node[1] d,\n"
        " *   where (p, q) = tan(i/2) (sin node, cos node).\n"
        " */\n"
        f"export const PLANET_EQUATOR_J2000 = {json.dumps(frames, indent=1)} as const;\n\n"
        f"export const PLANET_MOON_ORBITS = {json.dumps(moons, indent=1)} as const;\n"
    )
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
