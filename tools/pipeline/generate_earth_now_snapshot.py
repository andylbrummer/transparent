#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the offline stand-in for "Earth
right now".

Writes app/public/weather/earth-now.webp and earth-now.json: one picture
of the half of the planet that GOES East and GOES West see, put together
exactly as the app does it live (app/src/layers/weather/geostationary.ts)
- each satellite's GeoColor tiles from NASA GIBS on one equirectangular
canvas, joined midway between the satellites with a cross-fade - at tile
level 1 (1280x640), and the time each satellite's picture was taken.

The app shows this only when it can reach neither GIBS nor its own last
download, and then says "offline · snapshot <date>".

GeoColor: NOAA/NESDIS and CIRA (Colorado State University), from the GOES
Advanced Baseline Imager; imagery by NASA GIBS. Free to use; credit
NOAA/CIRA.

Usage (needs pillow, numpy: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_earth_now_snapshot.py

Not cached: the point is the newest picture.
"""

import io
import json
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from fetch_cache import USER_AGENT

WMTS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best"
# id, layer, longitude it stands over. West first: East is laid over it east of the seam.
SATELLITES = [
    ("west", "GOES-West_ABI_GeoColor", -137.2),
    ("east", "GOES-East_ABI_GeoColor", -75.2),
]
LEVEL = 1
TILE_PX = 512
SPAN_DEG = 288 / 2**LEVEL
REACH_DEG = 82
SEAM_LONGITUDE = (SATELLITES[0][2] + SATELLITES[1][2]) / 2
SEAM_FEATHER_DEG = 8
WIDTH = round(360 * TILE_PX / SPAN_DEG)
HEIGHT = round(180 * TILE_PX / SPAN_DEG)
WEBP_QUALITY = 80

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "weather"
IMAGE = OUTPUT_DIR / "earth-now.webp"
META = OUTPUT_DIR / "earth-now.json"


def columns(longitude: float) -> list[int]:
    count = -(-360 // SPAN_DEG)
    wanted = set()
    offset = -REACH_DEG
    while offset <= REACH_DEG:
        lon = (longitude + offset + 180) % 360 - 180
        wanted.add(min(int(count) - 1, int((lon + 180) // SPAN_DEG)))
        offset += 1
    return sorted(wanted)


def fetch_tile(layer: str, row: int, col: int) -> tuple[Image.Image, str]:
    """A tile of the newest picture, and the time GIBS says it is of."""
    request = urllib.request.Request(f"{WMTS}/{layer}/default/default/1km/{LEVEL}/{row}/{col}.png", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        time = response.headers["layer-time-actual"]
        return Image.open(io.BytesIO(response.read())).convert("RGBA"), time


def main() -> None:
    whole = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    times: dict[str, str] = {}
    for name, layer, longitude in SATELLITES:
        picture = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        for row in range(-(-180 // int(SPAN_DEG))):
            for col in columns(longitude):
                tile, time = fetch_tile(layer, row, col)
                assert times.setdefault(name, time) == time, f"{layer}: tiles of two times ({times[name]}, {time})"
                picture.paste(tile, (col * TILE_PX, row * TILE_PX))
        if name == "east":
            # Faded in across the seam, as the app does with a gradient.
            pixels = np.asarray(picture).astype(np.float32)
            lon = (np.arange(WIDTH) + 0.5) / WIDTH * 360 - 180
            fade = np.clip((lon - (SEAM_LONGITUDE - SEAM_FEATHER_DEG / 2)) / SEAM_FEATHER_DEG, 0, 1)
            pixels[:, :, 3] *= fade[None, :]
            picture = Image.fromarray(pixels.round().astype(np.uint8), "RGBA")
        whole = Image.alpha_composite(whole, picture)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    whole.save(IMAGE, "WEBP", quality=WEBP_QUALITY, method=6)
    META.write_text(json.dumps({"file": IMAGE.name, "validTime": min(times.values()), "times": times}, indent=1) + "\n")
    print(f"wrote {IMAGE.relative_to(REPO_ROOT)} ({IMAGE.stat().st_size / 1024:.0f} KB), {times}")


if __name__ == "__main__":
    main()
