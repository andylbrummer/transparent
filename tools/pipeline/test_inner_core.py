#!/usr/bin/env python3
"""
Checks for app/public/geo/inner-core.json against the file it comes from
and against what is known of the inner core.

  - The file holds itself together: each turning point lies on the great
    circle from the ray's entry to its exit, midway; the angle the file
    gives each ray to the Earth's axis (xi) is the angle of the chord from
    entry to exit, which is what the app computes in its place.
  - A straight chord through the inner core from entry to exit turns
    within 15 km of the file's turning depth: the ray bends only slightly
    there, so the app's two straight legs through the real turning point
    are a fair drawing.
  - Rays near the axis arrive early, rays along the equator do not: the
    inner core's anisotropy, found in PKIKP travel times by Morelli,
    Dziewonski & Woodhouse (1986), Anisotropy of the inner core inferred
    from PKIKP travel times, GRL 13, 1545-1548, and the subject of Frost
    et al. (2021). The medians here: about +3 s for xi under 35 degrees,
    about 0 s over 55.
  - Not checked: Frost et al.'s finding that the anisotropy strengthens
    with depth. Their analysis models each ray; here, binned by turning
    depth, the polar-minus-equatorial difference grows in seconds but
    shrinks per kilometre of path, so this simple test cannot say.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_inner_core.py
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_inner_core.py
"""

import json

import numpy as np

import generate_inner_core as bake
from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish

data = json.loads((OUTPUT_DIR / "inner-core.json").read_text())
rays, sources = bake.read_rays()
check(len(rays) == 5144, f"5,144 rays in the file ({len(rays)})")
measured = (rays[:, bake.AB_DF] != 0) | (rays[:, bake.BC_DF] != 0)
check(int(measured.sum()) == 5129, f"5,129 with a residual; 15 have neither ({int((~measured).sum())})")
check(len(data["studies"]) == 6, f"six source sets ({len(data['studies'])})")
check(not np.any((rays[:, bake.AB_DF] != 0) & (rays[:, bake.BC_DF] != 0)), "no ray has both residuals")
rays = rays[measured]


def unit(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    lon, lat = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def angle(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.degrees(np.arccos(np.clip((a * b).sum(-1), -1, 1)))


entry = unit(rays[:, bake.ENTRY_LON], rays[:, bake.ENTRY_LAT])
exit_ = unit(rays[:, bake.EXIT_LON], rays[:, bake.EXIT_LAT])
turn = unit(rays[:, bake.TURN_LON], rays[:, bake.TURN_LAT])
off_path = angle(entry, turn) + angle(turn, exit_) - angle(entry, exit_)
check(off_path.max() < 0.01, f"every turning point is on its ray's great circle (worst {off_path.max():.1e} degrees)")
lopsided = np.abs(angle(entry, turn) - angle(turn, exit_))
check(lopsided.max() < 0.05, f"and midway along it (worst {lopsided.max():.3f} degrees)")
chord = exit_ - entry
chord /= np.linalg.norm(chord, axis=1)[:, None]
xi = np.degrees(np.arccos(np.abs(chord[:, 2])))
check(np.abs(xi - rays[:, bake.XI]).max() < 0.5, f"xi is the chord's angle to the axis (worst {np.abs(xi - rays[:, bake.XI]).max():.2f} degrees)")
half = np.radians(angle(entry, exit_)) / 2
straight = bake.EARTH_RADIUS_KM - bake.INNER_CORE_RADIUS_KM * np.cos(half)
bend = rays[:, bake.TURN_DEPTH] - straight
check(0 <= bend.min() and bend.max() < 15, f"a straight chord turns 0-15 km above the ray ({bend.min():.1f} to {bend.max():.1f} km)")
depth = rays[:, bake.TURN_DEPTH]
check(bake.EARTH_RADIUS_KM - bake.INNER_CORE_RADIUS_KM < depth.min() and depth.max() < bake.EARTH_RADIUS_KM,
      f"every ray turns inside the inner core ({depth.min():.0f}-{depth.max():.0f} km down)")

residual = np.where(rays[:, bake.BC_DF] != 0, rays[:, bake.BC_DF], rays[:, bake.AB_DF])
polar = float(np.median(residual[rays[:, bake.XI] < 35]))
equatorial = float(np.median(residual[rays[:, bake.XI] > 55]))
check(polar > 2.5 and abs(equatorial) < 0.5, f"rays near the axis arrive early ({polar:+.2f} s), along the equator not ({equatorial:+.2f} s)")

# The baked file decodes to the source.
flat = np.array(data["rays"]).reshape(-1, len(data["fields"]))
check(len(flat) == len(rays), f"the bake keeps every ray with a residual ({len(flat)})")
q = data["quantumPerDegree"]
check(np.abs(flat[:, 0] / q - rays[:, bake.ENTRY_LON]).max() <= 0.5 / q + 1e-9 and np.abs(flat[:, 3] / q - rays[:, bake.EXIT_LAT]).max() <= 0.5 / q + 1e-9,
      "entry and exit decode to the file's")
check(np.abs(flat[:, 5] * data["residualQuantumS"] - residual).max() <= 0.005 + 1e-9, "residuals decode to the file's")
check(int(flat[:, 6].sum()) == int((rays[:, bake.BC_DF] != 0).sum()), "which pair of waves each residual came from")

finish()
