#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: fireballs (bolides).

Writes app/public/geo/fireballs.json: every fireball in NASA/JPL CNEOS's
"Fireball and Bolide Data" that has a reported position - bright meteors
seen by U.S. Government sensors since 1988, with the time of peak
brightness, where it was, how high, how fast and how much energy it had.

Source:

    NASA/JPL Center for Near Earth Object Studies (CNEOS), Fireball Data
    API v1.2, https://ssd-api.jpl.nasa.gov/fireball.api
    (documentation: https://ssd-api.jpl.nasa.gov/doc/fireball.html;
    the table: https://cneos.jpl.nasa.gov/fireballs/). NASA/JPL data,
    free to use with credit ("Courtesy NASA/JPL-Caltech").

The API sends no CORS header, so a browser cannot read it: the layer is
baked, and the file records the day it was fetched.

What is kept, as CNEOS gives it:

    t         time of peak brightness, UTC
    lat, lon  degrees (CNEOS prints tenths of a degree with N/S, E/W)
    altKm     altitude of peak brightness above the geoid, km; null where
              the sensors did not report one (about a third of events)
    velKms    speed at peak brightness, km/s; null likewise
    energyKt  CNEOS's "calculated total impact energy", kilotons of TNT
    radiatedJ "total radiated energy", joules (CNEOS prints units of 1e10 J)

Events without a position (about one in six, mostly the oldest) cannot be
put on a globe and are left out; the file says how many.

Two events carry a name, both by their date in the table and both named by
NASA itself: the 15 Feb 2013 Chelyabinsk airburst and the 18 Dec 2018
Bering Sea fireball (https://www.jpl.nasa.gov/news/nasa-instruments-image-fireball-over-bering-sea).
Nothing else is named: the table has no names.

Output, largest energy first:

    {source, fetched, total, withoutPosition,
     fireballs: [{t, lat, lon, altKm, velKms, energyKt, radiatedJ, name?}]}

Usage:
    python3 tools/pipeline/generate_fireballs.py [--refresh]
"""

import json
import sys
from datetime import datetime, timezone

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

API_URL = "https://ssd-api.jpl.nasa.gov/fireball.api"
CACHE_NAME = "hazards/fireballs.json"

#: Time of peak brightness as the table prints it -> the name NASA gives the event.
NAMED = {
    "2013-02-15 03:20:26": "Chelyabinsk",
    "2018-12-18 23:48:18": "Bering Sea",
}


def number(text: str | None) -> float | None:
    return None if text is None else float(text)


def build(payload: dict) -> tuple[list[dict], int]:
    """(fireballs with a position, how many had none)."""
    fields = payload["fields"]
    fireballs = []
    without = 0
    for row in payload["data"]:
        r = dict(zip(fields, row))
        if r["lat"] is None or r["lon"] is None:
            without += 1
            continue
        lat = float(r["lat"]) * (-1 if r["lat-dir"] == "S" else 1)
        lon = float(r["lon"]) * (-1 if r["lon-dir"] == "W" else 1)
        entry = {
            "t": r["date"].replace(" ", "T") + "Z",
            "lat": lat,
            "lon": lon,
            "altKm": number(r["alt"]),
            "velKms": number(r["vel"]),
            "energyKt": float(r["impact-e"]),
            "radiatedJ": float(r["energy"]) * 1e10,
        }
        if r["date"] in NAMED:
            entry["name"] = NAMED[r["date"]]
        fireballs.append(entry)
    fireballs.sort(key=lambda f: (-f["energyKt"], f["t"]))
    return fireballs, without


def main() -> None:
    path = cached_fetch(API_URL, CACHE_NAME, refresh="--refresh" in sys.argv)
    payload = json.loads(path.read_text(encoding="utf-8"))
    fireballs, without = build(payload)
    fetched = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%d")
    write_json(OUTPUT_DIR / "fireballs.json", {
        "source": "NASA/JPL CNEOS Fireball and Bolide Data, https://cneos.jpl.nasa.gov/fireballs/ (API v%s)"
                  % payload["signature"]["version"],
        "fetched": fetched,
        "total": int(payload["count"]),
        "withoutPosition": without,
        "fireballs": fireballs,
    })
    print(f"{len(fireballs)} fireballs with a position ({without} without), "
          f"{sum(f['altKm'] is not None for f in fireballs)} with an altitude; largest: "
          + ", ".join(f"{f['t'][:10]} {f['energyKt']} kt" for f in fireballs[:4]), file=sys.stderr)


if __name__ == "__main__":
    main()
