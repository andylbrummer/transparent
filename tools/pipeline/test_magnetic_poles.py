#!/usr/bin/env python3
"""
Data checks for generate_magnetic_poles.py's output.

The tracks are whole (a position a year, 1590 to 2025, and the forecast to
2030), move without jumps, end where NOAA's page says the poles are, and
show the thing the layer is there to show: the north pole near-still off
Canada for three centuries, then leaving for Siberia at tens of kilometres
a year, while the south pole ambles.

Usage:
    python3 tools/pipeline/test_magnetic_poles.py
"""

import json
import math

from generate_magnetic_poles import OUTPUT
from geo_test_support import check, finish


def distance_km(a: list[float], b: list[float]) -> float:
    la1, la2 = math.radians(a[2]), math.radians(b[2])
    dl = math.radians(b[1] - a[1])
    return 6371.0 * math.acos(max(-1.0, min(1.0, math.sin(la1) * math.sin(la2) + math.cos(la1) * math.cos(la2) * math.cos(dl))))


def main() -> None:
    data = json.loads(OUTPUT.read_text())
    check(OUTPUT.stat().st_size < 30_000, f"{OUTPUT.stat().st_size / 1024:.0f} KB")
    for hemisphere in ("north", "south"):
        model = data[hemisphere]["model"]
        forecast = data[hemisphere]["forecast"]
        check([row[0] for row in model] == list(range(1590, 2026)), f"{hemisphere}: a position every year 1590-2025 ({len(model)})")
        check([row[0] for row in forecast] == list(range(2025, 2031)), f"{hemisphere}: forecast every year 2025-2030")
        check(all(-180 <= row[1] <= 180 and -90 <= row[2] <= 90 for row in model + forecast), f"{hemisphere}: longitudes and latitudes in range")
        worst = max(distance_km(a, b) for a, b in zip(model, model[1:]))
        check(worst < 80, f"{hemisphere}: no jump - the largest move in a year is {worst:.0f} km")
        gap = distance_km(model[-1], forecast[0])
        check(gap < 60, f"{hemisphere}: the forecast's 2025 is {gap:.0f} km from the model's 2025 (two models of one field)")

    north = {row[0]: row for row in data["north"]["model"]}
    south = {row[0]: row for row in data["south"]["model"]}
    # NOAA's page, read 2026-11-10: "Based on the current WMM, the 2025 location of the North Magnetic Pole is
    # 85.762 N and 139.298 E and the South Magnetic Pole is 63.851 S and 135.078 E."
    wmm_north, wmm_south = data["north"]["forecast"][0], data["south"]["forecast"][0]
    check(wmm_north[1:] == [139.298, 85.762], f"north pole 2025 by WMM: {wmm_north[2]} N {wmm_north[1]} E (NOAA's page: 85.762 N 139.298 E)")
    check(abs(wmm_south[2] + 63.851) < 0.001 and abs(wmm_south[1] - 135.078) < 0.02, f"south pole 2025 by WMM: {-wmm_south[2]} S {wmm_south[1]} E (NOAA's page: 63.851 S 135.078 E)")
    check(north[1900][2] > 69 and north[1900][2] < 72 and -100 < north[1900][1] < -93, f"north pole 1900 in the Canadian Arctic ({north[1900][2]} N {-north[1900][1]} W)")
    check(south[1900][2] < -70 and 140 < south[1900][1] < 155, f"south pole 1900 inland in Antarctica ({-south[1900][2]} S {south[1900][1]} E)")
    check(south[2025][2] > -66.5, f"south pole 2025 is off the coast, north of the Antarctic circle ({-south[2025][2]} S)")

    def speed(track: dict[int, list[float]], start: int, end: int) -> float:
        return distance_km(track[start], track[end]) / (end - start)

    check(speed(north, 1900, 1910) < 10, f"north pole 1900-1910: {speed(north, 1900, 1910):.1f} km a year")
    check(45 < speed(north, 2000, 2010) < 60, f"north pole 2000-2010: {speed(north, 2000, 2010):.1f} km a year")
    check(35 < speed(north, 2020, 2025) < 45, f"north pole 2020-2025: {speed(north, 2020, 2025):.1f} km a year")
    check(speed(south, 2020, 2025) < 12, f"south pole 2020-2025: {speed(south, 2020, 2025):.1f} km a year")
    check(north[2025][2] > north[1900][2] + 14, f"the north pole has gone {north[2025][2] - north[1900][2]:.1f} degrees of latitude poleward since 1900")
    # The poles are not opposite each other.
    antipode_gap = distance_km(north[2025], [2025, (south[2025][1] + 360) % 360 - 180, -south[2025][2]])
    check(antipode_gap > 2000, f"the two poles are not antipodal: the north one is {antipode_gap:.0f} km from the point opposite the south one")

    finish()


if __name__ == "__main__":
    main()
