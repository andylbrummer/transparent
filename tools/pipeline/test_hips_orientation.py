#!/usr/bin/env python3
"""
Which way up a HiPS tile image is: checked against the stars.

The app draws sky surveys from HiPS tiles fetched live (app/src/layers/
sky-survey). A tile is one HEALPix pixel as a 512x512 image, and the image
can be laid on that pixel eight ways (four rotations, mirrored or not);
seven of them still look like sky. This fetches a few real tiles of the
Digitized Sky Survey and of 2MASS, puts the app's own star catalogue
(app/public/sky/stars.json) on each of them all eight ways, and checks
that the stars fall on bright pixels for exactly the layout the app uses:
HEALPix v along the image's rows from the left, u down its columns from
the top (tileImageXy in app/src/layers/sky-survey/hips.ts).

Tiles come from ESA's ESASky HiPS node and are cached in
tools/pipeline/.cache/hips/.

Usage (needs healpy, numpy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/test_hips_orientation.py
"""

import json
from pathlib import Path

import healpy as hp
import numpy as np
from PIL import Image

from fetch_cache import cached_fetch
from geo_test_support import check, finish

REPO_ROOT = Path(__file__).resolve().parents[2]
STARS = REPO_ROOT / "app" / "public" / "sky" / "stars.json"
ORDER = 3
TILE_PX = 512
# survey path on the node -> tiles of order 3: polar cap, equatorial belt, both hemispheres.
SURVEYS = {
    "DSSColor": [100, 300, 500, 650],
    "2MASSColor": [100, 300, 500, 650],
}
BASE = "https://cdn.skies.esac.esa.int"

# (name, image column, image row) from HEALPix (u, v) in pixels, 0..511.
LAYOUTS = {
    "column u, row v": lambda u, v: (u, v),
    "column 1-u, row v": lambda u, v: (TILE_PX - 1 - u, v),
    "column u, row 1-v": lambda u, v: (u, TILE_PX - 1 - v),
    "column 1-u, row 1-v": lambda u, v: (TILE_PX - 1 - u, TILE_PX - 1 - v),
    "column v, row u": lambda u, v: (v, u),
    "column 1-v, row u": lambda u, v: (TILE_PX - 1 - v, u),
    "column v, row 1-u": lambda u, v: (v, TILE_PX - 1 - u),
    "column 1-v, row 1-u": lambda u, v: (TILE_PX - 1 - v, TILE_PX - 1 - u),
}
APP_LAYOUT = "column v, row u"


def main() -> None:
    stars = json.loads(STARS.read_text())
    quantum = stars["quantumPerDegree"]
    vectors = hp.ang2vec(np.array(stars["ra"]) / quantum, np.array(stars["dec"]) / quantum, lonlat=True)
    tile_of = hp.vec2pix(2**ORDER, *vectors.T, nest=True)
    # Each star's pixel within its tile: the tile's own 512x512 sub-pixels, nine orders down.
    sub = hp.vec2pix(2 ** (ORDER + 9), *vectors.T, nest=True) - tile_of.astype(np.int64) * 4**9
    u = np.zeros_like(sub)
    v = np.zeros_like(sub)
    for bit in range(9):
        u |= ((sub >> (2 * bit)) & 1) << bit
        v |= ((sub >> (2 * bit + 1)) & 1) << bit

    for survey, tiles in SURVEYS.items():
        for tile in tiles:
            url = f"{BASE}/{survey}/Norder{ORDER}/Dir{tile // 10000 * 10000}/Npix{tile}.jpg"
            image = np.asarray(Image.open(cached_fetch(url, f"hips/{survey}-{ORDER}-{tile}.jpg")).convert("L"), dtype=float)
            check(image.shape == (TILE_PX, TILE_PX), f"{survey} tile {tile}: {image.shape[1]}x{image.shape[0]}")
            inside = tile_of == tile
            scores = {}
            for name, layout in LAYOUTS.items():
                columns, rows = layout(u[inside], v[inside])
                scores[name] = float(np.mean([image[max(0, r - 2) : r + 3, max(0, c - 2) : c + 3].mean() for c, r in zip(columns, rows)]))
            best = max(scores, key=scores.get)
            others = max(score for name, score in scores.items() if name != APP_LAYOUT)
            check(
                best == APP_LAYOUT and scores[APP_LAYOUT] > 1.5 * others,
                f"{survey} tile {tile}: {int(inside.sum())} catalogue stars fall on bright pixels with {APP_LAYOUT} "
                f"({scores[APP_LAYOUT]:.0f} against {others:.0f} for the next best layout; sky level {image.mean():.0f})",
            )

    finish()


if __name__ == "__main__":
    main()
