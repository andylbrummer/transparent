#!/usr/bin/env python3
"""
Data checks for generate_moon.py's output: the map is the right way round.

A lunar map that is mirrored or shifted in longitude still looks like a
Moon, so the check is by named features at their selenographic
coordinates (IAU Gazetteer of Planetary Nomenclature, planetarynames.wr.usgs.gov):
dark maria against the bright highlands beside them.

Usage:
    python3 tools/pipeline/test_moon.py
"""

from PIL import Image

from generate_moon import HEIGHT, OUTPUT, WIDTH
from geo_test_support import check, finish


def main() -> None:
    image = Image.open(OUTPUT).convert("L")
    check(image.size == (WIDTH, HEIGHT), f"{image.size[0]}x{image.size[1]} plate carree")
    pixels = image.load()

    def brightness(lon: float, lat: float, half: int = 4) -> float:
        """Mean level around selenographic (lon east-positive, lat), longitude 0 at the centre."""
        x = round(WIDTH / 2 + lon / 360 * WIDTH)
        y = round(HEIGHT / 2 - lat / 180 * HEIGHT)
        values = [pixels[(x + dx) % WIDTH, y + dy] for dx in range(-half, half + 1) for dy in range(-half, half + 1)]
        return sum(values) / len(values)

    # (mare, lon, lat), (highland beside it, lon, lat)
    pairs = [
        (("Mare Crisium", 59.1, 17.0), ("the highlands north of it", 59.1, 38.0)),
        (("Mare Imbrium", -15.6, 32.8), ("the northern highlands", -15.6, 65.0)),
        (("Mare Tranquillitatis", 31.4, 8.5), ("the highlands by Theophilus", 31.4, -25.0)),
        (("Oceanus Procellarum", -57.4, 18.4), ("the western limb highlands", -85.0, 40.0)),
        (("Grimaldi", -68.6, -5.2), ("the highlands west of it", -80.0, -5.2)),
        (("Mare Moscoviense, on the far side", 147.9, 27.3), ("the far-side highlands", 147.9, 5.0)),
    ]
    for (dark_name, dark_lon, dark_lat), (bright_name, bright_lon, bright_lat) in pairs:
        dark = brightness(dark_lon, dark_lat)
        bright = brightness(bright_lon, bright_lat)
        check(dark < bright - 15, f"{dark_name} ({dark:.0f}) is darker than {bright_name} ({bright:.0f})")

    # A map mirrored east-west would swap these two.
    grimaldi = brightness(-68.6, -5.2)
    opposite = brightness(68.6, -5.2)
    check(grimaldi < opposite - 15, f"Grimaldi's dark floor is in the west ({grimaldi:.0f}), highlands at the same place east ({opposite:.0f})")
    tycho = brightness(-11.2, -43.3, 2)
    check(tycho > 200, f"Tycho (11.2 W, 43.3 S) is a bright spot ({tycho:.0f})")
    near = sum(brightness(lon, 20) for lon in range(-60, 61, 10)) / 13
    far = sum(brightness(lon, 20) for lon in range(120, 241, 10)) / 13
    check(near < far - 15, f"the near side, with its maria, is darker ({near:.0f}) than the far side ({far:.0f})")

    finish()


if __name__ == "__main__":
    main()
