#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: meteorites.

Writes app/public/geo/meteorites.json: every meteorite that was SEEN to
fall and then recovered (a "fall"), and the largest masses ever found
(Hoba, Cape York, Campo del Cielo...), with name, year, mass, class and
the place of recovery.

Source:

    "Meteorite Landings", NASA Open Data Portal,
    https://data.nasa.gov/dataset/meteorite-landings - a table of The
    Meteoritical Society's Meteoritical Bulletin Database
    (https://www.lpi.usra.edu/meteor/) as it stood in 2013: 45,716
    meteorites, the newest fall being Chelyabinsk.

    Licence: the portal entry states none ("License not specified"). The
    table is a U.S. Government publication of facts compiled by The
    Meteoritical Society; it is kept in its own file so it can be dropped.
    See docs/data-sources/events.md.

What is kept:

    falls   every record with fall = "Fell" and a position. Records at
            exactly 0 N 0 E are missing positions written as zeros and are
            left out, as are those with no position at all.
    finds   records with fall = "Found" of FIND_MIN_MASS_G or more: the
            great irons, mostly. Of the 44,609 finds nearly all are
            gram-sized stones from Antarctica and the deserts; drawing
            them would map where people search, not where meteorites are.

Mass is the total known mass in grams as the Bulletin gives it; a fall
with no mass recorded keeps null.

Output, heaviest first within each list:

    {source, asOf, falls: [[name, year, lat, lon, massG, class], ...], finds: [...]}

Usage:
    python3 tools/pipeline/generate_meteorites.py
"""

import csv
import sys

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

CSV_URL = "https://data.nasa.gov/docs/legacy/meteorite_landings/Meteorite_Landings.csv"
CACHE_NAME = "hazards/meteorite_landings.csv"
FIND_MIN_MASS_G = 1_000_000


def record(row: dict) -> list | None:
    """[name, year, lat, lon, massG, class], or None without a usable position."""
    if not row["reclat"] or not row["reclong"]:
        return None
    lat = float(row["reclat"])
    lon = float(row["reclong"])
    if lat == 0 and lon == 0:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    year = int(row["year"]) if row["year"] else None
    mass = float(row["mass (g)"]) if row["mass (g)"] else None
    if mass is not None and mass == int(mass):
        mass = int(mass)
    return [row["name"], year, round(lat, 3), round(lon, 3), mass, row["recclass"]]


def build(rows: list[dict]) -> tuple[list[list], list[list]]:
    falls = []
    finds = []
    for row in rows:
        if row["nametype"] != "Valid":
            continue
        entry = record(row)
        if entry is None:
            continue
        if row["fall"] == "Fell":
            falls.append(entry)
        elif entry[4] is not None and entry[4] >= FIND_MIN_MASS_G:
            finds.append(entry)
    by_mass = lambda e: (-(e[4] or 0), e[0])  # noqa: E731
    return sorted(falls, key=by_mass), sorted(finds, key=by_mass)


def main() -> None:
    path = cached_fetch(CSV_URL, CACHE_NAME)
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    falls, finds = build(rows)
    write_json(OUTPUT_DIR / "meteorites.json", {
        "source": "Meteorite Landings, NASA Open Data Portal; from The Meteoritical Society's Meteoritical Bulletin Database",
        "asOf": max(e[1] for e in falls if e[1] is not None),
        "records": len(rows),
        "findMinMassG": FIND_MIN_MASS_G,
        "falls": falls,
        "finds": finds,
    })
    print(f"{len(rows)} records: {len(falls)} located falls, {len(finds)} finds of {FIND_MIN_MASS_G / 1e6:g} t or more; "
          "heaviest falls: " + ", ".join(f"{e[0]} {e[4] / 1e6:g} t" for e in falls[:4]), file=sys.stderr)


if __name__ == "__main__":
    main()
