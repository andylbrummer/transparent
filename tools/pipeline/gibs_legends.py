#!/usr/bin/env python3
"""
Print the layers panel's legends for the NASA GIBS data products the app shows.

GIBS draws each data product with a published colour map
(https://gibs.earthdata.nasa.gov/colormaps/v1.3/<name>.xml). The app shows the
images as GIBS renders them, so its legends must be those same colours: this
script reduces each colour map to a CSS gradient of a few stops and prints it
with the map's value range, for pasting into the layer definitions
(app/src/layers/weather/layer.ts, app/src/layers/surface-imagery/layer.ts).
Nothing here is typed in by hand.

Usage:
    python3 tools/pipeline/gibs_legends.py

Standard library only; colour maps are cached in tools/pipeline/.cache/.
"""

import html
import re

from fetch_cache import cached_fetch

COLORMAP_URL = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/{name}.xml"

#: label -> (colour map file, title of the ColorMap element inside it)
LEGENDS = {
    "precipitation (rain)": ("GPM_Precipitation_Rate", "Rain Rate"),
    "precipitation (snow)": ("GPM_Precipitation_Rate", "Snow Rate"),
    "sea surface temperature": ("GHRSST_Sea_Surface_Temperature", "Sea Surface Temperature"),
    "sea surface temperature anomaly": ("GHRSST_Sea_Surface_Temperature_Anomalies", "Sea Surface Temperature Anomaly"),
    "vegetation index": ("MODIS_L3_NDVI", "Vegetation Indices"),
    "population density": ("GPW_Population_Density_2020", "Population Density"),
}
STOPS = 9


def colour_map(name: str, title: str) -> tuple[list[tuple[int, int, int]], str, str, str]:
    """(colours in order, units, label of the low end, label of the high end)."""
    text = cached_fetch(COLORMAP_URL.format(name=name), f"gibs_colormap_{name}.xml").read_text(encoding="utf-8")
    block = re.search(rf'<ColorMap title="{re.escape(title)}"([^>]*)>(.*?)</ColorMap>', text, re.S)
    if not block:
        raise RuntimeError(f"{name}: no colour map titled {title!r}")
    units = re.search(r'units="([^"]*)"', block.group(1))
    legend = re.search(r'<Legend type="continuous"([^>]*)>(.*?)</Legend>', block.group(2), re.S)
    if not legend:
        raise RuntimeError(f"{name}/{title}: no continuous legend")
    colours = [tuple(int(c) for c in rgb.split(",")) for rgb in re.findall(r'<LegendEntry rgb="([^"]+)"', legend.group(2))]
    low = re.search(r'minLabel="([^"]*)"', legend.group(1))
    high = re.search(r'maxLabel="([^"]*)"', legend.group(1))
    return colours, html.unescape(units.group(1)) if units else "", html.unescape(low.group(1)), html.unescape(high.group(1))


def gradient(colours: list[tuple[int, int, int]], stops: int = STOPS) -> str:
    picks = [colours[round(i * (len(colours) - 1) / (stops - 1))] for i in range(stops)]
    return "linear-gradient(to right, " + ", ".join("#%02x%02x%02x" % c for c in picks) + ")"


def main() -> None:
    for label, (name, title) in LEGENDS.items():
        colours, units, low, high = colour_map(name, title)
        print(f"{label}: {low} .. {high} {units} ({len(colours)} colours)")
        print(f"  {gradient(colours)}")


if __name__ == "__main__":
    main()
