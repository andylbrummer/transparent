#!/usr/bin/env python3
"""
Spot-check test for travel-time texture against ObsPy TauP.

Compares 20 random (depth, distance) samples from the generated texture
against freshly computed ObsPy arrivals. Passes if all within 2 seconds.

Usage:
    python3 tools/pipeline/test_traveltime.py
"""

import json
import random
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
    from obspy.taup import TauPyModel
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install: pip install obspy numpy pillow")
    sys.exit(1)


def load_texture():
    output_dir = Path(__file__).parent / "output"
    img = Image.open(output_dir / "traveltime.png")
    texture = np.array(img, dtype=np.uint16)

    with open(output_dir / "traveltime_manifest.json") as f:
        manifest = json.load(f)

    return texture, manifest


def sample_texture(texture, manifest, depth_km, distance_deg):
    max_depth = manifest["maxDepthKm"]
    max_dist = manifest["maxDistanceDeg"]
    h, w = texture.shape[:2]

    di = int((depth_km / max_depth) * (h - 1))
    dj = int((distance_deg / max_dist) * (w - 1))
    di = max(0, min(di, h - 1))
    dj = max(0, min(dj, w - 1))

    p_time = texture[di, dj, 0]
    s_time = texture[di, dj, 1]
    surf_time = texture[di, dj, 2]

    sentinel = manifest["sentinel"]
    scale = manifest["timeScale"]

    return {
        "P": None if p_time == sentinel else p_time * scale,
        "S": None if s_time == sentinel else s_time * scale,
        "surface": None if surf_time == sentinel else surf_time * scale,
    }


def test_spot_checks():
    texture, manifest = load_texture()
    model = TauPyModel(manifest["model"])

    random.seed(42)
    errors = []

    for _ in range(20):
        depth = random.uniform(0, manifest["maxDepthKm"])
        distance = random.uniform(0, manifest["maxDistanceDeg"])

        sampled = sample_texture(texture, manifest, depth, distance)

        try:
            arrivals = model.get_travel_times(
                source_depth_in_km=depth,
                distance_in_degree=distance,
                phase_list=["P", "S", "p", "s", "PP", "SS", "Rayleigh"]
            )

            expected_p = None
            expected_s = None
            for arr in arrivals:
                if arr.name in ("P", "p", "PP") and expected_p is None:
                    expected_p = arr.time
                elif arr.name in ("S", "s", "SS") and expected_s is None:
                    expected_s = arr.time

            if sampled["P"] is not None and expected_p is not None:
                diff = abs(sampled["P"] - expected_p)
                if diff > 2.0:
                    errors.append(f"P-wave at ({depth:.1f}km, {distance:.1f}°): "
                                  f"texture={sampled['P']:.1f}s, expected={expected_p:.1f}s, diff={diff:.1f}s")

            if sampled["S"] is not None and expected_s is not None:
                diff = abs(sampled["S"] - expected_s)
                if diff > 2.0:
                    errors.append(f"S-wave at ({depth:.1f}km, {distance:.1f}°): "
                                  f"texture={sampled['S']:.1f}s, expected={expected_s:.1f}s, diff={diff:.1f}s")

        except Exception:
            # No arrival expected — check sentinel
            if sampled["P"] is not None:
                errors.append(f"Unexpected P arrival at ({depth:.1f}km, {distance:.1f}°)")

    if errors:
        print(f"FAILED: {len(errors)} spot checks exceeded 2s tolerance:")
        for e in errors:
            print(f"  {e}")
        return 1

    print("PASSED: All 20 spot checks within 2s tolerance")
    return 0


def test_core_shadow():
    """Test that S-wave has no arrival for shallow source > 104°."""
    texture, manifest = load_texture()

    sampled = sample_texture(texture, manifest, 10.0, 110.0)
    sentinel = manifest["sentinel"]

    if sampled["S"] is not None:
        print(f"FAILED: S-wave should be shadowed at 10km, 110° but got {sampled['S']:.1f}s")
        return 1

    print("PASSED: S-wave core shadow detected at 10km, 110°")
    return 0


if __name__ == "__main__":
    rc = test_spot_checks()
    rc |= test_core_shadow()
    sys.exit(rc)
