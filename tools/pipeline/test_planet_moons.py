#!/usr/bin/env python3
"""
Data checks for generate_planet_moons.py's output.

Reads packages/core/src/astro/planet-moons-data.ts back - the rounded
numbers the app uses, not the fit's own - and holds them to the Horizons
vectors in the cache: each moon within a quarter of a degree of its orbit
of where Horizons has it over 1950-2050, and the residuals written into
the file true. Then to things known independently of the fit: JPL's
published mean elements, Io-Europa-Ganymede's Laplace resonance, Triton
going round backwards, Tethys's 70-year libration.

Usage (needs numpy and scipy: tools/pipeline/.cache/venv):
    python3 tools/pipeline/test_planet_moons.py
"""

import json
import math
import re

import numpy as np

from generate_planet_moons import MOONS, OUTPUT, SPAN, SPAN_STEPS, model, planet_frame, vectors
from geo_test_support import check, finish

# JPL's own mean elements (https://ssd.jpl.nasa.gov/sats/elem/, "referred to the local Laplace
# planes", read 2026-11-10): semi-major axis km, eccentricity, and for Saturn's moons the period
# in days. The table's periods for Jupiter's moons and Triton are not sidereal ones (its Io is
# 1.762732 d against the 1.769138 d Io takes), so those are left to the resonance check below.
JPL_MEAN_ELEMENTS = {
    "io": (421800.0, 0.004, None),
    "europa": (671100.0, 0.009, None),
    "ganymede": (1070400.0, 0.001, None),
    "callisto": (1882700.0, 0.007, None),
    "tethys": (295000.0, 0.001, 1.887802),
    "dione": (377700.0, 0.002, 2.736916),
    "rhea": (527200.0, 0.001, 4.517503),
    "titan": (1221900.0, 0.029, 15.945448),
    "iapetus": (3561700.0, 0.028, 79.331002),
    "triton": (354800.0, 0.000, None),
}


def main() -> None:
    text = OUTPUT.read_text()
    orbits = json.loads(re.search(r"PLANET_MOON_ORBITS = (\{.*?\n\}) as const", text, re.S).group(1))
    check(set(orbits) == set(MOONS), f"{len(orbits)} moons: {', '.join(orbits)}")

    for moon, (code, planet, centre) in MOONS.items():
        orbit = orbits[moon]
        check(orbit["planet"] == planet, f"{moon} goes round {planet}")
        params = [
            orbit["semiMajorAxisKm"],
            *orbit["meanLongitude"],
            orbit["eccentricity"],
            *orbit["periapsis"],
            *orbit["plane"],
            orbit["tilt"],
            *orbit["node"],
            *(orbit["libration"] or []),
        ]
        days, icrf = vectors(moon, code, centre, SPAN[0], SPAN[1], str(SPAN_STEPS), "wide")
        want = icrf @ planet_frame(planet).T
        error_km = np.linalg.norm(model(np.array(params), days, orbit["libration"] is not None) - want, axis=1)
        worst_deg = math.degrees(float(error_km.max()) / orbit["semiMajorAxisKm"])
        check(worst_deg < 0.25, f"{moon}: within {worst_deg:.3f} deg of its orbit of Horizons over {SPAN[0][:4]}-{SPAN[1][:4]} ({error_km.max():.0f} km)")
        check(
            abs(error_km.max() - orbit["fit"]["maxKm"]) < 0.02 * orbit["fit"]["maxKm"] + 5,
            f"{moon}: the file's own residual ({orbit['fit']['maxKm']:.0f} km) is what the rounded numbers give ({error_km.max():.0f} km)",
        )
        jpl_a, jpl_e, jpl_period = JPL_MEAN_ELEMENTS[moon]
        check(abs(orbit["semiMajorAxisKm"] / jpl_a - 1) < 0.0015, f"{moon}: semi-major axis {orbit['semiMajorAxisKm']:.0f} km (JPL mean elements {jpl_a:.0f})")
        check(abs(orbit["eccentricity"] - jpl_e) < 0.0015, f"{moon}: eccentricity {orbit['eccentricity']:.4f} (JPL {jpl_e})")
        if jpl_period is not None:
            period = 2 * math.pi / orbit["meanLongitude"][1]
            check(abs(period / jpl_period - 1) < 1e-6, f"{moon}: period {period:.6f} d (JPL {jpl_period})")

    n = {moon: orbits[moon]["meanLongitude"][1] for moon in ("io", "europa", "ganymede")}
    laplace = n["io"] - 3 * n["europa"] + 2 * n["ganymede"]
    check(abs(laplace) < 1e-6, f"Laplace resonance: n(Io) - 3 n(Europa) + 2 n(Ganymede) = {laplace:.2e} rad/day")
    tilt = lambda moon: math.degrees(2 * math.atan(orbits[moon]["tilt"]))
    check(abs(tilt("triton") - 157.3) < 1, f"Triton goes round backwards (inclined {tilt('triton'):.1f} deg; JPL 157.3)")
    check(abs(tilt("tethys") - 1.1) < 0.1, f"Tethys is inclined {tilt('tethys'):.2f} deg (JPL 1.1)")
    check(all(tilt(moon) < 1 for moon in ("io", "europa", "ganymede", "callisto")), "Jupiter's four lie within a degree of its equator")
    io_periapsis_years = 2 * math.pi / orbits["io"]["periapsis"][1] / 365.25
    check(abs(abs(io_periapsis_years) - 1.333) < 0.01, f"Io's periapsis goes round in {io_periapsis_years:.3f} years (JPL 1.333; the resonance with Europa drives it)")
    check(orbits["tethys"]["libration"] is not None, "Tethys carries its libration with Mimas")
    period_years = 2 * math.pi / abs(orbits["tethys"]["libration"][2]) / 365.25
    check(60 < period_years < 80, f"Tethys's libration takes {period_years:.1f} years (Mimas-Tethys resonance: about 70)")

    finish()


if __name__ == "__main__":
    main()
