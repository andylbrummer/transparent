#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth.

Generates a 2-D travel-time texture (source depth × angular distance)
for P-waves, S-waves, and surface waves using ObsPy's TauP.

Output: tools/pipeline/output/traveltime.png (1024×512, 16-bit per channel)
        tools/pipeline/output/traveltime_manifest.json

Usage:
    python3 tools/pipeline/generate_traveltime.py

Requirements:
    pip install obspy numpy pillow
"""

import json
import os
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

# Configuration
MODEL_NAME = "ak135"
TEXTURE_WIDTH = 1024   # angular distance 0-180°
TEXTURE_HEIGHT = 512   # source depth 0-700 km
MAX_DEPTH_KM = 700.0
MAX_DISTANCE_DEG = 180.0
SENTINEL = 65535       # 16-bit max = no arrival (core shadow)


def generate_traveltime_texture():
    model = TauPyModel(MODEL_NAME)

    depths = np.linspace(0, MAX_DEPTH_KM, TEXTURE_HEIGHT)
    distances = np.linspace(0, MAX_DISTANCE_DEG, TEXTURE_WIDTH)

    # 16-bit unsigned channels: R=P, G=S, B=surface
    texture = np.zeros((TEXTURE_HEIGHT, TEXTURE_WIDTH, 3), dtype=np.uint16)

    for i, depth in enumerate(depths):
        if i % 50 == 0:
            print(f"Processing depth {depth:.1f} km ({i}/{TEXTURE_HEIGHT})")

        for j, distance in enumerate(distances):
            try:
                arrivals = model.get_travel_times(
                    source_depth_in_km=depth,
                    distance_in_degree=distance,
                    phase_list=["P", "S", "p", "s", "PP", "SS", "Rayleigh"]
                )

                p_time = SENTINEL
                s_time = SENTINEL
                surf_time = SENTINEL

                for arr in arrivals:
                    t = int(arr.time * 10)  # Store as deciseconds (max ~6553 s)
                    if t >= 65535:
                        t = 65534

                    if arr.name in ("P", "p", "PP") and p_time == SENTINEL:
                        p_time = t
                    elif arr.name in ("S", "s", "SS") and s_time == SENTINEL:
                        s_time = t
                    elif arr.name == "Rayleigh" and surf_time == SENTINEL:
                        surf_time = t

                texture[i, j, 0] = p_time
                texture[i, j, 1] = s_time
                texture[i, j, 2] = surf_time

            except Exception:
                # No arrival (core shadow, etc.)
                texture[i, j, 0] = SENTINEL
                texture[i, j, 1] = SENTINEL
                texture[i, j, 2] = SENTINEL

    return texture, depths, distances


def save_texture(texture, depths, distances):
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)

    # Save as 16-bit PNG
    img = Image.fromarray(texture, mode="RGB")
    png_path = output_dir / "traveltime.png"
    img.save(png_path)

    # Save manifest
    manifest = {
        "model": MODEL_NAME,
        "width": TEXTURE_WIDTH,
        "height": TEXTURE_HEIGHT,
        "maxDepthKm": MAX_DEPTH_KM,
        "maxDistanceDeg": MAX_DISTANCE_DEG,
        "sentinel": SENTINEL,
        "timeScale": 0.1,  # deciseconds to seconds
        "channels": {
            "R": "P-wave arrival time (s)",
            "G": "S-wave arrival time (s)",
            "B": "Surface wave arrival time (s)"
        },
        "depthSamples": depths.tolist(),
        "distanceSamples": distances.tolist(),
    }

    manifest_path = output_dir / "traveltime_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Saved: {png_path}")
    print(f"Saved: {manifest_path}")


def main():
    print("Generating ak135 travel-time texture...")
    texture, depths, distances = generate_traveltime_texture()
    save_texture(texture, depths, distances)
    print("Done.")


if __name__ == "__main__":
    main()
