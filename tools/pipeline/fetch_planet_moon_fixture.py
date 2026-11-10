#!/usr/bin/env python3
"""
Reference values for the big moons of Jupiter, Saturn and Neptune, from
JPL Horizons.

Writes packages/core/src/astro/planet-moons.fixture.ts: where Horizons puts
each moon in the sky seen from the Earth's centre (astrometric ICRF right
ascension and declination), how far it is from its planet's centre, and
Horizons' own word on whether the planet hides it, at the instants of the
planet-disc fixture plus a few picked because a moon was then behind
Jupiter, in its shadow or on its face. packages/core/src/astro/
planet-discs.test.ts holds the app's fitted orbits to them.

These instants are not the ones the orbits were fitted to
(generate_planet_moons.py samples its own), though the source is the same.

Horizons is keyless: https://ssd.jpl.nasa.gov/api/horizons.api
(Giorgini et al., JPL Solar System Dynamics). Responses are cached in
tools/pipeline/.cache/horizons/; delete them to fetch again.

Usage:
    python3 tools/pipeline/fetch_planet_moon_fixture.py
"""

import json
import urllib.parse
from pathlib import Path

from fetch_cache import cached_fetch
from fetch_horizons_fixture import API, julian_date
from fetch_planet_disc_fixture import INSTANTS as DISC_INSTANTS

# The middles of events found with the app's own orbits, then put to Horizons: each
# of Jupiter's four moons in its shadow and behind it, three crossing its face, and
# two of Saturn's.
EVENT_INSTANTS = [
    "2026-11-10T02:55:00Z",  # Dione behind Saturn
    "2026-11-10T03:25:00Z",  # Io crossing Jupiter
    "2026-11-10T18:25:00Z",  # Tethys crossing Saturn
    "2026-11-10T22:50:00Z",  # Io in Jupiter's shadow
    "2026-11-11T00:35:00Z",  # Io behind Jupiter
    "2026-11-11T12:20:00Z",  # Ganymede crossing
    "2026-11-11T16:05:00Z",  # Europa in shadow
    "2026-11-11T18:45:00Z",  # Europa behind
    "2026-11-13T13:15:00Z",  # Europa crossing
    "2026-11-14T21:10:00Z",  # Ganymede in shadow
    "2026-11-15T02:20:00Z",  # Ganymede behind
    "2026-11-16T05:15:00Z",  # Callisto in shadow
    "2026-11-16T17:20:00Z",  # Callisto behind
]

# In time order: Horizons answers a list of instants sorted, whatever order it was asked in.
INSTANTS = sorted(DISC_INSTANTS + EVENT_INSTANTS)

MOONS = {
    "io": "501",
    "europa": "502",
    "ganymede": "503",
    "callisto": "504",
    "tethys": "603",
    "dione": "604",
    "rhea": "605",
    "titan": "606",
    "iapetus": "608",
    "triton": "801",
}

# Horizons' visibility codes -> the app's words. Horizons judges limb to limb, the
# app by the moon's centre, so the two can differ for the few minutes a moon takes
# to cross the planet's edge. P and U are occulted and in shadow at once.
VISIBILITY = {
    "*": "clear",
    "t": "transit",
    "O": "occulted",
    "P": "occulted",
    "U": "occulted",
    "p": "partly-eclipsed",
    "u": "eclipsed",
}

PLANETS = {"jupiter": "599", "saturn": "699", "neptune": "899"}

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "packages" / "core" / "src" / "astro" / "planet-moons.fixture.ts"


def query(body: str, name: str, planet: bool = False) -> list[dict[str, object]]:
    params = {
        "format": "text",
        "COMMAND": f"'{body}'",
        "CENTER": "'500@399'",
        "EPHEM_TYPE": "'OBSERVER'",
        "TLIST": " ".join(f"'{julian_date(iso):.6f}'" for iso in INSTANTS),
        "QUANTITIES": "'1'" if planet else "'1,12'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "OBJ_DATA": "'NO'",
    }
    text = cached_fetch(f"{API}?{urllib.parse.urlencode(params)}", f"horizons/{name}-moon-{len(INSTANTS)}.txt").read_text()
    lines = text.splitlines()
    start = lines.index("$$SOE")
    end = lines.index("$$EOE")
    header = [cell.strip() for cell in lines[start - 2].split(",")]
    for column in ("R.A._(ICRF)", "DEC_(ICRF)") + (() if planet else ("ang-sep", "vis.")):
        assert column in header, f"{name}: Horizons did not return {column}: {header}"
    rows = []
    for line in lines[start + 1 : end]:
        cells = dict(zip(header, (cell.strip() for cell in line.split(","))))
        if planet:
            rows.append({"ra": float(cells["R.A._(ICRF)"]), "dec": float(cells["DEC_(ICRF)"])})
            continue
        code = cells["vis."]
        assert code in VISIBILITY, f"{name}: unknown visibility code {code!r}"
        rows.append(
            {
                "ra": float(cells["R.A._(ICRF)"]),
                "dec": float(cells["DEC_(ICRF)"]),
                "separationArcsec": float(cells["ang-sep"]),
                "code": code,
                "situation": VISIBILITY[code],
            }
        )
    assert len(rows) == len(INSTANTS), f"{name}: {len(rows)} rows"
    return rows


def main() -> None:
    fixture = {
        "instants": INSTANTS,
        "planets": {name: query(body, name, planet=True) for name, body in PLANETS.items()},
        "moons": {name: query(body, name) for name, body in MOONS.items()},
    }
    OUTPUT.write_text(
        "/**\n"
        " * JPL Horizons reference values for the big moons of Jupiter, Saturn and\n"
        " * Neptune. GENERATED by tools/pipeline/fetch_planet_moon_fixture.py - do\n"
        " * not edit.\n"
        " *\n"
        " * Rows follow `instants`, seen from the Earth's centre: astrometric ICRF\n"
        " * right ascension and declination in degrees of each planet and moon; for\n"
        " * a moon also its angle from the planet's centre in arcseconds, Horizons'\n"
        " * visibility code and what it means.\n"
        " */\n"
        f"export const PLANET_MOONS = {json.dumps(fixture, indent=1)} as const;\n"
    )
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
