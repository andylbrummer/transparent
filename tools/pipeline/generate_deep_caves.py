#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: caves with a known depth.

Writes app/public/geo/deep-caves.json: every cave on Wikidata (CC0) with
a position and a stated vertical depth (P4511, "vertical depth": the
height between a cave's highest entrance and its lowest point), asked
with one SPARQL query at https://query.wikidata.org/sparql and baked.

A cave is an instance of cave (Q35509) or of any subclass of it (pit
caves, sinkholes entered as caves, lava tubes, ice caves...). Of several
depths on one item (a survey and a later one) the greatest is kept: cave
depths only grow as explorers push further. Two items within 1 km of
each other are one cave entered twice; the deeper is kept.

The query, the name rules (the English Wikipedia title where there is
one, else the English label) and the position parsing are shared with
generate_landmarks.py, whose "deep" set already takes the few caves of
1,000 m and more.

Wikidata is edited by anyone, and covers caves unevenly: two thirds of
them lie in and around Bulgaria, most countries have a handful. test_deep_caves.py
pins the deepest against their Wikipedia articles.

Output: {source, licence, asOf, caves: [[name, lat, lon, depth_m, links], ...]}, deepest first.

Usage:
    python3 tools/pipeline/generate_deep_caves.py [--refresh]
"""

import argparse
import json
import sys
import time
import urllib.parse
from datetime import datetime, timezone

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, write_json
from generate_landmarks import COMMON, ENDPOINT, items, merge_places

QUERY = """SELECT ?i ?coord ?links ?label ?title ?d WHERE {
  ?i wdt:P31/wdt:P279* wd:Q35509 ; p:P4511/psn:P4511/wikibase:quantityAmount ?d . FILTER(?d > 0)
  %s }"""
CACHE_NAME = "subsurface/wikidata-deep-caves.json"
SAME_CAVE_KM = 1.0


def rows(refresh: bool = False) -> list[dict]:
    url = f"{ENDPOINT}?format=json&query={urllib.parse.quote(QUERY % COMMON)}"
    fresh = refresh or not (CACHE_DIR / CACHE_NAME).exists()
    path = cached_fetch(url, CACHE_NAME, refresh=refresh)
    if fresh:
        time.sleep(2)
    bindings = json.loads(path.read_text())["results"]["bindings"]
    return [{key: value["value"] for key, value in row.items()} for row in bindings]


def build(result: list[dict]) -> list[list]:
    caves = []
    for entry in items(result).values():
        entry["depth"] = round(max(float(r["d"]) for r in entry["_rows"]))
        caves.append(entry)
    kept = merge_places(caves, lambda c: (-c["depth"], -c["links"], c["name"]), SAME_CAVE_KM)
    kept.sort(key=lambda c: (-c["depth"], c["name"]))
    return [[c["name"], c["lat"], c["lon"], c["depth"], c["links"]] for c in kept]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="ask Wikidata again instead of using the cached answer")
    args = parser.parse_args()
    result = rows(args.refresh)
    caves = build(result)
    as_of = datetime.fromtimestamp((CACHE_DIR / CACHE_NAME).stat().st_mtime, timezone.utc).strftime("%Y-%m-%d")
    write_json(OUTPUT_DIR / "deep-caves.json", {
        "source": "Wikidata, caves with a vertical depth (P4511)",
        "licence": "CC0 1.0",
        "asOf": as_of,
        "caves": caves,
    })
    print(f"{len(result)} rows, {len(caves)} caves; deepest " + ", ".join(f"{c[0]} {c[3]} m" for c in caves[:6]), file=sys.stderr)


if __name__ == "__main__":
    main()
