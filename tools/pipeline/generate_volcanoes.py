#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: volcanoes as data.

Writes app/public/geo/volcanoes.json: every volcano of the Smithsonian
Global Volcanism Program's Volcanoes of the World database - those
active in the Holocene (the last ~12,000 years) with the year of their
last known eruption, and those of the Pleistocene - and every Holocene
eruption of Volcanic Explosivity Index 6 or more.

    Global Volcanism Program (2025), Volcanoes of the World (v. 5),
    Smithsonian Institution, compiled by Venzke, E.,
    doi:10.5479/si.GVP.VOTW5-2024.5.2 - read from the Program's public
    WFS (webservices.volcano.si.edu/geoserver/GVP-VOTW), layers
    Smithsonian_VOTW_Holocene_Volcanoes, _Pleistocene_Volcanoes and
    _Holocene_Eruptions.

The app already names volcanoes (geology.json, NOAA NCEI); this adds what
they are: type, height and how recently each erupted. "Last eruption" is
the database's Last_Eruption_Year on the day of the bake (asOf): a volcano
whose year is that year or the one before is drawn as recently active. It
is a snapshot, not a live feed.

Output (parallel arrays; coordinates in thousandths of a degree):

    {source, asOf, missingYear,
     holocene: {lon[], lat[], elevationM[], lastYear[], type[], name[]},
     pleistocene: {lon[], lat[], elevationM[], type[], name[]},
     types: [..],                       # type[] indexes this
     eruptions: [{name, lon, lat, startYear, endYear, vei, yearUncertainty}]}

Negative years are BCE as the database gives them (astronomical: -1645).

Usage:
    python3 tools/pipeline/generate_volcanoes.py
"""

import datetime
import json
import sys

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, write_json

WFS = ("https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature"
       "&outputFormat=application/json&typeName=GVP-VOTW:")
QUANTUM_PER_DEG = 1000
# No eruption year on record (the volcano is Holocene on other evidence).
MISSING_YEAR = -99999
MIN_VEI = 6


def features(layer: str, name: str, query: str = "") -> list[dict]:
    path = cached_fetch(WFS + layer + query, f"gvp/{name}.json")
    return [feature["properties"] | {"_lonlat": feature["geometry"]["coordinates"]}
            for feature in json.loads(path.read_text())["features"]]


def volcano_table(rows: list[dict], types: list[str], with_year: bool) -> dict:
    rows = sorted(rows, key=lambda r: r["Volcano_Number"])
    table: dict = {"lon": [], "lat": [], "elevationM": [], "type": [], "name": []}
    if with_year:
        table["lastYear"] = []
    for row in rows:
        lon, lat = row["_lonlat"]
        table["lon"].append(round(lon * QUANTUM_PER_DEG))
        table["lat"].append(round(lat * QUANTUM_PER_DEG))
        table["elevationM"].append(int(row["Elevation"]) if row.get("Elevation") is not None else 0)
        kind = row.get("Primary_Volcano_Type") or "Unknown"
        if kind not in types:
            types.append(kind)
        table["type"].append(types.index(kind))
        table["name"].append(row["Volcano_Name"])
        if with_year:
            year = row.get("Last_Eruption_Year")
            table["lastYear"].append(MISSING_YEAR if year is None else int(year))
    return table


def main() -> None:
    holocene = features("Smithsonian_VOTW_Holocene_Volcanoes", "holocene")
    pleistocene = features("Smithsonian_VOTW_Pleistocene_Volcanoes", "pleistocene")
    eruptions = features("Smithsonian_VOTW_Holocene_Eruptions", "eruptions-vei5", "&cql_filter=ExplosivityIndexMax%3E%3D5")
    types: list[str] = []
    great = []
    for row in eruptions:
        if row["ExplosivityIndexMax"] < MIN_VEI or row["Activity_Type"] != "Confirmed Eruption":
            continue
        lon, lat = row["_lonlat"]
        great.append({
            "name": row["Volcano_Name"],
            "lon": round(lon, 3),
            "lat": round(lat, 3),
            "startYear": int(row["StartDateYear"]),
            "endYear": int(row["EndDateYear"]) if row.get("EndDateYear") is not None else None,
            "vei": int(row["ExplosivityIndexMax"]),
            "yearUncertainty": int(row["StartDateYearUncertainty"]) if row.get("StartDateYearUncertainty") is not None else None,
        })
    great.sort(key=lambda e: (-e["startYear"], e["name"]))
    # The day the database was read: the cached download's, not today's.
    cache_day = datetime.date.fromtimestamp((CACHE_DIR / "gvp" / "holocene.json").stat().st_mtime)
    data = {
        "source": "Global Volcanism Program, Volcanoes of the World v. 5, Smithsonian Institution (doi:10.5479/si.GVP.VOTW5-2024.5.2)",
        "asOf": cache_day.isoformat(),
        "quantumPerDegree": QUANTUM_PER_DEG,
        "missingYear": MISSING_YEAR,
        "types": types,
        "holocene": volcano_table(holocene, types, True),
        "pleistocene": volcano_table(pleistocene, types, False),
        "eruptions": great,
    }
    out = OUTPUT_DIR / "volcanoes.json"
    write_json(out, data)
    years = [y for y in data["holocene"]["lastYear"] if y != MISSING_YEAR]
    print(f"{len(holocene)} Holocene volcanoes ({len(years)} with a last eruption, "
          f"{sum(y >= cache_day.year - 1 for y in years)} since {cache_day.year - 1}), {len(pleistocene)} Pleistocene, "
          f"{len(great)} eruptions of VEI {MIN_VEI}+; as of {cache_day}", file=sys.stderr)


if __name__ == "__main__":
    main()
