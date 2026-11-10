#!/usr/bin/env python3
"""
Data checks for the Antarctic ice thickness and bed (generate_antarctic_ice.py).

Reads only the baked files, so it needs neither the 2.5 GB download nor
h5py. Known places are pinned to known figures from outside Bedmap3:
ice-core drilling depths, the published record thickness, and places that
are open sea or bare rock.

Usage:
    python3 tools/pipeline/test_antarctic_ice.py
"""

import json
from pathlib import Path

from PIL import Image

from geo_test_support import check, finish

OUT_DIR = Path(__file__).resolve().parents[2] / "app" / "public" / "geo"


def main() -> None:
    document = json.loads((OUT_DIR / "antarctic-ice.json").read_text())
    strip = document["strip"]
    thickness_image = Image.open(OUT_DIR / "antarctic-ice-thickness.png").convert("LA")
    bed_image = Image.open(OUT_DIR / "antarctic-bed.png").convert("LA")
    check(thickness_image.size == (strip["width"], strip["height"]) == bed_image.size, f"both strips are {strip['width']}x{strip['height']}")

    def pixel(lon: float, lat: float) -> tuple[int, int]:
        x = int((lon + 180.0) / 360.0 * strip["width"]) % strip["width"]
        y = int((lat - strip["latTop"]) / (strip["latBottom"] - strip["latTop"]) * strip["height"])
        return x, min(max(y, 0), strip["height"] - 1)

    def thickness(lon: float, lat: float) -> tuple[float, int]:
        grey, alpha = thickness_image.getpixel(pixel(lon, lat))
        return grey * document["thickness"]["stepM"] + document["thickness"]["offsetM"], alpha

    def bed(lon: float, lat: float) -> tuple[float, int]:
        grey, alpha = bed_image.getpixel(pixel(lon, lat))
        return grey * document["bed"]["stepM"] + document["bed"]["offsetM"], alpha

    # Wide brackets round widely reported figures, as a guard on placement rather than a measurement:
    # the Vostok borehole met the lake at about 3,770 m, the EPICA Dome C core is about 3,260 m long and
    # stopped just above the bed, and the ice at the South Pole is about 2,800 m thick.
    for name, lon, lat, low, high in [
        ("Vostok station", 106.84, -78.46, 3550, 3950),
        ("Dome C (Concordia)", 123.35, -75.10, 3100, 3400),
        ("South Pole", 0.0, -89.95, 2600, 2950),
        ("Ross Ice Shelf", -175.0, -81.5, 200, 800),
        ("Ronne Ice Shelf", -62.0, -78.5, 300, 1500),
    ]:
        metres, alpha = thickness(lon, lat)
        check(alpha > 200 and low <= metres <= high, f"{name}: ice {low}-{high} m thick (got {metres:.0f} m, cover {alpha / 255:.0%})")

    for name, lon, lat in [("Southern Ocean at 60S 0E", 0.0, -60.5), ("Drake Passage", -65.0, -59.0), ("Ross Sea off Cape Adare", 175.0, -70.0)]:
        _, alpha = thickness(lon, lat)
        check(alpha == 0, f"{name}: no ice sheet")

    vostok_bed, _ = bed(106.84, -78.46)
    check(-700 < vostok_bed < 0, f"the bed at Vostok is below sea level, under the lake's ice (got {vostok_bed:.0f} m)")
    # The trench is a long trough about 80 S, 105-120 W; its floor is given as about 2,500 m below sea level.
    bentley = min(bed(-120.0 + 0.5 * i, -81.5 + 0.25 * j)[0] for i in range(31) for j in range(13))
    check(bentley < -2000, f"Bentley Subglacial Trench reaches more than 2,000 m below sea level (got {bentley:.0f} m)")
    gamburtsev, _ = bed(76.0, -80.5)
    check(gamburtsev > 1500, f"the Gamburtsev Subglacial Mountains stand over 1,500 m above sea level under the ice (got {gamburtsev:.0f} m)")

    # The record of the full grid, as the Bedmap3 paper gives it (Pritchard et al. 2025, Sci. Data 12, 414):
    # 4,757 m at 76.052 S, 118.378 E.
    thickest = document["thickestIce"]
    check(thickest["metres"] == 4757, f"thickest ice is 4,757 m (got {thickest['metres']})")
    check(
        abs(thickest["lat"] + 76.052) < 0.01 and abs(thickest["lon"] - 118.378) < 0.01,
        f"and lies at 76.052S 118.378E (got {thickest['lat']}, {thickest['lon']})",
    )
    near, _ = thickness(thickest["lon"], thickest["lat"])
    check(near > 4000, f"the strip is over 4,000 m thick there after averaging to 4 km (got {near:.0f} m)")
    deepest = document["deepestBedUnderGroundedIce"]
    check(-3600 < deepest["metres"] < -2500, f"deepest bed under grounded ice is 2.5-3.6 km below sea level (got {deepest['metres']})")
    check(1850 < document["meanThicknessM"] < 2050, f"mean thickness of all the ice is about 1.95 km (got {document['meanThicknessM']})")
    check(13.0e6 < document["nominalIceAreaKm2"] < 14.2e6, f"about 13.6 million km2 under ice (got {document['nominalIceAreaKm2']})")

    for name in ("antarctic-ice-thickness.png", "antarctic-bed.png"):
        size = (OUT_DIR / name).stat().st_size
        check(size < 500_000, f"{name} is under 500 KB ({size})")


if __name__ == "__main__":
    main()
    finish()
