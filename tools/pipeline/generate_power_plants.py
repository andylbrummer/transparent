#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the world's large power plants.

Writes app/public/geo/power-plants.json from the Global Power Plant
Database v1.3.0 (June 2021, the last release):

    Global Energy Observatory, Google, KTH Royal Institute of Technology
    in Stockholm, Enipedia, World Resources Institute (2021), Global Power
    Plant Database v1.3.0, Resource Watch and Google Earth Engine,
    https://datasets.wri.org/dataset/globalpowerplantdatabase  (CC BY 4.0)

The database has 34,936 plants; kept here are

  plants    every plant of MIN_CAPACITY_MW or more, whatever its fuel:
            position, capacity, primary fuel, and the name of the largest
            NAMED_PLANTS for labels;
  nuclear   every nuclear plant, of any size, with its name.

Nothing is corrected or merged: a plant the database splits in two (Itaipu,
by country) stays split, and capacities are as of each row's
`year_of_capacity_data` - mostly 2017-2019. Plants built since are absent.

Output:

    {source, version, minCapacityMw, fuels: [..],
     plants:  {lon: [], lat: [], mw: [], fuel: [index into fuels], name: [first NAMED_PLANTS only]},   # largest first
     nuclear: [{name, country, lon, lat, mw}]}                                                        # largest first

Usage:
    python3 tools/pipeline/generate_power_plants.py
"""

import csv
import sys

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

SOURCE_URL = "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv"
MIN_CAPACITY_MW = 500
NAMED_PLANTS = 250


def read_plants() -> list[dict]:
    path = cached_fetch(SOURCE_URL, "human/gppd.csv")
    with open(path, encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    plants = []
    for row in rows:
        plants.append({
            "name": row["name"].strip(),
            "country": row["country_long"],
            "lon": round(float(row["longitude"]), 3),
            "lat": round(float(row["latitude"]), 3),
            "mw": round(float(row["capacity_mw"])),
            "fuel": row["primary_fuel"],
        })
    return plants


def build() -> dict:
    plants = read_plants()
    large = sorted((p for p in plants if p["mw"] >= MIN_CAPACITY_MW), key=lambda p: (-p["mw"], p["name"]))
    fuels = sorted({p["fuel"] for p in large})
    nuclear = sorted((p for p in plants if p["fuel"] == "Nuclear"), key=lambda p: (-p["mw"], p["name"]))
    return {
        "source": "Global Power Plant Database v1.3.0 (2021), Global Energy Observatory, Google, KTH, Enipedia, World Resources Institute",
        "version": "1.3.0 (June 2021)",
        "minCapacityMw": MIN_CAPACITY_MW,
        "fuels": fuels,
        "plants": {
            "lon": [p["lon"] for p in large],
            "lat": [p["lat"] for p in large],
            "mw": [p["mw"] for p in large],
            "fuel": [fuels.index(p["fuel"]) for p in large],
            "name": [p["name"] for p in large[:NAMED_PLANTS]],
        },
        "nuclear": [{k: p[k] for k in ("name", "country", "lon", "lat", "mw")} for p in nuclear],
    }


def main() -> None:
    data = build()
    write_json(OUTPUT_DIR / "power-plants.json", data)
    print(f"{len(data['plants']['lon'])} plants of {MIN_CAPACITY_MW} MW or more, {len(data['nuclear'])} nuclear", file=sys.stderr)


if __name__ == "__main__":
    main()
