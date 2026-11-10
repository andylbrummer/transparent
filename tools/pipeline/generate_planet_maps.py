#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the faces of Mars, Jupiter, Saturn
and Neptune.

Writes app/public/sky/planets/{mars,jupiter,saturn,neptune}.jpg from the
planet maps in NASA's 3D Resources collection (github.com/nasa/
NASA-3D-Resources, "Images and Textures"; "free and without copyright"),
which are the JPL Solar System Simulator's maps: Viking orbiter mosaics for
Mars, Voyager mosaics for the three giants.

Each source is a plate carree, north up, longitude 0 in the middle and
east to the right; test_planet_maps.py checks Mars against named features.
They are only shrunk - the app draws a planet a few hundred pixels across
at its narrowest field of view - except Saturn, whose source is far more
orange than the planet: its colour is pulled 45% of the way to grey
(SATURN_SATURATION), which changes no feature's place or contrast order.

What these maps cannot say: the giants' clouds drift. The belts and zones
stay at their latitudes, but a spot's longitude on a 1979-1989 map is not
its longitude today, and the app's rotation for the giants is the magnetic
field's (System III). Mercury, Venus and Uranus get no map: the first
would need a different source, the other two show no markings in visible
light.

Usage:
    python3 tools/pipeline/generate_planet_maps.py

Raw downloads are cached in tools/pipeline/.cache/. Needs pillow.
"""

from pathlib import Path

from PIL import Image, ImageEnhance

from fetch_cache import cached_fetch

BASE_URL = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures"
# planet -> (source file, output width)
MAPS = {
    "mars": ("Mars/Mars.jpg", 1024),
    "jupiter": ("Jupiter/Jupiter.jpg", 720),
    "saturn": ("Saturn/Saturn.jpg", 512),
    "neptune": ("Neptune/Neptune.jpg", 512),
}
SATURN_SATURATION = 0.55
JPEG_QUALITY = 82

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "sky" / "planets"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for planet, (path, width) in MAPS.items():
        source = Image.open(cached_fetch(f"{BASE_URL}/{path}", f"nasa3d-{planet}.jpg")).convert("RGB")
        assert source.size[0] == 2 * source.size[1], (planet, source.size)
        image = source if source.size[0] == width else source.resize((width, width // 2), Image.LANCZOS)
        if planet == "saturn":
            image = ImageEnhance.Color(image).enhance(SATURN_SATURATION)
        output = OUTPUT_DIR / f"{planet}.jpg"
        image.save(output, "JPEG", quality=JPEG_QUALITY, optimize=True)
        print(f"wrote {output.relative_to(REPO_ROOT)} ({output.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
