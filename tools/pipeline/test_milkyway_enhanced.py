#!/usr/bin/env python3
"""
Data checks for generate_milkyway_enhanced.py's output: every tile is
there, the set fits its budget, the tiles keep the plain tiles' layout,
and the finish did what it is for - nebulae glow red where the sky has
them, the bright galaxies Gaia misses are there, the Milky Way's shape is
unchanged, and empty sky stays dark. The galaxies' close-ups: galaxies.json
lists exactly the deep tiles written, names the galaxies, and a close-up
holds detail its order-2 ancestor does not.

Layout: the enhanced tiles are compared with the plain ones
(test_milkyway.py checks those against DSS) block by block, as written
and in the seven other ways a tile can be laid on its pixel.

Usage (needs healpy, numpy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/test_milkyway_enhanced.py
"""

import json

import healpy as hp
import numpy as np
from PIL import Image

from generate_milkyway import MAX_ORDER, TILE_PX, tile_path
from generate_milkyway import OUTPUT as PLAIN
from generate_milkyway_enhanced import CUTOUTS_FILE, OUTPUT, window_of_ancestor
from geo_test_support import check, finish
from test_milkyway import LAYOUT_TILES, LAYOUTS, blocks, correlation, grey, patch

BUDGET_MB = 12
# The galaxies' close-ups, on top: about 10 MB as written.
CLOSEUP_BUDGET_MB = 14
RED_ABOVE_GREEN = 50

# H-alpha regions (ICRS from SIMBAD): each must read red over its starlight, red standing well above green.
NEBULAE = {
    "the Orion Nebula": (83.82, -5.39),
    "the North America Nebula": (314.7, 44.3),
    "the Lagoon Nebula": (270.9, -24.38),
    "the Carina Nebula": (161.0, -59.7),
}


# Galaxies (ICRS from SIMBAD) all but missing from the Gaia map: each must stand out here, and not in the plain tiles.
GALAXIES = {
    "Andromeda, M31": (10.685, 41.269),
    "the Triangulum Galaxy, M33": (23.462, 30.660),
    "Bode's Galaxy, M81": (148.888, 69.065),
    "Centaurus A": (201.365, -43.019),
    "the Sculptor Galaxy, NGC 253": (11.888, -25.288),
    "the Pinwheel, M101": (210.802, 54.349),
}
GALAXY_LIFT = 60
# Labels the sky must show, as the deep-sky layer names them.
GALAXY_LABELS = ("M31 Andromeda Galaxy", "M33 Triangulum Galaxy", "M81 Bode's Galaxy", "M51 Whirlpool Galaxy", "Centaurus A", "Sculptor Galaxy")
# Close-ups checked for detail: (name, ICRS centre, order). Fine detail is the mean absolute difference between
# neighbouring pixels; a close-up must hold several times what its ancestor's window, enlarged, does.
CLOSEUPS = (("M51", (202.47, 47.195), 8), ("NGC 253", (11.888, -25.288), 8), ("M31", (10.685, 41.269), 6))
DETAIL_GAIN = 3.0


def detail(tile: np.ndarray) -> float:
    return float(np.abs(np.diff(tile, axis=0)).mean() + np.abs(np.diff(tile, axis=1)).mean())


def check_closeups() -> None:
    listed = json.loads(CUTOUTS_FILE.read_text())
    tiles = {int(order): set(pixels) for order, pixels in listed["tiles"].items()}
    check(listed["wholeSkyOrder"] == MAX_ORDER and min(tiles) == MAX_ORDER + 1, f"close-ups start at order {min(tiles)}, under the whole sky's {MAX_ORDER}")
    written = {(int(path.parts[-3][len("Norder") :]), int(path.stem[len("Npix") :])) for path in OUTPUT.glob("Norder*/Dir*/Npix*.jpg")}
    deep_written = {(order, ipix) for order, ipix in written if order > MAX_ORDER}
    deep_listed = {(order, ipix) for order, pixels in tiles.items() for ipix in pixels}
    check(deep_written == deep_listed, f"galaxies.json lists the {len(deep_listed)} close-up tiles written ({len(deep_written ^ deep_listed)} differ)")
    labels = [galaxy["label"] for galaxy in listed["galaxies"]]
    missing = [label for label in GALAXY_LABELS if label not in labels]
    check(not missing, f"{len(labels)} galaxies named, the showpieces among them (missing: {missing or 'none'})")
    unnamed = [label for label in labels if label.startswith(("MESSIER", "Holm", "Leo")) and " " not in label]
    check(not unnamed, f"no catalogue shorthand in the names ({unnamed or 'none'})")
    for name, (ra, dec), order in CLOSEUPS:
        ipix = int(hp.ang2pix(2**order, ra, dec, lonlat=True, nest=True))
        check(ipix in tiles.get(order, set()), f"{name} has a close-up at order {order}")
        closeup = np.asarray(Image.open(tile_path(OUTPUT, order, ipix)).convert("L"), dtype=np.float32)
        ancestor = np.asarray(Image.open(tile_path(OUTPUT, MAX_ORDER, ipix >> 2 * (order - MAX_ORDER))).convert("L"), dtype=np.float32)
        enlarged = window_of_ancestor(ancestor[..., None], order, ipix)[..., 0]
        sharp, soft = detail(closeup), detail(enlarged)
        check(sharp > DETAIL_GAIN * soft, f"{name}'s close-up holds detail its order-2 tile does not ({sharp:.1f} against {soft:.1f})")


def plain_brightness(ra: float, dec: float, radius_px: int) -> float:
    return float(patch(PLAIN, ra, dec, radius_px, "L").mean())


def colour(ra: float, dec: float, radius_px: int = 4) -> tuple[float, float, float]:
    r, g, b = patch(OUTPUT, ra, dec, radius_px, "RGB").reshape(-1, 3).mean(axis=0)
    return float(r), float(g), float(b)


def brightness(ra: float, dec: float, radius_px: int = 6) -> float:
    return float(patch(OUTPUT, ra, dec, radius_px, "L").mean())


def main() -> None:
    check_closeups()
    missing = [(order, n) for order in range(MAX_ORDER + 1) for n in range(12 * 4**order) if not tile_path(OUTPUT, order, n).exists()]
    check(not missing, f"every tile of orders 0-{MAX_ORDER} is written ({len(missing)} missing)")
    size_mb = sum(path.stat().st_size for order in range(MAX_ORDER + 1) for path in OUTPUT.glob(f"Norder{order}/Dir*/*.jpg")) / 2**20
    check(size_mb < BUDGET_MB, f"the whole sky is {size_mb:.1f} MB, under the {BUDGET_MB} MB budget")
    closeup_mb = sum(path.stat().st_size for path in OUTPUT.rglob("*.jpg")) / 2**20 - size_mb
    check(closeup_mb < CLOSEUP_BUDGET_MB, f"the close-ups are {closeup_mb:.1f} MB, under the {CLOSEUP_BUDGET_MB} MB budget")
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

    for name, (ra, dec) in GALAXIES.items():
        ours, plain = brightness(ra, dec, 1), plain_brightness(ra, dec, 1)
        check(ours > plain + GALAXY_LIFT, f"{name} shows ({ours:.0f}; {plain:.0f} in the plain tiles)")
    # Andromeda is a disc three degrees long, not a dot: lit well out along its major axis (position angle 35 deg).
    disc = brightness(10.685 + 0.8 * 0.57 / 0.75, 41.269 + 0.8 * 0.82, 1)
    check(disc > 60, f"Andromeda's disc reaches 0.8 deg from the nucleus ({disc:.0f})")

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
