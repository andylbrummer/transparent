#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the depth ladder.

Writes app/public/geo/depth-ladder.json: pressure, density and
temperature at the rungs the app marks along the line straight down from
the user (spec/ux.md: 100 km, 1,000 km, the core-mantle boundary, the
centre, the antipode) and at the discontinuities between.

Pressure and density:
    PREM - Dziewonski, A.M. & Anderson, D.L. (1981), Preliminary
    reference Earth model, Phys. Earth Planet. Inter. 25, 297-356 - as
    tabulated with BurnMan (github.com/geodynamics/burnman,
    burnman/data/input_seismic/prem.txt: depth, radius, pressure,
    density, Vp, Vs; the model without its ocean). A radial average: the
    real Earth differs from it by a per cent or so from place to place.

Temperature:
    The geotherm of Anderson, O.L. (1982), The Earth's core and the phase
    diagram of iron, Phil. Trans. R. Soc. A 306, 21-35, as tabulated with
    BurnMan (input_geotherm/anderson_82.txt). Temperature is the least
    known of the three: no one has measured it below a few km, and
    estimates for the core differ by a thousand kelvin and more. The app
    says so.

Both tables are read at each rung's depth by linear interpolation. Where
a rung is a discontinuity - a table lists the depth twice, with different
values - density and temperature are given on both sides, above then
below: at the core-mantle boundary the rock is 5.57 g/cm3 and the liquid
iron under it 9.90, and Anderson's temperature steps 700 K across the
thermal boundary layer.

Output:
    {sources, rungs: [{depthKm, name?, pressureGPa, densityGcm3: [above, below?], temperatureK: [above, below?]}]}

Usage:
    python3 tools/pipeline/generate_depth_ladder.py
"""

import sys
from pathlib import Path

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

BURNMAN = "https://raw.githubusercontent.com/geodynamics/burnman/main/burnman/data/"
EARTH_RADIUS_KM = 6371.0
# Anderson's table puts the 670 km discontinuity at 671 km and the core-mantle boundary at 2886 km; PREM, at 670 and 2891.
BOUNDARY_TOLERANCE_M = 6000.0
# (depth km, name). PREM's own boundary depths: 24.4 Moho, 400 and 670 km discontinuities, 2891 CMB, 5149.5 ICB.
RUNGS = [
    (100.0, None),
    (400.0, "400 km discontinuity"),
    (670.0, "670 km discontinuity"),
    (1000.0, None),
    (2000.0, None),
    (2891.0, "core–mantle boundary"),
    (5149.5, "inner core boundary"),
    (EARTH_RADIUS_KM, "centre of the Earth"),
]


def read_table(path: Path) -> list[list[float]]:
    return [[float(v) for v in line.split()] for line in path.read_text().splitlines() if line.strip() and not line.startswith("#")]


def above(table: list[list[float]], depth_m: float, column: int) -> float:
    """The table's value at a depth, linearly between rows; at a listed depth, the first row's (the shallow side's)."""
    for a, b in zip(table, table[1:]):
        if a[0] <= depth_m <= b[0]:
            if depth_m == a[0] or b[0] == a[0]:
                return a[column]
            if depth_m == b[0]:
                return b[column]
            t = (depth_m - a[0]) / (b[0] - a[0])
            return a[column] + t * (b[column] - a[column])
    raise ValueError(f"{depth_m} m is outside the table")


def sides(table: list[list[float]], depth_m: float, column: int) -> list[float]:
    """[value] at a depth - or, where the table has a discontinuity within BOUNDARY_TOLERANCE_M of it,
    [value just above, value just below]: the two tables put the same boundary a few km apart."""
    for a, b in zip(table, table[1:]):
        if a[0] == b[0] and abs(a[0] - depth_m) <= BOUNDARY_TOLERANCE_M and a[column] != b[column]:
            return [a[column], b[column]]
    return [above(table, depth_m, column)]


def load_tables() -> tuple[list[list[float]], list[list[float]]]:
    prem = read_table(cached_fetch(BURNMAN + "input_seismic/prem.txt", "ladder/prem.txt"))
    geotherm = read_table(cached_fetch(BURNMAN + "input_geotherm/anderson_82.txt", "ladder/anderson_82.txt"))
    return prem, geotherm


def main() -> None:
    prem, geotherm = load_tables()
    rungs = []
    for depth_km, name in RUNGS:
        rung: dict = {"depthKm": depth_km}
        if name:
            rung["name"] = name
        rung["pressureGPa"] = round(above(prem, depth_km * 1000, 2) / 1e9, 2)
        rung["densityGcm3"] = [round(v / 1000, 2) for v in sides(prem, depth_km * 1000, 3)]
        rung["temperatureK"] = [round(v) for v in sides(geotherm, depth_km * 1000, 1)]
        rungs.append(rung)
        print(rung, file=sys.stderr)
    write_json(OUTPUT_DIR / "depth-ladder.json", {
        "sources": {
            "pressure, density": "PREM, Dziewonski & Anderson (1981), Phys. Earth Planet. Inter. 25, 297, as tabulated with BurnMan",
            "temperature": "Anderson, O.L. (1982), Phil. Trans. R. Soc. A 306, 21, as tabulated with BurnMan",
        },
        "earthRadiusKm": EARTH_RADIUS_KM,
        "rungs": rungs,
    })


if __name__ == "__main__":
    main()
