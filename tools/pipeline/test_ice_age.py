#!/usr/bin/env python3
"""
Data checks for generate_ice_age.py's output.

By places whose glacial history is not in doubt: where the ice sheets
stood and where they did not reach, which sea floors were dry land and
which basins below sea level were never part of the sea. And the totals
against published figures.

Usage (needs numpy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/test_ice_age.py
"""

import json

import numpy as np
from PIL import Image

from generate_ice_age import HEIGHT, MASK, META, SHORE_DEPTH_M, WIDTH
from geo_test_support import check, finish


def main() -> None:
    image = Image.open(MASK).convert("RGB")
    meta = json.loads(META.read_text())
    check(image.size == (WIDTH, HEIGHT), f"{image.size[0]}x{image.size[1]} equirectangular")
    check(MASK.stat().st_size < 250_000, f"{MASK.stat().st_size / 1024:.0f} KB")
    pixels = np.asarray(image)

    def at(lon: float, lat: float) -> tuple[int, int]:
        """(ice, emerged) coverage 0..255 at a place."""
        row = min(HEIGHT - 1, int((90 - lat) / 180 * HEIGHT))
        col = min(WIDTH - 1, int((lon + 180) / 360 * WIDTH))
        return int(pixels[row, col, 0]), int(pixels[row, col, 1])

    under_ice = {
        "Hudson Bay": (-85.0, 60.0),
        "Chicago": (-87.6, 41.9),
        "Toronto": (-79.4, 43.7),
        "Seattle": (-122.3, 47.6),
        "Stockholm": (18.1, 59.3),
        "Edinburgh": (-3.2, 55.95),
        "Berlin": (13.4, 52.5),
        "Svalbard": (16.0, 78.5),
        "Reykjavik": (-21.9, 64.1),
        "the summit of Greenland": (-38.5, 72.6),
        # Under the joined British and Scandinavian ice in this reconstruction: "Doggerland" was dry land later.
        "Dogger Bank, in the North Sea": (2.5, 54.7),
    }
    for name, (lon, lat) in under_ice.items():
        check(at(lon, lat)[0] > 200, f"ice over {name}")
    ice_free = {
        "St. Louis": (-90.2, 38.6),
        "London": (-0.1, 51.5),
        "Paris": (2.35, 48.85),
        "Fairbanks, in unglaciated interior Alaska": (-147.7, 64.8),
        "Yakutsk": (129.7, 62.0),
        "Madrid": (-3.7, 40.4),
        "Austin": (-97.7, 30.3),
        "the central Arctic Ocean": (-150.0, 86.0),
    }
    for name, (lon, lat) in ice_free.items():
        check(at(lon, lat)[0] < 30, f"no ice sheet at {name}")
    check(pixels[HEIGHT // 2 :, :, 0].max() == 0, "nothing in the southern half: the source is the Northern Hemisphere only")

    dry_then = {
        "the Bering Strait": (-168.5, 65.8),
        "the southern North Sea, off Holland": (3.0, 52.5),
        "the Sunda Shelf, between Borneo and Malaya": (107.5, 3.0),
        "the Arafura Sea, between Australia and New Guinea": (136.0, -10.0),
        "Bass Strait, between Australia and Tasmania": (146.0, -39.8),
        "the head of the Persian Gulf": (50.5, 28.5),
        "the Yellow Sea": (123.0, 36.0),
        "the Argentine shelf": (-64.0, -45.0),
        "the English Channel off Dover": (1.4, 51.0),
    }
    for name, (lon, lat) in dry_then.items():
        check(at(lon, lat)[1] > 200, f"dry land then: {name}")
    not_emerged = {
        "the mid-Atlantic": (-30.0, 30.0),
        "the Sahara (land now)": (10.0, 23.0),
        "the Caspian Sea (below sea level, not joined to the ocean)": (51.0, 44.5),
        "the Dead Sea": (35.5, 31.5),
        "Death Valley": (-116.85, 36.25),
        "the Japan Trench": (144.0, 38.0),
        "the Mariana Trench": (142.2, 11.35),
        "Hudson Bay (under ice instead)": (-85.0, 60.0),
    }
    for name, (lon, lat) in not_emerged.items():
        check(at(lon, lat)[1] < 30, f"not drawn as emerged: {name}")
    check(int((pixels[:, :, 0] > 128).astype(int).__and__(pixels[:, :, 1] > 128).sum()) == 0, "no pixel is both ice and emerged land")

    for entry in meta["names"]:
        ice, emerged = at(entry["lon"], entry["lat"])
        value = ice if entry["kind"] == "ice" else emerged
        check(value > 200, f"the name '{entry['name']}' sits on {'ice' if entry['kind'] == 'ice' else 'emerged land'}")

    check(meta["shoreDepthM"] == SHORE_DEPTH_M == 125, "the depth used is recorded: 125 m")
    ice_area = meta["iceAreaKm2"] / 1e6
    # Northern Hemisphere ice sheets at the LGM: the Laurentide alone about 13 million km2; published totals 25-28.
    check(24 < ice_area < 29, f"ice area {ice_area:.1f} million km2")
    emerged_area = meta["emergedAreaKm2"] / 1e6
    # The continental shelves shallower than 200 m total about 27 million km2; down to 125 m, somewhat less.
    check(14 < emerged_area < 22, f"emerged land {emerged_area:.1f} million km2")

    finish()


if __name__ == "__main__":
    main()
