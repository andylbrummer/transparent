#!/usr/bin/env python3
"""
Checks for the earthquake pipeline (the slabs' are test_slabs.py).

quakes.json against the catalogues themselves. Every reference
below was read from a catalogue response on 2026-11-10, not from memory:

    COMCAT  the USGS event the bake drew on, by ComCat event id
            (https://earthquake.usgs.gov/earthquakes/eventpage/<id>); the
            file must reproduce it to its quantisation.
    ISC     the same earthquake in the ISC Bulletin (International
            Seismological Centre, https://www.isc.ac.uk/iscbulletin/, fdsnws
            event service), an independent location by event id; the file
            must agree to the tolerance two catalogues agree to.

Usage:
    python3 tools/pipeline/generate_seismicity.py   # writes app/public/geo/
    python3 tools/pipeline/test_seismicity.py
"""

import json
import math
from datetime import datetime, timezone

from generate_geo import OUTPUT_DIR
from generate_seismicity import drop_cross_network_duplicates, half_up, quake_region
from geo_test_support import check, finish

EARTH_RADIUS_KM = 6371.0

check(quake_region("near the east coast of Honshu, Japan") == "Japan", "regions come from the place's last part")
check(quake_region("2004 Sumatra - Andaman Islands Earthquake") == "Sumatra - Andaman Islands",
      "named events lose their year and 'Earthquake'")

# --- helpers of the bake ---------------------------------------------------

check([half_up(m, 10) for m in ("5.05", "5.15", "5.45", "5.55", "8.16", "9.1")] == [51, 52, 55, 56, 82, 91],
      "magnitudes round halves up, never to the even neighbour")
check([half_up(v, 100) for v in ("-179.997", "179.9952", "180", "-0.005", "-36.122")] == [-18000, 18000, 18000, -1, -3612],
      "coordinates round to the nearest hundredth of a degree")


def record(event_id: str, net: str, t: float, lon: float, lat: float, mag: float) -> dict:
    return {"id": event_id, "net": net, "t": t, "lon": lon, "lat": lat, "mag": mag}


kept, dropped = drop_cross_network_duplicates([
    record("us1", "us", 0.0, 10.0, 10.0, 5.3),
    record("gcmt1", "gcmt", 0.6, 11.0, 10.5, 5.3),     # the same event's centroid, 120 km off
    record("us2", "us", 100.0, 10.0, 10.0, 5.0),
    record("us3", "us", 106.0, 10.0, 10.0, 5.9),       # same network: a real doublet
    record("us4", "us", 200.0, 10.0, 10.0, 7.4),
    record("ak4", "ak", 205.0, 10.0, 10.0, 6.5),       # magnitudes too far apart to be one
    record("us5", "us", 300.0, 10.0, 10.0, 5.1),
    record("ak5", "ak", 303.0, 60.0, 10.0, 5.1),       # same instant, another place
    record("us6", "us", 400.0, -150.0, 60.0, 5.9),
    record("ak6", "ak", 401.5, -150.2, 60.1, 5.8),     # one event: the regional network's stays
])
check(dropped == 2 and [e["id"] for e in kept] == ["us1", "us2", "us3", "us4", "ak4", "us5", "ak5", "ak6"],
      "only cross-network twins are dropped: the centroid, or NEIC's beside a regional solution")

# --- the baked catalogue ---------------------------------------------------

quakes = json.loads((OUTPUT_DIR / "quakes.json").read_text(encoding="utf-8"))
q = quakes["quantumPerDegree"]
count = quakes["count"]
columns = [quakes["minute"], quakes["lon"], quakes["lat"], quakes["depthKm"], quakes["magnitude10"]]
check(all(len(c) == count for c in columns), "five columns of `count` entries")
check(all(isinstance(v, int) for c in columns for v in c), "every value is an integer")

minutes = []
total = 0
for delta in quakes["minute"]:
    total += delta
    minutes.append(total)
lon = [v / q for v in quakes["lon"]]
lat = [v / q for v in quakes["lat"]]
depth = quakes["depthKm"]
mag10 = quakes["magnitude10"]


def minute_of(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() // 60)


def position(lon_deg: float, lat_deg: float, depth_km: float) -> tuple[float, float, float]:
    r = EARTH_RADIUS_KM - depth_km
    lo, la = math.radians(lon_deg), math.radians(lat_deg)
    return (r * math.cos(la) * math.cos(lo), r * math.cos(la) * math.sin(lo), r * math.sin(la))


def events_in_minute(iso: str) -> list[int]:
    target = minute_of(iso)
    return [i for i, m in enumerate(minutes) if m == target]


def nearest_in_minute(iso: str, lon_deg: float, lat_deg: float, depth_km: float) -> tuple[int | None, float]:
    """Index of, and 3-D distance (km) to, the event of that minute nearest a hypocentre."""
    best, best_km = None, math.inf
    for i in events_in_minute(iso):
        km = math.dist(position(lon_deg, lat_deg, depth_km), position(lon[i], lat[i], depth[i]))
        if km < best_km:
            best, best_km = i, km
    return best, best_km


# ComCat's own count for the same search, 2026-11-10: 90081 events of every
# type, 89587 of them earthquakes. The catalogue grows by revision, slowly.
check(89000 < count < 90500, f"about 89,550 earthquakes ({count})")
excluded = quakes["excluded"]
check(excluded.get("nuclear explosion", 0) >= 400 and excluded.get("volcanic eruption", 0) >= 50,
      f"nuclear tests and eruptions are counted out ({excluded})")
check(20 <= excluded.get("duplicate of another network's record", 0) <= 60, "a few dozen twin records are dropped")
check(count + sum(excluded.values()) > 90000, "kept and left out add up to ComCat's M5+ count of every type")
check(0 < quakes["iscGem"] < 0.006 * count, f"ISC-GEM records are counted, under 0.6 % ({quakes['iscGem']})")

check(all(d >= 0 for d in quakes["minute"][1:]), "oldest first")
check(minutes[0] >= minute_of(quakes["start"] + "T00:00:00Z") and minutes[-1] < minute_of(quakes["end"] + "T00:00:00Z"),
      "every origin time lies inside the stated range")
check(quakes["start"] == "1973-01-01", "the catalogue starts in 1973")
check(min(mag10) >= 50 and max(mag10) == 91, "M5.0 to M9.1")
check(min(quakes["lon"]) >= -180 * q and max(quakes["lon"]) <= 180 * q, "longitudes within +-180")
check(min(quakes["lat"]) >= -90 * q and max(quakes["lat"]) <= 90 * q, "latitudes within +-90")
check(min(depth) == 0 and max(depth) == 700, "depths 0 to 700 km: nothing above the surface, nothing below the deepest slab")

# (ComCat id, origin time, lon, lat, depth km, M) - then the ISC Bulletin's
# (event id, lon, lat, depth km) for the same earthquake.
NAMED = [
    ("Tohoku 2011", ("official20110311054624120_30", "2011-03-11T05:46:24.120Z", 142.373, 38.297, 29.0, 9.1),
     ("16461282", 142.498, 38.2963, 19.7)),
    ("Sumatra-Andaman 2004", ("official20041226005853450_30", "2004-12-26T00:58:53.450Z", 95.982, 3.295, 30.0, 9.1),
     ("7453151", 95.983, 3.315, 26.5)),
    ("Maule 2010", ("official20100227063411530_30", "2010-02-27T06:34:11.530Z", -72.898, -36.122, 22.9, 8.8),
     ("14340585", -72.911, -36.271, 22.9)),
    ("Bolivia 1994 (deep)", ("usp0006dzc", "1994-06-09T00:33:16.230Z", -67.553, -13.841, 631.3, 8.2),
     ("168418", -67.588, -13.803, 638.0)),
    ("Sea of Okhotsk 2013 (deep)", ("usb000h4jh", "2013-05-24T05:44:48.980Z", 153.221, 54.892, 598.1, 8.3),
     ("603007131", 153.391, 54.815, 607.0)),
    ("Fiji 2018 (deep)", ("us1000gcii", "2018-08-19T00:19:40.670Z", -178.153, -18.1125, 600.0, 8.2),
     ("616641704", -178.043, -18.114, 578.5)),
    ("Bonin 2015 (deep)", ("us20002ki3", "2015-05-30T11:23:02.110Z", 140.4931, 27.8386, 664.0, 7.8),
     ("607273371", 140.494, 27.828, 685.5)),
    ("Turkiye 2023", ("us6000jllz", "2023-02-06T01:17:34.342Z", 37.0143, 37.2256, 10.0, 7.8),
     ("625613033", 37.073, 37.219, 9.0)),
    ("Gorkha 2015", ("us20002926", "2015-04-25T06:11:25.950Z", 84.7314, 28.2305, 8.22, 7.8),
     ("607208674", 84.717, 28.130, 13.4)),
    ("Loma Prieta 1989", ("nc216859", "1989-10-18T00:04:15.190Z", -121.8798333, 37.0361667, 17.214, 6.9),
     ("389808", -121.855, 36.997, 11.0)),
    ("Haiti 2010", ("usp000h60h", "2010-01-12T21:53:10.060Z", -72.571, 18.443, 13.0, 7.0),
     ("14226221", -72.537, 18.356, 13.9)),
    ("Kaikoura 2016", ("us1000778i", "2016-11-13T11:02:56.340Z", 173.054, -42.7373, 15.11, 7.8),
     ("615035032", 172.923, -42.665, 16.0)),
    # Kept although its ComCat record is ISC-GEM's (iscgem694739): the largest of 1977.
    ("Sumba 1977", ("iscgem694739", "1977-08-19T06:08:54.450Z", 118.385, -11.154, 15.9, 8.3), None),
]
# 0.005 deg each way and 0.5 km of depth: 0.93 km at worst.
QUANTISATION_KM = 0.95
# ComCat against ISC for these twelve: 4 to 24 km; for 498 ordinary M5-6
# events in ten random 12-day windows, median 14 km, 90 % within 30 km.
ISC_TOLERANCE_KM = 30.0
worst_comcat = worst_isc = 0.0
for name, (event_id, iso, e_lon, e_lat, e_depth, e_mag), isc in NAMED:
    i, km = nearest_in_minute(iso, e_lon, e_lat, e_depth)
    ok = i is not None and km <= QUANTISATION_KM and mag10[i] == round(e_mag * 10)
    check(ok, f"{name} ({event_id}): at its hypocentre, minute and magnitude ({km:.2f} km off)")
    if not ok or isc is None:
        continue
    worst_comcat = max(worst_comcat, km)
    isc_km = math.dist(position(lon[i], lat[i], depth[i]), position(*isc[1:]))
    worst_isc = max(worst_isc, isc_km)
    check(isc_km <= ISC_TOLERANCE_KM, f"{name}: within {ISC_TOLERANCE_KM:.0f} km of ISC event {isc[0]} ({isc_km:.1f} km)")
print(f"     named events: worst {worst_comcat:.2f} km from ComCat, {worst_isc:.1f} km from ISC")

# Depth is kilometres, positive down: the deep ones are deep, the shallow shallow.
i, _ = nearest_in_minute("1994-06-09T00:33:16.230Z", -67.553, -13.841, 631.3)
check(i is not None and depth[i] == 631, "the deep Bolivia earthquake is 631 km down")
i, _ = nearest_in_minute("2023-02-06T01:17:34.342Z", 37.0143, 37.2256, 10.0)
check(i is not None and depth[i] == 10, "the Turkiye earthquake is 10 km down")

# Edges: the antimeridian from both sides, the poles, above sea level.
i, km = nearest_in_minute("1975-10-31T16:02:50.700Z", 180.0, -23.528, 515.0)  # usp0000dce
check(i is not None and quakes["lon"][i] == 18000 and km < QUANTISATION_KM, "an event at longitude 180 exactly stays there")
i, km = nearest_in_minute("1992-08-08T01:08:05.790Z", -179.997, -31.566, 392.3)  # usp0005c56
check(i is not None and quakes["lon"][i] == -18000 and km < QUANTISATION_KM,
      "an event at -179.997 rounds to -180, the same meridian")
i, km = nearest_in_minute("2020-08-05T08:48:05.981Z", 7.0685, 87.386, 10.0)  # us6000b9kr
check(i is not None and km < QUANTISATION_KM and quakes["lat"][i] == max(quakes["lat"]),
      "the northernmost, 87.39 N on the Gakkel Ridge, is in place")
i, km = nearest_in_minute("2012-06-01T05:07:01.980Z", -148.864, -77.08, 12.0)  # usp000jm6p
check(i is not None and km < QUANTISATION_KM and quakes["lat"][i] == min(quakes["lat"]),
      "the southernmost, 77.08 S in Antarctica, is in place")
i, km = nearest_in_minute("1974-11-30T13:54:23.280Z", -155.4143333, 19.4328333, 0.0)  # hv19743383, depth -0.669
check(i is not None and depth[i] == 0 and km < QUANTISATION_KM, "an event located above sea level sits at the surface")
i, km = nearest_in_minute("1985-10-22T19:14:01.630Z", -179.163, -20.158, 700.0)  # usp0002m15
check(i is not None and depth[i] == 700 and km < QUANTISATION_KM, "the deepest, 700 km under Fiji, is in place")
i, km = nearest_in_minute("1976-12-07T12:59:48.720Z", -114.543, 31.553, 6.0)  # ci149841, M5.45
check(i is not None and mag10[i] == 55, "a catalogue M5.45 is baked as 5.5")


def absent(iso: str, e_lon: float, e_lat: float) -> bool:
    return all(math.dist(position(e_lon, e_lat, 0), position(lon[i], lat[i], 0)) > 100 for i in events_in_minute(iso))


# Not earthquakes, though ComCat lists them at M5+.
check(absent("2017-09-03T03:30:01.760Z", 129.0297, 41.3324), "no North Korean nuclear test of 2017 (us2000aert, mb 6.3)")
check(absent("1973-03-08T16:10:00.200Z", -116.027, 37.103), "no Nevada nuclear test of 1973 (usp00000vk)")
check(absent("2022-01-15T04:14:45.000Z", -175.39, -20.546), "no Hunga Tonga eruption of 2022 (us7000gc8r)")
# gcmtb022893c (a centroid at -115.36, -48.26) and usp0005nsy are one earthquake.
pair = events_in_minute("1993-02-28T13:29:24.000Z")
check(len(pair) == 1 and abs(lon[pair[0]] + 114.29) < 0.01, "an earthquake ComCat lists twice is here once, at NEIC's hypocentre")
seen: dict[tuple[int, int, int, int, int], int] = {}
for row in zip(minutes, *columns[1:]):
    seen[row] = seen.get(row, 0) + 1
check(max(seen.values()) == 1, "no two events share minute, place, depth and magnitude")


def within(lon0: float, lat0: float, e_lon: float, e_lat: float, deg: float) -> bool:
    dlon = (e_lon - lon0 + 180) % 360 - 180
    return abs(e_lat - lat0) <= deg and abs(dlon) * math.cos(math.radians(lat0)) <= deg


tonga_deep = sum(1 for e_lon, e_lat, d in zip(lon, lat, depth) if d >= 300 and within(-178, -20, e_lon, e_lat, 8))
check(tonga_deep > 500, f"deep quakes cluster under Tonga-Fiji, on both sides of the antimeridian ({tonga_deep} at 300+ km)")
aleutian = sum(1 for e_lon, e_lat in zip(lon, lat) if within(180, 51.5, e_lon, e_lat, 3))
check(aleutian > 300, f"the Aleutian arc runs unbroken across the antimeridian ({aleutian} within 3 deg of 51.5 N 180)")

# --- labels ------------------------------------------------------------------

labels = quakes["labels"]
points = {(round(e_lon * q), round(e_lat * q), d, m): minute for e_lon, e_lat, d, m, minute in zip(lon, lat, depth, mag10, minutes)}
check(all(label["kind"] == "quake" for label in labels), "quake labels are kind 'quake'")
check(len(labels) == sum(1 for m in mag10 if m >= 80), f"one label per M8+ earthquake ({len(labels)})")
on_point = True
for label in labels:
    magnitude = round(float(label["name"].split()[0][1:]) * 10)
    minute = points.get((round(label["lon"] * q), round(label["lat"] * q), label["depthKm"], magnitude))
    year = datetime.fromtimestamp(minute * 60, timezone.utc).year if minute is not None else None
    on_point = on_point and str(year) == label["name"].split()[-1]
check(on_point, "every label names the magnitude and year of a point at exactly its place and depth")
tohoku = next((label for label in labels if label["name"] == "M9.1 Japan 2011"), None)
check(tohoku is not None and (tohoku["lon"], tohoku["lat"], tohoku["depthKm"]) == (142.37, 38.3, 29),
      "Tohoku 2011 is labelled at its hypocentre")
check(any(label["name"] == "M8.3 Indonesia 1977" for label in labels), "Sumba 1977 is labelled")
check([round(float(label["name"].split()[0][1:]), 1) for label in labels] == sorted(
    (round(float(label["name"].split()[0][1:]), 1) for label in labels), reverse=True), "labels run from the greatest down")

finish()
