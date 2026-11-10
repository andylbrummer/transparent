#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: where the spacecraft beyond Earth
orbit are - the observatories at the Sun-Earth L1 and L2 points and the
probes in deep space - as a table of geocentric directions and distances.

Source: JPL Horizons (https://ssd.jpl.nasa.gov/horizons/), the API at
https://ssd.jpl.nasa.gov/api/horizons.api - keyless, but without CORS
headers, so the app cannot ask it directly and a table is baked instead.
For each spacecraft: astrometric right ascension and declination (ICRF)
and distance from the Earth's centre at 00:00 UTC, every STEP days, from
START to STOP. Horizons' trajectories are the missions' own (reconstructed
up to their last delivery, predicted after it); where one ends before STOP
the table ends with it, and the app shows nothing beyond a table's end.

Output: app/public/space/spacecraft.json

    start      first date of the range, YYYY-MM-DD
    craft[]    name (as Horizons gives it, tidied), horizons id, where
               ('L1', 'L2' or 'deep'), stepDays, offsetDays of the first
               sample from start, and parallel arrays ra (deg), dec (deg),
               au - one entry per step

Usage:
    python3 tools/pipeline/generate_spacecraft.py

Stdlib only. Responses are cached in tools/pipeline/.cache/spacecraft/.
"""

import datetime
import json
import re
import urllib.parse
from pathlib import Path

from fetch_cache import cached_fetch

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "space" / "spacecraft.json"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
START = datetime.date(2026, 1, 1)
STOP = datetime.date(2028, 1, 1)

# (Horizons id, where, step in days). Ids were resolved with the Horizons lookup API
# (https://ssd.jpl.nasa.gov/api/horizons_lookup.api?sstr=<name>&group=sct); the names shown come
# from each response, so a wrong id cannot pass under the right name. Steps: a day where the
# direction changes by a degree or more a day (the L-point craft follow the Sun; the inner
# solar system probes move fast), longer for the distant ones, whose direction barely changes.
# A probe passing the Earth for a gravity assist crosses half the sky in hours: no daily table can
# hold that, and the app shows nothing across any step wider than MAX_STEP_DEG (ephemeris-table.ts).
CRAFT = [
    ("-21", "L1", 1),  # SOHO
    ("-92", "L1", 1),  # ACE
    ("-78", "L1", 1),  # DSCOVR
    ("-8", "L1", 1),  # Wind
    ("-156", "L1", 1),  # Aditya-L1
    ("-43", "L1", 1),  # IMAP
    ("-231", "L1", 1),  # SWFO-L1
    ("-171", "L1", 1),  # Carruthers Geocorona Observatory
    ("-170", "L2", 1),  # James Webb Space Telescope
    ("-680", "L2", 1),  # Euclid
    ("-139479", "deep", 1),  # Gaia (retired March 2025, left L2 for a solar orbit)
    ("-96", "deep", 1),  # Parker Solar Probe
    ("-144", "deep", 1),  # Solar Orbiter
    ("-121", "deep", 1),  # BepiColombo
    ("-234", "deep", 2),  # STEREO-A
    ("-61", "deep", 2),  # Juno
    ("-255", "deep", 2),  # Psyche
    ("-159", "deep", 1),  # Europa Clipper (Earth flyby December 2026)
    ("-49", "deep", 2),  # Lucy
    ("-64", "deep", 1),  # OSIRIS-REx / OSIRIS-APEX (Earth flyby 2027)
    ("-28", "deep", 1),  # JUICE (Earth flyby September 2026)
    ("-91", "deep", 2),  # Hera
    ("-98", "deep", 5),  # New Horizons
    ("-31", "deep", 5),  # Voyager 1
    ("-32", "deep", 5),  # Voyager 2
    ("-23", "deep", 5),  # Pioneer 10
    ("-24", "deep", 5),  # Pioneer 11
]

MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def query(craft_id: str, start: datetime.date, stop: datetime.date, step: int) -> str:
    params = {
        "format": "text",
        "COMMAND": f"'{craft_id}'",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'500@399'",
        "START_TIME": f"'{start.isoformat()}'",
        "STOP_TIME": f"'{stop.isoformat()}'",
        "STEP_SIZE": f"'{step}d'",
        "QUANTITIES": "'1,20'",
        "ANG_FORMAT": "DEG",
        "CSV_FORMAT": "YES",
    }
    name = f"spacecraft/{craft_id.strip('-')}_{start.isoformat()}_{stop.isoformat()}_{step}d.txt"
    return cached_fetch(f"{HORIZONS}?{urllib.parse.urlencode(params)}", name).read_text(encoding="utf-8")


def parse_bound(text: str, which: str) -> datetime.date | None:
    """The date in Horizons' 'No ephemeris for target ... prior to/after A.D. 2026-JAN-05 12:00' message."""
    found = re.search(rf"{which} A\.D\. (\d{{4}})-([A-Za-z]{{3}})-(\d{{2}})", text)
    if not found:
        return None
    return datetime.date(int(found.group(1)), MONTHS[found.group(2).capitalize()], int(found.group(3)))


def fetch_craft(craft_id: str, step: int) -> tuple[str, datetime.date, list[tuple[float, float, float]]]:
    start, stop = START, STOP
    for _ in range(4):
        text = query(craft_id, start, stop, step)
        if "$$SOE" in text:
            break
        before = parse_bound(text, "prior to")
        after = parse_bound(text, "after")
        if before:
            # Keep to the grid of whole steps from START.
            days = (before - START).days + 1
            start = START + datetime.timedelta(days=-(-days // step) * step)
        if after:
            stop = after - datetime.timedelta(days=1)
        if not before and not after or start >= stop:
            raise SystemExit(f"{craft_id}: no ephemeris in range:\n{text[-600:]}")
    else:
        raise SystemExit(f"{craft_id}: could not find a range Horizons covers")
    name = re.search(r"Target body name:\s*(.+?)\s*\{", text)
    if not name:
        raise SystemExit(f"{craft_id}: no target name in the response")
    rows = []
    for line in text[text.index("$$SOE") + 5 : text.index("$$EOE")].strip().splitlines():
        fields = [f.strip() for f in line.split(",")]
        # date, sun flag, moon flag, RA, Dec, delta (au), deldot
        rows.append((float(fields[3]), float(fields[4]), float(fields[5])))
    return name.group(1), start, rows


def tidy(name: str) -> str:
    """'James Webb Space Telescope (spacecraft) (-170)' -> 'James Webb Space Telescope'."""
    name = re.sub(r"\s*\((?:spacecraft|Spacecraft|-?\d+)\)", "", name)
    return re.sub(r"\s+", " ", name).strip()


def main() -> None:
    craft = []
    for craft_id, where, step in CRAFT:
        name, start, rows = fetch_craft(craft_id, step)
        entry = {
            "name": tidy(name),
            "horizons": craft_id,
            "where": where,
            "stepDays": step,
            "offsetDays": (start - START).days,
            "ra": [round(r[0], 3) for r in rows],
            "dec": [round(r[1], 3) for r in rows],
            # Six significant figures: 150 km at L1, and a part in a million of anything further.
            "au": [float(f"{r[2]:.6g}") for r in rows],
        }
        craft.append(entry)
        last = start + datetime.timedelta(days=step * (len(rows) - 1))
        print(f"{entry['name']:36s} {where:4s} {start} .. {last}  {len(rows):4d} samples  {rows[0][2]:12.6f} au")
    data = {
        "source": "JPL Horizons (ssd.jpl.nasa.gov/horizons): geocentric astrometric RA/Dec (ICRF) and range at 00:00 UTC",
        "start": START.isoformat(),
        "stop": STOP.isoformat(),
        "craft": craft,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUTPUT.name}: {OUTPUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
