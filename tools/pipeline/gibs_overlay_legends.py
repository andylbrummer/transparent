#!/usr/bin/env python3
"""
Check the NASA GIBS products behind the Earth-overlay layers and print their legends.

For every product in app/src/layers/earth-overlays/layer.ts this reads the
GIBS WMTS capabilities (the authority on which layer identifiers exist and
what dates each has), follows the product's own colour-map link, and prints:

  * the product's title and the newest date in its time domain,
  * for each colour map in the file: the value range, the units, and a CSS
    gradient of nine stops taken from the map's legend entries.

The gradients and ranges are pasted into the layer definitions, so the
legend in the panel is the colour map GIBS draws the image with; nothing is
typed in by hand. The script fails if a product has gone from the
capabilities, which is the check to run before adding or renaming one.

Usage:
    python3 tools/pipeline/gibs_overlay_legends.py [--refresh]

Standard library only. Capabilities (5 MB) and colour maps are cached in
tools/pipeline/.cache/; --refresh downloads the capabilities again.
"""

import html
import re
import sys

from fetch_cache import CACHE_DIR, cached_fetch
from gibs_legends import gradient

CAPABILITIES_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities"
CAPABILITIES_FILE = "gibs_caps.xml"

#: layer id in the app -> GIBS product identifier
PRODUCTS = {
    "overlay-sea-ice": "GHRSST_L4_MUR25_Sea_Ice_Concentration",
    "overlay-snow": "MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct",
    "overlay-fires": "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
    "overlay-aerosol": "MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly",
    "overlay-no2": "TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column",
    "overlay-carbon-monoxide": "AIRS_L3_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Monthly_Day",
    "overlay-ozone": "OMPS_Ozone_Total_Column",
    "overlay-water-vapour": "MERRA2_Total_Precipitable_Water_Vapor_Monthly",
    "overlay-soil-moisture": "SMAP_L4_Analyzed_Surface_Soil_Moisture",
    "overlay-lightning": "LIS_High_Resolution_Full_Climatology_Combined_Flash_Rate_Climatology",
}


def capabilities(refresh: bool) -> dict[str, str]:
    """Product identifier -> its <Layer> element."""
    if refresh:
        (CACHE_DIR / CAPABILITIES_FILE).unlink(missing_ok=True)
    text = cached_fetch(CAPABILITIES_URL, CAPABILITIES_FILE).read_text(encoding="utf-8")
    layers = {}
    for block in re.findall(r"<Layer>(.*?)</Layer>", text, re.S):
        identifier = re.search(r"<ows:Identifier>([^<]+)", block)
        if identifier:
            layers[identifier.group(1)] = block
    return layers


def describe(product: str, block: str) -> dict:
    title = html.unescape(re.search(r"<ows:Title[^>]*>([^<]+)", block).group(1)).strip()
    periods = re.findall(r"<Value>([^<]+)</Value>", block)
    colormap = re.search(r"href='(https://gibs\.earthdata\.nasa\.gov/colormaps/v1\.3/[^']+)'", block)
    return {
        "title": title,
        "first": periods[0].split("/")[0] if periods else None,
        "last": periods[-1].split("/")[1] if periods else None,
        "step": periods[-1].split("/")[2] if periods else None,
        "colormap": colormap.group(1) if colormap else None,
    }


def colour_maps(url: str) -> list[dict]:
    """Every colour map of a file that has a legend: title, units, legend type, entries (rgb, tooltip)."""
    name = url.rsplit("/", 1)[1]
    text = cached_fetch(url, f"gibs_colormap_{name}").read_text(encoding="utf-8")
    maps = []
    for attributes, body in re.findall(r"<ColorMap([^>]*)>(.*?)</ColorMap>", text, re.S):
        legend = re.search(r"<Legend([^>]*)>(.*?)</Legend>", body, re.S)
        if not legend:
            continue
        title = re.search(r'title="([^"]*)"', attributes)
        units = re.search(r'units="([^"]*)"', attributes)
        kind = re.search(r'type="([^"]*)"', legend.group(1))
        low = re.search(r'minLabel="([^"]*)"', legend.group(1))
        high = re.search(r'maxLabel="([^"]*)"', legend.group(1))
        entries = [
            (tuple(int(c) for c in rgb.split(",")), html.unescape(tip))
            for rgb, tip in re.findall(r'<LegendEntry rgb="([^"]+)" tooltip="([^"]*)"', legend.group(2))
        ]
        maps.append(
            {
                "title": html.unescape(title.group(1)) if title else "",
                "units": html.unescape(units.group(1)) if units else "",
                "kind": kind.group(1) if kind else "",
                "low": html.unescape(low.group(1)) if low else (entries[0][1] if entries else ""),
                "high": html.unescape(high.group(1)) if high else (entries[-1][1] if entries else ""),
                "entries": entries,
            }
        )
    return maps


def main() -> None:
    layers = capabilities("--refresh" in sys.argv)
    missing = [product for product in PRODUCTS.values() if product not in layers]
    if missing:
        raise SystemExit(f"not in the GIBS capabilities: {', '.join(missing)}")
    for layer_id, product in PRODUCTS.items():
        info = describe(product, layers[product])
        print(f"{layer_id}: {product}")
        print(f"  {info['title']}")
        print(f"  dates {info['first']} .. {info['last']} step {info['step']}")
        if not info["colormap"]:
            print("  no colour map")
            continue
        for colour_map in colour_maps(info["colormap"]):
            colours = [rgb for rgb, _ in colour_map["entries"]]
            print(
                f"  [{colour_map['title']}] {colour_map['kind']}: {colour_map['low']} .. {colour_map['high']} "
                f"{colour_map['units']} ({len(colours)} colours)"
            )
            if colour_map["kind"] in ("continuous", "discrete") and len(colours) > 8:
                print(f"    {gradient(colours)}")
            else:
                for rgb, tip in colour_map["entries"][:8]:
                    print("    #%02x%02x%02x %s" % (*rgb, tip))


if __name__ == "__main__":
    main()
