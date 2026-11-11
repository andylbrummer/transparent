#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the world's major mineral deposits.

Writes app/public/geo/mineral-deposits.json: 3,161 deposits of the major
non-fuel mineral commodities, each with its name, place, the commodities
it is worked for, its geological setting and a commodity group for the
colour.

Source:

    Schulz, K.J. & Briskey, J.A. (compilers), Major mineral deposits of the
    world, U.S. Geological Survey Open-File Report 2005-1294,
    https://mrdata.usgs.gov/major-deposits/ - five regional compilations
    "combined here for convenience despite likely inconsistencies among
    the regional reports". Public domain (U.S. Government work; the
    metadata's Use_Constraints: none).

What it is not: a list of mines by size. The file has no tonnages or
grades, so nothing here is sized; positions are "near the deposits they
describe" (the metadata), not their outlines. Fuels (coal, oil, gas,
uranium as a fuel) are outside its scope, though uranium appears as a
by-product.

The group is the deposit's first-listed commodity (commodity.csv keeps
them in the order the compilers wrote them):

    precious    gold, silver, platinum-group metals
    base        copper, lead, zinc, nickel, cobalt, molybdenum
    steel       iron, manganese, chromium, vanadium, tungsten
    aluminium   bauxite (Al)
    critical    lithium, rare earths, niobium, tantalum, tin, titanium,
                zirconium, beryllium, uranium, antimony, mercury and
                the other minor metals
    gems        diamond and the gemstones
    industrial  everything else: phosphate, potash, salt, gypsum, clays,
                fluorspar, barite, graphite, asbestos, borates...

Seven of the 3,168 records have no position and are left out.

Output: {source, deposits: [[name, country, lat, lon, group, commodities, setting], ...]}
with commodities as the compilers wrote them, sorted by group then name.

Usage:
    python3 tools/pipeline/generate_mineral_deposits.py
"""

import csv
import io
import sys
import zipfile
from collections import Counter, defaultdict

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

ZIP_URL = "https://mrdata.usgs.gov/major-deposits/ofr20051294-csv.zip"
CACHE_NAME = "subsurface/ofr20051294-csv.zip"

GROUPS = ("precious", "base", "steel", "aluminium", "critical", "gems", "industrial")
GROUP_OF_CODE = {
    **dict.fromkeys(["Au", "Ag", "PGE", "Pt", "Pd", "Rh", "Os", "Ir", "Ru"], "precious"),
    **dict.fromkeys(["Cu", "Pb", "Zn", "Ni", "Co", "Mo", "Cd"], "base"),
    **dict.fromkeys(["Fe", "Mn", "Cr", "V", "W"], "steel"),
    "Al": "aluminium",
    **dict.fromkeys(["Li", "REE", "Nb", "Ta", "Sn", "Ti", "Zr", "Be", "U", "Sb", "Hg", "Bi", "Ge", "Ga", "In", "Cs", "Rb",
                     "Sc", "Y", "Hf", "Te", "Se", "Th", "Mg", "Sr", "Re", "Tl", "As"], "critical"),
}
GEM_WORDS = ("diamond", "emerald", "ruby", "sapphire", "opal", "kunzite", "lapis", "tourmaline", "jade", "topaz", "garnet",
             "aquamarine", "tanzanite", "beryl", "gem", "amethyst", "chrysoberyl", "spinel", "turquoise", "peridot")


def group_of(code: str) -> str:
    if code in GROUP_OF_CODE:
        return GROUP_OF_CODE[code]
    if any(word in code.lower() for word in GEM_WORDS):
        return "gems"
    return "industrial"


def read(path) -> tuple[list[dict], dict[str, list[str]]]:
    with zipfile.ZipFile(path) as archive:
        deposits = list(csv.DictReader(io.StringIO(archive.read("ofr20051294/deposit.csv").decode("latin-1"))))
        codes: dict[str, list[str]] = defaultdict(list)
        for row in csv.DictReader(io.StringIO(archive.read("ofr20051294/commodity.csv").decode("latin-1"))):
            codes[row["gid"]].append(row["value"].strip())
    return deposits, codes


def build(deposits: list[dict], codes: dict[str, list[str]]) -> list[list]:
    out = []
    for row in deposits:
        # Seven records (US industrial minerals) carry no position at all: left out.
        if not row["latitude"] or not row["longitude"]:
            continue
        lat, lon = float(row["latitude"]), float(row["longitude"])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f"bad position for {row['dep_name']}: {lat}, {lon}")
        first = codes.get(row["gid"], ["?"])[0]
        out.append([row["dep_name"].strip(), row["country"].strip(), round(lat, 4), round(lon, 4), group_of(first),
                    row["commodity"].strip(), row["dep_type"].strip()])
    out.sort(key=lambda d: (GROUPS.index(d[4]), d[0]))
    return out


def main() -> None:
    deposits, codes = read(cached_fetch(ZIP_URL, CACHE_NAME))
    rows = build(deposits, codes)
    write_json(OUTPUT_DIR / "mineral-deposits.json", {
        "source": "Major mineral deposits of the world, USGS Open-File Report 2005-1294 (public domain)",
        "groups": list(GROUPS),
        "deposits": rows,
    })
    print(f"{len(rows)} deposits: " + ", ".join(f"{g} {n}" for g, n in Counter(d[4] for d in rows).most_common()), file=sys.stderr)


if __name__ == "__main__":
    main()
