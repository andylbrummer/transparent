#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth.

Generates a 2-D travel-time texture (source depth × angular distance)
for P-waves, S-waves, and surface waves using ObsPy's TauP.

Output: tools/pipeline/output/traveltime.bin (height × width × 3, uint16 LE)
        tools/pipeline/output/traveltime_manifest.json

Raw uint16 rather than a 16-bit PNG: browsers decode PNGs to 8 bits per
channel before WebGL sees them, which would throw away the precision the
16-bit encoding exists for. The app fetches the .bin into a Uint16Array.

Usage:
    python3 tools/pipeline/generate_traveltime.py [--width W] [--height H]

Requirements:
    pip install obspy numpy
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    from obspy.taup import TauPyModel
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install: pip install obspy numpy")
    sys.exit(1)

# Configuration
MODEL_NAME = "ak135"
TEXTURE_WIDTH = 1024   # angular distance 0-180°
TEXTURE_HEIGHT = 512   # source depth 0-700 km
MAX_DEPTH_KM = 700.0
MAX_DISTANCE_DEG = 180.0
SENTINEL = 65535       # 16-bit max = no arrival (core shadow)

# Direct body waves only, so the core shadow zones stay empty. TauP names
# surface waves by group velocity; 3.5 km/s approximates Rayleigh waves.
P_PHASES = ("P", "p")
S_PHASES = ("S", "s")
SURFACE_PHASE = "3.5kmps"
PHASE_LIST = [*P_PHASES, *S_PHASES, SURFACE_PHASE]


def generate_traveltime_texture(width, height):
    model = TauPyModel(MODEL_NAME)

    depths = np.linspace(0, MAX_DEPTH_KM, height)
    distances = np.linspace(0, MAX_DISTANCE_DEG, width)

    # 16-bit unsigned channels: R=P, G=S, B=surface
    texture = np.full((height, width, 3), SENTINEL, dtype=np.uint16)

    for i, depth in enumerate(depths):
        if i % 50 == 0:
            print(f"Processing depth {depth:.1f} km ({i}/{height})")

        for j, distance in enumerate(distances):
            # A shadowed phase simply has no arrival; TauP raises only on
            # bad input, which must stop the run rather than become data.
            arrivals = model.get_travel_times(
                source_depth_in_km=depth,
                distance_in_degree=distance,
                phase_list=PHASE_LIST,
            )

            # Arrivals come sorted by time, so the first match per channel wins.
            for arr in arrivals:
                t = min(int(round(arr.time * 10)), SENTINEL - 1)  # deciseconds
                if arr.name in P_PHASES:
                    channel = 0
                elif arr.name in S_PHASES:
                    channel = 1
                elif arr.name == SURFACE_PHASE:
                    channel = 2
                else:
                    continue
                if texture[i, j, channel] == SENTINEL:
                    texture[i, j, channel] = t

    return texture, depths, distances


def save_texture(texture, depths, distances):
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)
    height, width = texture.shape[:2]

    # Row-major height × width × 3, little-endian, written via a temp file
    # and renamed so a crash never leaves a truncated texture behind.
    bin_path = output_dir / "traveltime.bin"
    tmp_path = bin_path.with_suffix(".bin.tmp")
    texture.astype("<u2").tofile(tmp_path)
    tmp_path.replace(bin_path)

    manifest = {
        "model": MODEL_NAME,
        "format": "uint16le",
        "layout": "height x width x 3 (R=P, G=S, B=surface), row = depth",
        "width": width,
        "height": height,
        "maxDepthKm": MAX_DEPTH_KM,
        "maxDistanceDeg": MAX_DISTANCE_DEG,
        "sentinel": SENTINEL,
        "timeScale": 0.1,  # deciseconds to seconds
        "channels": {
            "R": "P-wave arrival time (s)",
            "G": "S-wave arrival time (s)",
            "B": "Surface wave (3.5 km/s) arrival time (s)"
        },
        "depthSamples": depths.tolist(),
        "distanceSamples": distances.tolist(),
    }

    manifest_path = output_dir / "traveltime_manifest.json"
    tmp_manifest = manifest_path.with_suffix(".json.tmp")
    with open(tmp_manifest, "w") as f:
        json.dump(manifest, f, indent=2)
    tmp_manifest.replace(manifest_path)

    print(f"Saved: {bin_path}")
    print(f"Saved: {manifest_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--width", type=int, default=TEXTURE_WIDTH, help="distance samples")
    parser.add_argument("--height", type=int, default=TEXTURE_HEIGHT, help="depth samples")
    args = parser.parse_args()

    print(f"Generating {MODEL_NAME} travel-time texture ({args.width}x{args.height})...")
    texture, depths, distances = generate_traveltime_texture(args.width, args.height)
    save_texture(texture, depths, distances)
    print("Done.")


if __name__ == "__main__":
    main()
