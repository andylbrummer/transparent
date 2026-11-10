#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the northern ice sheets through the Quaternary.

Writes
    app/public/geo/ice-sheets/<id>.png   2048x1024 equirectangular coverage (lon -180..180, north up),
                                         grey 0..255: one per time-slice, best-estimate extent
    app/public/geo/ice-sheets.json       the slices, oldest last: id, name, age range, file, area

Source
    Batchelor, C.L., Margold, M., Krapp, M., Murton, D.K., Dalton, A.S., Gibbard, P.L., Stokes, C.R.,
    Murton, J.B. & Manica, A. (2019), The configuration of Northern Hemisphere ice sheets through the
    Quaternary, Nature Communications 10, 3713, doi:10.1038/s41467-019-11601-2 (article CC BY 4.0).
    Shapefiles from the paper's repository, https://osf.io/7jen3/ (no licence of its own stated): the
    best-estimate reconstruction of each of its 18 time-slices. The repository also holds minimum and
    maximum hypotheses for the 17 slices before the Last Glacial Maximum; they are not drawn.

What is and is not claimed (from the repository's README)
    * Ice sheets over 50,000 km2 in the Northern Hemisphere only; no ice shelves, sea ice or mountain
      glaciers, nothing in the south.
    * Each slice aims at the largest extent within its time span, except 45 ka, MIS 5a and MIS 5c, which
      aim at the peak warmth. The largest extent may have come at different times in different places.
    * Where a slice had no evidence for a region, the authors borrowed the ice from another slice with a
      similar global d18O value. For general extent only, not local study.

Geometry
    The 17 older slices are in North Pole Lambert Azimuthal Equal Area on the WGS 84 ellipsoid (metres);
    the LGM file is in longitude and latitude. Polygons are drawn on a polar raster and each output
    pixel looks itself up there through the forward projection (Snyder 1987, USGS Prof. Paper 1395,
    eqs. 3-12, 24-13, 21-30), so shapes that cross the date line or circle the pole need no cutting.
    Drawn at twice the size and averaged down, for a soft edge.

Usage (needs numpy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_ice_sheets_through_time.py

Raw downloads are cached in tools/pipeline/.cache/ice-age/.
"""

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from fetch_cache import cached_fetch
from generate_ice_age import LGM_SHP_URL, read_polygons, signed_area

WIDTH, HEIGHT = 2048, 1024
EARTH_RADIUS_KM = 6371.0
# WGS 84.
A_M = 6378137.0
F = 1 / 298.257223563
E2 = F * (2 - F)
E = math.sqrt(E2)
# The polar raster: metres from the pole to its edge (about latitude 27°, south of every slice's ice), and its size.
POLAR_EXTENT_M = 7.0e6
POLAR_PX = 8192
SOUTHMOST_LAT = 25.0

# id, name, age range in thousands of years (young, old) as the repository's README gives them, the
# best-estimate shapefile and its projection file. The LGM has one estimate, in longitude and latitude.
SLICES = [
    ("lgm", "Last Glacial Maximum", (19, 26.5), LGM_SHP_URL, None),
    ("30ka", "30,000 years ago", (30, 30), "https://osf.io/download/3wpf5/", "https://osf.io/download/3wm9g/"),
    ("35ka", "35,000 years ago", (35, 35), "https://osf.io/download/dutnj/", "https://osf.io/download/ugzch/"),
    ("40ka", "40,000 years ago", (40, 40), "https://osf.io/download/cyn29/", "https://osf.io/download/g2vtp/"),
    ("45ka", "45,000 years ago", (45, 45), "https://osf.io/download/w7gpm/", "https://osf.io/download/948bp/"),
    ("mis4", "MIS 4", (58, 72), "https://osf.io/download/4q9f2/", "https://osf.io/download/2jkua/"),
    ("mis5a", "MIS 5a", (72, 86), "https://osf.io/download/hd2sx/", "https://osf.io/download/fwu4s/"),
    ("mis5b", "MIS 5b", (86, 92), "https://osf.io/download/pnqgx/", "https://osf.io/download/vreku/"),
    ("mis5c", "MIS 5c", (92, 108), "https://osf.io/download/twgje/", "https://osf.io/download/rz3av/"),
    ("mis5d", "MIS 5d", (108, 117), "https://osf.io/download/g6se4/", "https://osf.io/download/ptjqd/"),
    ("mis6", "MIS 6", (132, 190), "https://osf.io/download/hwt2g/", "https://osf.io/download/zq3tw/"),
    ("mis8", "MIS 8", (243, 279), "https://osf.io/download/urfx2/", "https://osf.io/download/u9b8n/"),
    ("mis10", "MIS 10", (337, 365), "https://osf.io/download/8ujx7/", "https://osf.io/download/j4xwn/"),
    ("mis12", "MIS 12", (429, 477), "https://osf.io/download/ezmkf/", "https://osf.io/download/d4hm5/"),
    ("mis16", "MIS 16", (622, 677), "https://osf.io/download/uebhx/", "https://osf.io/download/853s4/"),
    ("mis20-24", "MIS 20–24", (790, 928), "https://osf.io/download/ws839/", "https://osf.io/download/8tukn/"),
    ("early-matuyama", "early Matuyama Chron", (1780, 2600), "https://osf.io/download/v859p/", "https://osf.io/download/3qxzc/"),
    ("late-gauss", "late Gauss Chron", (2600, 3590), "https://osf.io/download/rj5z9/", "https://osf.io/download/u3dtk/"),
]
WARM_PEAK = {"45ka", "mis5a", "mis5c"}

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "app" / "public" / "geo" / "ice-sheets"
META = REPO_ROOT / "app" / "public" / "geo" / "ice-sheets.json"


def authalic_q(lat_rad: np.ndarray | float) -> np.ndarray | float:
    """Snyder eq. 3-12."""
    s = np.sin(lat_rad)
    return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * np.log((1 - E * s) / (1 + E * s)))


QP = float(authalic_q(math.pi / 2))


def polar_forward(lon_deg: np.ndarray, lat_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """North-polar Lambert azimuthal equal-area on WGS 84, central meridian 0: metres (Snyder 24-13, 21-30)."""
    lon = np.radians(lon_deg)
    rho = A_M * np.sqrt(np.maximum(QP - authalic_q(np.radians(lat_deg)), 0.0))
    return rho * np.sin(lon), -rho * np.cos(lon)


def assert_projection(prj_text: str) -> None:
    for needed in ("Lambert_Azimuthal_Equal_Area", "6378137.0", "298.257223563", '"Central_Meridian",0.0', '"Latitude_Of_Origin",90.0', '"Meter"'):
        assert needed in prj_text, f"projection file lacks {needed}: {prj_text}"


def polar_raster(records: list[list[list[tuple[float, float]]]]) -> np.ndarray:
    """Ice 0/255 on the polar raster; outer rings run clockwise, holes the other way, in metres or degrees alike."""
    image = Image.new("L", (POLAR_PX, POLAR_PX), 0)
    draw = ImageDraw.Draw(image)
    scale = POLAR_PX / (2 * POLAR_EXTENT_M)

    def pixels(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
        return [((x + POLAR_EXTENT_M) * scale, (POLAR_EXTENT_M - y) * scale) for x, y in ring]

    for rings in records:
        for ring in rings:
            if signed_area(ring) < 0:
                draw.polygon(pixels(ring), fill=255)
        for ring in rings:
            if signed_area(ring) >= 0:
                draw.polygon(pixels(ring), fill=0)
    return np.asarray(image)


def to_projected(records: list[list[list[tuple[float, float]]]]) -> list[list[list[tuple[float, float]]]]:
    """Longitude-latitude rings into the polar plane. The projection keeps orientation, so ring order holds."""
    out = []
    for rings in records:
        projected = []
        for ring in rings:
            lon, lat = np.array(ring).T
            x, y = polar_forward(lon, lat)
            projected.append(list(zip(x.tolist(), y.tolist())))
        out.append(projected)
    return out


def equirectangular(polar: np.ndarray) -> np.ndarray:
    """Coverage 0..255 per output pixel, from 2x2 samples of the polar raster."""
    scale = 2
    cols = (np.arange(WIDTH * scale) + 0.5) / (WIDTH * scale) * 360 - 180
    rows_all = 90 - (np.arange(HEIGHT * scale) + 0.5) / (HEIGHT * scale) * 180
    north = rows_all > SOUTHMOST_LAT
    lon, lat = np.meshgrid(cols, rows_all[north])
    x, y = polar_forward(lon, lat)
    px = np.clip(((x + POLAR_EXTENT_M) * POLAR_PX / (2 * POLAR_EXTENT_M)).astype(int), 0, POLAR_PX - 1)
    py = np.clip(((POLAR_EXTENT_M - y) * POLAR_PX / (2 * POLAR_EXTENT_M)).astype(int), 0, POLAR_PX - 1)
    fine = np.zeros((HEIGHT * scale, WIDTH * scale), dtype=np.float32)
    fine[north] = polar[py, px]
    return fine.reshape(HEIGHT, scale, WIDTH, scale).mean(axis=(1, 3)).round().astype(np.uint8)


def cell_areas_km2() -> np.ndarray:
    edges = np.radians(90 - np.arange(HEIGHT + 1) * 180 / HEIGHT)
    return EARTH_RADIUS_KM**2 * (2 * math.pi / WIDTH) * (np.sin(edges[:-1]) - np.sin(edges[1:]))


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    areas = cell_areas_km2()[:, None]
    slices = []
    for slice_id, name, (young, old), shp_url, prj_url in SLICES:
        if prj_url is None:
            records = to_projected(read_polygons(cached_fetch(shp_url, "ice-age/LGM_best_estimate.shp")))
        else:
            assert_projection(cached_fetch(prj_url, f"ice-age/{slice_id}_best_estimate.prj").read_text())
            records = read_polygons(cached_fetch(shp_url, f"ice-age/{slice_id}_best_estimate.shp"))
            xs = [x for rings in records for ring in rings for x, _ in ring]
            assert max(map(abs, xs)) > 1e5, f"{slice_id}: coordinates look like degrees, not metres"
        coverage = equirectangular(polar_raster(records))
        path = OUT_DIR / f"{slice_id}.png"
        Image.fromarray(coverage, "L").save(path, optimize=True)
        area = round(float((coverage / 255 * areas).sum()), -4)
        slices.append(
            {
                "id": slice_id,
                "name": name,
                "youngKa": young,
                "oldKa": old,
                "warmPeak": slice_id in WARM_PEAK,
                "file": f"geo/ice-sheets/{slice_id}.png",
                "areaKm2": area,
            }
        )
        print(f"{slice_id}: {area / 1e6:.1f} million km2, {path.stat().st_size / 1024:.0f} KB")
    META.write_text(json.dumps({"width": WIDTH, "height": HEIGHT, "slices": slices}, indent=1) + "\n")
    total = sum((OUT_DIR / f"{s['id']}.png").stat().st_size for s in slices)
    print(f"wrote {len(slices)} slices, {total / 1024:.0f} KB in all, and {META.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
