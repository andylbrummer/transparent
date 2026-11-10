#!/usr/bin/env python3
"""
Checks for app/public/geo/hazards-snapshot.json.

The snapshot is whatever EONET listed on the day it was baked, so the
checks are of shape and sense - and of position for any of a few volcanoes
that are nearly always in eruption, should EONET list them: Fuego,
Guatemala (14.47 N 90.88 W), Etna (37.75 N 14.99 E), Sakurajima
(31.59 N 130.66 E), Popocatepetl (19.02 N 98.62 W), Kilauea (19.42 N
155.29 W), as the Smithsonian Global Volcanism Program places them.

The reduction of an EONET event to one marker is checked directly.

Usage:
    python3 tools/pipeline/generate_hazards_snapshot.py
    python3 tools/pipeline/test_hazards_snapshot.py
"""

import json
from datetime import datetime, timedelta, timezone

from generate_geo import OUTPUT_DIR, REPO_ROOT
from generate_hazards_snapshot import ONGOING_CATEGORIES, QUERIES, RECENT_CATEGORIES, RECENT_DAYS, position, reduce_all, reduce_event
from geo_test_support import check, finish

storm = {
    "id": "EONET_1", "title": "Tropical Storm X", "closed": None,
    "categories": [{"id": "severeStorms", "title": "Severe Storms"}],
    "sources": [{"id": "JTWC", "url": "https://example.org"}],
    "geometry": [
        {"magnitudeValue": 45.0, "magnitudeUnit": "kts", "date": "2026-11-08T00:00:00Z", "type": "Point", "coordinates": [52.3, -13.4]},
        {"magnitudeValue": 35.0, "magnitudeUnit": "kts", "date": "2026-11-07T18:00:00Z", "type": "Point", "coordinates": [52.6, -13.5]},
    ],
}
reduced = reduce_event(storm)
check(reduced["lon"] == 52.3 and reduced["lat"] == -13.4 and reduced["mag"] == 45.0, "an event is at its latest report, whatever the order")
check(reduced["first"] == "2026-11-07T18:00:00Z" and reduced["date"] == "2026-11-08T00:00:00Z", "first and latest dates kept")
check(reduced["category"] == "severeStorms" and reduced["from"] == "JTWC" and reduced["closed"] is None, "category, source, open")
check(position({"type": "Polygon", "coordinates": [[[10, 20], [14, 20], [14, 26], [10, 26], [10, 20]]]}) == (12, 23),
      "a polygon is marked at the middle of its box")
check(reduce_event({**storm, "geometry": []}) is None, "no geometry, no marker")
check(len(reduce_all([{"events": [storm]}, {"events": [storm]}])) == 1, "an event in both queries appears once")

path = OUTPUT_DIR / "hazards-snapshot.json"
data = json.loads(path.read_text())
events = data["events"]
generated = datetime.strptime(data["generated"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
check(path.stat().st_size < 300_000, f"under 300 kB ({path.stat().st_size} bytes)")
check(len(events) >= 30, f"dozens of events at least ({len(events)})")
check(len({e["id"] for e in events}) == len(events), "no event twice")
check(all(-90 <= e["lat"] <= 90 and -180 <= e["lon"] <= 180 for e in events), "every event is on the globe")
known = set(ONGOING_CATEGORIES) | set(RECENT_CATEGORIES)
check(all(e["category"] in known for e in events), "every category is one that was asked for")
check(not set(ONGOING_CATEGORIES) & set(RECENT_CATEGORIES), "the two queries do not overlap")
check(all(e["first"] <= e["date"] for e in events), "first report at or before the latest")
check(all(e["date"] <= (generated + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ") for e in events), "nothing dated after the snapshot")
recent = [e for e in events if e["category"] in RECENT_CATEGORIES]
cutoff = (generated - timedelta(days=RECENT_DAYS + 2)).strftime("%Y-%m-%dT%H:%M:%SZ")
check(all(e["date"] >= cutoff for e in recent), f"fires and floods are of the past {RECENT_DAYS} days")
check(all(e["closed"] is None for e in events if e["category"] in ONGOING_CATEGORIES), "eruptions, icebergs and storms are open events")
check(any(e["category"] == "volcanoes" for e in events), "some volcano is erupting")
check(all(e["lat"] < -40 or e["lat"] > 40 for e in events if e["title"].startswith("Iceberg")), "icebergs are in polar waters")

# (word in the title, lat, lon)
VOLCANOES = [("Fuego", 14.47, -90.88), ("Etna", 37.75, 14.99), ("Sakura", 31.59, 130.66), ("Popocat", 19.02, -98.62), ("Kilauea", 19.42, -155.29)]
found = 0
for word, lat, lon in VOLCANOES:
    for e in events:
        if e["category"] == "volcanoes" and word in e["title"]:
            found += 1
            check(abs(e["lat"] - lat) < 0.1 and abs(e["lon"] - lon) < 0.1, f"{e['title']} at {lat}, {lon} ({e['lat']}, {e['lon']})")
check(found >= 1, f"at least one of the ever-erupting volcanoes is listed, to pin positions ({found})")

# The app asks EONET the same questions.
source = (REPO_ROOT / "app/src/layers/hazards-live/eonet.ts").read_text()
for name, query in QUERIES.items():
    check(query in source, f"the app's {name} query is the snapshot's")

finish()
