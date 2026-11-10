#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: two small earthquake sets.

    app/public/geo/quakes-recent-snapshot.json
        What the "Recent earthquakes (live)" layer falls back on when it
        cannot reach USGS: the two real-time feeds it reads, merged, as they
        stood when this script ran. The app shows it as stale, with its date.

    app/public/geo/quakes-notable.json
        The "Notable earthquakes since 1900" layer: every M >= 8.5 earthquake
        since 1900 and the named presets of spec/seismic.md that fall below
        that (PRESET_EVENT_IDS).

Sources:

    Recent   USGS Earthquake Hazards Program real-time GeoJSON summary feeds,
             https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
             (M4.5+ past 30 days and M2.5+ past 7 days). Public domain.
    Notable  USGS ANSS Comprehensive Catalog (ComCat), FDSN event service.
             Public domain - but before 1973 ComCat's locations are those of
             the ISC-GEM Global Instrumental Earthquake Catalogue
             (International Seismological Centre, doi:10.31905/D808B825),
             CC BY-SA 3.0. The file records each event's location source and
             is shared under CC BY-SA 3.0.

The snapshot keeps the feeds' own GeoJSON shape, cut down to the properties
the app reads, so the app parses live and baked data with one parser. Only
events of type "earthquake" are kept (the feeds also carry quarry blasts).

Usage:
    python3 tools/pipeline/generate_quake_sets.py [--only recent|notable]

The recent feeds are fetched afresh on every run; the notable queries are
cached in tools/pipeline/.cache/comcat/. Requires only the standard library.
"""

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{name}.geojson"
# The feeds the app reads, widest first; the same list is in the layer.
RECENT_FEEDS = ("4.5_month", "2.5_week")
SNAPSHOT_PROPERTIES = ("mag", "place", "time", "magType", "type")

FDSN_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
NOTABLE_START = "1900-01-01"
# Fixed end, so a rerun reproduces the same file.
NOTABLE_END = "2026-11-01"
NOTABLE_MIN_MAGNITUDE = 8.5
# spec/seismic.md's notable-event presets that are smaller than M8.5, by
# ComCat event id: the 1906 San Francisco earthquake and the 2023
# Kahramanmaras (Turkiye-Syria) mainshock.
PRESET_EVENT_IDS = ("official19060418131226300_12", "us6000jllz")


def recent_snapshot() -> dict:
    features: dict[str, dict] = {}
    generated = 0
    for name in RECENT_FEEDS:
        url = FEED_URL.format(name=name)
        feed = json.loads(cached_fetch(url, f"feeds/{name}.geojson", refresh=True).read_text(encoding="utf-8"))
        if feed.get("type") != "FeatureCollection":
            raise ValueError(f"{url} is not a FeatureCollection")
        generated = max(generated, feed["metadata"]["generated"])
        for feature in feed["features"]:
            properties = feature["properties"]
            coordinates = feature["geometry"]["coordinates"]
            if properties.get("type") != "earthquake" or properties.get("mag") is None or None in coordinates:
                continue
            # A later feed's copy of an event replaces an earlier one: both are current.
            features[feature["id"]] = {
                "type": "Feature",
                "id": feature["id"],
                "properties": {key: properties.get(key) for key in SNAPSHOT_PROPERTIES},
                "geometry": {"type": "Point", "coordinates": coordinates},
            }
    ordered = sorted(features.values(), key=lambda f: f["properties"]["time"])
    return {
        "type": "FeatureCollection",
        "metadata": {
            "generated": generated,
            "title": "USGS earthquakes, snapshot of the real-time feeds " + ", ".join(RECENT_FEEDS),
            "source": "USGS Earthquake Hazards Program real-time feeds, public domain. See ATTRIBUTION.md.",
            "count": len(ordered),
        },
        "features": ordered,
    }


def notable_name(place: str) -> str:
    """ComCat's place text as a short name.

    '1960 Great Chilean Earthquake (Valdivia Earthquake)' -> 'Great Chilean';
    'The 1964 Prince William Sound, Alaska Earthquake' -> 'Prince William
    Sound, Alaska'; '89 km ESE of Petropavlovsk-Kamchatsky, Russia' ->
    'Petropavlovsk-Kamchatsky, Russia'.
    """
    name = re.sub(r"\s*\([^)]*\)", "", place)
    name = re.sub(r"^The ", "", name)
    name = re.sub(r"^\d{4} ", "", name)
    name = re.sub(r"\s*\b[Ee]arthquake( sequence)?\b", "", name)
    name = re.sub(r"^\d+ km [NSEW]{1,3} of ", "", name)
    return re.sub(r"\s+", " ", name).strip(" ,")


def fetch_rows(url: str, cache_name: str) -> list[dict]:
    return list(csv.DictReader(cached_fetch(url, cache_name).read_text(encoding="utf-8").splitlines()))


def notable_events() -> list[dict]:
    rows = fetch_rows(
        f"{FDSN_URL}?format=csv&orderby=time-asc&minmagnitude={NOTABLE_MIN_MAGNITUDE}"
        f"&starttime={NOTABLE_START}&endtime={NOTABLE_END}",
        f"comcat/notable_m{NOTABLE_MIN_MAGNITUDE:g}_{NOTABLE_START}_{NOTABLE_END}.csv")
    for event_id in PRESET_EVENT_IDS:
        found = fetch_rows(f"{FDSN_URL}?format=csv&eventid={event_id}", f"comcat/event_{event_id}.csv")
        if len(found) != 1 or found[0]["id"] != event_id:
            raise ValueError(f"ComCat has no single event {event_id}")
        rows += found
    events = {}
    for row in rows:
        # ComCat leaves the type of some pre-1973 earthquakes blank.
        if row["type"] not in ("earthquake", ""):
            continue
        year = row["time"][:4]
        events[row["id"]] = {
            "id": row["id"],
            "time": row["time"],
            "lon": float(row["longitude"]),
            "lat": float(row["latitude"]),
            "depthKm": float(row["depth"]),
            "mag": float(row["mag"]),
            "magType": row["magType"],
            "name": f"{notable_name(row['place'])} {year}",
            "place": row["place"],
            "locationSource": row["locationSource"],
            "magSource": row["magSource"],
        }
    return sorted(events.values(), key=lambda e: e["time"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", choices=("recent", "notable"), help="write just one of the two files")
    args = parser.parse_args()

    if args.only != "notable":
        snapshot = recent_snapshot()
        when = datetime.fromtimestamp(snapshot["metadata"]["generated"] / 1000, timezone.utc)
        print(f"recent: {snapshot['metadata']['count']} earthquakes as of {when:%Y-%m-%dT%H:%MZ}", file=sys.stderr)
        write_json(OUTPUT_DIR / "quakes-recent-snapshot.json", snapshot)
    if args.only != "recent":
        events = notable_events()
        print(f"notable: {len(events)}: " + "; ".join(f"M{e['mag']:g} {e['name']}" for e in events), file=sys.stderr)
        write_json(OUTPUT_DIR / "quakes-notable.json", {
            "source": f"USGS ANSS ComCat: earthquakes M>={NOTABLE_MIN_MAGNITUDE} {NOTABLE_START} to {NOTABLE_END}, "
                      "and the presets of spec/seismic.md. Locations with locationSource iscgem are from the "
                      "ISC-GEM catalogue, CC BY-SA 3.0. See ATTRIBUTION.md.",
            "minMagnitude": NOTABLE_MIN_MAGNITUDE,
            "start": NOTABLE_START,
            "end": NOTABLE_END,
            "events": events,
        })


if __name__ == "__main__":
    main()
