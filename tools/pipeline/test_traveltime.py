#!/usr/bin/env python3
"""
Spot-check test for travel-time texture against ObsPy TauP.

Compares 20 random texels of the generated texture against freshly
computed ObsPy arrivals at that texel's exact (depth, distance), and checks
that the core shadow zones hold no direct arrivals. Passes if every sample
matches to within the texture's decisecond quantisation.

Usage:
    python3 tools/pipeline/test_traveltime.py
"""

import json
import random
import sys
from pathlib import Path

try:
    import numpy as np
    from obspy.taup import TauPyModel
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install: pip install obspy numpy")
    sys.exit(1)

from generate_traveltime import P_PHASES, S_PHASES, SURFACE_PHASE, PHASE_LIST

# Stored times are rounded to 0.1 s.
TOLERANCE_S = 0.05 + 1e-6


def load_texture():
    output_dir = Path(__file__).parent / "output"
    with open(output_dir / "traveltime_manifest.json") as f:
        manifest = json.load(f)

    assert manifest["format"] == "uint16le", manifest["format"]
    texture = np.fromfile(output_dir / "traveltime.bin", dtype="<u2").reshape(
        manifest["height"], manifest["width"], 3
    )
    return texture, manifest


def decode(value, manifest):
    return None if value == manifest["sentinel"] else value * manifest["timeScale"]


def first_arrival(arrivals, names):
    return next((arr.time for arr in arrivals if arr.name in names), None)


def test_spot_checks():
    texture, manifest = load_texture()
    model = TauPyModel(manifest["model"])
    depths = manifest["depthSamples"]
    distances = manifest["distanceSamples"]

    random.seed(42)
    errors = []

    for _ in range(20):
        i = random.randrange(manifest["height"])
        j = random.randrange(manifest["width"])
        depth, distance = depths[i], distances[j]

        arrivals = model.get_travel_times(
            source_depth_in_km=depth,
            distance_in_degree=distance,
            phase_list=PHASE_LIST,
        )

        for channel, label, names in (
            (0, "P", P_PHASES),
            (1, "S", S_PHASES),
            (2, "surface", (SURFACE_PHASE,)),
        ):
            sampled = decode(texture[i, j, channel], manifest)
            expected = first_arrival(arrivals, names)
            where = f"{label} at ({depth:.1f}km, {distance:.2f}°)"
            if (sampled is None) != (expected is None):
                errors.append(f"{where}: texture={sampled}, expected={expected}")
            elif sampled is not None and abs(sampled - expected) > TOLERANCE_S:
                errors.append(f"{where}: texture={sampled:.2f}s, expected={expected:.2f}s")

    if errors:
        print(f"FAILED: {len(errors)} spot check(s) disagree with TauP:")
        for e in errors:
            print(f"  {e}")
        return 1

    print("PASSED: 20 spot checks match TauP")
    return 0


def test_core_shadow():
    """Direct P and S must be absent inside their core shadow zones."""
    texture, manifest = load_texture()
    depths = np.array(manifest["depthSamples"])
    distances = np.array(manifest["distanceSamples"])

    def texel(depth_km, distance_deg):
        i = int(np.abs(depths - depth_km).argmin())
        j = int(np.abs(distances - distance_deg).argmin())
        return texture[i, j]

    failures = []
    if decode(texel(10.0, 110.0)[1], manifest) is not None:
        failures.append("S should be shadowed at 10km, 110°")
    if decode(texel(10.0, 120.0)[0], manifest) is not None:
        failures.append("P should be shadowed at 10km, 120°")

    if failures:
        for f in failures:
            print(f"FAILED: {f}")
        return 1

    print("PASSED: P and S core shadows present")
    return 0


if __name__ == "__main__":
    rc = test_spot_checks()
    rc |= test_core_shadow()
    sys.exit(rc)
