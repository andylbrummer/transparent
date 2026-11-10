#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: historical tsunamis.

Writes app/public/geo/tsunamis.json: the sources of the tsunamis of the
past four thousand years that did measurable harm - where the earthquake,
landslide or eruption that raised each one was, how high the water ran
and how many people it killed.

Source:

    National Geophysical Data Center / World Data Service (NGDC/WDS):
    NCEI/WDS Global Historical Tsunami Database. NOAA National Centers for
    Environmental Information. doi:10.7289/V5PN93H7
    read from its HazEL API,
    https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events
    (a work of the U.S. Government: public domain).

Of the database's ~3,100 source events, kept are those that

  - NCEI rates a probable or definite tsunami (eventValidity 3 or 4;
    doubtful and erroneous entries and seiches are left out),
  - have a source position, and
  - either ran up MIN_HEIGHT_M or more somewhere, or killed someone
    themselves: NCEI keeps the tsunami's own toll apart from that of the
    earthquake or eruption behind it, and only the tsunami's is used here
    (the 2023 Turkiye earthquake killed 56,697 and its 0.3 m tsunami
    nobody: it is not in this file).

Fields, as NCEI gives them:

    y, m, d      date (negative years are BCE; month and day may be null)
    lat, lon     of the SOURCE: the epicentre, the slide, the volcano -
                 not of the coasts the waves reached
    cause        'earthquake', 'landslide', 'volcano' or 'other', folded
                 from NCEI's cause code (CAUSE_GROUPS; an earthquake that
                 set off a landslide counts as a landslide, since the
                 slide is what raised the water: Lituya Bay 1958)
    heightM      maximum water height above sea level recorded anywhere, m
    deaths       killed by the tsunami itself; null where NCEI has no figure
    mag          magnitude of the earthquake, if one
    place        NCEI's location name - or, for four famous events whose
                 location name is only a region, the name they go by
                 (KNOWN_AS) - and country

Output, highest water first:

    {source, fetched, total, tsunamis: [{id, y, m, d, lat, lon, cause, heightM, deaths, mag, place, country}]}

Usage:
    python3 tools/pipeline/generate_tsunamis.py [--refresh]
"""

import json
import sys
from datetime import datetime, timezone

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

API_URL = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events?itemsPerPage=200&page={page}"
MIN_VALIDITY = 3
MIN_HEIGHT_M = 1.0

#: NCEI cause code -> group. Codes: 0 unknown, 1 earthquake, 2 questionable
#: earthquake, 3 earthquake and landslide, 4 volcano and earthquake, 5 volcano,
#: earthquake and landslide, 6 volcano, 7 volcano and landslide, 8 landslide,
#: 9 meteorological, 10 explosion, 11 astronomical tide.
CAUSE_GROUPS = {
    1: "earthquake", 2: "earthquake",
    3: "landslide", 8: "landslide",
    4: "volcano", 5: "volcano", 6: "volcano", 7: "volcano",
    0: "other", 9: "other", 10: "other", 11: "other",
}


#: Compass abbreviations and country initials stay as NCEI prints them.
KEPT_CAPITALS = {"N", "S", "E", "W", "NE", "NW", "SE", "SW", "USA", "UK"}

#: NCEI event id -> the name the event is known by, where NCEI's location name
#: is only the region. 1880 is the 10 July 1958 earthquake whose landslide
#: into Lituya Bay raised the 524.6 m run-up (NCEI's run-up record for the
#: event is at Lituya Bay); 2439 the 26 December 2004 Indian Ocean tsunami;
#: 5413 the 11 March 2011 Tohoku tsunami; 1902 the 22 May 1960 Chilean tsunami.
KNOWN_AS = {
    1880: "Lituya Bay, Alaska",
    2439: "Indian Ocean (Sumatra)",
    5413: "Tōhoku, Japan",
    1902: "Chile (Valdivia)",
}


def title_case(text: str) -> str:
    """NCEI prints names in capitals: "OFF W. COAST OF SUMATRA" -> "Off W. Coast of Sumatra"; "AK" stays."""
    small = {"OF", "THE", "AND", "DE", "DEL", "LA"}
    words = []
    for i, word in enumerate(text.split(" ")):
        bare = word.strip(",.()")
        if i > 0 and bare in small:
            words.append(word.lower())
        elif bare in KEPT_CAPITALS:
            words.append(word)
        elif len(bare) <= 2 and "." not in word and i > 0 and words[-1].endswith(","):
            words.append(word)  # a state or province code after a comma
        else:
            words.append("-".join(part[:1] + part[1:].lower() for part in word.split("-")))
    return " ".join(words)


def keep(item: dict) -> bool:
    if item.get("eventValidity", -1) < MIN_VALIDITY:
        return False
    if item.get("latitude") is None or item.get("longitude") is None:
        return False
    return (item.get("maxWaterHeight") or 0) >= MIN_HEIGHT_M or (item.get("deaths") or 0) > 0


def entry(item: dict) -> dict:
    return {
        "id": item["id"],
        "y": item["year"],
        "m": item.get("month"),
        "d": item.get("day"),
        "lat": item["latitude"],
        "lon": item["longitude"],
        "cause": CAUSE_GROUPS.get(item.get("causeCode"), "other"),
        "heightM": item.get("maxWaterHeight"),
        "deaths": item.get("deaths"),
        "mag": item.get("eqMagnitude"),
        "place": KNOWN_AS.get(item["id"]) or title_case(item.get("locationName") or ""),
        "country": title_case(item.get("country") or ""),
    }


def fetch_all(refresh: bool) -> tuple[list[dict], str]:
    items: list[dict] = []
    page = 1
    fetched = ""
    while True:
        path = cached_fetch(API_URL.format(page=page), f"hazards/tsunami-events-{page}.json", refresh=refresh)
        if page == 1:
            fetched = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%d")
        data = json.loads(path.read_text(encoding="utf-8"))
        items += data["items"]
        if page >= data["totalPages"]:
            if len(items) != data["totalItems"]:
                raise RuntimeError(f"read {len(items)} events, the service says {data['totalItems']}")
            return items, fetched
        page += 1


def main() -> None:
    items, fetched = fetch_all("--refresh" in sys.argv)
    tsunamis = sorted((entry(i) for i in items if keep(i)), key=lambda t: (-(t["heightM"] or 0), -(t["deaths"] or 0), t["id"]))
    write_json(OUTPUT_DIR / "tsunamis.json", {
        "source": "NCEI/WDS Global Historical Tsunami Database, NOAA NCEI, doi:10.7289/V5PN93H7",
        "fetched": fetched,
        "total": len(items),
        "minHeightM": MIN_HEIGHT_M,
        "tsunamis": tsunamis,
    })
    print(f"{len(tsunamis)} of {len(items)} source events kept; highest: "
          + ", ".join(f"{t['y']} {t['place']} {t['heightM']} m" for t in tsunamis[:5]), file=sys.stderr)


if __name__ == "__main__":
    main()
