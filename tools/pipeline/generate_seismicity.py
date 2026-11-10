#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: earthquakes at depth.

Writes what the app draws inside the see-through Earth, below the surface:

    app/public/geo/quakes.json  every M >= MIN_MAGNITUDE earthquake since
                                CATALOG_START_YEAR, at its hypocentre and
                                origin time, plus labels for the great
                                (M >= LABEL_MAGNITUDE) ones

The subducting slabs the earthquakes outline are baked by generate_slabs.py.

Source (see app/public/geo/ATTRIBUTION.md), public domain (USGS):

    Earthquakes  USGS ANSS Comprehensive Catalog (ComCat), via the FDSN
                 event web service.

quakes.json is columnar, one entry per earthquake, oldest first:

    minute       origin time in whole minutes (UTC, floored); the first entry
                 counts from 1970-01-01T00:00Z, each later one from the entry
                 before it
    lon, lat     quanta of 1/quantumPerDegree degrees (0.01 deg: at most
                 0.79 km off on the ground)
    depthKm      whole km below sea level (at most 0.5 km off); the handful
                 of events located above sea level are put at 0
    magnitude10  ComCat's preferred magnitude times ten, halves rounded up

What goes in, and what does not (the counts are written into the file):

    * Only ComCat event type "earthquake". At M5+ the catalogue also lists
      nuclear tests, other explosions, volcanic-collapse events, landslides,
      a rock burst and a mine collapse - real ground motion, not earthquakes.
    * Not the second record of an earthquake ComCat lists twice, under two
      networks it failed to associate: see drop_cross_network_duplicates.

Licence: ComCat is public domain, but 0.4 % of these events are records
ComCat took from the ISC-GEM Global Instrumental Earthquake Catalogue
(networks "iscgem", "iscgemsup"), which is CC BY-SA 3.0 - among them the
M8.3 Sumba earthquake of 1977, so leaving them out would leave a hole.
They are kept and counted ("iscGem" in the file), ISC-GEM is credited, and
quakes.json is therefore shared under CC BY-SA 3.0. To get a purely
public-domain file instead, put the two networks in EXCLUDED_NETWORKS.

The magnitude is whatever type ComCat prefers for the event - mb for about
half (it saturates near 6.5), a moment magnitude for most of the rest - so
"M5+" is a threshold on mixed scales, as in every ComCat search. Depths of
exactly 10, 33 and 35 km are mostly defaults assigned when the depth could
not be resolved (about 44 % of events), not measurements.

The catalogue is revised for weeks after an event, so the last month before
CATALOG_END still changes between runs; everything older is stable.

Usage:
    python3 tools/pipeline/generate_seismicity.py [--source-dir DIR] [--only quakes]

--only quakes is accepted for the scripts that still pass it, from when this
file baked the slabs as well; it changes nothing.

The catalogue pages are kept in tools/pipeline/.cache/comcat/ (delete them
to fetch the catalogue afresh).

--source-dir reads an already-downloaded file instead of fetching:
    usgs_quakes.csv                     (FDSN csv, one header, any year order)
Requires only the Python standard library.
"""

import argparse
import csv
import math
import re
import sys
from collections import Counter
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, write_json

FDSN_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"

# M5 is complete worldwide since the early 1970s and already outlines every
# Wadati-Benioff zone; M4.5 would triple the file for the same picture.
MIN_MAGNITUDE = 5.0
CATALOG_START_YEAR = 1973
# Fixed end, so a rerun reproduces the same file.
CATALOG_END = "2026-11-01"
LABEL_MAGNITUDE = 8.0
# The FDSN service refuses a query matching more than 20000 events; a year
# of M5+ is ~1700, so five years stay well inside it.
FETCH_YEARS_PER_REQUEST = 5
FDSN_MAX_EVENTS = 20000
# ComCat's ISC-GEM records are CC BY-SA 3.0 (see the docstring).
ISC_GEM_NETWORKS = {"iscgem", "iscgemsup"}
# Networks whose records are left out. Empty: everything is kept.
EXCLUDED_NETWORKS: set[str] = set()
# Two records this close, from different networks, are one earthquake.
DUPLICATE_WINDOW_S = 16.0
DUPLICATE_DISTANCE_KM = 200.0
DUPLICATE_MAGNITUDE = 0.3
EARTH_RADIUS_KM = 6371.0

def load_quake_rows(source_dir: Path | None) -> list[dict]:
    if source_dir is not None:
        return list(csv.DictReader((source_dir / "usgs_quakes.csv").read_text(encoding="utf-8").splitlines()))
    rows = []
    end_year = int(CATALOG_END[:4])
    for start in range(CATALOG_START_YEAR, end_year + 1, FETCH_YEARS_PER_REQUEST):
        stop = min(start + FETCH_YEARS_PER_REQUEST, end_year + 1)
        stop_date = CATALOG_END if stop > end_year else f"{stop}-01-01"
        url = (f"{FDSN_URL}?format=csv&orderby=time-asc&minmagnitude={MIN_MAGNITUDE}"
               f"&starttime={start}-01-01&endtime={stop_date}")
        text = cached_fetch(url, f"comcat/m{MIN_MAGNITUDE:g}_{start}_{stop_date}.csv").read_text(encoding="utf-8")
        chunk = list(csv.DictReader(text.splitlines()))
        if len(chunk) >= FDSN_MAX_EVENTS:
            raise ValueError(f"{url} hit the {FDSN_MAX_EVENTS}-event cap; shorten FETCH_YEARS_PER_REQUEST")
        rows += chunk
    return rows


def quake_region(place: str) -> str:
    """'near the east coast of Honshu, Japan' -> 'Japan'; named events lose
    their year and 'Earthquake': '2004 Sumatra - Andaman Islands Earthquake'
    -> 'Sumatra - Andaman Islands'."""
    if not place:
        return "unlocated"
    region = place.rsplit(",", 1)[-1].strip()
    return re.sub(r"^\d{4} | Earthquake$", "", region)


def half_up(text: str, scale: int) -> int:
    """Decimal text times scale, to the nearest integer, halves away from zero.

    Python's round() works on binary floats and sends halves to the even
    neighbour, so a catalogue M5.45 would become 5.4 but M5.55 5.6.
    """
    return int((Decimal(text) * scale).to_integral_value(ROUND_HALF_UP))


def chord_km(a: dict, b: dict) -> float:
    """Straight-line distance between two epicentres."""
    def unit(e: dict) -> tuple[float, float, float]:
        lon, lat = math.radians(e["lon"]), math.radians(e["lat"])
        return (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))
    return EARTH_RADIUS_KM * math.dist(unit(a), unit(b))


def drop_cross_network_duplicates(events: list[dict]) -> tuple[list[dict], int]:
    """Drop the second record of an earthquake ComCat lists twice.

    ComCat merges the solutions different networks send for one earthquake
    into one event, but a few dozen slipped through and stand as two events:
    a Global CMT centroid beside the NEIC hypocentre, or an Alaska network
    solution beside NEIC's. They are told from real doublets by coming from
    different networks, at nearly the same instant and place with nearly the
    same magnitude; two shocks of one sequence are located by one network.
    Of a pair, the one dropped is the "gcmt" record (a centroid, not a
    hypocentre), else the ISC-GEM one, else NEIC's ("us") in favour of the
    regional network's.

    `events` must be sorted by time. Returns (kept, number dropped).
    """
    def rank(e: dict) -> int:
        return {"gcmt": 0, "iscgem": 1, "iscgemsup": 1, "us": 2}.get(e["net"], 3)

    dropped: set[str] = set()
    for i, first in enumerate(events):
        for second in events[i + 1:]:
            if second["t"] - first["t"] > DUPLICATE_WINDOW_S:
                break
            if (first["net"] == second["net"] or first["id"] in dropped or second["id"] in dropped
                    or abs(first["mag"] - second["mag"]) > DUPLICATE_MAGNITUDE + 1e-9
                    or chord_km(first, second) > DUPLICATE_DISTANCE_KM):
                continue
            dropped.add(min(first, second, key=rank)["id"])
    return [e for e in events if e["id"] not in dropped], len(dropped)


def build_quakes(rows: list[dict]) -> tuple[dict, list[dict]]:
    """quakes.json's columns and bookkeeping, and the M8+ labels."""
    events = []
    seen = set()
    seen_origins = set()
    excluded: Counter[str] = Counter()
    for row in rows:
        if row["id"] in seen:  # an event exactly on a chunk edge comes twice
            continue
        seen.add(row["id"])
        if row.get("type") != "earthquake":
            excluded[row.get("type") or "untyped"] += 1
            continue
        if not row.get("mag") or not row.get("depth"):
            excluded["no magnitude or depth"] += 1
            continue
        if row["net"] in EXCLUDED_NETWORKS:
            excluded[f"network {row['net']}"] += 1
            continue
        # ComCat holds the odd origin twice, under two ids of one network.
        origin = (row["time"], row["longitude"], row["latitude"], row["depth"], row["mag"])
        if origin in seen_origins:
            excluded["identical record under a second id"] += 1
            continue
        seen_origins.add(origin)
        events.append({
            "id": row["id"],
            "net": row["net"],
            "t": datetime.fromisoformat(row["time"].replace("Z", "+00:00")).timestamp(),
            "lon": float(row["longitude"]),
            "lat": float(row["latitude"]),
            "mag": float(row["mag"]),
            "lonQ": half_up(row["longitude"], QUANTUM_PER_DEG),
            "latQ": half_up(row["latitude"], QUANTUM_PER_DEG),
            # Above sea level (a volcano's flank): the app's surface is sea level.
            "depthKm": max(0, half_up(row["depth"], 1)),
            "mag10": half_up(row["mag"], 10),
            "year": row["time"][:4],
            "place": row.get("place") or "",
        })
    events.sort(key=lambda e: (e["t"], e["id"]))
    events, duplicates = drop_cross_network_duplicates(events)
    if duplicates:
        excluded["duplicate of another network's record"] = duplicates

    minutes = [int(e["t"] // 60) for e in events]
    columns = {
        "count": len(events),
        "excluded": dict(sorted(excluded.items())),
        "iscGem": sum(1 for e in events if e["net"] in ISC_GEM_NETWORKS),
        "minute": minutes[:1] + [b - a for a, b in zip(minutes, minutes[1:])],
        "lon": [e["lonQ"] for e in events],
        "lat": [e["latQ"] for e in events],
        "depthKm": [e["depthKm"] for e in events],
        "magnitude10": [e["mag10"] for e in events],
    }
    # Labels carry the very numbers of their points, so each sits on its dot.
    great = sorted((e for e in events if e["mag10"] >= LABEL_MAGNITUDE * 10), key=lambda e: (-e["mag"], -e["t"]))
    labels = [{"kind": "quake", "name": f"M{e['mag10'] / 10:.1f} {quake_region(e['place'])} {e['year']}",
               "lon": e["lonQ"] / QUANTUM_PER_DEG, "lat": e["latQ"] / QUANTUM_PER_DEG, "depthKm": e["depthKm"],
               "priority": round(10 - e["mag"], 2)} for e in great]
    return columns, labels


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--source-dir", type=Path, help="read source files from here instead of fetching")
    parser.add_argument("--only", choices=("quakes",), help="accepted and ignored: quakes.json is all this writes")
    args = parser.parse_args()

    columns, labels = build_quakes(load_quake_rows(args.source_dir))
    print(f"quakes: {columns['count']}, labelled: {len(labels)}, left out: {columns['excluded']}", file=sys.stderr)
    write_json(OUTPUT_DIR / "quakes.json", {
        "source": f"USGS ANSS ComCat, earthquakes M>={MIN_MAGNITUDE} {CATALOG_START_YEAR} to {CATALOG_END}; "
                  "includes ISC-GEM records, CC BY-SA 3.0. See ATTRIBUTION.md.",
        "start": f"{CATALOG_START_YEAR}-01-01",
        "end": CATALOG_END,
        "quantumPerDegree": QUANTUM_PER_DEG,
        **columns,
        "labels": labels,
    })


if __name__ == "__main__":
    main()
