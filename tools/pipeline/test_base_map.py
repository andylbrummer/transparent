#!/usr/bin/env python3
"""
Data checks for generate_base_map.py's output: the offline Blue Marble is
the right size, the right way up and the right way round.

Usage:
    python3 tools/pipeline/test_base_map.py
"""

from PIL import Image

from generate_base_map import HEIGHT, OUTPUT, WIDTH
from geo_test_support import check, finish


def main() -> None:
    image = Image.open(OUTPUT).convert("RGB")
    check(image.size == (WIDTH, HEIGHT), f"{WIDTH}x{HEIGHT}, as the app's shader expects of an equirectangular map")
    check(OUTPUT.stat().st_size < 700_000, f"under 700 kB ({OUTPUT.stat().st_size} bytes)")

    def at(lon: float, lat: float) -> tuple[int, int, int]:
        x = min(WIDTH - 1, int((lon + 180) / 360 * WIDTH))
        y = min(HEIGHT - 1, int((90 - lat) / 180 * HEIGHT))
        return image.getpixel((x, y))

    def is_sea(rgb: tuple[int, int, int]) -> bool:
        r, g, b = rgb
        return b > r and b >= g and r < 60

    # Longitude -180..180 left to right, north up: places only one orientation satisfies.
    sahara = at(10, 23)
    check(sahara[0] > 150 and sahara[0] > sahara[2] + 40, f"the Sahara (10E 23N) is sand-coloured {sahara}")
    check(is_sea(at(-140, 0)), f"the equatorial Pacific (140W 0N) is sea {at(-140, 0)}")
    check(is_sea(at(75, -30)), f"the southern Indian Ocean (75E 30S) is sea {at(75, -30)}")
    antarctica = at(90, -80)
    check(min(antarctica) > 180, f"East Antarctica (90E 80S) is ice {antarctica}")
    amazon = at(-62, -5)
    check(amazon[1] > amazon[0] and amazon[1] > amazon[2] and max(amazon) < 130, f"the Amazon (62W 5S) is dark green {amazon}")
    check(not is_sea(at(135, -25)) and at(135, -25)[0] > 100, f"central Australia (135E 25S) is red land {at(135, -25)}")
    finish()


if __name__ == "__main__":
    main()
