#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: landmarks people point at.

Writes app/public/geo/landmarks.json: small sets of points, each asked of
Wikidata (CC0) with one SPARQL query at https://query.wikidata.org/sparql:

  mountains      the fourteen eight-thousanders (elevation >= 8000 m and
                 topographic prominence >= 500 m), the Seven Summits
                 (part of Q208126) and every mountain whose prominence is
                 3000 m or more. value = elevation, m.
  deep           boreholes, mines and caves with a stated vertical depth
                 (P4511) of 1000 m or more. value = depth, m. Wikidata
                 gives no depth for the two deepest mines, Mponeng and
                 TauTona; theirs are read from the lead of their English
                 Wikipedia articles and kept as the text says them
                 ("over 4 km", "about 3.9 km").
  launchSites    spaceports (instance of a subclass of Q194188).
  observatories  telescopes and astronomical observatories, with neutrino
                 detectors and gravitational-wave detectors. kind says
                 which: optical | radio | observatory | neutrino | gw.
  accelerators   particle accelerators (subclasses of Q130825).
  heritage       UNESCO World Heritage Sites (heritage designation, P1435,
                 = Q9259).
  wrecks         shipwrecks (instance of Q852190), where they lie or
                 went down. Wikidata states a depth for three of the
                 three hundred, too few to draw: they are on the surface.

Which members a set has is decided by Wikidata's classes, not by hand;
how well known an item is - used only to rank names and to cut the long
tails - is the number of Wikipedia language editions with an article on
it (`links`). Names are the English Wikipedia article's title where there
is one (labels are easier to vandalise), else the English label.

Wikidata is edited by anyone: test_landmarks.py pins a sample of each set
against independent sources.

Output:

    {source, licence, asOf, sets: {<set>: [{name, lon, lat, links, value?, valueText?, kind?}]}}

Usage:
    python3 tools/pipeline/generate_landmarks.py [--refresh]
"""

import argparse
import json
import math
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, write_json

ENDPOINT = "https://query.wikidata.org/sparql"
WIKIPEDIA_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"

# What every query returns besides its own columns.
COMMON = """
  ?i wdt:P625 ?coord ; wikibase:sitelinks ?links .
  OPTIONAL { ?i rdfs:label ?label . FILTER(lang(?label) = "en") }
  OPTIONAL { ?article schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }
"""

QUERIES = {
    "mountains-high": """SELECT ?i ?coord ?links ?label ?title ?e ?when ?p WHERE {
  ?i p:P2044 ?st . ?st a wikibase:BestRank ; psn:P2044/wikibase:quantityAmount ?e . FILTER(?e >= 8000 && ?e < 9000)
  ?i wdt:P31/wdt:P279* wd:Q8502 .
  OPTIONAL { ?st pq:P585 ?when }
  OPTIONAL { ?i p:P2660/psn:P2660/wikibase:quantityAmount ?p }
  %s }""",
    "mountains-summits": """SELECT ?i ?coord ?links ?label ?title ?e ?when ?p WHERE {
  ?i wdt:P361 wd:Q208126 ; p:P2044 ?st . ?st a wikibase:BestRank ; psn:P2044/wikibase:quantityAmount ?e .
  OPTIONAL { ?st pq:P585 ?when }
  OPTIONAL { ?i p:P2660/psn:P2660/wikibase:quantityAmount ?p }
  %s }""",
    "mountains-prominent": """SELECT ?i ?coord ?links ?label ?title ?e ?when ?p WHERE {
  ?i p:P2660/psn:P2660/wikibase:quantityAmount ?p . FILTER(?p >= 3000 && ?p < 9000)
  ?i wdt:P31/wdt:P279* wd:Q8502 .
  ?i p:P2044 ?st . ?st a wikibase:BestRank ; psn:P2044/wikibase:quantityAmount ?e .
  OPTIONAL { ?st pq:P585 ?when }
  %s }""",
    "deep": """SELECT ?i ?coord ?links ?label ?title ?d ?k WHERE {
  VALUES ?k { wd:Q820477 wd:Q502102 wd:Q35509 }
  ?i wdt:P31/wdt:P279* ?k ; p:P4511/psn:P4511/wikibase:quantityAmount ?d . FILTER(?d >= 1000)
  %s }""",
    "deep-mines": """SELECT ?i ?coord ?links ?label ?title WHERE {
  VALUES ?i { wd:Q3327134 wd:Q2140375 }
  %s }""",
    "launch-sites": """SELECT ?i ?coord ?links ?label ?title WHERE {
  ?i wdt:P31/wdt:P279* wd:Q194188 .
  %s }""",
    "telescopes": """SELECT ?i ?coord ?links ?label ?title WHERE {
  ?i wdt:P31 ?t . ?t wdt:P279* wd:Q4213 .
  %s FILTER(?links >= 10) }""",
    "radio-telescopes": """SELECT ?i ?coord ?links ?label ?title WHERE {
  ?i wdt:P31 ?t . ?t wdt:P279* wd:Q184356 .
  %s FILTER(?links >= 10) }""",
    "observatories": """SELECT ?i ?coord ?links ?label ?title WHERE {
  ?i wdt:P31 wd:Q1254933 .
  %s FILTER(?links >= 20) }""",
    "detectors": """SELECT ?i ?coord ?links ?label ?title ?k WHERE {
  VALUES ?k { wd:Q583152 wd:Q2302080 }
  ?i wdt:P31 ?k .
  %s FILTER(?links >= 3) }""",
    "accelerators": """SELECT ?i ?coord ?links ?label ?title WHERE {
  ?i wdt:P31/wdt:P279* wd:Q130825 .
  %s FILTER(?links >= 5) }""",
    "heritage": """SELECT ?i ?coord ?links ?label ?title WHERE {
  ?i wdt:P1435 wd:Q9259 .
  %s }""",
    "wrecks": """SELECT ?i ?coord ?links ?label ?title WHERE {
  ?i wdt:P31 wd:Q852190 .
  %s FILTER(?links >= 8) }""",
}

MINE, BOREHOLE, CAVE = "Q820477", "Q502102", "Q35509"
NEUTRINO, GRAVITATIONAL = "Q583152", "Q2302080"
DEEP_KIND = {MINE: "mine", BOREHOLE: "borehole", CAVE: "cave"}
# The two deepest mines: Wikidata has their positions but no depth. The sentence each article's lead must contain.
MINE_DEPTHS = {
    "Q3327134": ("Mponeng_Gold_Mine", r"reaching over ([\d.]+) kilomet", "over {} km"),
    "Q2140375": ("TauTona_Mine", r"At approximately ([\d.]+) kilomet", "about {} km"),
}
# Two items of a set this near each other are one place (a peak and its massif, one site entered twice).
SAME_PLACE_KM = 3.0
# Lhotse stands 3 km from Everest: only a summit entered twice (Kibo and Kilimanjaro, 1 km apart) is merged.
SAME_SUMMIT_KM = 1.5
# A mountain with an article in fewer editions than this is usually a second entry for a summit of a massif already listed.
MIN_MOUNTAIN_LINKS = 5
# Sites of one instrument further apart than this are separate places.
SEPARATE_SITE_KM = 50.0
MAX_HERITAGE = 1400
MAX_WRECKS = 300


def run(name: str, refresh: bool) -> list[dict]:
    query = QUERIES[name] % COMMON
    url = f"{ENDPOINT}?format=json&query={urllib.parse.quote(query)}"
    cache_name = f"human/wikidata-{name}.json"
    fresh = refresh or not (CACHE_DIR / cache_name).exists()
    path = cached_fetch(url, cache_name, refresh=refresh)
    if fresh:
        # The endpoint asks for no more than a few queries at a time.
        time.sleep(2)
    bindings = json.loads(path.read_text())["results"]["bindings"]
    return [{key: value["value"] for key, value in row.items()} for row in bindings]


def distance_km(a: dict, b: dict) -> float:
    la1, la2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlon = math.radians(b["lon"] - a["lon"])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def items(rows: list[dict]) -> dict[str, dict]:
    """One entry per item on Earth with a usable name; the rows of an item are kept for the caller's own columns."""
    out: dict[str, dict] = {}
    for row in rows:
        match = re.fullmatch(r"Point\((-?[\d.eE-]+) (-?[\d.eE-]+)\)", row["coord"])
        if not match:
            # Another globe (the IRI of the globe precedes the point), or an unknown value.
            continue
        name = row.get("title") or row.get("label")
        if not name:
            continue
        qid = row["i"].rsplit("/", 1)[1]
        entry = out.setdefault(qid, {
            # "Mercury (planet)" style disambiguators are not part of the name.
            "name": re.sub(r" \([^)]*\)$", "", name),
            "lon": round(float(match.group(1)), 3),
            "lat": round(float(match.group(2)), 3),
            "links": int(row["links"]),
            "_id": qid,
            "_rows": [],
            "_sites": [],
        })
        entry["_rows"].append(row)
        site = (round(float(match.group(1)), 3), round(float(match.group(2)), 3))
        if site not in entry["_sites"]:
            entry["_sites"].append(site)
    return out


def merge_places(entries: list[dict], key, within_km: float = SAME_PLACE_KM) -> list[dict]:
    """Drop an entry within `within_km` of a better one; `key` sorts the best first."""
    kept: list[dict] = []
    for entry in sorted(entries, key=key):
        if all(distance_km(entry, other) > within_km for other in kept):
            kept.append(entry)
    return kept


def clean(entries: list[dict]) -> list[dict]:
    return [{k: v for k, v in entry.items() if not k.startswith("_")} for entry in entries]


def elevation(rows: list[dict]) -> float:
    """Of several best-rank elevations, the most recently surveyed; undated, the highest."""
    dated = [r for r in rows if "when" in r]
    if dated:
        return float(max(dated, key=lambda r: r["when"])["e"])
    return max(float(r["e"]) for r in rows)


def prominence(rows: list[dict]) -> float | None:
    values = [float(r["p"]) for r in rows if "p" in r]
    return max(values) if values else None


def build_mountains(refresh: bool) -> list[dict]:
    chosen: dict[str, dict] = {}
    for qid, entry in items(run("mountains-high", refresh)).items():
        p = prominence(entry["_rows"])
        if p is not None and p >= 500:
            chosen[qid] = {**entry, "kind": "eight-thousander"}
    for qid, entry in items(run("mountains-summits", refresh)).items():
        chosen.setdefault(qid, {**entry, "kind": "seven-summits"})
    for qid, entry in items(run("mountains-prominent", refresh)).items():
        e, p = elevation(entry["_rows"]), prominence(entry["_rows"])
        # A prominence above the summit's own height is an error in the data.
        if p is not None and p <= e + 1:
            chosen.setdefault(qid, {**entry, "kind": "prominent"})
    for entry in chosen.values():
        entry["value"] = round(elevation(entry["_rows"]))
    known = [m for m in chosen.values() if m["links"] >= MIN_MOUNTAIN_LINKS]
    return clean(sorted(merge_places(known, lambda m: -m["links"], SAME_SUMMIT_KM), key=lambda m: -m["value"]))


def build_deep(refresh: bool) -> list[dict]:
    entries = []
    for entry in items(run("deep", refresh)).values():
        if entry["links"] < 1:
            continue
        kinds = {row["k"].rsplit("/", 1)[1] for row in entry["_rows"]}
        # A borehole that is also classed under "mine" (a drilled observatory) is a borehole.
        kind = next(k for k in (BOREHOLE, CAVE, MINE) if k in kinds)
        entries.append({**entry, "value": round(max(float(r["d"]) for r in entry["_rows"])), "kind": DEEP_KIND[kind]})
    for qid, entry in items(run("deep-mines", refresh)).items():
        page, pattern, text = MINE_DEPTHS[qid]
        summary = json.loads(cached_fetch(WIKIPEDIA_SUMMARY + page, f"human/wikipedia-{page}.json", refresh=refresh).read_text())
        match = re.search(pattern, summary["extract"])
        if not match:
            raise SystemExit(f"{page}: the article's lead no longer states the depth as expected; read it and update MINE_DEPTHS")
        km = float(match.group(1))
        entries.append({**entry, "value": round(km * 1000), "valueText": text.format(match.group(1)), "kind": "mine"})
    return clean(sorted(merge_places(entries, lambda d: -d["value"]), key=lambda d: -d["value"]))


def build_ranked(name: str, refresh: bool, limit: int | None = None) -> list[dict]:
    entries = merge_places(list(items(run(name, refresh)).values()), lambda x: (-x["links"], x["name"]))
    return clean(entries[:limit])


def build_observatories(refresh: bool) -> list[dict]:
    radio = set(items(run("radio-telescopes", refresh)))
    entries = []
    for qid, entry in items(run("detectors", refresh)).items():
        kind = "gw" if any(r["k"].endswith(GRAVITATIONAL) for r in entry["_rows"]) else "neutrino"
        # One instrument at several sites (LIGO at Hanford and at Livingston) is drawn at each.
        sites: list[dict] = []
        for lon, lat in sorted(entry["_sites"]):
            site = {**entry, "lon": lon, "lat": lat, "kind": kind}
            if all(distance_km(site, other) > SEPARATE_SITE_KM for other in sites):
                sites.append(site)
        entries += sites
    seen = {e["_id"] for e in entries}
    for qid, entry in items(run("telescopes", refresh)).items():
        if qid not in seen:
            entries.append({**entry, "kind": "radio" if qid in radio else "optical"})
            seen.add(qid)
    for qid, entry in items(run("observatories", refresh)).items():
        if qid not in seen:
            entries.append({**entry, "kind": "observatory"})
    # Detectors first, so a detector is never dropped for the observatory that houses it.
    special = lambda e: e["kind"] not in ("neutrino", "gw")  # noqa: E731
    kept: list[dict] = []
    for entry in sorted(entries, key=lambda e: (special(e), -e["links"], e["name"])):
        # An instrument entered twice, or under its observatory's name as well, is drawn once.
        if all(distance_km(entry, other) > 0.5 for other in kept):
            kept.append(entry)
    return clean(sorted(kept, key=lambda e: (-e["links"], e["name"])))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--refresh", action="store_true", help="ask Wikidata again instead of reading the cache")
    args = parser.parse_args()
    sets = {
        "mountains": build_mountains(args.refresh),
        "deep": build_deep(args.refresh),
        "launchSites": build_ranked("launch-sites", args.refresh),
        "observatories": build_observatories(args.refresh),
        "accelerators": build_ranked("accelerators", args.refresh),
        "heritage": build_ranked("heritage", args.refresh, MAX_HERITAGE),
        "wrecks": build_ranked("wrecks", args.refresh, MAX_WRECKS),
    }
    asked = max((CACHE_DIR / f"human/wikidata-{name}.json").stat().st_mtime for name in QUERIES)
    write_json(OUTPUT_DIR / "landmarks.json", {
        "source": "Wikidata (query.wikidata.org); depths of Mponeng and TauTona from English Wikipedia",
        "licence": "CC0 1.0 (Wikidata)",
        "asOf": datetime.fromtimestamp(asked, tz=timezone.utc).strftime("%Y-%m-%d"),
        "sets": sets,
    })
    print(", ".join(f"{name} {len(entries)}" for name, entries in sets.items()), file=sys.stderr)


if __name__ == "__main__":
    main()
