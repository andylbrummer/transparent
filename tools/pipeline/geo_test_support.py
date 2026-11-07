"""Shared helpers for the pipeline's data checks (test_geo.py, test_geology.py)."""

import math
import sys

from generate_geo import decode_polyline

failures: list[str] = []


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


def finish() -> None:
    if failures:
        print(f"\n{len(failures)} check(s) failed")
        sys.exit(1)
    print("\nall checks passed")
