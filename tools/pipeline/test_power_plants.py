#!/usr/bin/env python3
"""
Checks for app/public/geo/power-plants.json.

Pinned to what the database says of plants anyone can look up - the
Three Gorges Dam, 22,500 MW of hydro on the Yangtze, the largest power
plant there is; Kashiwazaki-Kariwa, the largest nuclear plant - and held
against a second source for position: Wikidata's nuclear power plants
(instance of Q134447, CC0), of which nearly every one in the database
must have a counterpart within a few kilometres.

Usage:
    python3 tools/pipeline/generate_power_plants.py
    python3 tools/pipeline/test_power_plants.py
"""

import json
import re
import urllib.parse

from fetch_cache import cached_fetch
from generate_cables import arc_km
from generate_geo import OUTPUT_DIR
from generate_power_plants import MIN_CAPACITY_MW, NAMED_PLANTS
from geo_test_support import check, finish

path = OUTPUT_DIR / "power-plants.json"
data = json.loads(path.read_text())
plants = data["plants"]
count = len(plants["lon"])

check(path.stat().st_size < 150_000, f"under 150 kB ({path.stat().st_size} bytes)")
check(all(len(plants[column]) == count for column in ("lat", "mw", "fuel")), "the columns are of one length")
check(len(plants["name"]) == NAMED_PLANTS, f"the largest {NAMED_PLANTS} are named")
check(3000 <= count <= 3500, f"about 3,200 plants of {MIN_CAPACITY_MW} MW and more ({count})")
check(min(plants["mw"]) >= MIN_CAPACITY_MW and plants["mw"] == sorted(plants["mw"], reverse=True), "largest first, none under the floor")
check(plants["name"][0] == "Three Gorges Dam" and plants["mw"][0] == 22500, "the Three Gorges Dam leads: 22,500 MW")
check(data["fuels"][plants["fuel"][0]] == "Hydro", "... of hydro")
check(arc_km((plants["lon"][0], plants["lat"][0]), (111.0, 30.82)) < 10, "... on the Yangtze above Yichang")
for fuel in ("Coal", "Gas", "Hydro", "Nuclear", "Oil", "Solar", "Wind"):
    check(fuel in data["fuels"], f"{fuel} is among the fuels")
coal = sum(1 for f in plants["fuel"] if data["fuels"][f] == "Coal")
check(coal > count * 0.3, f"coal is the commonest fuel of large plants ({coal} of {count})")

nuclear = data["nuclear"]
check(len(nuclear) == 195, f"195 nuclear plants ({len(nuclear)})")
check(nuclear[0]["name"] == "Kashiwazaki Kariwa" and nuclear[0]["mw"] == 8212 and nuclear[0]["country"] == "Japan", "Kashiwazaki-Kariwa is the largest: 8,212 MW")
check(any(p["name"].startswith("Zaporizhzhia") or p["name"].startswith("Zaporozh") for p in nuclear), "Zaporizhzhia is there")

query = """SELECT ?i ?coord WHERE { ?i wdt:P31/wdt:P279* wd:Q134447 ; wdt:P625 ?coord . }"""
answer = cached_fetch(f"https://query.wikidata.org/sparql?format=json&query={urllib.parse.quote(query)}", "human/wikidata-nuclear-plants.json")
reference = []
for row in json.loads(answer.read_text())["results"]["bindings"]:
    match = re.fullmatch(r"Point\((-?[\d.eE-]+) (-?[\d.eE-]+)\)", row["coord"]["value"])
    if match:
        reference.append((float(match.group(1)), float(match.group(2))))
check(len(reference) > 300, f"Wikidata lists {len(reference)} nuclear power plants with a position")
matched = sum(1 for p in nuclear if any(abs(lat - p["lat"]) < 0.2 and arc_km((p["lon"], p["lat"]), (lon, lat)) < 10 for lon, lat in reference))
check(matched / len(nuclear) > 0.9, f"{matched} of the {len(nuclear)} have a Wikidata nuclear plant within 10 km ({matched / len(nuclear):.0%})")

finish()
