#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: an offline copy of the base map.

The app loads NASA's Blue Marble (Next Generation) from GIBS at start-up,
at 4096x2048. When that request fails - offline, or GIBS having a bad
minute - the far side would be a flat colour. This bakes the same image
at 2048x1024 for the app to fall back to:

    app/public/geo/blue-marble.jpg

Source: NASA Global Imagery Browse Services (GIBS), layer
BlueMarble_NextGeneration; NASA Earth Observatory Blue Marble Next
Generation (Stöckli et al. 2005). Public domain; GIBS asks to be
acknowledged.

Usage:
    python3 tools/pipeline/generate_base_map.py

The download is cached in tools/pipeline/.cache/. Needs Pillow.
"""

from pathlib import Path

from PIL import Image

from fetch_cache import cached_fetch

WIDTH, HEIGHT = 2048, 1024
JPEG_QUALITY = 82
GIBS_URL = (
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap"
    "&VERSION=1.3.0&LAYERS=BlueMarble_NextGeneration&CRS=EPSG:4326&BBOX=-90,-180,90,180"
    f"&WIDTH={WIDTH}&HEIGHT={HEIGHT}&FORMAT=image/png"
)

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "geo" / "blue-marble.jpg"


def main() -> None:
    source = cached_fetch(GIBS_URL, "blue-marble-2048.png")
    image = Image.open(source).convert("RGB")
    if image.size != (WIDTH, HEIGHT):
        raise SystemExit(f"GIBS returned {image.size}, expected {(WIDTH, HEIGHT)}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
