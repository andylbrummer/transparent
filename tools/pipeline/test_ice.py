#!/usr/bin/env python3
"""
Data checks for the ice layers (generate_ice.py).

Pins the projection to the grid corners NSIDC publishes, the grids'
orientation to their own land mask, the land-ice mask to places that are
and are not under ice, and the baked sea-ice days to the Sea Ice Index's
own tables, read again here from the cached downloads.

Usage:
    python3 tools/pipeline/test_ice.py
"""

import datetime as dt
import json
import math

import numpy as np
from PIL import Image

from fetch_cache import CACHE_DIR
from generate_ice import (
    HEMISPHERES,
    OUT_DIR,
    polar_stereographic_inverse,
    read_daily_extents,
    read_extent_grid,
    read_median_extents,
    simplify,
    trace_ice_edge,
)
from geo_test_support import check, finish


def angular_distance(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    a = math.radians(lat1)
    b = math.radians(lat2)
    c = math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(math.radians(lon1 - lon2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def test_projection() -> None:
    # Corners of the 25 km grids, from NSIDC's "A Guide to NSIDC's Polar Stereographic Projection",
    # https://nsidc.org/data/user-resources/help-center/guide-nsidcs-polar-stereographic-projection
    # (grid corner tables): x, y in km -> latitude, longitude east.
    corners = [
        ("north", -3850, 5850, 30.98, 168.35),
        ("north", 3750, 5850, 31.37, 102.34),
        ("north", 3750, -5350, 34.35, 350.03),
        ("north", -3850, -5350, 33.92, 279.26),
        ("south", -3950, 4350, -39.23, 317.76),
        ("south", 3950, 4350, -39.23, 42.24),
        ("south", 3950, -3950, -41.45, 135.00),
        ("south", -3950, -3950, -41.45, 225.00),
    ]
    for hemisphere, x_km, y_km, lat, lon in corners:
        got_lon, got_lat = polar_stereographic_inverse(x_km * 1000.0, y_km * 1000.0, hemisphere)
        error = angular_distance(got_lon, got_lat, lon, lat)
        check(error < 0.01, f"{hemisphere} grid corner ({x_km}, {y_km}) km is {lat}, {lon}E (off by {error:.4f} deg)")
    for hemisphere, pole in (("north", 90.0), ("south", -90.0)):
        _, lat = polar_stereographic_inverse(0.0, 0.0, hemisphere)
        check(abs(lat - pole) < 1e-9, f"{hemisphere} grid origin is the pole")


def test_grid_orientation() -> None:
    """The grids' own land mask, read through our projection, must put land where land is."""
    places = [
        ("north", "Greenland summit", -38.46, 72.58, True),
        ("north", "central Siberia", 100.0, 65.0, True),
        ("north", "North Pole", 0.0, 90.0, False),
        ("north", "Norwegian Sea", 2.0, 68.0, False),
        ("north", "Hudson Bay", -86.0, 60.0, False),
        ("south", "South Pole", 0.0, -90.0, True),
        ("south", "Palmer Land, Antarctic Peninsula", -65.0, -71.5, True),
        ("south", "Weddell Sea", -40.0, -68.0, False),
        ("south", "Ross Sea", -175.0, -72.0, False),
        ("south", "Tierra del Fuego", -68.5, -54.0, True),
    ]
    grids = {}
    for hemisphere, (letter, _, _) in HEMISPHERES.items():
        path = sorted((CACHE_DIR / "ice").glob(f"{letter}_*_extent_v4.0.tif"))[-1]
        grid, origin, cell = read_extent_grid(path)
        rows, cols = grid.shape
        lons = np.zeros(grid.shape)
        lats = np.zeros(grid.shape)
        for r in range(rows):
            for c in range(cols):
                lons[r, c], lats[r, c] = polar_stereographic_inverse(origin[0] + (c + 0.5) * cell, origin[1] - (r + 0.5) * cell, hemisphere)
        grids[hemisphere] = (grid, lons, lats)
    for hemisphere, name, lon, lat, is_land in places:
        grid, lons, lats = grids[hemisphere]
        cos = np.sin(np.radians(lats)) * math.sin(math.radians(lat)) + np.cos(np.radians(lats)) * math.cos(math.radians(lat)) * np.cos(
            np.radians(lons - lon)
        )
        r, c = np.unravel_index(np.argmax(cos), grid.shape)
        value = int(grid[r, c])
        check((value == 254) == is_land, f"{name}: the grid says {'land' if value == 254 else 'sea or ice'} ({value})")


def test_tracing() -> None:
    grid = np.zeros((12, 12), dtype=np.uint8)
    grid[3:9, 3:9] = 1
    lines = trace_ice_edge(grid)
    check(len(lines) == 1 and lines[0][0] == lines[0][-1], "a block of ice traces to one closed line")
    xs = [p[0] for p in lines[0]]
    ys = [p[1] for p in lines[0]]
    check(min(xs) == 2.5 and max(xs) == 8.5 and min(ys) == 2.5 and max(ys) == 8.5, "the line runs midway between ice and water cells")
    grid[:, 0:5] = 254
    lines = trace_ice_edge(grid)
    check(len(lines) > 0 and all(p[0] >= 5 for line in lines for p in line), "no line where ice meets land")
    straight = [(float(i), 0.0) for i in range(10)]
    check(simplify(straight, 0.1) == [straight[0], straight[-1]], "a straight run thins to its ends")


def decode(flat: list[int]) -> list[tuple[float, float]]:
    return [(flat[i] / 100.0, flat[i + 1] / 100.0) for i in range(0, len(flat), 2)]


def mean_latitude(lines: list[list[int]]) -> float:
    points = [p for line in lines for p in decode(line)]
    return sum(lat for _, lat in points) / len(points)


def test_sea_ice() -> None:
    document = json.loads((OUT_DIR / "sea-ice-extent.json").read_text())
    days = document["days"]
    check(len(days) == 25, f"25 days baked (got {len(days)})")
    dates = [dt.date.fromisoformat(day["date"]) for day in days]
    check(dates == sorted(dates) and (dates[-1] - dates[0]).days <= 366, "days in order, spanning a year at most")
    check(document["medianPeriod"] == "1981-2010", "median period stated")
    newest = dates[-1]
    for hemisphere, (letter, _, _) in HEMISPHERES.items():
        extents = read_daily_extents(CACHE_DIR / "ice" / f"{letter}_daily_{newest}.csv")
        medians = read_median_extents(CACHE_DIR / "ice" / f"{letter}_climatology.csv")
        ok = all(
            day[hemisphere]["extentMkm2"] == extents[date] and day[hemisphere]["medianMkm2"] == medians[date.timetuple().tm_yday]
            for day, date in zip(days, dates)
        )
        check(ok, f"{hemisphere}: every day's extent and median are the Sea Ice Index's own figures")
        sign = 1 if hemisphere == "north" else -1
        bad = [
            f"{day['date']} {key}"
            for day in days
            for key in ("edge", "median")
            if sum(len(line) for line in day[hemisphere][key]) < 100
            or not all(sign * lat > 38 for line in day[hemisphere][key] for _, lat in decode(line))
        ]
        check(not bad, f"{hemisphere}: every line has 50+ vertices, all poleward of 38 deg in its own hemisphere {bad[:3]}")

    by_date = {day["date"]: day for day in days}
    march, september = by_date["2026-03-15"], by_date["2026-09-15"]
    check(
        mean_latitude(september["north"]["edge"]) > mean_latitude(march["north"]["edge"]) + 5,
        f"Arctic edge in September (mean {mean_latitude(september['north']['edge']):.1f}N) is far north of March's "
        f"({mean_latitude(march['north']['edge']):.1f}N)",
    )
    check(
        mean_latitude(september["south"]["edge"]) > mean_latitude(march["south"]["edge"]) + 5,
        f"Antarctic edge in September (mean {-mean_latitude(september['south']['edge']):.1f}S) is far north of March's "
        f"({-mean_latitude(march['south']['edge']):.1f}S)",
    )
    check(march["north"]["extentMkm2"] > 2.5 * september["north"]["extentMkm2"], "Arctic extent in March is over 2.5 times September's")

    # The September median edge, a climatology: ice runs down the east coast of Greenland through the Fram
    # Strait, and the southern Barents Sea is open water.
    points = [p for line in september["north"]["median"] for p in decode(line)]
    near_greenland = min(angular_distance(lon, lat, -15.0, 75.0) for lon, lat in points)
    near_barents = min(angular_distance(lon, lat, 35.0, 72.0) for lon, lat in points)
    check(near_greenland < 6, f"September median edge passes East Greenland ({near_greenland:.1f} deg from 75N 15W)")
    check(near_barents > 4, f"September median edge stays out of the southern Barents Sea ({near_barents:.1f} deg from 72N 35E)")


def test_land_ice() -> None:
    mask = Image.open(OUT_DIR / "ice-mask.png").convert("RGB")
    check(mask.size == (4096, 2048), f"mask is 4096x2048 (got {mask.size})")

    def at(lon: float, lat: float) -> tuple[int, int, int]:
        return mask.getpixel((int((lon + 180) / 360 * mask.width) % mask.width, min(mask.height - 1, int((90 - lat) / 180 * mask.height))))

    ice = [
        ("Greenland summit", -38.46, 72.58),
        ("Vatnajökull", -16.8, 64.4),
        ("South Pole", 0.0, -89.9),
        ("Vostok", 106.8, -78.5),
        ("Southern Patagonian Ice Field", -73.25, -49.5),
        ("Devon Ice Cap", -82.3, 75.3),
    ]
    bare = [("Sahara", 10.0, 23.0), ("Austin", -97.74, 30.27), ("Amazon", -60.0, -3.0), ("mid Pacific", -150.0, 0.0), ("Reykjavik", -21.9, 64.15)]
    for name, lon, lat in ice:
        check(at(lon, lat)[0] > 200, f"land ice at {name}")
    for name, lon, lat in bare:
        check(at(lon, lat)[0] == 0 and at(lon, lat)[1] == 0, f"no ice at {name}")
    for name, lon, lat in [("Ross Ice Shelf", -175.0, -81.5), ("Ronne Ice Shelf", -62.0, -78.5), ("Amery Ice Shelf", 71.0, -70.0)]:
        check(at(lon, lat)[1] > 200 and at(lon, lat)[0] < 50, f"ice shelf, not grounded ice, at {name}")

    labels = {label["name"]: label for label in json.loads((OUT_DIR / "ice.json").read_text())["labels"]}
    for name, lon, lat, tolerance in [("Vatnajökull", -16.8, 64.4, 0.6), ("Ross Ice Shelf", -175.0, -81.5, 4.0), ("Devon Ice Cap", -82.3, 75.3, 1.0)]:
        label = labels.get(name)
        ok = label is not None and angular_distance(label["lon"], label["lat"], lon, lat) < tolerance
        check(ok, f"{name} is labelled where it is ({label and (label['lon'], label['lat'])})")
    vatna = labels.get("Vatnajökull", {}).get("areaKm2", 0)
    greenland = labels.get("Greenland Ice Sheet", {}).get("areaKm2", 0)
    # 1.71 million km2 (NSIDC); the outline includes peripheral ice.
    check(1_600_000 < greenland < 1_900_000, f"Greenland Ice Sheet holds 1.6-1.9 million km2 (got {greenland})")
    # About 7,700 km2 today (Icelandic Met Office); Natural Earth's outline is generalised.
    check(6500 < vatna < 9500, f"Vatnajökull's outline holds 6,500-9,500 km2 (got {vatna})")
    ross = labels.get("Ross Ice Shelf", {}).get("areaKm2", 0)
    check(300_000 < ross < 560_000, f"Ross Ice Shelf's largest part holds 300-560 thousand km2 (got {ross})")


if __name__ == "__main__":
    test_projection()
    test_grid_orientation()
    test_tracing()
    test_sea_ice()
    test_land_ice()
    finish()
