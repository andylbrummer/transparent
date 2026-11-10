#!/usr/bin/env python3
"""
Data checks for generate_milkyway.py's output: the Milky Way is where the
sky has it.

A mirrored or shifted panorama still looks like a Milky Way, so the map is
probed at known places (ICRS coordinates from SIMBAD), using the layout
render/sky-map.ts reads it with: right ascension 0 at the centre,
increasing to the LEFT, north up.

Usage:
    python3 tools/pipeline/test_milkyway.py
"""

from PIL import Image

from generate_milkyway import HEIGHT, OUTPUT, WIDTH
from geo_test_support import check, finish


def main() -> None:
    image = Image.open(OUTPUT).convert("L")
    check(image.size == (WIDTH, HEIGHT), f"{image.size[0]}x{image.size[1]} plate carree")
    check(OUTPUT.stat().st_size < 500 * 1024, f"{OUTPUT.stat().st_size / 1024:.0f} KB, under the 500 KB budget")
    pixels = image.load()

    def brightness(ra: float, dec: float, half: int = 6) -> float:
        x = round(WIDTH / 2 - ((ra + 180) % 360 - 180) / 360 * WIDTH)
        y = round(HEIGHT / 2 - dec / 180 * HEIGHT)
        values = [
            pixels[(x + dx) % WIDTH, min(HEIGHT - 1, max(0, y + dy))]
            for dx in range(-half, half + 1)
            for dy in range(-half, half + 1)
        ]
        return sum(values) / len(values)

    def mirrored(ra: float, dec: float) -> float:
        return brightness(-ra, dec)

    # Baade's Window, the bright bulge just off the galactic centre (l = 1.0, b = -3.9).
    bulge = brightness(270.89, -30.03)
    check(bulge > 150, f"the galactic bulge in Sagittarius is bright ({bulge:.0f})")
    check(mirrored(270.89, -30.03) < bulge / 3, "and is not where a mirrored map would put it")
    # The Scutum star cloud and the Cygnus star cloud, either side of the Great Rift.
    scutum = brightness(281.0, -6.0)
    check(scutum > 100, f"the Scutum star cloud is bright ({scutum:.0f})")
    cygnus = brightness(298.0, 35.0)
    check(cygnus > 60, f"the Cygnus star cloud is there ({cygnus:.0f})")
    # The Great Rift's dark lane in Aquila/Serpens Cauda (l = 28, b = +3) beside the Scutum cloud (l = 27, b = -3).
    rift = brightness(278.5, -3.0, 3)
    check(rift < scutum * 0.6, f"the Great Rift beside it is dark ({rift:.0f})")
    # The galactic poles (NGP 192.86 +27.13, SGP 12.86 -27.13) are empty.
    for name, ra, dec in (("north", 192.86, 27.13), ("south", 12.86, -27.13)):
        pole = brightness(ra, dec, 20)
        check(pole < 12, f"the {name} galactic pole is dark ({pole:.1f})")
    # The Magellanic Clouds.
    lmc = brightness(80.89, -69.76)
    smc = brightness(13.16, -72.80)
    check(lmc > 60, f"the Large Magellanic Cloud is at 5h24m -69.8 ({lmc:.0f})")
    check(smc > 40, f"the Small Magellanic Cloud is at 0h53m -72.8 ({smc:.0f})")
    check(mirrored(80.89, -69.76) < lmc / 3, "and the LMC is not where a mirrored map would put it")
    # The anticentre (Auriga, l = 180) is far fainter than the centre.
    anticentre = brightness(86.4, 28.9)
    check(anticentre < bulge / 2.5, f"the anticentre in Auriga is faint beside the bulge ({anticentre:.0f})")

    finish()


if __name__ == "__main__":
    main()
