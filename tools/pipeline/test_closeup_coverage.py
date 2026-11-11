#!/usr/bin/env python3
"""
Data checks for generate_closeup_coverage.py's output.

The cells are sorted, unique and in range, cover at least the area the
coverage maps state and not much more, and include fields Webb is known
to have imaged, fields Hubble's ACS imaged before 2015, and the centres of Euclid's deep fields - placed with healpy, not with the
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
# Fields imaged with Hubble's Advanced Camera for Surveys before the survey's 2015 cut-off, positions from SIMBAD.
HUBBLE_FIELDS = {
    "Hubble Ultra Deep Field (ACS, 2003-04)": (53.1625, -27.7914),
    "M51, Whirlpool Galaxy (ACS, 2005)": (202.4696, 47.1952),
    "M31 nucleus (ACS, PHAT 2010-13)": (10.6847, 41.2690),
}
# Centres of Euclid's deep fields as the mission's Q1 release gives them (Euclid Collaboration: Aussel et al. 2025).
EUCLID_FIELDS = {
    "euclid-edfs": {"Euclid Deep Field South": (61.24, -48.42)},
    "euclid-edff": {"Euclid Deep Field Fornax": (52.93, -28.09)},
    "euclid-edfn": {"Euclid Deep Field North": (269.73, 66.02)},
    "euclid-egbs": {},
}
# Each survey's moc_sky_fraction from its HiPS properties file, read 2026-11-10: the bake's area must agree.
# Webb's states 1.025e-5 (0.42 deg²) while its Moc.fits, dated the same minute, sums to 2.37 deg²; the same sum
# matches all four Euclid files, so the stated fraction is taken as stale and not checked. Hubble ACS's states
# 6.566e-6 (0.27 deg²), its Moc.fits 24.6 deg²: the survey was built from three parts (blue, red, UV) and the
# fraction seems to be the first part's alone; not checked either.
SKY_FRACTION = {
    "jwst": None,
    "hst-acs": None,
    "euclid-edfs": 1.357e-3,
    "euclid-edff": 7.266e-4,
    "euclid-edfn": 1.132e-3,
    "euclid-egbs": 1.254e-4,
}


def main() -> None:
    data = json.loads(OUTPUT.read_text())
    # Hubble's thousands of scattered fields take most of it; served compressed, about a third of this.
    check(OUTPUT.stat().st_size < 40_000, f"{OUTPUT.stat().st_size / 1024:.0f} KB")
    order = data["order"]
    nside = 2**order
    cell_area = 4 * math.pi * (180 / math.pi) ** 2 / hp.nside2npix(nside)
    check(data["frame"] == "icrs", "cells are in ICRS")

    check(sorted(data["surveys"]) == sorted(SKY_FRACTION), "the expected surveys, no more")
    for name, fields in (("jwst", WEBB_FIELDS), ("hst-acs", HUBBLE_FIELDS), *EUCLID_FIELDS.items()):
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
        if SKY_FRACTION[name] is not None:
            stated = SKY_FRACTION[name] * 41_253
            check(abs(survey["areaDeg2"] - stated) < 0.01 * stated, f"{name}: {survey['areaDeg2']} deg² as the survey states ({stated:.2f})")
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
