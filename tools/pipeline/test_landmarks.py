#!/usr/bin/env python3
"""
Checks for app/public/geo/landmarks.json.

Wikidata is edited by anyone, so each set is held against a second,
independent source, fetched here (and cached):

  mountains      Natural Earth's elevation points (public domain): every
                 summit both list must agree in height to 60 m.
  observatories  the Minor Planet Center's observatory codes
                 (https://minorplanetcenter.net/iau/lists/ObsCodes.html):
                 longitude and geocentric latitude of Palomar, La Silla
                 and Siding Spring.
  heritage       UNESCO's own World Heritage List
                 (https://whc.unesco.org/en/list/xml/): the positions of
                 named sites, and how much of the List is covered.
  others         the coordinates the English Wikipedia article carries
                 (REST summary), for the Kola borehole, Baikonur and the
                 wreck of the Titanic.

and the famous values are pinned: Everest 8,849 m, K2 8,611 m, the Kola
Superdeep Borehole 12,262 m.

Usage:
    python3 tools/pipeline/generate_landmarks.py
    python3 tools/pipeline/test_landmarks.py
"""

import html
import json
import math
import re

from fetch_cache import cached_fetch
from generate_geo import NATURAL_EARTH_BASE, OUTPUT_DIR
from generate_landmarks import distance_km, elevation, merge_places
from geo_test_support import check, finish

check(elevation([{"e": "8848", "when": "1955"}, {"e": "8848.86", "when": "2020"}, {"e": "8850"}]) == 8848.86,
      "of several elevations the most recently surveyed is taken")
check(elevation([{"e": "5610"}, {"e": "5628"}]) == 5628, "undated elevations: the highest")
twins = [{"lon": 0, "lat": 0, "links": 5}, {"lon": 0.005, "lat": 0, "links": 9}, {"lon": 1, "lat": 0, "links": 1}]
check([p["links"] for p in merge_places(twins, lambda p: -p["links"])] == [9, 1], "two entries for one place: the better known is kept")

path = OUTPUT_DIR / "landmarks.json"
data = json.loads(path.read_text())
sets = data["sets"]
check(path.stat().st_size < 250_000, f"under 250 kB ({path.stat().st_size} bytes)")
for name, entries in sets.items():
    check(all(-180 <= e["lon"] <= 180 and -90 <= e["lat"] <= 90 and e["name"] for e in entries), f"{name}: every entry has a name and a position on Earth")
    check(not any(re.fullmatch(r"Q\d+", e["name"]) for e in entries), f"{name}: no entry is named by its Wikidata id")


def find(set_name: str, name: str) -> dict:
    return next(e for e in sets[set_name] if e["name"] == name)


def at(entry: dict, lon: float, lat: float) -> float:
    return distance_km(entry, {"lon": lon, "lat": lat})


# Mountains.
mountains = sets["mountains"]
eight = [m for m in mountains if m["value"] >= 8000]
check(len(eight) == 14, f"fourteen eight-thousanders ({len(eight)}: {', '.join(m['name'] for m in eight)})")
check(find("mountains", "Mount Everest")["value"] == 8849, "Everest: 8,849 m (the 2020 survey's 8,848.86)")
check(find("mountains", "K2")["value"] == 8611, "K2: 8,611 m")
for summit in ("Aconcagua", "Denali", "Mount Kilimanjaro", "Mount Elbrus", "Vinson Massif", "Puncak Jaya", "Mount Kosciuszko", "Mont Blanc"):
    check(any(m["name"] == summit for m in mountains), f"{summit} is there")
check(not any(m["name"] in ("Kibo", "Uhuru Peak", "Mount Vinson") for m in mountains), "a summit entered twice is drawn once")

reference = json.loads(cached_fetch(f"{NATURAL_EARTH_BASE}/ne_10m_geography_regions_elevation_points.geojson",
                                    "human/ne_10m_geography_regions_elevation_points.geojson").read_text(encoding="utf-8"))
compared, worst = 0, (0, "")
for feature in reference["features"]:
    lon, lat = feature["geometry"]["coordinates"][:2]
    near = [m for m in mountains if at(m, lon, lat) < 8]
    if not near or feature["properties"]["featurecla"] != "mountain":
        continue
    mountain = min(near, key=lambda m: at(m, lon, lat))
    difference = abs(mountain["value"] - feature["properties"]["elevation"])
    compared += 1
    if difference > worst[0]:
        worst = (difference, f"{mountain['name']} {mountain['value']} m against Natural Earth's {feature['properties']['elevation']} m")
check(compared >= 25, f"{compared} summits are also in Natural Earth's elevation points")
check(worst[0] <= 60, f"all of them agree in height to 60 m (worst: {worst[1]})")

# Deep places.
kola = find("deep", "Kola Superdeep Borehole")
check(kola["value"] == 12262 and sets["deep"][0] is kola, "the Kola Superdeep Borehole is the deepest: 12,262 m")
mponeng = find("deep", "Mponeng Gold Mine")
check(mponeng["valueText"] == "over 4 km" and mponeng["value"] == 4000, "Mponeng: 'over 4 km', as its article's lead says")
check(find("deep", "TauTona Mine")["valueText"] == "about 3.9 km", "TauTona: 'about 3.9 km'")
check(at(mponeng, 27.43, -26.44) < 10, "Mponeng is west of Johannesburg")
check(all(d["value"] >= 1000 for d in sets["deep"]), "nothing shallower than a kilometre")


def wikipedia_position(page: str) -> tuple[float, float]:
    summary = json.loads(cached_fetch(f"https://en.wikipedia.org/api/rest_v1/page/summary/{page}", f"human/wikipedia-{page}.json").read_text())
    return summary["coordinates"]["lon"], summary["coordinates"]["lat"]


for set_name, name, page in (
    ("deep", "Kola Superdeep Borehole", "Kola_Superdeep_Borehole"),
    ("launchSites", "Baikonur Cosmodrome", "Baikonur_Cosmodrome"),
    ("wrecks", "Titanic", "Wreck_of_the_Titanic"),
    ("heritage", "Taj Mahal", "Taj_Mahal"),
):
    off = at(find(set_name, name), *wikipedia_position(page))
    check(off < 5, f"{name}: within 5 km of the position in Wikipedia's article ({off:.1f} km)")

# Launch sites.
for site in ("Baikonur Cosmodrome", "Kennedy Space Center", "Guiana Space Centre", "Vandenberg Space Force Base", "Satish Dhawan Space Centre"):
    check(any(s["name"] == site for s in sets["launchSites"][:12]), f"{site} is among the twelve best known")
check(at(find("launchSites", "Kennedy Space Center"), -80.65, 28.57) < 15, "Kennedy Space Center is on Merritt Island")

# Observatories.
observatories = sets["observatories"]
ligo = [o for o in observatories if o["name"] == "LIGO"]
check(len(ligo) == 2 and all(o["kind"] == "gw" for o in ligo), "LIGO is drawn at both its sites")
check(min(at(o, -119.41, 46.46) for o in ligo) < 5 and min(at(o, -90.77, 30.56) for o in ligo) < 5, "... Hanford and Livingston")
check(find("observatories", "IceCube Neutrino Observatory")["lat"] < -89.9, "IceCube is at the South Pole")
check(find("observatories", "Super-Kamiokande")["kind"] == "neutrino", "Super-Kamiokande is a neutrino detector")
check(find("observatories", "Virgo interferometer")["kind"] == "gw", "Virgo is a gravitational-wave detector")
check(find("observatories", "Very Large Array")["kind"] == "radio", "the Very Large Array is a radio telescope")

codes = cached_fetch("https://minorplanetcenter.net/iau/lists/ObsCodes.html", "human/mpc-obscodes.html").read_text(encoding="utf-8", errors="replace")
for code, name in (("675", "Palomar Observatory"), ("809", "La Silla Observatory"), ("413", "Siding Spring Observatory")):
    row = next(line for line in codes.splitlines() if line.startswith(code + " "))
    longitude = float(row[4:13])
    rho_cos, rho_sin = float(row[13:21]), float(row[21:30])
    # The list gives geocentric latitude; at these latitudes it is within 0.2° of the geodetic one.
    latitude = math.degrees(math.atan2(rho_sin, rho_cos))
    ours = find("observatories", name)
    check(abs(((ours["lon"] - longitude + 180) % 360) - 180) < 0.05 and abs(ours["lat"] - latitude) < 0.25,
          f"{name}: agrees with the Minor Planet Center's code {code} ({ours['lon']}, {ours['lat']} against {longitude - 360 if longitude > 180 else longitude:.3f}, {latitude:.2f} geocentric)")

# Accelerators.
lhc = find("accelerators", "Large Hadron Collider")
check(sets["accelerators"][0] is lhc and at(lhc, 6.05, 46.23) < 10, "the Large Hadron Collider leads, at CERN outside Geneva")

# World Heritage.
unesco = cached_fetch("https://whc.unesco.org/en/list/xml/", "human/whc.xml").read_text(encoding="utf-8")
sites = []
for row in unesco.split("<row>")[1:]:
    # A serial site lists each of its parts.
    parts = [{"lon": float(lon), "lat": float(lat)}
             for lat, lon in re.findall(r"<latitude>([-\d.]+)</latitude>\s*<longitude>([-\d.]+)</longitude>", row)]
    name = re.search(r"<site>(.*?)</site>", row, re.S)
    if parts and name:
        sites.append({"name": html.unescape(name.group(1)), "parts": parts})
check(len(sites) > 1100, f"UNESCO's list read: {len(sites)} sites with a position")


def off_unesco(ours: dict, site: dict) -> float:
    return min(distance_km(ours, part) for part in site["parts"])


for ours_name, theirs in (("Taj Mahal", "Taj Mahal"), ("Stonehenge", "Stonehenge, Avebury and Associated Sites"), ("Sydney Opera House", "Sydney Opera House"),
                          ("Petra", "Petra"), ("Statue of Liberty", "Statue of Liberty")):
    site = next(s for s in sites if s["name"] == theirs)
    off = off_unesco(find("heritage", ours_name), site)
    check(off < 5, f"{ours_name}: within 5 km of UNESCO's own position ({off:.1f} km)")
covered = sum(1 for s in sites if any(abs(h["lat"] - p["lat"]) < 0.5 and distance_km(h, p) < 30 for p in s["parts"] for h in sets["heritage"]))
check(covered / len(sites) > 0.8, f"{covered} of UNESCO's {len(sites)} sites have one of ours within 30 km ({covered / len(sites):.0%})")

# Wrecks.
titanic = find("wrecks", "Titanic")
check(sets["wrecks"][0] is titanic and at(titanic, -49.95, 41.73) < 10, "the Titanic leads, south-east of Newfoundland")

finish()
