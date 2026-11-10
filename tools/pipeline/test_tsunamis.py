#!/usr/bin/env python3
"""
Checks for app/public/geo/tsunamis.json.

References: the wave of 10 July 1958 in Lituya Bay, Alaska (the bay's head
is at 58.65 N 137.5 W) stripped the forest to 524 m above the water, the
highest run-up ever recorded; NCEI places the source at the earthquake's
epicentre on the Fairweather Fault, 58.37 N 136.67 W, some 60 km away. The
26 December 2004 Indian Ocean tsunami came from the M9.1 earthquake off
Sumatra (3.3 N 95.98 E; Banda Aceh is at 5.55 N 95.32 E) and killed about
228,000; the 11 March 2011 Tohoku tsunami (38.3 N 142.37 E, M9.1) ran up
39 m and killed about 18,400; the 22 May 1960 Chilean earthquake was M9.5
(38.14 S 73.41 W); Krakatau (6.10 S 105.42 E) in 1883 was a volcano.

Usage:
    python3 tools/pipeline/generate_tsunamis.py
    python3 tools/pipeline/test_tsunamis.py
"""

import json

from generate_geo import OUTPUT_DIR, REPO_ROOT
from generate_tsunamis import MIN_HEIGHT_M, entry, keep, title_case
from geo_test_support import check, finish

check(title_case("OFF W. COAST OF SUMATRA") == "Off W. Coast of Sumatra", "names are put in title case")
check(title_case("SE. ALASKA, AK") == "SE. Alaska, AK", "compass points and state codes stay capital")
check(title_case("USA") == "USA" and title_case("PAPUA NEW GUINEA") == "Papua New Guinea", "countries")
base = {"id": 1, "year": 1900, "eventValidity": 4, "causeCode": 1, "latitude": 1.0, "longitude": 2.0, "maxWaterHeight": 3.0}
check(keep(base), "a definite tsunami of 3 m is kept")
check(not keep({**base, "eventValidity": 2}), "a questionable one is not")
check(not keep({**base, "maxWaterHeight": 0.3}) and keep({**base, "maxWaterHeight": 0.3, "deaths": 2}),
      "a small one is kept only if it killed")
check(not keep({**base, "maxWaterHeight": 0.3, "deathsTotal": 56697}), "the dead of the earthquake behind it do not count")
check(not keep({k: v for k, v in base.items() if k != "latitude"}), "no position, no marker")
check(entry({**base, "causeCode": 3})["cause"] == "landslide" and entry({**base, "causeCode": 6})["cause"] == "volcano"
      and entry({**base, "causeCode": 9})["cause"] == "other", "cause codes fold into four groups")

path = OUTPUT_DIR / "tsunamis.json"
data = json.loads(path.read_text())
tsunamis = data["tsunamis"]
by_id = {t["id"]: t for t in tsunamis}
check(path.stat().st_size < 200_000, f"under 200 kB ({path.stat().st_size} bytes)")
check(600 <= len(tsunamis) <= 1200, f"several hundred damaging tsunamis ({len(tsunamis)})")
check(len(by_id) == len(tsunamis), "no event twice")
check(all(-90 <= t["lat"] <= 90 and -180 <= t["lon"] <= 180 for t in tsunamis), "every source is on the globe")
check(all((t["heightM"] or 0) >= MIN_HEIGHT_M or (t["deaths"] or 0) > 0 for t in tsunamis),
      "each ran up a metre or killed someone")
check(all(t["cause"] in ("earthquake", "landslide", "volcano", "other") for t in tsunamis), "every cause is one of four")
check(sum(t["cause"] == "earthquake" for t in tsunamis) > len(tsunamis) / 2, "most were raised by earthquakes")
check([t["heightM"] or 0 for t in tsunamis] == sorted((t["heightM"] or 0 for t in tsunamis), reverse=True), "highest first")

lituya = tsunamis[0]
check(lituya["id"] == 1880 and lituya["place"] == "Lituya Bay, Alaska" and (lituya["y"], lituya["m"], lituya["d"]) == (1958, 7, 10),
      "the highest is Lituya Bay, 10 July 1958")
check(abs(lituya["heightM"] - 524.6) < 0.5, f"524 m ({lituya['heightM']})")
check(abs(lituya["lat"] - 58.65) < 0.6 and abs(lituya["lon"] + 137.5) < 1.2,
      f"its source is within 60 km or so of the bay ({lituya['lat']}, {lituya['lon']})")
check(lituya["cause"] == "landslide" and lituya["deaths"] == 5, "raised by a landslide; five dead")

# (id, year, lat, lon, cause, height m, deaths, magnitude)
KNOWN = [
    (2439, 2004, 3.3, 95.98, "earthquake", 50.9, 227_899, 9.1),
    (5413, 2011, 38.3, 142.37, "earthquake", 39.26, 18_423, 9.1),
    (1902, 1960, -38.14, -73.41, "earthquake", 25, 2_226, 9.5),
    (1142, 1883, -6.10, 105.42, "volcano", 41, 34_417, None),
]
for event_id, year, lat, lon, cause, height, deaths, magnitude in KNOWN:
    check(event_id in by_id, f"event {event_id} ({year}) is listed")
    if event_id not in by_id:
        continue
    t = by_id[event_id]
    check(t["y"] == year and abs(t["lat"] - lat) < 0.05 and abs(t["lon"] - lon) < 0.05, f"{year} {t['place']} at {lat}, {lon}")
    check(t["cause"] == cause and t["heightM"] == height and t["deaths"] == deaths and t["mag"] == magnitude,
          f"{year} {t['place']}: {cause}, {height} m, {deaths} dead, M{magnitude}")
check(by_id[2439]["place"] == "Indian Ocean (Sumatra)" and by_id[5413]["place"] == "Tōhoku, Japan", "the famous ones go by their names")
check(max(tsunamis, key=lambda t: t["deaths"] or 0)["id"] == 2439, "the deadliest is 2004")

caption = (REPO_ROOT / "app/src/layers/tsunamis/layer.ts").read_text()
check(f"{len(tsunamis)} tsunamis" in caption, f"the app's caption says {len(tsunamis)} tsunamis")

finish()
