#!/usr/bin/env python3
"""
Checks for the outline/label pipeline.

Round-trips the delta encoding, then checks the generated files against
known geography: the California coast passes near Los Angeles, the
US-Mexico border near El Paso, and Texas, California and the USA are
labelled where they belong.

Usage:
    python3 tools/pipeline/generate_geo.py   # writes app/public/geo/
    python3 tools/pipeline/test_geo.py
"""

import json
import math
import sys

from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, decode_polyline, encode_polyline

failures = []


def check(condition: bool, message: str) -> None:
    print(("ok   " if condition else "FAIL ") + message)
    if not condition:
        failures.append(message)


def nearest_point_deg(polylines: list[list[int]], lon: float, lat: float) -> float:
    """Smallest great-circle distance, in degrees, from (lon, lat) to any vertex."""
    best = math.inf
    la1 = math.radians(lat)
    for encoded in polylines:
        for plon, plat in decode_polyline(encoded):
            la2 = math.radians(plat)
            dlon = math.radians(plon - lon)
            c = math.sin(la1) * math.sin(la2) + math.cos(la1) * math.cos(la2) * math.cos(dlon)
            best = min(best, math.degrees(math.acos(max(-1.0, min(1.0, c)))))
    return best


# Encoding round trip, including repeated points that must be dropped.
points = [[-118.2437, 34.0522], [-118.2437, 34.0522], [-117.1611, 32.7157], [-122.4194, 37.7749]]
encoded = encode_polyline(points)
decoded = decode_polyline(encoded)
check(len(decoded) == 3, "repeated points are dropped")
check(
    all(abs(a - b) <= 0.5 / QUANTUM_PER_DEG for p, q in zip(decoded, [points[0], points[2], points[3]]) for a, b in zip(p, q)),
    "round trip within half a quantum",
)
check(encode_polyline([[1.0, 1.0], [1.001, 1.001]]) is None, "a line collapsing to one point is dropped")

outlines = json.loads((OUTPUT_DIR / "outlines.json").read_text(encoding="utf-8"))
layers = outlines["layers"]
check(set(layers) == {"coastline", "borders", "states"}, "all outline layers present")
check(nearest_point_deg(layers["coastline"], -118.40, 33.95) < 0.1, "coastline passes within 0.1° of LAX")
check(nearest_point_deg(layers["borders"], -106.49, 31.76) < 0.15, "US-Mexico border passes El Paso")
check(nearest_point_deg(layers["states"], -103.06, 33.0) < 0.15, "Texas-New Mexico line at 103°W")
check(nearest_point_deg(layers["coastline"], -97.74, 30.27) > 1.5, "Austin is inland")

labels = json.loads((OUTPUT_DIR / "labels.json").read_text(encoding="utf-8"))["labels"]
by_name = {(label["kind"], label["name"]): label for label in labels}
for key, lon, lat in [
    (("state", "Texas"), -99.0, 31.0),
    (("state", "California"), -119.5, 37.0),
    (("country", "United States of America"), -97.5, 39.5),
]:
    label = by_name.get(key)
    check(
        label is not None and abs(label["lon"] - lon) < 3 and abs(label["lat"] - lat) < 3,
        f"{key[0]} label {key[1]} near ({lon}, {lat})",
    )
kind_order = ["country", "state", "city"]
order = [(kind_order.index(label["kind"]), label["priority"]) for label in labels]
check(order == sorted(order), "labels sorted by kind, then priority")
names = [label["name"] for label in labels]
check(names.index("California") < names.index("Los Angeles"), "a state outranks a city inside it")

if failures:
    print(f"\n{len(failures)} check(s) failed")
    sys.exit(1)
print("\nall checks passed")
