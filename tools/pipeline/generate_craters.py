#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: impact craters.

Writes app/public/geo/craters.json: the proven impact structures of the
Earth with their position, diameter and age, from Table 1 of

    Schmieder, M. & Kring, D.A. (2020), Earth's Impact Events Through
    Geologic Time: A List of Recommended Ages for Terrestrial Impact
    Structures and Deposits, Astrobiology 20(1), 91-141,
    doi:10.1089/ast.2019.2085 (open access, CC BY 4.0),

read from the article's full text at Europe PMC (PMC6987741). The table
lists 200 structures; every one is kept as the paper gives it except:

  - the eight smaller than MIN_DIAMETER_KM (recent falls such as
    Chelyabinsk's hole in lake ice and Carancas' 13 m pit), which are
    not craters one can point at on a globe;
  - nothing else. Positions are the paper's, to the arc minute.

Ages are the paper's "recommended age" in millions of years, kept as the
text it prints (e.g. "66.052 ± 0.043", "~100", "<360") beside the first
number in it for sorting. Diameters likewise: where the paper gives a
range the text keeps it and the number drawn is its smaller end (see
diameter_km).

Output:

    {source, craters: [{name, country, lon, lat, diameterKm, diameterText, ageMa, ageText}]}

sorted by diameter, largest first.

Usage:
    python3 tools/pipeline/generate_craters.py
"""

import html
import re
import sys
from pathlib import Path

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

ARTICLE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6987741/fullTextXML"
MIN_DIAMETER_KM = 0.1
NUMBER = r"\d+(?:\.\d+)?"


def cell_text(cell: str) -> str:
    """A table cell without markup or footnote letters."""
    cell = re.sub(r"<sup>.*?</sup>", "", cell, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", "", cell))
    return re.sub(r"\s+", " ", text.replace(" ", " ").replace(" ", " ")).strip()


def table_rows(xml: str) -> list[list[str]]:
    table = next(t for t in re.findall(r"<table-wrap.*?</table-wrap>", xml, flags=re.S)
                 if "List of Proven Terrestrial Impact Structures" in t)
    rows = []
    for row in re.findall(r"<tr.*?</tr>", table, flags=re.S):
        rows.append([cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S)])
    return rows


def dms(text: str) -> float:
    """"16°40′S" -> -16.667: degrees, minutes and sometimes seconds, with a hemisphere letter.

    The table's cells are not uniform ("S27°46′", "N 48°21′", "14°33.84′E",
    "60°08′20′′N", and two with a stray letter, "91°46′WW" and "25°22.5′CE"),
    so this reads the numbers in order and the one hemisphere letter present.
    """
    numbers = [float(n) for n in re.findall(NUMBER, text)]
    hemispheres = set(re.findall(r"[NSEW]", text))
    if not 1 <= len(numbers) <= 3 or len(hemispheres) != 1:
        raise ValueError(f"unreadable coordinate {text!r}")
    value = sum(n / 60 ** i for i, n in enumerate(numbers))
    return -value if hemispheres & {"S", "W"} else value


def diameter_km(text: str) -> float:
    """The diameter to draw: the one number given, or of a range ("160-300") the smaller,
    which is the size the structure certainly has."""
    numbers = [float(n) for n in re.findall(NUMBER, text)]
    if not numbers:
        raise ValueError(f"no diameter in {text!r}")
    return min(numbers[:2]) if re.search(rf"{NUMBER}\s*[–-]\s*{NUMBER}", text) else numbers[0]


def age_ma(text: str) -> float | None:
    match = re.search(NUMBER, text)
    return float(match.group(0)) if match else None


def build(xml: str) -> list[dict]:
    rows = table_rows(xml)
    header = rows[0]
    column = {name: header.index(name) for name in
              ("Impact structure", "Country", "Latitude", "Longitude", "Diameter (km)", "Recommended age (Ma)")}
    craters = []
    for row in rows[1:]:
        if len(row) != len(header) or not row[column["Latitude"]]:
            continue
        diameter_text = row[column["Diameter (km)"]]
        diameter = diameter_km(diameter_text)
        if diameter < MIN_DIAMETER_KM:
            continue
        age_text = row[column["Recommended age (Ma)"]].replace("∼", "~")
        craters.append({
            "name": row[column["Impact structure"]],
            "country": row[column["Country"]],
            "lon": round(dms(row[column["Longitude"]]), 3),
            "lat": round(dms(row[column["Latitude"]]), 3),
            "diameterKm": diameter,
            "diameterText": diameter_text.replace("∼", "~"),
            "ageMa": age_ma(age_text),
            "ageText": age_text,
        })
    craters.sort(key=lambda c: (-c["diameterKm"], c["name"]))
    return craters


def load_article() -> str:
    return Path(cached_fetch(ARTICLE_URL, "craters/schmieder-kring-2020.xml")).read_text(encoding="utf-8")


def main() -> None:
    craters = build(load_article())
    write_json(OUTPUT_DIR / "craters.json", {
        "source": "Schmieder & Kring (2020), Astrobiology 20, 91, doi:10.1089/ast.2019.2085, Table 1 (CC BY 4.0)",
        "minDiameterKm": MIN_DIAMETER_KM,
        "craters": craters,
    })
    print(f"{len(craters)} impact structures of {MIN_DIAMETER_KM} km or more; largest: "
          + ", ".join(f"{c['name']} {c['diameterText']} km" for c in craters[:6]), file=sys.stderr)


if __name__ == "__main__":
    main()
