#!/usr/bin/env python3
"""
Data checks for generate_transition_zone.py.

First that the files were read the right way round: the grids are complete, and the transition
zone's thickness matches the thermal model shipped in the same archive, which was made from it
(hot is thin). Then against what other studies found:
  - the mean thickness of the transition zone is about 242 km (Flanagan & Shearer 1998, JGR 103,
    2673, from SS precursors; Lawrence & Shearer 2006, JGR 111, B06307, from receiver functions);
  - the 660 is pushed down and the zone thickened where cold slabs reach it: beneath the
    Izu-Bonin, Tonga and South American subduction zones (Flanagan & Shearer 1998; the negative
    Clapeyron slope of ringwoodite breakdown);
  - the zone is thin beneath Hawaii (Li, Kind, Priestley, Sobolev, Tilmann, Yuan & Weber 2000, Nature 405, 938:
    Mapping the Hawaiian plume conduit with converted seismic waves).
Not checked: that the 410 and 660 move in opposite directions. In this data they do not, on the
whole (their correlation over the globe is +0.39), and the claim was general knowledge rather than
something from this paper.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_transition_zone.py
"""

import json

import numpy as np
from PIL import Image

from generate_transition_zone import (
    BOUNDARIES,
    OUT_JSON,
    REPO_ROOT,
    THERMAL_MODEL,
    archive,
    area_mean,
    decode,
    pixel_centres,
    read_grid,
)
from geo_test_support import check, finish


def main() -> None:
    tar = archive()
    lats, lons, d410 = read_grid(tar, BOUNDARIES["410"])
    _, _, d660 = read_grid(tar, BOUNDARIES["660"])
    _, _, temperature = read_grid(tar, THERMAL_MODEL)
    thickness = d660 - d410

    def at(values: np.ndarray, lat: float, lon: float) -> float:
        return float(values[np.argmin(abs(lats - lat)), np.argmin(abs(lons - lon))])

    check(d410.shape == (361, 721) and d660.shape == (361, 721), "both grids are 0.5 degree, 361 x 721 nodes")
    check(not np.isnan(d410).any() and not np.isnan(d660).any(), "no gaps in either grid")
    check(np.allclose(d410[:, 0], d410[:, -1]) and np.allclose(d660[:, 0], d660[:, -1]), "the -180 and 180 columns agree")
    check(394 < d410.min() and d410.max() < 427, f"the 410 lies between 394 and 427 km ({d410.min():.1f}-{d410.max():.1f})")
    check(630 < d660.min() and d660.max() < 682, f"the 660 lies between 630 and 682 km ({d660.min():.1f}-{d660.max():.1f})")
    mean410, mean660 = area_mean(lats, d410), area_mean(lats, d660)
    check(abs(mean410 - 410) < 3, f"the 410 averages 410 km ({mean410:.1f})")

    w = np.sqrt(np.cos(np.radians(lats)))[:, None] * np.ones_like(thickness)
    r = np.corrcoef(((thickness - thickness.mean()) * w).ravel(), ((temperature - temperature.mean()) * w).ravel())[0, 1]
    check(r < -0.9, f"thickness follows the archive's own thermal model, thin where hot (r = {r:.3f})")

    mean_thickness = area_mean(lats, thickness)
    check(236 < mean_thickness < 248, f"the zone is about 242 km thick on average ({mean_thickness:.1f})")
    for name, lat, lon in [("Izu-Bonin", 28, 140), ("Tonga", -20, -178), ("South America", -20, -65)]:
        deeper = at(d660, lat, lon) - mean660
        thicker = at(thickness, lat, lon) - mean_thickness
        check(deeper > 2 and thicker > 5, f"under {name} the 660 is {deeper:+.1f} km and the zone {thicker:+.1f} km against the mean")
    hawaii = at(thickness, 20, -157) - mean_thickness
    check(hawaii < -5, f"under Hawaii the zone is thin ({hawaii:+.1f} km)")
    deepest = np.unravel_index(np.argmax(d660), d660.shape)
    check(-40 < lats[deepest[0]] < 10 and -90 < lons[deepest[1]] < -50, f"the 660 is deepest by the South American subduction zone ({lats[deepest[0]]:.1f}, {lons[deepest[1]]:.1f})")

    meta = json.loads(OUT_JSON.read_text())
    rows, cols = pixel_centres()
    for entry, depth, mean in [(meta["boundaries"][0], d410, mean410), (meta["boundaries"][1], d660, mean660)]:
        path = REPO_ROOT / "app" / "public" / entry["file"]
        image = np.asarray(Image.open(path))
        check(image.shape == (meta["height"], meta["width"]), f"{entry['id']}.png is {meta['width']}x{meta['height']}")
        check(path.stat().st_size < 60_000, f"{entry['id']}.png is small ({path.stat().st_size} bytes)")
        check(abs(entry["meanKm"] - mean) < 0.1, f"{entry['id']}: the stated mean is the data's")
        errors = []
        for lat, lon in [(28, 140), (20, -157), (-20, -65), (60, 90), (-60, 0)]:
            y, x = np.argmin(abs(rows - lat)), np.argmin(abs(cols - lon))
            truth = at(depth, rows[y], cols[x]) - mean
            errors.append(abs(decode(image[y, x]) - truth))
        check(max(errors) < 1.0, f"{entry['id']}.png decodes to the data within a km (worst {max(errors):.2f})")
    finish()


if __name__ == "__main__":
    main()
