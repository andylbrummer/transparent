#!/usr/bin/env python3
"""
Data checks for generate_sks_splitting.py.

The averaging first: fast directions are axes, so 170 and 10 degrees
average to 0, not 90. Then the compilation against what its sources
report: a typical delay about a second (Silver, P.G. 1996, Seismic
anisotropy beneath the continents: probing the depths of geology, Annu.
Rev. Earth Planet. Sci. 24, 385-432); fast directions close to east-west
across southern California (Polet, J. & Kanamori, H. 2002, Anisotropy
beneath California: shear wave splitting measurements using a dense
broadband array, Geophys. J. Int. 149, 313-327; its abstract, read on
2026-11-11, says only that the region fits a single layer and that the
fast directions are "generally orthogonal to the maximum horizontal
compressive stress", which there is near north-south: the east-west
figure is that inference, not a quoted number) and along the Pyrenees,
about N100E, parallel to the range (Barruol, G. et al. 1998, Lithospheric
anisotropy beneath the Pyrenees from shear wave splitting, J. Geophys.
Res. 103, 30039-30053). And the file decodes to what was computed.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_sks_splitting.py
"""

import json
import statistics

from generate_sks_splitting import FIELDS, OUT_JSON, axial_mean, measurements, read_rows, stations
from geo_test_support import check, finish


def region(result: list[dict], west: float, east: float, south: float, north: float) -> tuple[int, float, float]:
    inside = [s for s in result if s["split"] and west <= s["lon"] <= east and south <= s["lat"] <= north]
    phi, strength = axial_mean([s["phi"] for s in inside])
    return len(inside), phi, strength


def main() -> None:
    phi, strength = axial_mean([170, 10])
    check(min(phi, 180 - phi) < 1e-9 and abs(strength - 0.9397) < 1e-3, f"170 and 10 average to 0 ({phi:.3f}, R {strength:.3f})")
    phi, strength = axial_mean([0, 90])
    check(strength < 1e-9, f"crossed directions have no mean (R {strength:.3f})")

    rows = read_rows()
    kept, dropped = measurements(rows)
    check(len(rows) > 65_000, f"over 65,000 rows in the database ({len(rows)})")
    check(len(kept) > 0.95 * len(rows), f"over 95% kept ({len(kept)}; dropped {dropped})")
    result = stations(kept)
    check(len(result) > 12_000, f"over 12,000 stations ({len(result)})")
    nulls = sum(1 for s in result if s["split"] == 0)
    check(0 < nulls < 0.05 * len(result), f"stations with only nulls: a few per cent ({nulls})")

    delays = [s["dt"] for s in result if s["split"]]
    median = statistics.median(delays)
    check(0.8 <= median <= 1.3, f"median delay about a second ({median:.2f} s)")
    check(max(delays) < 5, f"no delay of 5 s or more ({max(delays):.2f} s)")

    count, phi, strength = region(result, -119, -115, 32.5, 35)
    check(count > 100 and 70 <= phi <= 110 and strength > 0.6, f"southern California: east-west ({count} stations, {phi:.0f} deg, R {strength:.2f})")
    count, phi, strength = region(result, -2, 3, 42, 43.5)
    check(count > 50 and 85 <= phi <= 115 and strength > 0.6, f"Pyrenees: along the range, about N100E ({count} stations, {phi:.0f} deg, R {strength:.2f})")

    data = json.loads(OUT_JSON.read_text())
    flat = data["stations"]
    check(data["fields"] == FIELDS and len(flat) == FIELDS * len(result), f"{FIELDS} numbers a station ({len(flat)})")
    decoded = [flat[i : i + FIELDS] for i in range(0, len(flat), FIELDS)]
    check(all(0 <= d[2] < 180 and 0 <= d[3] < 500 and 0 <= d[6] <= 100 for d in decoded), "phi 0-179, dt under 5 s, R 0-100")
    check(all(abs(d[0] - round(s["lon"] * 100)) == 0 and abs(d[3] - round(s["dt"] * 100)) == 0 for d, s in zip(decoded, result)), "the file holds what was computed")
    check(OUT_JSON.stat().st_size < 400_000, f"file under 400 kB ({OUT_JSON.stat().st_size} bytes)")
    finish()


if __name__ == "__main__":
    main()
