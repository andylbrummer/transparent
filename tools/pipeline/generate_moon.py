#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the face of the Moon.

Writes app/public/sky/moon.jpg from the colour map of NASA's CGI Moon Kit
(NASA's Scientific Visualization Studio, E. Wright, svs.gsfc.nasa.gov/4720;
public domain, credit requested): the Lunar Reconnaissance Orbiter Camera's
wide-angle natural-colour mosaic.

The source is a plate carree in selenographic coordinates centred on
longitude 0 (the middle of the near side), east to the right, north up.
It is only shrunk: at the app's narrowest field of view the Moon is under
a hundred pixels across, so 1024x512 is already more than the screen can
show. test_moon.py checks the maria and Tycho are where the Moon has them.

Usage:
    python3 tools/pipeline/generate_moon.py

Raw downloads are cached in tools/pipeline/.cache/. Needs pillow.
"""

from pathlib import Path

from PIL import Image

from fetch_cache import cached_fetch

SOURCE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg"
WIDTH, HEIGHT = 1024, 512
JPEG_QUALITY = 85

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "moon.jpg"


def main() -> None:
    source = Image.open(cached_fetch(SOURCE_URL, "lroc_color_2k.jpg")).convert("RGB")
    assert source.size[0] == 2 * source.size[1], source.size
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    source.resize((WIDTH, HEIGHT), Image.LANCZOS).save(OUTPUT, "JPEG", quality=JPEG_QUALITY, optimize=True)
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
