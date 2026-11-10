#!/usr/bin/env python3
"""
Checks for the ULVZ layer: app/public/geo/ulvz.json against the Yu &
Garnero (2018) database it was read from and against what the studies
themselves say.

The counts are those of the database's 1_Database folder (v1.0.1), counted
independently of the bake on 2026-11-09 by walking the unpacked archive:
121 Data.* files from 54 studies, 17,129 coordinate rows.

The places are from the papers: the Hawaiian ULVZ is "~ 910 km in
diameter" (Cottaar & Romanowicz 2012, abstract), which pins both the
outline read and the conversion of degrees to km on the core-mantle
boundary; Vidale & Benz (1992), study 1, found none under Alaska; the
Icelandic and Samoan ones lie under Iceland and near Samoa.

Usage:
    python3 tools/pipeline/generate_ulvz.py
    python3 tools/pipeline/test_ulvz.py
"""

import json
import math

from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish

data = json.loads((OUTPUT_DIR / "ulvz.json").read_text(encoding="utf-8"))
q = data["quantumPerDegree"]
size = (OUTPUT_DIR / "ulvz.json").stat().st_size
check(size < 500_000, f"ulvz.json is {size / 1024:.0f} KiB, within 500 kB")
check(data["studies"] == 54 and data["files"] == 121, f"121 files from 54 studies ({data['files']}, {data['studies']})")
check(data["depthKm"] == 2891.0 and q == 100, "at the core-mantle boundary, 2,891 km; hundredths of a degree")
check("10.1002/2017GC007281" in data["source"] and "10.5281/zenodo.1064217" in data["source"], "the source names the paper and the data set")

points = {result: len(values) // 2 for result, values in data["points"].items()}
check(points == {"yes": 1986, "no": 2508, "may": 479}, f"pierce points: 1,986 found, 2,508 not found, 479 uncertain ({points})")
lines = {result: len(values) for result, values in data["lines"].items()}
check(lines == {"yes": 185, "no": 218, "may": 53}, f"paths: 185 found, 218 not found, 53 uncertain ({lines})")
check(all(len(line) == 4 for values in data["lines"].values() for line in values), "every path has two ends")
area_rows = {result: sum(len(ring) // 2 for ring in rings) for result, rings in data["areas"].items()}
check(area_rows == {"yes": 8475, "no": 1142, "may": 1627}, f"outline vertices: 8,475 found, 1,142 not found, 1,627 uncertain ({area_rows})")
total = sum(points.values()) + 2 * sum(lines.values()) + sum(area_rows.values())
check(total == 17129, f"every coordinate row of the database is kept ({total} of 17,129)")

flat = [v for values in data["points"].values() for v in values]
flat += [v for group in ("lines", "areas") for values in data[group].values() for part in values for v in part]
lons, lats = flat[0::2], flat[1::2]
check(min(lons) >= -180 * q and max(lons) <= 180 * q, f"longitudes in -180..180 ({min(lons) / q} .. {max(lons) / q})")
check(min(lats) >= -90 * q and max(lats) <= 90 * q, f"latitudes in -90..90 ({min(lats) / q} .. {max(lats) / q})")


def distance_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    a, b = math.radians(lat1), math.radians(lat2)
    c = math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(math.radians(lon1 - lon2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def nearest_vertex(rings: list[list[int]], lon: float, lat: float) -> float:
    return min(distance_deg(ring[i] / q, ring[i + 1] / q, lon, lat) for ring in rings for i in range(0, len(ring), 2))


# Study 1's region, under the Gulf of Alaska: looked for and not found.
check(nearest_vertex(data["areas"]["no"], -160.37, 52.74) < 0.01, "Vidale & Benz 1992: an outline of 'no ULVZ' under the Gulf of Alaska at 160.37 W 52.74 N")
check(nearest_vertex(data["areas"]["yes"], -160.37, 52.74) > 5, "and no outline of a ULVZ found within 5 degrees of it")
# Study 11's first path, under Africa: 15.081 E 9.482 N to 24.915 E 9.511 N.
want = (15.081, 9.482, 24.915, 9.511)
check(any(all(abs(got / q - value) <= 0.5 / q + 1e-9 for got, value in zip(line, want)) for line in data["lines"]["yes"]),
      "Helmberger, Ni & Wen 2000: a path with a ULVZ under Africa, 15.081 E 9.482 N to 24.915 E 9.511 N")

mega = {entry["name"]: entry for entry in data["mega"]}
check(list(mega) == ["Hawaiian mega-ULVZ", "Iceland mega-ULVZ", "Samoan mega-ULVZ", "Galápagos mega-ULVZ"], "four mega-ULVZs: Hawaii, Iceland, Samoa, Galápagos")
hawaii, iceland, samoa, galapagos = mega.values()
check(abs(hawaii["widthKm"] - 910) <= 10 and hawaii["heightKm"] == 20 and hawaii["dVsPercent"] == -20,
      f"Hawaii: ~910 km across, 20 km high, S waves -20 %, as the paper's abstract has it ({hawaii['widthKm']:.0f} km measured from the outline)")
# "centered ~11 degrees to the southwest of Hawaii" (same abstract); Kilauea is at 155.3 W 19.4 N.
offset = distance_deg(hawaii["lon"], hawaii["lat"], -155.3, 19.4)
check(9 < offset < 13 and hawaii["lon"] < -155.3 and hawaii["lat"] < 19.4, f"Hawaii: centred {offset:.1f} degrees south-west of the island (the paper: ~11)")
check(distance_deg(iceland["lon"], iceland["lat"], -19.0, 64.9) < 3, f"Iceland: centred under Iceland ({iceland['lon']} E, {iceland['lat']} N)")
check(iceland["heightKm"] == 15 and iceland["dVsPercent"] == -23 and 700 <= iceland["widthKm"] <= 900,
      f"Iceland: {iceland['widthKm']:.0f} km across, 15 km high, S waves -23 % (the database's table)")
check(distance_deg(samoa["lon"], samoa["lat"], -172.1, -13.8) < 7, f"Samoa: centred within 7 degrees of Samoa ({samoa['lon']} E, {samoa['lat']} N)")
check(samoa["size"] == "250 × 800 km, 10–15 km high" and samoa["dVsPercent"] == -45 and samoa["widthKm"] is None,
      "Samoa: 250 x 800 km and 10-15 km thick in the paper's words, S waves -45 %; no width measured from an outline that is not a circle")
check((galapagos["lon"], galapagos["lat"], galapagos["widthKm"], galapagos["heightKm"], galapagos["dVsPercent"]) == (-105.0, 2.0, 600, 20, -25),
      "Galápagos: 105 W 2 N, 600 km, 20 km, -25 %, as Cottaar et al. 2022 give it")
# A mega-ULVZ of the database is drawn by its own outline: it must be there.
for entry in (hawaii, iceland, samoa):
    near = nearest_vertex(data["areas"]["yes"], entry["lon"], entry["lat"])
    check(near < 8, f"{entry['name']}: an outline of a found ULVZ passes within {near:.1f} degrees of its centre")

finish()
