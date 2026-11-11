#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: scientific ocean drilling.

Writes app/public/geo/drill-holes.json: every hole cored into the seabed
by the Deep Sea Drilling Project (DSDP, legs 1-96, 1968-1983), the Ocean
Drilling Program (ODP, legs 100-210, 1985-2003) and the Integrated and
International Ocean Discovery Programs (IODP, expeditions 301 on, from
2003), with the programmes that worked it and how many cruises did.

Source:

    IODP, "Drilled Holes" (the table behind its Google Earth maps),
    https://kml.iodp.org/Drilled_Holes.csv - one row per hole per cruise:
    leg or expedition, site, hole, latitude, longitude, links to the core
    data. No licence is stated; the programmes are publicly funded (NSF,
    JAMSTEC, ECORD and partners) and their data are published openly.
    Cited as IODP's table; see docs/data-sources/earth-extras.md.

What is not used: the "core_penetrated" column. Read across cruises it
is not one quantity: Hole 735B gives 500.7 m for leg 118 and 1,508 m for
leg 176, the hole's whole depth after both, while Hole 504B's legs give
each cruise's own interval. Holes are therefore not sized by depth.

A cruise's programme is from its leg or expedition number: under 100
DSDP, 100-210 ODP, 301 and over IODP (DSDP's 78A/78B are leg 78). A hole
is one site and hole letter; a hole revisited (504B, nine rows) is one
point, at its first-listed position.

Output: {source, holes: [[name, lat, lon, programmes, cruises], ...]}
with programmes a bit mask (1 DSDP, 2 ODP, 4 IODP), most-visited first.

Usage:
    python3 tools/pipeline/generate_drill_holes.py
"""

import csv
import re
import sys
from collections import Counter

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

CSV_URL = "https://kml.iodp.org/Drilled_Holes.csv"
CACHE_NAME = "subsurface/Drilled_Holes.csv"
DSDP, ODP, IODP = 1, 2, 4


def programme(cruise: str) -> int:
    found = re.match(r"(\d+)", cruise)
    if not found:
        raise ValueError(f"no leg or expedition number in {cruise!r}")
    number = int(found.group(1))
    if number < 100:
        return DSDP
    if number <= 210:
        return ODP
    if number >= 301:
        return IODP
    raise ValueError(f"leg {number} belongs to no programme")


def read(path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def build(rows: list[dict]) -> list[list]:
    holes: dict[str, dict] = {}
    for row in rows:
        name = row["site"] + row["hole"]
        cruise = row["leg"] or row["expedition"]
        hole = holes.setdefault(name, {"lat": float(row["latitude"]), "lon": float(row["longitude"]), "mask": 0, "cruises": set()})
        hole["mask"] |= programme(cruise)
        hole["cruises"].add(cruise)
    out = [[name, round(h["lat"], 4), round(h["lon"], 4), h["mask"], len(h["cruises"])] for name, h in holes.items()]
    out.sort(key=lambda h: (-h[4], h[0]))
    return out


def main() -> None:
    rows = read(cached_fetch(CSV_URL, CACHE_NAME))
    holes = build(rows)
    write_json(OUTPUT_DIR / "drill-holes.json", {
        "source": "IODP Drilled Holes table, kml.iodp.org (DSDP, ODP and IODP)",
        "rows": len(rows),
        "holes": holes,
    })
    counts = Counter(h[3] for h in holes)
    print(f"{len(rows)} rows, {len(holes)} holes; by programme mask {dict(counts)}; most visited "
          + ", ".join(f"{h[0]} ({h[4]})" for h in holes[:5]), file=sys.stderr)


if __name__ == "__main__":
    main()
