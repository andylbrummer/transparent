#!/usr/bin/env python3
"""
Data checks for generate_milkyway_enhanced.py's output: every tile is
there, the set fits its budget, the tiles keep the plain tiles' layout,
and the finish did what it is for - nebulae glow red where the sky has
them, the Milky Way's shape is unchanged, and empty sky stays dark.

Layout: the enhanced tiles are compared with the plain ones
(test_milkyway.py checks those against DSS) block by block, as written
and in the seven other ways a tile can be laid on its pixel.

Usage (needs healpy, numpy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/test_milkyway_enhanced.py
"""

from PIL import Image

from generate_milkyway import MAX_ORDER, TILE_PX, tile_path
from generate_milkyway import OUTPUT as PLAIN
from generate_milkyway_enhanced import OUTPUT
from geo_test_support import check, finish
from test_milkyway import LAYOUT_TILES, LAYOUTS, blocks, correlation, grey, patch

BUDGET_MB = 12
RED_ABOVE_GREEN = 50

# H-alpha regions (ICRS from SIMBAD): each must read red over its starlight, red standing well above green.
NEBULAE = {
    "the Orion Nebula": (83.82, -5.39),
    "the North America Nebula": (314.7, 44.3),
    "the Lagoon Nebula": (270.9, -24.38),
    "the Carina Nebula": (161.0, -59.7),
}


def colour(ra: float, dec: float, radius_px: int = 4) -> tuple[float, float, float]:
    r, g, b = patch(OUTPUT, ra, dec, radius_px, "RGB").reshape(-1, 3).mean(axis=0)
    return float(r), float(g), float(b)


def brightness(ra: float, dec: float, radius_px: int = 6) -> float:
    return float(patch(OUTPUT, ra, dec, radius_px, "L").mean())


def main() -> None:
    missing = [(order, n) for order in range(MAX_ORDER + 1) for n in range(12 * 4**order) if not tile_path(OUTPUT, order, n).exists()]
    check(not missing, f"every tile of orders 0-{MAX_ORDER} is written ({len(missing)} missing)")
    size_mb = sum(path.stat().st_size for path in OUTPUT.rglob("*.jpg")) / 2**20
    check(size_mb < BUDGET_MB, f"{size_mb:.1f} MB, under the {BUDGET_MB} MB budget")
    first = Image.open(tile_path(OUTPUT, 0, 0))
    check(first.size == (TILE_PX, TILE_PX) and first.mode == "RGB", f"tiles are {first.size[0]}x{first.size[1]} {first.mode}")

    for tile in LAYOUT_TILES:
        plain = blocks(grey(tile_path(PLAIN, MAX_ORDER, tile)))
        ours = grey(tile_path(OUTPUT, MAX_ORDER, tile))
        scores = {name: correlation(blocks(layout(ours)), plain) for name, layout in LAYOUTS.items()}
        others = max(score for name, score in scores.items() if name != "as written")
        check(
            # Against the same sky's plain tiles the true layout is near 1; a tile symmetric enough to fool DSS still loses 0.2.
            scores["as written"] > 0.95 and scores["as written"] > others + 0.2,
            f"tile {tile} keeps the plain tiles' layout (correlation {scores['as written']:.2f}; next best layout {others:.2f})",
        )

    for name, (ra, dec) in NEBULAE.items():
        r, g, b = colour(ra, dec)
        check(r > 120 and r > g + RED_ABOVE_GREEN and r > b, f"{name} glows red (rgb {r:.0f} {g:.0f} {b:.0f})")
    # The red is the gas, not a cast over everything: starlight with no H-alpha before it keeps its colour.
    # Mirrored nebulae are no test of that - Orion's and Carina's mirror images fall on the plane's own H-alpha.
    r, g, b = colour(270.89, -30.03, 12)
    check(r < g + RED_ABOVE_GREEN / 2, f"Baade's Window, starlight without gas, is not red (rgb {r:.0f} {g:.0f} {b:.0f})")

    # The Milky Way's shape survives the finish: the bulge bright, the Great Rift dark beside the Scutum cloud.
    bulge = brightness(270.89, -30.03)
    check(bulge > 150, f"the galactic bulge in Sagittarius is bright ({bulge:.0f})")
    scutum = brightness(281.0, -6.0)
    rift = brightness(278.5, -3.0)
    check(rift < scutum * 0.6, f"the Great Rift is dark beside the Scutum cloud ({rift:.0f} against {scutum:.0f})")
    # Empty sky is not lifted: the galactic poles stay dark.
    for name, ra, dec in (("north", 192.86, 27.13), ("south", 12.86, -27.13)):
        pole = brightness(ra, dec, 40)
        check(pole < 15, f"the {name} galactic pole is dark ({pole:.1f})")

    finish()


if __name__ == "__main__":
    main()
