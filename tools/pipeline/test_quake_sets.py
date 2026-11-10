#!/usr/bin/env python3
"""
Checks for generate_quake_sets.py's two files.

quakes-notable.json is pinned to catalogue values read on 2026-11-10:

    COMCAT  USGS ComCat by event id (the bake's own source; exact match).
    NCEI    NOAA NCEI/WDS Global Significant Earthquake Database
            (doi:10.7289/V5TD9V7K, hazard-service API, public domain), an
            independently compiled list, by its event id. For most pre-1973
            earthquakes NCEI and ComCat both carry the ISC-GEM location, so
            agreement there shows only that neither garbled it; the 1906
            San Francisco, 1950 Assam, 1952 Kamchatka and 1963 Kuril
            entries are NCEI's own, 11 to 27 km away.

quakes-recent-snapshot.json changes with every bake, so it is checked for
shape and sense, and against the raw feeds in tools/pipeline/.cache/feeds/
when those are the ones it was made from.

Usage:
    python3 tools/pipeline/generate_quake_sets.py
    python3 tools/pipeline/test_quake_sets.py
"""

import json
import math
from datetime import datetime, timezone

from fetch_cache import CACHE_DIR
from generate_geo import OUTPUT_DIR
from generate_quake_sets import RECENT_FEEDS, notable_name
from geo_test_support import check, finish

EARTH_RADIUS_KM = 6371.0


def epicentral_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    def unit(lon: float, lat: float) -> tuple[float, float, float]:
        lo, la = math.radians(lon), math.radians(lat)
        return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    return EARTH_RADIUS_KM * 2 * math.asin(min(1.0, math.dist(unit(lon1, lat1), unit(lon2, lat2)) / 2))


check(notable_name("1960 Great Chilean Earthquake (Valdivia Earthquake)") == "Great Chilean", "names drop year, 'Earthquake' and asides")
check(notable_name("The 1964 Prince William Sound, Alaska Earthquake") == "Prince William Sound, Alaska", "names drop 'The'")
check(notable_name("89 km ESE of Petropavlovsk-Kamchatsky, Russia") == "Petropavlovsk-Kamchatsky, Russia", "names drop the offset")
check(notable_name("Pazarcik earthquake, Kahramanmaras earthquake sequence") == "Pazarcik, Kahramanmaras", "names drop 'earthquake sequence'")

# --- notable -----------------------------------------------------------------

notable = json.loads((OUTPUT_DIR / "quakes-notable.json").read_text(encoding="utf-8"))
events = {e["id"]: e for e in notable["events"]}
check(len(events) == len(notable["events"]), "no event twice")
check([e["time"] for e in notable["events"]] == sorted(e["time"] for e in notable["events"]), "oldest first")

# id: (origin time, lon, lat, depth km, M) from ComCat.
COMCAT = {
    "official19060418131226300_12": ("1906-04-18T13:12:26.300Z", -122.55, 37.75, 11.7, 7.9),   # San Francisco
    "official19600522191120_30": ("1960-05-22T19:11:20.000Z", -73.407, -38.143, 25.0, 9.5),    # Valdivia
    "official19640328033616_30": ("1964-03-28T03:36:16.000Z", -147.339, 60.908, 25.0, 9.2),    # Alaska
    "official19521104165830_30": ("1952-11-04T16:58:30.000Z", 159.779, 52.623, 21.6, 9.0),     # Kamchatka
    "official19650204050122_30": ("1965-02-04T05:01:22.000Z", 178.715, 51.251, 30.3, 8.7),     # Rat Islands
    "official20041226005853450_30": ("2004-12-26T00:58:53.450Z", 95.982, 3.295, 30.0, 9.1),    # Sumatra-Andaman
    "official20110311054624120_30": ("2011-03-11T05:46:24.120Z", 142.373, 38.297, 29.0, 9.1),  # Tohoku
    "us6000jllz": ("2023-02-06T01:17:34.342Z", 37.0143, 37.2256, 10.0, 7.8),                   # Turkiye
    "us6000qw60": ("2025-07-29T23:24:52.483Z", 160.2395, 52.4948, 35.0, 8.8),                  # Kamchatka
}
for event_id, (time, lon, lat, depth, mag) in COMCAT.items():
    e = events.get(event_id)
    check(e is not None and (e["time"], e["lon"], e["lat"], e["depthKm"], e["mag"]) == (time, lon, lat, depth, mag),
          f"{event_id} ({e['name'] if e else 'missing'}) carries ComCat's origin exactly")

# ComCat id: (NCEI id, lat, lon, Mw) from the NCEI significant earthquake database.
NCEI = {
    "official19060131153610_30": (2748, 0.955, -79.369, 8.8),
    "official19060418131226300_12": (2768, 37.67, -122.48, 7.9),
    "official19221111043251_30": (3202, -28.293, -69.852, 8.5),
    "official19380201190422_30": (3609, -5.045, 131.614, 8.6),
    "official19460401122901_30": (3822, 53.492, -162.832, 8.6),
    "official19500815140934_30": (3950, 28.5, 96.5, 8.6),
    "official19521104165830_30": (4007, 52.755, 160.057, 9.0),
    "official19570309142233_30": (4116, 51.499, -175.626, 8.6),
    "official19600522191120_30": (4227, -38.143, -73.407, 9.5),
    "official19631013051759_30": (4304, 44.77, 149.798, 8.5),
    "official19640328033616_30": (4311, 60.908, -147.339, 9.2),
    "official19650204050122_30": (4337, 51.251, 178.715, 8.7),
}
worst = 0.0
for event_id, (ncei_id, lat, lon, mag) in NCEI.items():
    e = events.get(event_id)
    km = epicentral_km(e["lon"], e["lat"], lon, lat) if e else math.inf
    worst = max(worst, km)
    check(km <= 30 and abs(e["mag"] - mag) <= 0.1 + 1e-9, f"{e['name'] if e else event_id}: within 30 km and 0.1 M of NCEI event {ncei_id} ({km:.1f} km)")
print(f"     pre-1973 events: at most {worst:.1f} km from NCEI")

pre_1973 = [e for e in notable["events"] if e["time"] < "1973"]
check(set(NCEI) == {e["id"] for e in pre_1973}, "every pre-1973 event is cross-checked against NCEI")
check(all(e["mag"] >= notable["minMagnitude"] or e["id"] in ("official19060418131226300_12", "us6000jllz")
          for e in notable["events"]), "everything is M8.5+, bar the two presets")
check(sum(1 for e in notable["events"] if e["mag"] >= 8.5) == 17, "17 earthquakes of M8.5+ since 1900")
check(all(e["locationSource"] for e in notable["events"]), "every event names where its location comes from")
check(all(e["name"].endswith(e["time"][:4]) for e in notable["events"]), "every name ends in the year")
check(all(-180 <= e["lon"] <= 180 and -90 <= e["lat"] <= 90 and 0 <= e["depthKm"] <= 700 for e in notable["events"]),
      "coordinates and depths in range")

# --- recent snapshot -----------------------------------------------------------

snapshot = json.loads((OUTPUT_DIR / "quakes-recent-snapshot.json").read_text(encoding="utf-8"))
features = snapshot["features"]
generated = snapshot["metadata"]["generated"]
check(snapshot["type"] == "FeatureCollection" and snapshot["metadata"]["count"] == len(features), "a FeatureCollection of `count` features")
check(len({f["id"] for f in features}) == len(features), "no event twice")
check(all(f["properties"]["type"] == "earthquake" for f in features), "only earthquakes: no quarry blasts or explosions")
times = [f["properties"]["time"] for f in features]
check(times == sorted(times), "oldest first")
DAY_MS = 86400000
check(all(generated - 31 * DAY_MS <= t <= generated for t in times), "every event within the 30 days before the snapshot")
# The feeds admit by magnitude rounded to one decimal: an M2.46 is in "2.5+".
check(all(f["properties"]["mag"] >= 2.45 for f in features), "nothing under M2.5")
check(all(f["properties"]["mag"] >= 4.45 for f in features if f["properties"]["time"] < generated - 7.1 * DAY_MS),
      "older than a week: only M4.5+")
big = sum(1 for f in features if f["properties"]["mag"] >= 4.45)
check(300 <= big <= 2500, f"a month of M4.5+ worldwide is some hundreds of events ({big})")
check(all(len(f["geometry"]["coordinates"]) == 3 and -180 <= f["geometry"]["coordinates"][0] <= 180
          and -90 <= f["geometry"]["coordinates"][1] <= 90 and -10 <= f["geometry"]["coordinates"][2] <= 800 for f in features),
      "coordinates are [lon, lat, depth km] in range")
deep = [f for f in features if f["geometry"]["coordinates"][2] >= 300]
check(all(f["properties"]["mag"] >= 3.5 for f in deep), f"deep events are sizeable ones, as depth in km would have it ({len(deep)} at 300+ km)")
when = datetime.fromtimestamp(generated / 1000, timezone.utc)
print(f"     snapshot of {when:%Y-%m-%d %H:%M} UTC: {len(features)} earthquakes, {big} of M4.5+")

raw = {}
for name in RECENT_FEEDS:
    path = CACHE_DIR / "feeds" / f"{name}.geojson"
    if path.exists():
        feed = json.loads(path.read_text(encoding="utf-8"))
        if feed["metadata"]["generated"] <= generated:
            raw.update({f["id"]: f for f in feed["features"]})
if raw and max(json.loads((CACHE_DIR / "feeds" / f"{n}.geojson").read_text(encoding="utf-8"))["metadata"]["generated"]
               for n in RECENT_FEEDS if (CACHE_DIR / "feeds" / f"{n}.geojson").exists()) == generated:
    same = all(f["id"] in raw and f["geometry"]["coordinates"] == raw[f["id"]]["geometry"]["coordinates"]
               and f["properties"]["mag"] == raw[f["id"]]["properties"]["mag"]
               and f["properties"]["time"] == raw[f["id"]]["properties"]["time"] for f in features)
    check(same, "every feature is the raw feed's, value for value")
    check(len(features) == sum(1 for f in raw.values() if f["properties"]["type"] == "earthquake"), "and every earthquake of the feeds is here")
else:
    print("     (raw feeds of this snapshot not in the cache: skipping the value-for-value check)")

finish()
