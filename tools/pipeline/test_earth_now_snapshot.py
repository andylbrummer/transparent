#!/usr/bin/env python3
"""
Data checks for generate_earth_now_snapshot.py's output.

The picture is the right shape and size, dated, opaque where GOES East and
West look and transparent where they cannot (so the app's base map shows
there), and not blank where it is opaque.

Usage (needs pillow, numpy: tools/pipeline/.cache/venv):
    python3 tools/pipeline/test_earth_now_snapshot.py
"""

import datetime
import json

import numpy as np
from PIL import Image

from generate_earth_now_snapshot import HEIGHT, IMAGE, META, SEAM_LONGITUDE, WIDTH
from geo_test_support import check, finish


def main() -> None:
    meta = json.loads(META.read_text())
    image = Image.open(IMAGE).convert("RGBA")
    check(image.size == (WIDTH, HEIGHT), f"{image.size[0]}x{image.size[1]} equirectangular")
    check(IMAGE.stat().st_size < 250_000, f"{IMAGE.stat().st_size / 1024:.0f} KB")
    check(meta["file"] == IMAGE.name, "the metadata names the picture")
    times = {name: datetime.datetime.fromisoformat(text.replace("Z", "+00:00")) for name, text in meta["times"].items()}
    check(set(times) == {"west", "east"}, f"both satellites dated: {meta['times']}")
    spread = abs((times["west"] - times["east"]).total_seconds())
    check(spread <= 3600, f"the two pictures are {spread / 60:.0f} minutes apart")
    check(meta["validTime"] == min(meta["times"].values()), "dated by the older of the two")

    pixels = np.asarray(image)
    alpha = pixels[:, :, 3]

    def at(lon: float, lat: float) -> tuple[int, int]:
        return round((90 - lat) / 180 * HEIGHT), round((lon + 180) / 360 * WIDTH)

    seen = {
        "Austin": (-97.7, 30.3),
        "Quito, under GOES East": (-78.5, -0.2),
        "the Pacific under GOES West": (-137.2, 0.0),
        "Buenos Aires": (-58.4, -34.6),
        "Hawaii": (-155.5, 19.9),
        "the seam on the equator": (SEAM_LONGITUDE, 0.0),
        "New Zealand, past the date line": (174.8, -41.3),
    }
    for name, (lon, lat) in seen.items():
        row, col = at(lon, lat)
        check(alpha[row, col] > 250, f"opaque at {name}")
    unseen = {"Nairobi": (36.8, -1.3), "Delhi": (77.2, 28.6), "Berlin": (13.4, 52.5), "Perth": (115.9, -31.9), "the North Pole": (0.0, 89.5)}
    for name, (lon, lat) in unseen.items():
        row, col = at(lon, lat)
        check(alpha[row, col] < 5, f"transparent at {name}")
    opaque = alpha > 128
    check(0.40 < opaque.mean() < 0.60, f"{opaque.mean() * 100:.0f}% of the map is covered (two discs, overlapping)")
    covered = pixels[:, :, :3][opaque].astype(float)
    check(covered.std() > 25, f"the covered part is a picture, not a flat tone (spread {covered.std():.0f})")
    # No hard step where the two pictures meet: columns either side of the seam differ little more than neighbours elsewhere.
    row0, row1 = at(0, 30)[0], at(0, -30)[0]
    seam_col = at(SEAM_LONGITUDE, 0)[1]
    band = pixels[row0:row1, :, :3].astype(float).mean(axis=2)
    step_at_seam = np.abs(band[:, seam_col + 1] - band[:, seam_col - 1]).mean()
    step_elsewhere = np.abs(band[:, seam_col + 61] - band[:, seam_col + 59]).mean()
    check(step_at_seam < 3 * step_elsewhere + 5, f"no hard step at the seam ({step_at_seam:.1f} against {step_elsewhere:.1f} sixty columns east)")

    finish()


if __name__ == "__main__":
    main()
