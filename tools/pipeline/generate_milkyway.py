#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the Milky Way.

Writes app/public/sky/milkyway.jpg from NASA's Deep Star Maps 2020
(NASA/Goddard Space Flight Center Scientific Visualization Studio, E.
Wright, svs.gsfc.nasa.gov/4851; public domain, credit requested, with
Gaia DR2: ESA/Gaia/DPAC): the "milkyway" map - the summed light of the
1.7 billion Gaia DR2, Tycho-2 and Hipparcos-2 stars too faint to plot one
by one - in celestial (ICRF) coordinates.

The source is a plate carree centred on 0h right ascension with r.a.
increasing to the left: exactly what render/sky-map.ts expects, so the
pixels are only tone-mapped and shrunk, never moved. test_milkyway.py
checks the galactic centre, the galactic poles and the Magellanic Clouds
sit where the sky has them.

Tone mapping: the EXR is linear light. A black level - the faint, even
floor of unresolved stars far from the plane - is subtracted so the map
adds nothing to the view where there is no Milky Way to see, eased in
just above that level so faint grain does not become speckle, then an
exposure and a gamma bring the band up without clipping the bulge.

Usage:
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install OpenEXR numpy pillow
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_milkyway.py

Raw downloads are cached in tools/pipeline/.cache/ (the EXR is 36 MB).
"""

from pathlib import Path

import numpy as np
import OpenEXR
from PIL import Image

from fetch_cache import cached_fetch

SOURCE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k.exr"

WIDTH, HEIGHT = 2048, 1024
# Linear level treated as black: two thirds of the sky - everything well off the galactic plane - is at or under it.
BLACK_PERCENTILE = 66
# Linear level, after the black is removed, that maps to white: only the bulge's core exceeds it.
WHITE_PERCENTILE = 99.9
GAMMA = 2.0
# Just above black the response is eased in (x^2 / (x + TOE)): a hard cut there would turn the grain of the
# faintest regions into speckle with sharp edges, which the eye reads as structure.
TOE = 0.03
JPEG_QUALITY = 82

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "milkyway.jpg"


def read_exr(path: Path) -> np.ndarray:
    """Linear RGB, float32, rows top (north) to bottom."""
    with OpenEXR.File(str(path)) as exr:
        channels = exr.channels()
        if "RGB" in channels:
            return np.asarray(channels["RGB"].pixels, dtype=np.float32)
        if "RGBA" in channels:
            return np.asarray(channels["RGBA"].pixels, dtype=np.float32)[..., :3]
        return np.stack([np.asarray(channels[c].pixels, dtype=np.float32) for c in "RGB"], axis=-1)


def tone_map(linear: np.ndarray) -> np.ndarray:
    luminance = linear.mean(axis=-1)
    black = np.percentile(luminance, BLACK_PERCENTILE)
    white = np.percentile(luminance, WHITE_PERCENTILE) - black
    # Scale each pixel by its luminance's change, so removing the floor does not shift colours.
    lifted = np.clip(luminance - black, 0, None)
    scale = np.divide(lifted, luminance, out=np.zeros_like(luminance), where=luminance > 0)
    level = np.clip(lifted / white, 0, 1)
    eased = level * level / (level + TOE) * (1 + TOE)
    scale *= np.divide(eased, level, out=np.zeros_like(level), where=level > 0)
    mapped = np.clip(linear * scale[..., None] / white, 0, 1) ** (1 / GAMMA)
    print(f"black {black:.5f}  white {white + black:.5f} (linear)")
    return mapped


def main() -> None:
    linear = read_exr(cached_fetch(SOURCE_URL, "milkyway_2020_4k.exr", timeout=900))
    print(f"source {linear.shape[1]}x{linear.shape[0]}, linear range {linear.min():.4f}..{linear.max():.4f}")
    # Average 2x2 blocks in linear light: the honest way to halve a photometric map.
    factor = linear.shape[1] // WIDTH
    assert linear.shape[1] == WIDTH * factor and linear.shape[0] == HEIGHT * factor, linear.shape
    small = linear.reshape(HEIGHT, factor, WIDTH, factor, 3).mean(axis=(1, 3))
    image = Image.fromarray((tone_map(small) * 255 + 0.5).astype(np.uint8), "RGB")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
