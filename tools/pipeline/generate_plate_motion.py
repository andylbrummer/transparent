#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: plate motion arrows.

Writes app/public/geo/plate-motion.json: one arrow per point of an even
grid over the globe, showing how the plate under it moves in the
no-net-rotation frame. Each arrow is the path the point travels in
ARROW_MYR million years, so arrow length reads as speed.

Source (see app/public/geo/ATTRIBUTION.md):

    Argus, Gordon & DeMets (2011), Geologically current motion of 56 plates
    relative to the no-net-rotation reference frame, G3 12, Q11001,
    doi:10.1029/2011GC003751 (NNR-MORVEL56). Angular velocities and plate
    outlines as packaged by the MIT-licensed `platemotion` Python package
    (github.com/lcx366/PlateTectonic), which took them from the MORVEL
    pages of C. DeMets; every angular velocity was checked against the
    paper's Table 1. The package spells Sandwich and Scotia "SW"/"SC";
    the paper and the outlines use "sw"/"sc" (and "NB" is North Bismarck,
    distinct from Nubia "nb"), so codes are matched case-sensitively after
    that fix.

Output uses the delta polyline encoding of outlines.json (see
generate_geo.py) with one layer, "plate-motion": one polyline per arrow,
base -> tip -> barb -> tip -> barb, so the first point is where the
velocity was sampled. Longitudes stay continuous across the antimeridian
within an arrow, so no segment wraps.

Usage:
    python3 tools/pipeline/generate_plate_motion.py --source-dir DIR

DIR holds NNR_MRV56.csv and NnrMRVL_PltBndsLatLon/All_boundaries from the
platemotion wheel (platemotion/data/). Requires only the standard library.
"""

import argparse
import csv
import io
import math
import sys
import urllib.request
import zipfile
from pathlib import Path

from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, encode_polyline, write_json

PLATEMOTION_WHEEL_URL = ("https://files.pythonhosted.org/packages/37/43/"
                         "e4defd6fffa86659d1ecec92d8a53ef5ddb19240ed32808dacc6dcbecb3f/"
                         "platemotion-0.1.7-py3-none-any.whl")
POLES_MEMBER = "platemotion/data/NNR_MRV56.csv"
OUTLINES_MEMBER = "platemotion/data/NnrMRVL_PltBndsLatLon/All_boundaries"
# The package's spellings that differ from the paper and the outline file.
CODE_FIXES = {"SW": "sw", "SC": "sc"}

EARTH_RADIUS_KM = 6371.0
# ~1650 points: one arrow per ~550 km, sparser than any plate is wide.
GRID_POINTS = 1650
# 100 mm/yr (= 100 km/Myr) draws a 300 km arrow, under the grid spacing.
ARROW_MYR = 3.0
HEAD_FRACTION = 0.3
HEAD_ANGLE_DEG = 28.0
# Below this an arrow is shorter than a few pixels at any distance.
MIN_SPEED_MM_YR = 2.0


def load_sources(source_dir: Path | None) -> tuple[str, str]:
    if source_dir is not None:
        return ((source_dir / "NNR_MRV56.csv").read_text(encoding="utf-8"),
                (source_dir / "NnrMRVL_PltBndsLatLon" / "All_boundaries").read_text(encoding="utf-8"))
    print(f"fetching {PLATEMOTION_WHEEL_URL}", file=sys.stderr)
    with urllib.request.urlopen(PLATEMOTION_WHEEL_URL, timeout=180) as response:
        wheel = zipfile.ZipFile(io.BytesIO(response.read()))
    return wheel.read(POLES_MEMBER).decode("utf-8"), wheel.read(OUTLINES_MEMBER).decode("utf-8")


def parse_poles(text: str) -> dict[str, dict]:
    """Plate code -> name and angular velocity vector in rad/Myr (ECEF axes)."""
    poles = {}
    for row in csv.reader(text.splitlines()):
        if len(row) < 5 or not row[2] or row[2][0] not in "-0123456789":
            continue  # header and section rows
        name, code, lat, lon, rate = row[0], CODE_FIXES.get(row[1], row[1]), float(row[2]), float(row[3]), float(row[4])
        w = math.radians(rate)
        la, lo = math.radians(lat), math.radians(lon)
        poles[code] = {"name": name, "omega": (w * math.cos(la) * math.cos(lo), w * math.cos(la) * math.sin(lo),
                                               w * math.sin(la))}
    return poles


def parse_outlines(text: str) -> dict[str, list[tuple[float, float]]]:
    """Plate code -> closed outline as (lon, lat), from 'code' header lines and 'lat lon' rows."""
    outlines: dict[str, list[tuple[float, float]]] = {}
    current = None
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if len(parts) == 1:
            current = parts[0]
            outlines[current] = []
        else:
            outlines[current].append((float(parts[1]), float(parts[0])))
    return outlines


def unit(lon: float, lat: float) -> tuple[float, float, float]:
    la, lo = math.radians(lat), math.radians(lon)
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b) -> tuple[float, float, float]:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


class SphericalPolygon:
    """Containment by winding: the outline's turning angle seen from the point
    is +-360 degrees inside and 0 outside, valid while the polygon holds no
    antipodal pair, which every plate satisfies. A bounding cap skips most
    polygons cheaply."""

    def __init__(self, ring: list[tuple[float, float]]):
        self.vertices = [unit(lon, lat) for lon, lat in ring]
        if self.vertices[0] != self.vertices[-1]:
            self.vertices.append(self.vertices[0])
        cx = sum(v[0] for v in self.vertices)
        cy = sum(v[1] for v in self.vertices)
        cz = sum(v[2] for v in self.vertices)
        norm = math.sqrt(cx * cx + cy * cy + cz * cz)
        self.centre = (cx / norm, cy / norm, cz / norm) if norm > 1e-9 else None
        self.cap_cos = min(dot(self.centre, v) for v in self.vertices) if self.centre else -1.0

    def contains(self, p: tuple[float, float, float]) -> bool:
        if self.centre is not None and self.cap_cos > -0.99 and dot(self.centre, p) < self.cap_cos - 1e-9:
            return False
        total = 0.0
        prev = None
        for v in self.vertices:
            # Direction of v as seen from p, in p's tangent plane.
            t = (v[0] - p[0] * dot(p, v), v[1] - p[1] * dot(p, v), v[2] - p[2] * dot(p, v))
            if prev is not None:
                total += math.atan2(dot(p, cross(prev, t)), dot(prev, t))
            prev = t
        return abs(total) > math.pi


def fibonacci_grid(n: int) -> list[tuple[float, float]]:
    """Evenly spread (lon, lat) points."""
    golden = math.pi * (3 - math.sqrt(5))
    points = []
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        points.append((math.degrees(math.remainder(i * golden, 2 * math.pi)), math.degrees(math.asin(z))))
    return points


def east_north_velocity(omega, lon: float, lat: float) -> tuple[float, float]:
    """Surface velocity (mm/yr = km/Myr) as east and north components."""
    r = unit(lon, lat)
    v = cross(omega, r)
    v = (v[0] * EARTH_RADIUS_KM, v[1] * EARTH_RADIUS_KM, v[2] * EARTH_RADIUS_KM)
    lo, la = math.radians(lon), math.radians(lat)
    east = (-math.sin(lo), math.cos(lo), 0.0)
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    return dot(v, east), dot(v, north)


def destination(lon: float, lat: float, azimuth_deg: float, distance_km: float) -> tuple[float, float]:
    """Great-circle destination, longitude kept continuous with `lon`."""
    d = distance_km / EARTH_RADIUS_KM
    la1, lo1, az = math.radians(lat), math.radians(lon), math.radians(azimuth_deg)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(az))
    lo2 = lo1 + math.atan2(math.sin(az) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(lo2), math.degrees(la2)


def initial_bearing(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    la1, la2, dlo = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    return math.degrees(math.atan2(math.sin(dlo) * math.cos(la2),
                                   math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)))


def arrow_polyline(lon: float, lat: float, east: float, north: float) -> list[list[float]]:
    """The arrow for a velocity at (lon, lat): shaft, then the head's barbs via the tip."""
    speed = math.hypot(east, north)
    azimuth = math.degrees(math.atan2(east, north))
    length = speed * ARROW_MYR
    tip = destination(lon, lat, azimuth, length)
    back = (initial_bearing(tip[0], tip[1], lon, lat) + 360) % 360
    head = length * HEAD_FRACTION
    barbs = [destination(tip[0], tip[1], back + side * HEAD_ANGLE_DEG, head) for side in (-1, 1)]
    return [[lon, lat], list(tip), list(barbs[0]), list(tip), list(barbs[1])]


def plate_at(polygons: dict[str, SphericalPolygon], p) -> list[str]:
    return [code for code, polygon in polygons.items() if polygon.contains(p)]


def build_arrows(poles: dict[str, dict], outlines: dict[str, list[tuple[float, float]]]):
    missing = set(poles) ^ set(outlines)
    if missing:
        raise ValueError(f"plates without both a pole and an outline: {sorted(missing)}")
    polygons = {code: SphericalPolygon(ring) for code, ring in outlines.items()}
    polylines = []
    unplaced = 0
    ambiguous = 0
    for lon, lat in fibonacci_grid(GRID_POINTS):
        codes = plate_at(polygons, unit(lon, lat))
        if not codes:
            unplaced += 1
            continue
        if len(codes) > 1:
            ambiguous += 1  # on a shared edge: either plate is right to the arrow's scale
        east, north = east_north_velocity(poles[codes[0]]["omega"], lon, lat)
        if math.hypot(east, north) < MIN_SPEED_MM_YR:
            continue
        encoded = encode_polyline(arrow_polyline(lon, lat, east, north))
        if encoded:
            polylines.append(encoded)
    print(f"arrows: {len(polylines)}, off every plate: {unplaced}, on a shared edge: {ambiguous}",
          file=sys.stderr)
    if unplaced > GRID_POINTS * 0.01:
        raise ValueError(f"{unplaced} grid points fall on no plate: the outlines do not tile the globe")
    return polylines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--source-dir", type=Path, help="read source files from here instead of fetching")
    args = parser.parse_args()
    pole_text, outline_text = load_sources(args.source_dir)
    polylines = build_arrows(parse_poles(pole_text), parse_outlines(outline_text))
    write_json(OUTPUT_DIR / "plate-motion.json", {
        "source": "Argus, Gordon & DeMets (2011) NNR-MORVEL56; arrows show "
                  f"{ARROW_MYR:g} Myr of motion in the no-net-rotation frame. See ATTRIBUTION.md.",
        "encoding": "delta",
        "quantumPerDegree": QUANTUM_PER_DEG,
        "arrowMyr": ARROW_MYR,
        "layers": {"plate-motion": polylines},
    })


if __name__ == "__main__":
    main()
