#!/usr/bin/env python3
"""
Data checks for generate_closeup_coverage.py's output.

The cells are sorted, unique and in range, cover at least the area the
coverage maps state and not much more, and include famous fields Webb
is known to have imaged - placed with healpy, not with the
script's own arithmetic - while leaving most of the sky out.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_closeup_coverage.py
"""

import json
import math

import healpy as hp

from generate_closeup_coverage import OUTPUT
from geo_test_support import check, finish

# Positions (ICRS, degrees) of fields Webb imaged, from their discovery or release papers; a
# 13.7' cell holds the whole of each.
WEBB_FIELDS = {
    "SMACS 0723 deep field (NIRCam, 2022)": (110.8375, -73.4544),
    "Stephan's Quintet (NIRCam, 2022)": (338.9894, 33.9597),
    "Pillars of Creation, M16 (NIRCam, 2022)": (274.7000, -13.8370),
}


def main() -> None:
    data = json.loads(OUTPUT.read_text())
    check(OUTPUT.stat().st_size < 10_000, f"{OUTPUT.stat().st_size / 1024:.0f} KB")
    order = data["order"]
    nside = 2**order
    cell_area = 4 * math.pi * (180 / math.pi) ** 2 / hp.nside2npix(nside)
    check(data["frame"] == "icrs", "cells are in ICRS")

    for name, fields in (("jwst", WEBB_FIELDS),):
        survey = data["surveys"][name]
        deltas = survey["deltas"]
        cells = []
        total = 0
        for delta in deltas:
            total += delta
            cells.append(total)
        check(len(cells) == survey["cells"], f"{name}: {len(cells)} cells as stated")
        check(all(b > a for a, b in zip(cells, cells[1:])), f"{name}: cells sorted and unique")
        check(0 <= cells[0] and cells[-1] < hp.nside2npix(nside), f"{name}: cells within order {order}")
        covered = len(cells) * cell_area
        # Coarsening can only add sky; patches far smaller than a cell can add a lot of it, but not without limit.
        check(survey["areaDeg2"] <= covered <= 60 * survey["areaDeg2"], f"{name}: {covered:.1f} deg² of cells for {survey['areaDeg2']} deg² of coverage")
        check(covered < 0.05 * 41_253, f"{name}: under 5% of the sky ({covered / 41_253:.2%})")
        held = set(cells)
        for field, (ra, dec) in fields.items():
            pixel = int(hp.ang2pix(nside, ra, dec, nest=True, lonlat=True))
            check(pixel in held, f"{name}: covers {field}")
    finish()


if __name__ == "__main__":
    main()
