#!/usr/bin/env python3
"""
Data checks for the baked lightning overlay (generate_overlay_snapshot.py).

The image holds GIBS's palette, so a pixel's colour can be read back to a
flash rate through the product's colour map. The checks put the planet's
lightning where it is known to be: most over the Congo basin and Lake
Maracaibo, little over the open ocean, none recorded poleward of what the
instruments covered.

Usage:
    python3 tools/pipeline/test_overlay_snapshot.py
"""

from PIL import Image

from generate_overlay_snapshot import OUT
from geo_test_support import check, finish
from gibs_overlay_legends import colour_maps

COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/LIS_High_Resolution_Full_Climatology_Combined_Flash_Rate_Climatology.xml"


def main() -> None:
    image = Image.open(OUT).convert("RGBA")
    check(image.size == (1024, 512), f"1024x512 (got {image.size})")
    flash_rate = next(m for m in colour_maps(COLORMAP) if m["title"] == "Lightning Flash Rate")
    check(flash_rate["units"] == "Flashes/km²/year", f"colour map is in flashes per km2 per year ({flash_rate['units']})")
    index = {rgb: i for i, (rgb, _) in enumerate(flash_rate["entries"])}
    top = len(index) - 1

    def level(lon: float, lat: float, reach: int = 2) -> float:
        """Highest palette position (0..1) within `reach` pixels of the place; -1 where there is no data."""
        cx = int((lon + 180) / 360 * image.width)
        cy = int((90 - lat) / 180 * image.height)
        best = -1.0
        for y in range(cy - reach, cy + reach + 1):
            for x in range(cx - reach, cx + reach + 1):
                r, g, b, a = image.getpixel((x % image.width, min(max(y, 0), image.height - 1)))
                if a > 0 and (r, g, b) in index:
                    best = max(best, index[(r, g, b)] / top)
        return best

    raw = image.tobytes()
    pixels = [tuple(raw[i : i + 4]) for i in range(0, len(raw), 4)]
    total = sum(1 for _, _, _, a in pixels if a > 0)
    opaque = total / len(pixels)
    check(0.3 < opaque < 0.95, f"part of the globe has data, part has none ({opaque:.0%} opaque)")
    known = sum(1 for r, g, b, a in pixels if a > 0 and (r, g, b) in index)
    check(known / total > 0.99, f"opaque pixels are colours of the product's colour map ({known / total:.1%})")

    congo = level(28.0, -1.5)
    maracaibo = level(-71.5, 9.5)
    florida = level(-81.5, 27.0)
    pacific = level(-140.0, -20.0)
    sahara = level(25.0, 24.0)
    check(congo > 0.5, f"eastern Congo basin is in the upper half of the scale ({congo:.2f})")
    check(maracaibo > 0.5, f"Lake Maracaibo is in the upper half of the scale ({maracaibo:.2f})")
    check(florida > pacific + 0.2, f"Florida ({florida:.2f}) far above the open South Pacific ({pacific:.2f})")
    check(congo > sahara + 0.3, f"Congo ({congo:.2f}) far above the eastern Sahara ({sahara:.2f})")
    check(level(0.0, 85.0) < 0 and level(0.0, -85.0) < 0, "nothing poleward of the instruments' reach")


if __name__ == "__main__":
    main()
    finish()
