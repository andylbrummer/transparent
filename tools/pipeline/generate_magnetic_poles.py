#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: where the magnetic poles have been.

Writes app/public/geo/magnetic-poles.json: the north and south magnetic
(dip) poles - where the field is vertical and a compass needle would point
straight down - for every year from 1590 to 2025 as NOAA NCEI computes
them from field models ("IGRF Pole Locations (1590-2025)" on its
Wandering of the Geomagnetic Poles page; the International Geomagnetic
Reference Field begins in 1900, and the page does not say which historical
model stands before it), and NOAA's own forecast for 2025-2030 from the
World Magnetic Model 2025.

These are modelled positions, not surveyed ones: nobody stood at the pole
in 1590. The few surveyed positions (Ross 1831, Amundsen 1904, the
Canadian surveys) are shown on NOAA's map but not published as a file, so
they are not here.

Source: NOAA National Centers for Environmental Information,
https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles
U.S. Government work, public domain.

Usage:
    python3 tools/pipeline/generate_magnetic_poles.py

Raw downloads are cached in tools/pipeline/.cache/. Standard library only.
"""

import json
from pathlib import Path

from fetch_cache import cached_fetch

MODEL_URLS = {
    "north": "https://www.ngdc.noaa.gov/geomag/data/poles/NP.xy",
    "south": "https://www.ngdc.noaa.gov/geomag/data/poles/SP.xy",
}
FORECAST_URLS = {
    "north": "https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025_NP.txt",
    "south": "https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025_SP.txt",
}

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "geo" / "magnetic-poles.json"


def read(url: str, name: str) -> list[list[float]]:
    """Rows of [year, longitude east in -180..180, latitude], as the files give them: longitude latitude year."""
    rows = []
    for line in cached_fetch(url, name).read_text().splitlines():
        cells = line.split()
        if len(cells) != 3:
            continue
        lon, lat, year = (float(cell) for cell in cells)
        assert year == int(year), f"{name}: fractional year {year}"
        rows.append([int(year), round((lon + 180) % 360 - 180, 3), round(lat, 3)])
    return rows


def main() -> None:
    poles = {}
    for hemisphere in ("north", "south"):
        poles[hemisphere] = {
            "model": read(MODEL_URLS[hemisphere], f"magnetic-pole-{hemisphere}.xy"),
            "forecast": read(FORECAST_URLS[hemisphere], f"magnetic-pole-{hemisphere}-wmm2025.txt"),
        }
    data = {
        "source": "NOAA NCEI, Wandering of the Geomagnetic Poles: IGRF pole locations 1590-2025 and WMM2025 pole locations 2025-2030",
        "columns": ["year", "longitude", "latitude"],
        **poles,
    }
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    count = sum(len(track) for pole in poles.values() for track in pole.values())
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB), {count} positions")


if __name__ == "__main__":
    main()
