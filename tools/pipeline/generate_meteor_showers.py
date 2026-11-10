#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the year's meteor showers - where
each radiant is on the sky, when it is active, when it peaks and how strong
it usually is.

Source: the International Meteor Organization's Meteor Shower Calendar
(edited by Jürgen Rendtel), Table 5, "Working List of Visual Meteor
Showers": https://www.imo.net/files/meteor-shower/cal2026.pdf
The table gives, per shower: IAU number and code, activity period,
date and solar longitude of maximum, radiant right ascension and
declination at maximum (J2000), entry speed, population index r and the
zenithal hourly rate (ZHR; 'Var' where it varies from year to year).

LICENCE: the calendar carries no licence statement. The figures are facts
about the sky, published by the IMO for observers to use, and are credited
to it in the app; whether the compiled table may be redistributed in this
form has not been confirmed with the IMO.

The table is read from the PDF's text with `pdftotext -layout` (poppler-
utils; not a Python package), and every row must parse: a change in the
calendar's layout stops the script rather than dropping showers.

Output: app/public/space/meteor-showers.json

Usage:
    python3 tools/pipeline/generate_meteor_showers.py
"""

import json
import re
import subprocess
from pathlib import Path

from fetch_cache import cached_fetch

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "space" / "meteor-showers.json"
YEAR = 2026
URL = f"https://www.imo.net/files/meteor-shower/cal{YEAR}.pdf"
MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}

DATE = r"([A-Z][a-z]{2}) (\d\d)"
ROW = re.compile(
    rf"^\s*(?P<name>.+?)\s*\((?P<number>\d{{3}}) (?P<code>[A-Z]{{3}})\)\s+{DATE}–{DATE}\s+"
    rf"\(?{DATE}\)?\s+\(?(?P<lon>\d+)\s*◦\s*(?:\.\s*(?P<lonfrac>\d+))?\s*\)?\s+"
    r"(?P<ra>\d+)◦\s+(?P<dec>[+−-]\d+)◦\s+(?P<speed>\d+)\s+(?P<r>\d\.\d)\s+(?P<zhr>\d+|Var)\s*$"
)

# The calendar abbreviates some names to fit its column.
FULL_NAMES = {
    "Dayt. Arietids": "Daytime Arietids",
    "Dayt. Sextantids": "Daytime Sextantids",
    "S. δ-Aquariids": "Southern δ-Aquariids",
    "S. Taurids": "Southern Taurids",
    "N. Taurids": "Northern Taurids",
    "Sep. ε-Perseids": "September ε-Perseids",
    "Sep. Lyncids": "September Lyncids",
    "Oct. Camelopard.": "October Camelopardalids",
    "Nov. Orionids": "November Orionids",
}


def table_lines() -> list[str]:
    pdf = cached_fetch(URL, f"meteors/cal{YEAR}.pdf")
    text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], check=True, capture_output=True, text=True).stdout
    start = text.index("Table 5. Working List of Visual Meteor Showers")
    # Not the first "Table 6" after it: the Antihelion Source's row says "see Table 6".
    end = text.index("Table 6 (next page)", start)
    return text[start:end].splitlines()


def main() -> None:
    showers = []
    for line in table_lines():
        # Every shower row carries its IAU number and code; the Antihelion Source has neither and is not a shower.
        if not re.search(r"\(\d{3} [A-Z]{3}\)", line):
            continue
        found = ROW.match(line)
        if not found:
            raise SystemExit(f"row not understood: {line!r}")
        g = found.groups()
        name = found.group("name").strip()
        longitude = float(found.group("lon") + ("." + found.group("lonfrac") if found.group("lonfrac") else ""))
        showers.append(
            {
                "code": found.group("code"),
                "iau": int(found.group("number")),
                "name": FULL_NAMES.get(name, name),
                "start": [MONTHS[g[3]], int(g[4])],
                "end": [MONTHS[g[5]], int(g[6])],
                "peak": [MONTHS[g[7]], int(g[8])],
                "solarLongitude": longitude,
                "ra": int(found.group("ra")),
                "dec": int(found.group("dec").replace("−", "-")),
                "speedKmS": int(found.group("speed")),
                "r": float(found.group("r")),
                "zhr": None if found.group("zhr") == "Var" else int(found.group("zhr")),
            }
        )
    if len(showers) < 30:
        raise SystemExit(f"only {len(showers)} showers found: the table has moved")
    data = {
        "source": f"International Meteor Organization, {YEAR} Meteor Shower Calendar (ed. J. Rendtel), Table 5: Working List of Visual Meteor Showers",
        "url": URL,
        "year": YEAR,
        "showers": showers,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for shower in showers:
        print(f"{shower['code']} {shower['name']:28s} {shower['start']} - {shower['end']} peak {shower['peak']} λ {shower['solarLongitude']:7.2f} α {shower['ra']:3d} δ {shower['dec']:+3d} ZHR {shower['zhr']}")
    print(f"{len(showers)} showers, {OUTPUT.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
