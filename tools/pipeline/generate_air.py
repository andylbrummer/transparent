#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: airports and air routes.

Writes two files, kept apart because their licences differ:

  app/public/geo/airports.json     PUBLIC DOMAIN. Every airport OurAirports
        (https://ourairports.com/data/, public domain) classes as a
        `large_airport` with scheduled service and an IATA code: code,
        city, position. `rank` is Natural Earth's scale rank for
        the same IATA code (ne_10m_airports, public domain; 2 = the
        great hubs ... 9), or UNRANKED where Natural Earth does not list
        it; it only decides which codes are written out first.

  app/public/geo/air-routes.json   ODbL 1.0 - share-alike, flagged. From
        the OpenFlights route database (https://openflights.org/data.php,
        routes.dat), which stopped being maintained in JUNE 2014: these
        are the scheduled routes of a decade ago. For each pair of
        airports, `airlines` is the number of airlines that flew it
        non-stop in either direction under their own code; kept are the
        pairs flown by MIN_AIRLINES or more, and every pair longer than
        LONG_HAUL_KM. Positions are OurAirports' for the IATA code.

Output:

    airports.json    {source, airports: [{iata, city, lon, lat, rank}]}   # best rank first
    air-routes.json  {source, licence, dataDate, minAirlines, longHaulKm,
                      airports: [[iata, lon, lat]],
                      routes: [[airport index, airport index, airlines]]}       # most airlines first

Usage:
    python3 tools/pipeline/generate_air.py
"""

import csv
import json
import sys

from fetch_cache import cached_fetch
from generate_cables import arc_km
from generate_geo import NATURAL_EARTH_BASE, OUTPUT_DIR, write_json

OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
ROUTES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat"
UNRANKED = 10
MIN_AIRLINES = 3
LONG_HAUL_KM = 8000


def read_airports() -> list[dict]:
    path = cached_fetch(OURAIRPORTS_URL, "human/ourairports.csv")
    with open(path, encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def natural_earth_ranks() -> dict[str, int]:
    path = cached_fetch(f"{NATURAL_EARTH_BASE}/ne_10m_airports.geojson", "human/ne_10m_airports.geojson")
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    return {f["properties"]["iata_code"]: int(f["properties"]["scalerank"]) for f in features if f["properties"].get("iata_code")}


def build_airports(rows: list[dict]) -> list[dict]:
    ranks = natural_earth_ranks()
    airports = []
    for row in rows:
        if row["type"] != "large_airport" or row["scheduled_service"] != "yes" or not row["iata_code"]:
            continue
        airports.append({
            "iata": row["iata_code"],
            "city": row["municipality"],
            "lon": round(float(row["longitude_deg"]), 3),
            "lat": round(float(row["latitude_deg"]), 3),
            "rank": ranks.get(row["iata_code"], UNRANKED),
        })
    airports.sort(key=lambda a: (a["rank"], a["iata"]))
    return airports


def build_routes(rows: list[dict]) -> dict:
    position = {}
    for row in rows:
        # A closed field can keep its old code: the open one wins.
        if row["iata_code"] and (row["type"] != "closed" or row["iata_code"] not in position):
            position[row["iata_code"]] = (round(float(row["longitude_deg"]), 3), round(float(row["latitude_deg"]), 3))
    airlines: dict[tuple[str, str], set[str]] = {}
    path = cached_fetch(ROUTES_URL, "human/openflights-routes.dat")
    with open(path, encoding="utf-8", newline="") as handle:
        for airline, _airline_id, source, _sid, destination, _did, codeshare, stops, *_ in csv.reader(handle):
            if codeshare == "Y" or stops != "0" or source == destination:
                continue
            if source not in position or destination not in position:
                continue
            airlines.setdefault(tuple(sorted((source, destination))), set()).add(airline)
    kept = []
    for (a, b), flown in airlines.items():
        if len(flown) >= MIN_AIRLINES or arc_km(position[a], position[b]) >= LONG_HAUL_KM:
            kept.append((a, b, len(flown)))
    kept.sort(key=lambda r: (-r[2], r[0], r[1]))
    codes = sorted({code for a, b, _ in kept for code in (a, b)})
    index = {code: i for i, code in enumerate(codes)}
    return {
        "source": "OpenFlights route database (openflights.org); airport positions from OurAirports",
        "licence": "Open Database License (ODbL) 1.0",
        "dataDate": "2014-06",
        "minAirlines": MIN_AIRLINES,
        "longHaulKm": LONG_HAUL_KM,
        "airports": [[code, *position[code]] for code in codes],
        "routes": [[index[a], index[b], n] for a, b, n in kept],
    }


def main() -> None:
    rows = read_airports()
    airports = build_airports(rows)
    write_json(OUTPUT_DIR / "airports.json", {
        "source": "OurAirports (ourairports.com), public domain; scale ranks from Natural Earth",
        "airports": airports,
    })
    routes = build_routes(rows)
    write_json(OUTPUT_DIR / "air-routes.json", routes)
    print(f"{len(airports)} airports; {len(routes['routes'])} routes between {len(routes['airports'])} airports", file=sys.stderr)


if __name__ == "__main__":
    main()
