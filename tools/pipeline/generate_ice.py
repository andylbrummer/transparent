#!/usr/bin/env python3
"""
Bake the ice layers: where the land ice is, and where the sea ice ends.

Outputs
    app/public/geo/ice-mask.png          4096x2048 equirectangular coverage mask (lon -180..180, north up):
                                         red = glaciers, ice caps and ice sheets; green = Antarctic ice shelves
    app/public/geo/ice.json              names of the ice caps and ice shelves that Natural Earth names, largest first
    app/public/geo/sea-ice-extent.json   the edge of the sea ice at both poles on a set of days, each with the
                                         1981-2010 median edge for that day of the year and the extents in km2

Sources
    Natural Earth 1:10m physical vectors, "glaciated areas" and "Antarctic ice shelves" (public domain),
        https://www.naturalearthdata.com/downloads/10m-physical-vectors/
        read as GeoJSON from https://github.com/nvkelso/natural-earth-vector
    Sea Ice Index, Version 4 (G02135): Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. &
        Stafford, T. (2025), NOAA@NSIDC, National Snow and Ice Data Center, Boulder, Colorado,
        doi:10.7265/a98x-0f50. https://nsidc.org/data/g02135 - free to use with that citation.
        Used here: the daily 25 km extent grids (GeoTIFF: 0 open water, 1 ice of 15 % concentration or more,
        253 coast, 254 land, 255 missing), the day-of-year median extent lines 1981-2010 (shapefiles), the
        daily extent table and its 1981-2010 climatology (CSV).
        https://noaadata.apps.nsidc.org/NOAA/G02135/

The NSIDC server sends no CORS header, so a browser cannot read it: the sea
ice is baked, for the newest day NSIDC has and for the 1st and 15th of the
twelve months before it, and the app shows the day nearest its clock with
that day's date. Re-run this script to bring it up to date.

What is derived here, and how
    * The ice edge is the boundary between grid cells with ice and cells of open water, traced through the
      midpoints between cell centres (marching squares). Squares touching land, coast or missing cells are
      skipped, so the line never runs along a coast. It is then thinned (Douglas-Peucker, 8 km).
    * Grid and shapefile coordinates are NSIDC polar stereographic metres (EPSG:3411 north, 3412 south;
      Hughes 1980 ellipsoid, true at 70 degrees); they are turned to latitude and longitude with the
      ellipsoidal inverse of Snyder (1987), Map Projections: A Working Manual, eq. 20-18, 21-39, 3-5.
    * A label sits at the centroid of its polygon's vertices; areas are of the polygon on the sphere.

Usage:
    python3 tools/pipeline/generate_ice.py [--refresh-latest]

numpy and pillow. Raw downloads are cached in tools/pipeline/.cache/ice/.
"""

import csv
import datetime as dt
import io
import json
import math
import re
import struct
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from fetch_cache import CACHE_DIR, USER_AGENT, cached_fetch

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "app" / "public" / "geo"

NATURAL_EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
NSIDC = "https://noaadata.apps.nsidc.org/NOAA/G02135"

MASK_WIDTH = 4096
MASK_HEIGHT = 2048
#: The mask is drawn this many times larger and averaged down, for soft edges.
SUPERSAMPLE = 2
#: Named ice bodies kept for labels.
MAX_LABELS = 60
EARTH_RADIUS_KM = 6371.0088

#: Hughes 1980 ellipsoid, as the NSIDC grids use it.
HUGHES_A = 6378273.0
HUGHES_E = 0.081816153
TRUE_LATITUDE = 70.0
#: Hemisphere -> (letter, folder, central meridian in degrees east).
HEMISPHERES = {"north": ("N", "north", -45.0), "south": ("S", "south", 0.0)}
MONTH_FOLDERS = ["01_Jan", "02_Feb", "03_Mar", "04_Apr", "05_May", "06_Jun", "07_Jul", "08_Aug", "09_Sep", "10_Oct", "11_Nov", "12_Dec"]
#: Douglas-Peucker tolerance for the ice edges, metres.
SIMPLIFY_M = 8000.0
#: Runs of the traced edge shorter than this many vertices are polynyas and single cells: dropped.
MIN_EDGE_VERTICES = 8


# ---------------------------------------------------------------- projection


def polar_stereographic_inverse(x: float, y: float, hemisphere: str) -> tuple[float, float]:
    """(lon, lat) in degrees of a point in NSIDC polar stereographic metres."""
    lon0 = HEMISPHERES[hemisphere][2]
    south = hemisphere == "south"
    if south:
        # The southern aspect is the northern one seen from below: turn the plane half round.
        x, y = -x, -y
    e = HUGHES_E
    phi_c = math.radians(TRUE_LATITUDE)
    t_c = math.tan(math.pi / 4 - phi_c / 2) / ((1 - e * math.sin(phi_c)) / (1 + e * math.sin(phi_c))) ** (e / 2)
    m_c = math.cos(phi_c) / math.sqrt(1 - e * e * math.sin(phi_c) ** 2)
    rho = math.hypot(x, y)
    t = rho * t_c / (HUGHES_A * m_c)
    chi = math.pi / 2 - 2 * math.atan(t)
    phi = (
        chi
        + (e**2 / 2 + 5 * e**4 / 24 + e**6 / 12 + 13 * e**8 / 360) * math.sin(2 * chi)
        + (7 * e**4 / 48 + 29 * e**6 / 240 + 811 * e**8 / 11520) * math.sin(4 * chi)
        + (7 * e**6 / 120 + 81 * e**8 / 1120) * math.sin(6 * chi)
        + (4279 * e**8 / 161280) * math.sin(8 * chi)
    )
    lam = math.atan2(x, -y)
    lat = math.degrees(phi)
    lon = math.degrees(lam)
    if south:
        lat, lon = -lat, -lon
        lon = lon0 + lon
    else:
        lon = lon0 + lon
    return ((lon + 180.0) % 360.0) - 180.0, lat


# ---------------------------------------------------------------- land ice


def polygons_of(geometry: dict) -> list[list[list[list[float]]]]:
    """The polygons of a Polygon or MultiPolygon: each a list of rings, the outer one first."""
    return [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]


def spherical_ring_area_km2(ring: list[list[float]]) -> float:
    """Area enclosed by a ring on the sphere (the smaller side), km2."""
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(ring, ring[1:] + ring[:1]):
        dlon = math.radians(lon2 - lon1)
        if dlon > math.pi:
            dlon -= 2 * math.pi
        elif dlon < -math.pi:
            dlon += 2 * math.pi
        total += dlon * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    area = abs(total) * EARTH_RADIUS_KM**2 / 2
    return min(area, 4 * math.pi * EARTH_RADIUS_KM**2 - area)


def draw_features(features: list[dict]) -> Image.Image:
    """Coverage mask of the features, 0..255, at the mask's size."""
    width = MASK_WIDTH * SUPERSAMPLE
    height = MASK_HEIGHT * SUPERSAMPLE
    image = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(image)

    def pixels(ring: list[list[float]]) -> list[tuple[float, float]]:
        return [((lon + 180.0) / 360.0 * width, (90.0 - lat) / 180.0 * height) for lon, lat in ring]

    for feature in features:
        for polygon in polygons_of(feature["geometry"]):
            draw.polygon(pixels(polygon[0]), fill=255)
    # Holes after every outer ring, so a nunatak inside an ice sheet stays bare.
    for feature in features:
        for polygon in polygons_of(feature["geometry"]):
            for hole in polygon[1:]:
                draw.polygon(pixels(hole), fill=0)
    return image.resize((MASK_WIDTH, MASK_HEIGHT), Image.Resampling.BOX)


def label_of(feature: dict, kind: str) -> dict | None:
    name = feature["properties"].get("name")
    if not name:
        return None
    outers = [polygon[0] for polygon in polygons_of(feature["geometry"])]
    area = sum(spherical_ring_area_km2(ring) for ring in outers)
    # Centroid of the largest part's vertices, taken on the sphere so the date line and poles do no harm.
    ring = max(outers, key=spherical_ring_area_km2)
    x = y = z = 0.0
    for lon, lat in ring:
        x += math.cos(math.radians(lat)) * math.cos(math.radians(lon))
        y += math.cos(math.radians(lat)) * math.sin(math.radians(lon))
        z += math.sin(math.radians(lat))
    return {
        "name": name,
        "kind": kind,
        "lon": round(math.degrees(math.atan2(y, x)), 2),
        "lat": round(math.degrees(math.atan2(z, math.hypot(x, y))), 2),
        "areaKm2": int(round(area)),
    }


def bake_land_ice() -> None:
    glaciers = json.loads(cached_fetch(f"{NATURAL_EARTH}/ne_10m_glaciated_areas.geojson", "ice/ne_10m_glaciated_areas.geojson").read_text())
    shelves = json.loads(
        cached_fetch(f"{NATURAL_EARTH}/ne_10m_antarctic_ice_shelves_polys.geojson", "ice/ne_10m_antarctic_ice_shelves_polys.geojson").read_text()
    )
    red = draw_features(glaciers["features"])
    green = draw_features(shelves["features"])
    mask = Image.merge("RGB", (red, green, Image.new("L", red.size, 0)))
    mask.save(OUT_DIR / "ice-mask.png", optimize=True)

    labels = [label_of(f, "glacier") for f in glaciers["features"]] + [label_of(f, "shelf") for f in shelves["features"]]
    # Natural Earth cuts some bodies in parts under one name (the Ross Ice Shelf, at the date line):
    # one label, on the largest part, with the area of them all.
    by_name: dict[str, dict] = {}
    for label in labels:
        if not label:
            continue
        held = by_name.get(label["name"])
        if held is None:
            by_name[label["name"]] = dict(label, largestPartKm2=label["areaKm2"])
        else:
            total = held["areaKm2"] + label["areaKm2"]
            if label["areaKm2"] > held["largestPartKm2"]:
                held.update(lon=label["lon"], lat=label["lat"], largestPartKm2=label["areaKm2"])
            held["areaKm2"] = total
    for label in by_name.values():
        del label["largestPartKm2"]
    kept = sorted(by_name.values(), key=lambda label: -label["areaKm2"])[:MAX_LABELS]
    document = {
        "source": "Natural Earth 1:10m glaciated areas and Antarctic ice shelves (public domain), naturalearthdata.com",
        "mask": {"width": MASK_WIDTH, "height": MASK_HEIGHT, "red": "glaciers, ice caps and ice sheets", "green": "Antarctic ice shelves"},
        "labels": kept,
    }
    (OUT_DIR / "ice.json").write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"ice-mask.png {(OUT_DIR / 'ice-mask.png').stat().st_size} bytes; ice.json {len(kept)} labels")


# ---------------------------------------------------------------- sea ice


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on a polyline in plane coordinates."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        worst, index = 0.0, -1
        for i in range(first + 1, last):
            px, py = points[i]
            distance = abs(dx * (py - ay) - dy * (px - ax)) / length if length > 0 else math.hypot(px - ax, py - ay)
            if distance > worst:
                worst, index = distance, i
        if index >= 0 and worst > tolerance:
            keep[index] = True
            stack += [(first, index), (index, last)]
    return [p for p, k in zip(points, keep) if k]


def trace_ice_edge(grid: np.ndarray) -> list[list[tuple[float, float]]]:
    """
    Polylines along the ice/open-water boundary, in grid coordinates
    (column, row of cell centres; fractions between them).
    """
    rows, cols = grid.shape
    ice = grid == 1
    water = grid == 0
    known = ice | water
    # Points are kept doubled, as integers, so that shared endpoints compare equal.
    segments: list[tuple[tuple[int, int], tuple[int, int]]] = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            if not (known[r, c] and known[r, c + 1] and known[r + 1, c] and known[r + 1, c + 1]):
                continue
            a, b, d, e = ice[r, c], ice[r, c + 1], ice[r + 1, c + 1], ice[r + 1, c]
            code = (a << 3) | (b << 2) | (d << 1) | int(e)
            if code in (0, 15):
                continue
            top = (2 * c + 1, 2 * r)
            right = (2 * c + 2, 2 * r + 1)
            bottom = (2 * c + 1, 2 * r + 2)
            left = (2 * c, 2 * r + 1)
            table = {
                1: [(left, bottom)], 2: [(bottom, right)], 3: [(left, right)], 4: [(top, right)],
                5: [(top, left), (bottom, right)], 6: [(top, bottom)], 7: [(top, left)], 8: [(top, left)],
                9: [(top, bottom)], 10: [(top, right), (left, bottom)], 11: [(top, right)], 12: [(left, right)],
                13: [(bottom, right)], 14: [(left, bottom)],
            }  # fmt: skip
            segments += table[code]

    # Chain the segments end to end.
    neighbours: dict[tuple[int, int], list[int]] = {}
    for i, (p, q) in enumerate(segments):
        neighbours.setdefault(p, []).append(i)
        neighbours.setdefault(q, []).append(i)
    used = [False] * len(segments)
    lines: list[list[tuple[float, float]]] = []

    def walk(start: tuple[int, int], first: int) -> list[tuple[int, int]]:
        path = [start]
        point, index = start, first
        while True:
            used[index] = True
            p, q = segments[index]
            point = q if p == point else p
            path.append(point)
            following = [i for i in neighbours[point] if not used[i]]
            if not following:
                return path
            index = following[0]

    # Open runs first, from their loose ends; what is left is closed loops.
    for point, touching in neighbours.items():
        if len(touching) == 1 and not used[touching[0]]:
            lines.append([(x / 2, y / 2) for x, y in walk(point, touching[0])])
    for i, (p, _) in enumerate(segments):
        if not used[i]:
            lines.append([(x / 2, y / 2) for x, y in walk(p, i)])
    return lines


def grid_to_lonlat(col: float, row: float, origin: tuple[float, float], cell: float, hemisphere: str) -> tuple[float, float]:
    """Cell-centre grid coordinates to degrees: the origin is the outer corner of cell (0, 0)."""
    x = origin[0] + (col + 0.5) * cell
    y = origin[1] - (row + 0.5) * cell
    return polar_stereographic_inverse(x, y, hemisphere)


def read_extent_grid(path: Path) -> tuple[np.ndarray, tuple[float, float], float]:
    """The grid, the projected coordinates of its upper-left corner, and its cell size, from the GeoTIFF tags."""
    image = Image.open(path)
    tie = image.tag_v2[33922]
    scale = image.tag_v2[33550]
    return np.array(image), (float(tie[3]), float(tie[4])), float(scale[0])


def encode(lines: list[list[tuple[float, float]]]) -> list[list[int]]:
    """Each polyline as lon, lat, lon, lat ... in hundredths of a degree."""
    out = []
    for line in lines:
        flat: list[int] = []
        for lon, lat in line:
            flat += [int(round(lon * 100)), int(round(lat * 100))]
        out.append(flat)
    return out


def extent_lines(path: Path, hemisphere: str) -> list[list[tuple[float, float]]]:
    grid, origin, cell = read_extent_grid(path)
    lines = []
    for line in trace_ice_edge(grid):
        if len(line) < MIN_EDGE_VERTICES:
            continue
        thinned = simplify(line, SIMPLIFY_M / cell)
        lines.append([grid_to_lonlat(c, r, origin, cell, hemisphere) for c, r in thinned])
    return lines


def read_shapefile_polylines(data: bytes) -> list[list[tuple[float, float]]]:
    """Parts of every PolyLine record of a .shp file."""
    lines = []
    offset = 100
    while offset < len(data):
        (length_words,) = struct.unpack(">i", data[offset + 4 : offset + 8])
        record = data[offset + 8 : offset + 8 + 2 * length_words]
        offset += 8 + 2 * length_words
        (shape_type,) = struct.unpack("<i", record[:4])
        if shape_type != 3:
            continue
        parts_count, points_count = struct.unpack("<ii", record[36:44])
        parts = list(struct.unpack(f"<{parts_count}i", record[44 : 44 + 4 * parts_count])) + [points_count]
        base = 44 + 4 * parts_count
        points = [struct.unpack("<dd", record[base + 16 * i : base + 16 * i + 16]) for i in range(points_count)]
        for start, end in zip(parts, parts[1:]):
            lines.append(points[start:end])
    return lines


def median_lines(path: Path, hemisphere: str) -> list[list[tuple[float, float]]]:
    with zipfile.ZipFile(path) as archive:
        shp = next(name for name in archive.namelist() if name.endswith(".shp"))
        raw = read_shapefile_polylines(archive.read(shp))
    lines = []
    for line in raw:
        if len(line) < MIN_EDGE_VERTICES:
            continue
        lines.append([polar_stereographic_inverse(x, y, hemisphere) for x, y in simplify(line, SIMPLIFY_M)])
    return lines


def read_daily_extents(path: Path) -> dict[dt.date, float]:
    """Date -> extent in millions of km2."""
    extents = {}
    for row in csv.reader(io.StringIO(path.read_text())):
        if len(row) < 4 or not row[0].strip().isdigit():
            continue
        extents[dt.date(int(row[0]), int(row[1]), int(row[2]))] = float(row[3])
    return extents


def read_median_extents(path: Path) -> dict[int, float]:
    """Day of year -> the 50th percentile of 1981-2010, millions of km2."""
    medians = {}
    for row in csv.reader(io.StringIO(path.read_text())):
        if len(row) < 6 or not row[0].strip().isdigit():
            continue
        medians[int(row[0])] = float(row[5])
    return medians


def newest_day(letter: str, folder: str) -> dt.date:
    """The newest day with an extent grid, from the server's directory listings."""
    def listing(url: str) -> str:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read().decode("utf-8", "replace")

    base = f"{NSIDC}/{folder}/daily/geotiff/"
    year = max(re.findall(r'href="(\d{4})/"', listing(base)))
    month = max(re.findall(r'href="(\d\d_\w{3})/"', listing(f"{base}{year}/")))
    days = re.findall(rf"{letter}_(\d{{8}})_extent_v4\.0\.tif", listing(f"{base}{year}/{month}/"))
    newest = max(days)
    return dt.date(int(newest[:4]), int(newest[4:6]), int(newest[6:]))


def bake_dates(latest: dt.date) -> list[dt.date]:
    """The newest day, and the 1st and 15th of the twelve months before it."""
    dates = {latest}
    year, month = latest.year, latest.month
    for _ in range(13):
        for day in (1, 15):
            candidate = dt.date(year, month, day)
            if latest - dt.timedelta(days=366) <= candidate < latest:
                dates.add(candidate)
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return sorted(dates)


def bake_sea_ice(refresh_latest: bool) -> None:
    latest_file = CACHE_DIR / "ice" / "latest-day.txt"
    if refresh_latest or not latest_file.exists():
        latest = min(newest_day(letter, folder) for letter, folder, _ in HEMISPHERES.values())
        latest_file.parent.mkdir(parents=True, exist_ok=True)
        latest_file.write_text(latest.isoformat())
    latest = dt.date.fromisoformat(latest_file.read_text().strip())

    days = []
    tables = {}
    for hemisphere, (letter, folder, _) in HEMISPHERES.items():
        daily = cached_fetch(f"{NSIDC}/{folder}/daily/data/{letter}_seaice_extent_daily_v4.0.csv", f"ice/{letter}_daily_{latest}.csv")
        climatology = cached_fetch(
            f"{NSIDC}/{folder}/daily/data/{letter}_seaice_extent_climatology_1981-2010_v4.0.csv", f"ice/{letter}_climatology.csv"
        )
        tables[hemisphere] = (read_daily_extents(daily), read_median_extents(climatology))

    for date in bake_dates(latest):
        entry: dict = {"date": date.isoformat()}
        day_of_year = date.timetuple().tm_yday
        for hemisphere, (letter, folder, _) in HEMISPHERES.items():
            stamp = date.strftime("%Y%m%d")
            grid = cached_fetch(
                f"{NSIDC}/{folder}/daily/geotiff/{date.year}/{MONTH_FOLDERS[date.month - 1]}/{letter}_{stamp}_extent_v4.0.tif",
                f"ice/{letter}_{stamp}_extent_v4.0.tif",
            )
            median = cached_fetch(
                f"{NSIDC}/{folder}/daily/shapefiles/dayofyear_median/median_extent_{letter}_{day_of_year:03d}_1981-2010_polyline_v4.0.zip",
                f"ice/median_extent_{letter}_{day_of_year:03d}.zip",
            )
            extents, medians = tables[hemisphere]
            entry[hemisphere] = {
                "extentMkm2": extents.get(date),
                "medianMkm2": medians.get(day_of_year),
                "edge": encode(extent_lines(grid, hemisphere)),
                "median": encode(median_lines(median, hemisphere)),
            }
        days.append(entry)
        print(
            f"{entry['date']}: north {entry['north']['extentMkm2']} (median {entry['north']['medianMkm2']}), "
            f"south {entry['south']['extentMkm2']} (median {entry['south']['medianMkm2']}) M km2",
            file=sys.stderr,
        )

    document = {
        "source": "Sea Ice Index, Version 4 (G02135), NOAA@NSIDC, doi:10.7265/a98x-0f50",
        "medianPeriod": "1981-2010",
        "units": {"extent": "million km2", "lines": "lon, lat pairs in hundredths of a degree"},
        "days": days,
    }
    path = OUT_DIR / "sea-ice-extent.json"
    path.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"sea-ice-extent.json {path.stat().st_size} bytes, {len(days)} days, newest {latest}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bake_land_ice()
    bake_sea_ice("--refresh-latest" in sys.argv)


if __name__ == "__main__":
    main()
