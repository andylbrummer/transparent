#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: snapshot of current natural events.

Writes app/public/geo/hazards-snapshot.json: what the "Natural events now
(live)" layer falls back on when it cannot reach NASA EONET - the same two
queries the layer makes, reduced the same way, as they stood when this
script ran. The app shows it as stale, with its date.

Source:

    NASA Earth Observatory Natural Event Tracker (EONET) v3,
    https://eonet.gsfc.nasa.gov/docs/v3 - NASA's curated list of natural
    events in progress: wildfires (from InciWeb/IRWIN and GDACS), floods
    (GDACS), erupting volcanoes (Smithsonian Global Volcanism Program),
    icebergs (U.S. National Ice Center, BYU), severe storms (JTWC, NHC).
    Keyless, CORS-enabled, NASA open data (no restrictions on use).

The two queries (the same strings are in app/src/layers/hazards-live/eonet.ts):

    ONGOING  status=open, categories volcanoes, seaLakeIce, severeStorms:
             things that last - an eruption stays open for months
    RECENT   status=all, past RECENT_DAYS days, every other category:
             fires and floods, which EONET's sources open and close daily
             (asking for "open" wildfires alone returns thousands of
             long-dead incidents nobody closed)

Each event is reduced to one marker: its latest position (for an event with
a polygon, the middle of the polygon's bounding box), the dates of its first
and latest report, and its latest magnitude with unit where EONET has one
(fire area, storm wind, iceberg area).

Output:

    {source, generated, events: [{id, title, category, lon, lat, first, date, closed, mag, unit, from}]}

Usage:
    python3 tools/pipeline/generate_hazards_snapshot.py

Fetched afresh on every run; standard library only.
"""

import json
import sys
from datetime import datetime, timezone

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
RECENT_DAYS = 14
ONGOING_CATEGORIES = ("volcanoes", "seaLakeIce", "severeStorms")
RECENT_CATEGORIES = ("wildfires", "floods", "drought", "dustHaze", "landslides", "snow", "tempExtremes", "waterColor",
                     "manmade", "earthquakes")
QUERIES = {
    "ongoing": f"status=open&category={','.join(ONGOING_CATEGORIES)}",
    "recent": f"status=all&days={RECENT_DAYS}&category={','.join(RECENT_CATEGORIES)}",
}


def position(geometry: dict) -> tuple[float, float] | None:
    """(lon, lat) of a Point, or of the middle of a Polygon's bounding box."""
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Point":
        return float(coordinates[0]), float(coordinates[1])
    if geometry.get("type") == "Polygon":
        ring = coordinates[0]
        lons = [p[0] for p in ring]
        lats = [p[1] for p in ring]
        return (min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2
    return None


def reduce_event(event: dict) -> dict | None:
    geometries = sorted((g for g in event.get("geometry", []) if position(g) is not None), key=lambda g: g["date"])
    if not geometries or not event.get("categories"):
        return None
    latest = geometries[-1]
    lon, lat = position(latest)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {
        "id": event["id"],
        "title": event["title"],
        "category": event["categories"][0]["id"],
        "lon": round(lon, 3),
        "lat": round(lat, 3),
        "first": geometries[0]["date"],
        "date": latest["date"],
        "closed": event.get("closed"),
        "mag": latest.get("magnitudeValue"),
        "unit": latest.get("magnitudeUnit"),
        "from": event["sources"][0]["id"] if event.get("sources") else None,
    }


def reduce_all(payloads: list[dict]) -> list[dict]:
    """Every event once, the latest report first."""
    by_id: dict[str, dict] = {}
    for payload in payloads:
        for event in payload["events"]:
            reduced = reduce_event(event)
            if reduced:
                by_id[reduced["id"]] = reduced
    return sorted(by_id.values(), key=lambda e: (e["date"], e["id"]), reverse=True)


def main() -> None:
    payloads = []
    for name, query in QUERIES.items():
        path = cached_fetch(f"{EONET_URL}?{query}", f"hazards/eonet-{name}.json", refresh=True)
        payloads.append(json.loads(path.read_text(encoding="utf-8")))
    events = reduce_all(payloads)
    write_json(OUTPUT_DIR / "hazards-snapshot.json", {
        "source": "NASA EONET v3, https://eonet.gsfc.nasa.gov/",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "events": events,
    })
    counts: dict[str, int] = {}
    for event in events:
        counts[event["category"]] = counts.get(event["category"], 0) + 1
    print(f"{len(events)} events: " + ", ".join(f"{n} {c}" for c, n in sorted(counts.items())), file=sys.stderr)


if __name__ == "__main__":
    main()
