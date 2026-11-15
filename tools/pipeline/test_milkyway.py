#!/usr/bin/env python3
"""
Data checks for generate_milkyway.py's output: every tile is there, the
set fits its budget, the tiles are laid out the HiPS way, and the Milky
Way is where the sky has it.

Layout: a tile laid on its HEALPix pixel any of eight ways still looks
like sky, so a few tiles across the band are compared with ESA's
Digitized Sky Survey colour tiles of the same pixels (the survey whose
layout test_hips_orientation.py checks against catalogue stars): the
layout the app reads (HEALPix v along the rows, u down the columns) must
match DSS far better than any other.

Places: a mirrored or shifted sky still looks like a Milky Way, so the
tiles are probed at known places (ICRS coordinates from SIMBAD).

Usage (needs healpy, numpy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/test_milkyway.py
"""

import healpy as hp
import numpy as np
from PIL import Image

from fetch_cache import cached_fetch
from generate_milkyway import MAX_ORDER, OUTPUT, TILE_BITS, TILE_PX, tile_path
from geo_test_support import check, finish

BUDGET_MB = 10
DSS_BASE = "https://cdn.skies.esac.esa.int/DSSColor"
# Order-2 tiles with the most structure, all on the band toward the galactic centre.
LAYOUT_TILES = [112, 113, 114, 118, 164]
# Compared on blocks this many pixels wide: the band's shape, not the stars.
LAYOUT_BLOCK_PX = 16

LAYOUTS = {
    "as written": lambda a: a,
    "transposed": lambda a: a.T,
    "flipped rows": lambda a: a[::-1],
    "flipped columns": lambda a: a[:, ::-1],
    "turned half round": lambda a: a[::-1, ::-1],
    "turned right": lambda a: np.rot90(a, -1),
    "turned left": lambda a: np.rot90(a),
    "transposed the other way": lambda a: a[::-1, ::-1].T,
}


def grey(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=float)


def blocks(image: np.ndarray) -> np.ndarray:
    n = TILE_PX // LAYOUT_BLOCK_PX
    return image.reshape(n, LAYOUT_BLOCK_PX, n, LAYOUT_BLOCK_PX).mean(axis=(1, 3))


def correlation(a: np.ndarray, b: np.ndarray) -> float:
    if a.std() == 0 or b.std() == 0:
        raise ValueError("a flat tile has no layout to compare")
    return float(np.corrcoef(a.ravel(), b.ravel())[0, 1])


def brightness(ra: float, dec: float, radius_px: int = 6) -> float:
    """Mean grey level of the deepest tile around (ra, dec), read the way the app reads a tile: row u, column v."""
    nside = 2 ** (MAX_ORDER + TILE_BITS)
    sub_pixel = int(hp.ang2pix(nside, ra, dec, nest=True, lonlat=True))
    tile, sub = divmod(sub_pixel, 4**TILE_BITS)
    u = sum(((sub >> (2 * bit)) & 1) << bit for bit in range(TILE_BITS))
    v = sum(((sub >> (2 * bit + 1)) & 1) << bit for bit in range(TILE_BITS))
    image = grey(tile_path(MAX_ORDER, tile))
    return float(image[max(0, u - radius_px) : u + radius_px + 1, max(0, v - radius_px) : v + radius_px + 1].mean())


def main() -> None:
    missing = [(order, n) for order in range(MAX_ORDER + 1) for n in range(12 * 4**order) if not tile_path(order, n).exists()]
    check(not missing, f"every tile of orders 0-{MAX_ORDER} is written ({len(missing)} missing)")
    size_mb = sum(path.stat().st_size for path in OUTPUT.rglob("*.jpg")) / 2**20
    check(size_mb < BUDGET_MB, f"{size_mb:.1f} MB, under the {BUDGET_MB} MB budget")
    first = Image.open(tile_path(0, 0))
    check(first.size == (TILE_PX, TILE_PX) and first.mode == "RGB", f"tiles are {first.size[0]}x{first.size[1]} {first.mode}")

    for tile in LAYOUT_TILES:
        dss = blocks(grey(cached_fetch(f"{DSS_BASE}/Norder{MAX_ORDER}/Dir0/Npix{tile}.jpg", f"hips/DSSColor-{MAX_ORDER}-{tile}.jpg")))
        ours = grey(tile_path(MAX_ORDER, tile))
        scores = {name: correlation(blocks(layout(ours)), dss) for name, layout in LAYOUTS.items()}
        others = max(score for name, score in scores.items() if name != "as written")
        check(
            scores["as written"] > 0.6 and scores["as written"] > others + 0.25,
            f"tile {tile} matches DSS as written (correlation {scores['as written']:.2f}; next best layout {others:.2f})",
        )

    # Baade's Window, the bright bulge just off the galactic centre (l = 1.0, b = -3.9).
    bulge = brightness(270.89, -30.03)
    check(bulge > 150, f"the galactic bulge in Sagittarius is bright ({bulge:.0f})")
    check(brightness(360 - 270.89, -30.03) < bulge / 3, "and is not where a mirrored sky would put it")
    # The Scutum star cloud and the Cygnus star cloud, either side of the Great Rift.
    scutum = brightness(281.0, -6.0)
    check(scutum > 100, f"the Scutum star cloud is bright ({scutum:.0f})")
    cygnus = brightness(298.0, 35.0)
    check(cygnus > 60, f"the Cygnus star cloud is there ({cygnus:.0f})")
    # The Great Rift's dark lane in Aquila/Serpens Cauda (l = 28, b = +3) beside the Scutum cloud (l = 27, b = -3).
    rift = brightness(278.5, -3.0, 6)
    check(rift < scutum * 0.6, f"the Great Rift beside it is dark ({rift:.0f})")
    # The galactic poles (NGP 192.86 +27.13, SGP 12.86 -27.13) are empty.
    for name, ra, dec in (("north", 192.86, 27.13), ("south", 12.86, -27.13)):
        pole = brightness(ra, dec, 40)
        check(pole < 12, f"the {name} galactic pole is dark ({pole:.1f})")
    # The Magellanic Clouds.
    lmc = brightness(80.89, -69.76)
    smc = brightness(13.16, -72.80)
    check(lmc > 60, f"the Large Magellanic Cloud is at 5h24m -69.8 ({lmc:.0f})")
    check(smc > 40, f"the Small Magellanic Cloud is at 0h53m -72.8 ({smc:.0f})")
    check(brightness(360 - 80.89, -69.76) < lmc / 3, "and the LMC is not where a mirrored sky would put it")
    # The anticentre (Auriga, l = 180) is far fainter than the centre.
    anticentre = brightness(86.4, 28.9)
    check(anticentre < bulge / 2.5, f"the anticentre in Auriga is faint beside the bulge ({anticentre:.0f})")

    finish()


if __name__ == "__main__":
    main()
