#!/usr/bin/env python3
"""
Data checks for generate_planet_maps.py's output.

Mars: a map mirrored or shifted in longitude still looks like Mars, so the
check is by named features at their coordinates (IAU Gazetteer of
Planetary Nomenclature, planetarynames.wr.usgs.gov; east longitude):
dark albedo features against the bright deserts beside them, and the
polar caps.

The giants: belts and zones run east-west, so each row varies far less
along itself than the rows differ from one another; and Jupiter's
equatorial zone is brighter than the belts on either side of it.

Usage:
    python3 tools/pipeline/test_planet_maps.py
"""

from PIL import Image

from generate_planet_maps import MAPS, OUTPUT_DIR
from geo_test_support import check, finish


def main() -> None:
    images = {}
    for planet, (_, width) in MAPS.items():
        path = OUTPUT_DIR / f"{planet}.jpg"
        image = Image.open(path).convert("L")
        images[planet] = image
        check(image.size == (width, width // 2), f"{planet}: {image.size[0]}x{image.size[1]} plate carree")
        check(path.stat().st_size < 160_000, f"{planet}: {path.stat().st_size / 1024:.0f} KB")

    mars = images["mars"]
    width, height = mars.size
    pixels = mars.load()

    def brightness(lon: float, lat: float, half: int = 4) -> float:
        x = round(width / 2 + lon / 360 * width)
        y = min(height - 1 - half, max(half, round(height / 2 - lat / 180 * height)))
        values = [pixels[(x + dx) % width, y + dy] for dx in range(-half, half + 1) for dy in range(-half, half + 1)]
        return sum(values) / len(values)

    pairs = [
        (("Syrtis Major", 69.5, 9.0), ("Arabia Terra west of it", 30.0, 20.0)),
        (("Mare Acidalium", -30.0, 45.0), ("Tharsis", -110.0, 5.0)),
        (("Mare Cimmerium", 145.0, -25.0), ("Elysium", 150.0, 20.0)),
        (("Mare Erythraeum", -40.0, -25.0), ("Amazonis", -160.0, 20.0)),
    ]
    for (dark_name, dark_lon, dark_lat), (bright_name, bright_lon, bright_lat) in pairs:
        dark = brightness(dark_lon, dark_lat)
        bright = brightness(bright_lon, bright_lat)
        check(dark < bright - 15, f"mars: {dark_name} ({dark:.0f}) is darker than {bright_name} ({bright:.0f})")
    # Mirrored east-west, Syrtis Major would be at 69.5 W: bright Tharsis-side desert.
    syrtis = brightness(69.5, 9.0)
    mirrored = brightness(-69.5, 9.0)
    check(syrtis < mirrored - 15, f"mars: Syrtis Major is dark in the east ({syrtis:.0f}), the same place west is not ({mirrored:.0f})")
    hellas = brightness(70.0, -42.0)
    check(hellas > brightness(100.0, -20.0) + 10, f"mars: Hellas basin is bright ({hellas:.0f}) beside Mare Tyrrhenum")
    check(brightness(0.0, 88.0, 2) > 200, "mars: the north polar cap is white")

    for planet in ("jupiter", "saturn", "neptune"):
        image = images[planet]
        w, h = image.size
        px = image.load()
        rows = [[px[x, y] for x in range(w)] for y in range(h // 6, h - h // 6)]
        means = [sum(row) / w for row in rows]
        overall = sum(means) / len(means)
        between = (sum((m - overall) ** 2 for m in means) / len(means)) ** 0.5
        within = (sum(sum((v - m) ** 2 for v in row) / w for row, m in zip(rows, means)) / len(rows)) ** 0.5
        check(between > 0.8 * within, f"{planet}: banded east-west (rows differ by {between:.1f}, vary along themselves by {within:.1f})")

    jupiter = images["jupiter"]
    w, h = jupiter.size
    px = jupiter.load()

    def band(lat: float) -> float:
        y = round(h / 2 - lat / 180 * h)
        return sum(px[x, y + dy] for x in range(w) for dy in (-2, -1, 0, 1, 2)) / (5 * w)

    zone, north_belt, south_belt = band(-2.0), band(13.0), band(-13.0)
    check(zone > north_belt + 8 and zone > south_belt + 8, f"jupiter: the equatorial zone ({zone:.0f}) is brighter than the north ({north_belt:.0f}) and south ({south_belt:.0f}) equatorial belts")

    finish()


if __name__ == "__main__":
    main()
