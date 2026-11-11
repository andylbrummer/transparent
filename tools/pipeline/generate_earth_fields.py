#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: global geophysical fields.

Writes app/public/geo/fields/<name>.png, one map per field, and
fields.json describing them. Each is a property of the solid Earth that
the surface hides:

magnetic-anomaly  The magnetic anomaly of the crust: the stripes of
    alternately magnetised seafloor that proved plate tectonics, and the
    old continental cores.
    EMAG2 version 3: Meyer, B., Saltus, R. & Chulliat, A. (2017), EMAG2v3:
    Earth Magnetic Anomaly Grid (2-arc-minute resolution), NOAA National
    Centers for Environmental Information, doi:10.7289/V5H70CVX. Read
    from NCEI's image service (gis.ngdc.noaa.gov, EMAG2v3) at the grid's
    own 2 arc minutes and averaged down. Public domain (U.S. Government).
    A compilation of measurements; where there are none the grid is empty
    and so is the map.

geoid  The height of the geoid - mean sea level, the equipotential
    surface of gravity - above the reference ellipsoid: the planet's
    "potato" shape, from -107 m south of India to +85 m at New Guinea.
    EGM96: Lemoine, F.G. et al. (1998), The Development of the Joint NASA
    GSFC and NIMA Geopotential Model EGM96, NASA/TP-1998-206861; the
    15-arc-minute grid as packaged by PROJ (cdn.proj.org,
    us_nga_egm96_15.tif). Public domain (U.S. Government). A model.

gravity-anomaly  The free-air gravity anomaly: how much gravity at the
    surface differs from that of the smooth reference Earth (GRS80). Mass
    piled up - volcanoes, mountains not yet sunk into isostatic balance,
    the outer rises of trenches - pulls harder; the trenches, where the
    sea is deep and the plate bent down, pull less.
    XGM2019: Zingerle, P., Pail, R., Gruber, T. & Oikonomidou, X. (2019),
    The experimental gravity field model XGM2019e, GFZ Data Services,
    doi:10.5880/ICGEM.2019.007 (the degree-760 member). CC BY 4.0.
    Synthesised here to degree 719, the limit of the model's full
    combination with ground and altimetry data (spherical_harmonics.py),
    at the centres of 0.25-degree cells on the ellipsoid. A model: GOCE
    and GRACE from orbit, gravity measured on land and from altimetry at
    sea, and topography where gravity is not measured.

moho-depth, sediment-thickness  The depth of the Moho - the base of the
    crust - below sea level, and the thickness of the sediments on top of
    the crystalline crust.
    CRUST1.0: Laske, G., Masters, G., Ma, Z. & Pasyanos, M. (2013), Update
    on CRUST1.0 - A 1-degree Global Model of Earth's Crust, Geophys. Res.
    Abstracts 15, EGU2013-2658; igppweb.ucsd.edu/~gabi/crust1.html.
    Freely distributed by its authors, who ask to be cited. A model:
    1-degree cells, much of it extrapolated from crustal type where no
    seismic profile exists.

heat-flow  Heat flowing out of the Earth's surface, as measured in
    boreholes and by probes in the seabed: the median of the measurements
    in each 1-degree cell that has any.
    Global Heat Flow Data Assessment Group et al. (2024), The Global Heat
    Flow Database: Release 2024, v. 2026.03, GFZ Data Services,
    doi:10.5880/fidgeo.2024.014. CC BY 4.0. Measurements, unevenly spread:
    most cells have none and stay empty.

Every image is equirectangular, longitude -180..180 left to right, north
up. The PNGs are RGB: red is the value's code (each field has its own
scale: the *_code functions below, named in fields.json and mirrored in
the app's fields.ts), green is how much of the pixel has data, blue is
unused. The magnetic anomaly and the gravity anomaly are grey JPEGs of the code alone, with no
anomaly (128) where there is no data.

Usage:
    python3 tools/pipeline/generate_earth_fields.py     # needs numpy and pillow (with libtiff)
"""

import io
import json
import math
import sys
import tarfile
import zipfile

import numpy as np
from PIL import Image

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json
from spherical_harmonics import read_gfc, synthesise

FIELDS_DIR = OUTPUT_DIR / "fields"

EMAG2_EXPORT = ("https://gis.ngdc.noaa.gov/arcgis/rest/services/EMAG2v3/ImageServer/exportImage?bbox={w},{s},{e},{n}"
                "&size={size},{size}&format=tiff&pixelType=F32&interpolation=RSP_NearestNeighbor&f=image")
# The grid is 2 arc minutes: a 90-degree tile is 2700 nodes square.
EMAG2_TILE_DEG, EMAG2_TILE_SIZE = 90, 2700
EGM96_URL = "https://cdn.proj.org/us_nga_egm96_15.tif"
CRUST1_URL = "https://igppweb.ucsd.edu/~gabi/crust1/crust1.0.tar.gz"
GHFDB_URL = "https://datapub.gfz-potsdam.de/download/10.5880.FIDGEO.2024.014-VEueRf/GHFBD-R2024_v.2026-03.zip"
GHFDB_TABLE = "IHFC_2024_GHFDB_v.2026.03.txt"

MAGNETIC_RANGE_NT = 400.0
# The anomaly is all fine texture: as a PNG it is 1.4 MB. At this quality the JPEG is a third of
# that and off by about 6 of the 127 codes (rms), which no eye finds in the stripes.
MAGNETIC_JPEG_QUALITY = 70
GEOID_RANGE_M = 110.0
GRAVITY_RANGE_MGAL = 300.0
XGM2019_URL = "https://datapub.gfz-potsdam.de/download/10.5880.ICGEM.2019.007/XGM2019.zip"
# The degree to which XGM2019 combines satellite, ground and altimetry data in full (its README: "up to d/o 719").
GRAVITY_MAX_DEGREE = 719
GRAVITY_JPEG_QUALITY = 80
MOHO_MAX_KM = 80.0
SEDIMENT_MAX_KM = 20.0
HEAT_FLOW_MIN, HEAT_FLOW_MAX = 10.0, 1000.0


# value -> code 0..255 (float; rounded on writing). The app decodes with the inverse.
def magnetic_code(nt: np.ndarray) -> np.ndarray:
    """Signed square root: the stripes are tens of nT and the extremes thousands."""
    t = np.sign(nt) * np.sqrt(np.minimum(np.abs(nt) / MAGNETIC_RANGE_NT, 1.0))
    return 128 + 127 * t


def geoid_code(metres: np.ndarray) -> np.ndarray:
    return 128 + 127 * np.clip(metres / GEOID_RANGE_M, -1, 1)


def gravity_code(mgal: np.ndarray) -> np.ndarray:
    """Signed square root, as for the magnetic anomaly: most of the planet is within 50 mGal, the trenches and volcanoes hundreds."""
    t = np.sign(mgal) * np.sqrt(np.minimum(np.abs(mgal) / GRAVITY_RANGE_MGAL, 1.0))
    return 128 + 127 * t


def moho_code(km: np.ndarray) -> np.ndarray:
    return 255 * np.clip(km / MOHO_MAX_KM, 0, 1)


def sediment_code(km: np.ndarray) -> np.ndarray:
    return 255 * np.sqrt(np.clip(km / SEDIMENT_MAX_KM, 0, 1))


def heat_flow_code(mw: np.ndarray) -> np.ndarray:
    """Logarithmic: continents sit near 60 mW/m2, young seafloor and geothermal fields at many hundreds."""
    return 255 * np.clip(np.log(np.maximum(mw, 1e-6) / HEAT_FLOW_MIN) / math.log(HEAT_FLOW_MAX / HEAT_FLOW_MIN), 0, 1)


def block_mean(grid: np.ndarray, valid: np.ndarray, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """(mean of the valid nodes, share valid) per output pixel of a grid whose rows run north to south
    and columns west to east over the whole globe, each node the centre of its cell."""
    rows, columns = grid.shape
    row = np.minimum((np.arange(rows) + 0.5) * height // rows, height - 1).astype(int)
    column = np.minimum((np.arange(columns) + 0.5) * width // columns, width - 1).astype(int)
    index = (row[:, None] * width + column[None, :]).ravel()
    total = np.bincount(index, minlength=width * height)
    covered = np.bincount(index, weights=valid.ravel(), minlength=width * height)
    summed = np.bincount(index, weights=np.where(valid, grid, 0.0).ravel(), minlength=width * height)
    if total.min() == 0:
        raise ValueError("an output pixel holds no source node: the image is finer than the grid")
    mean = np.where(covered > 0, summed / np.maximum(covered, 1), np.nan)
    return mean.reshape(height, width), (covered / total).reshape(height, width)


def write_field(name: str, code: np.ndarray, coverage: np.ndarray) -> dict:
    """Write the image; returns its size for the log."""
    height, width = code.shape
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[..., 0] = np.where(coverage > 0, np.clip(np.rint(code), 0, 255), 0)
    image[..., 1] = np.rint(np.clip(coverage, 0, 1) * 255)
    FIELDS_DIR.mkdir(parents=True, exist_ok=True)
    out = FIELDS_DIR / f"{name}.png"
    Image.fromarray(image, "RGB").save(out, optimize=True)
    print(f"  {out.name}: {width} x {height}, {out.stat().st_size / 1024:.0f} KiB", file=sys.stderr)
    return {"file": out.name, "width": width, "height": height}


def area_weights(height: int) -> np.ndarray:
    return np.cos(np.radians(90 - (np.arange(height) + 0.5) * 180 / height))[:, None]


def load_emag2() -> np.ndarray:
    """The whole grid, [5400, 10800], north row first, from -180; 0 where there is no data."""
    Image.MAX_IMAGE_PIXELS = None
    rows = []
    for north in range(90, -90, -EMAG2_TILE_DEG):
        tiles = []
        for west in range(-180, 180, EMAG2_TILE_DEG):
            url = EMAG2_EXPORT.format(w=west, s=north - EMAG2_TILE_DEG, e=west + EMAG2_TILE_DEG, n=north, size=EMAG2_TILE_SIZE)
            path = cached_fetch(url, f"fields/emag2/tile{north:+04d}{west:+05d}.tif", timeout=900)
            tile = np.array(Image.open(path))
            if tile.shape != (EMAG2_TILE_SIZE, EMAG2_TILE_SIZE) or tile.dtype != np.float32:
                raise ValueError(f"{path.name}: unexpected tile {tile.shape} {tile.dtype}")
            tiles.append(tile)
        rows.append(np.concatenate(tiles, axis=1))
    return np.concatenate(rows, axis=0)


def bake_magnetic(width: int = 2048, height: int = 1024) -> dict:
    grid = load_emag2()
    # Where the compilation has no data the service returns exactly 0, and in places a float sentinel or NaN.
    valid = np.isfinite(grid) & (grid != 0) & (np.abs(grid) < 1e5)
    mean, coverage = block_mean(np.where(valid, grid, 0).astype(np.float64), valid, width, height)
    # Pixels mostly without data are written as no anomaly, which the app draws clear.
    has = coverage >= 0.5
    code = np.where(has, np.clip(np.rint(magnetic_code(np.nan_to_num(mean))), 1, 255), 128).astype(np.uint8)
    FIELDS_DIR.mkdir(parents=True, exist_ok=True)
    out = FIELDS_DIR / "magnetic-anomaly.jpg"
    Image.fromarray(code, "L").save(out, "JPEG", quality=MAGNETIC_JPEG_QUALITY, optimize=True)
    print(f"  {out.name}: {width} x {height}, {out.stat().st_size / 1024:.0f} KiB", file=sys.stderr)
    share = float((has * area_weights(height)).sum() / (area_weights(height).sum() * width))
    finite = mean[has]
    return {"file": out.name, "width": width, "height": height,
            "id": "magnetic-anomaly", "unit": "nT", "encoding": "signed-sqrt", "range": MAGNETIC_RANGE_NT,
            "coverage": round(share, 3), "min": round(float(finite.min()), 1), "max": round(float(finite.max()), 1)}


def load_egm96() -> np.ndarray:
    """Geoid height, metres, [721, 1440]: rows from 90 N to 90 S, columns from 180 W, every 0.25 degrees (grid nodes)."""
    image = Image.open(cached_fetch(EGM96_URL, "fields/us_nga_egm96_15.tif"))
    tie, scale = image.tag_v2[33922], image.tag_v2[33550]
    if tuple(tie[3:5]) != (-180.0, 90.0) or tuple(scale[:2]) != (0.25, 0.25) or image.size != (1440, 721):
        raise ValueError(f"unexpected georeferencing: {tie} {scale} {image.size}")
    return np.array(image, dtype=np.float64)


def geoid_at(grid: np.ndarray, lon: float, lat: float) -> float:
    return float(grid[round((90 - lat) / 0.25), round((lon + 180) / 0.25) % 1440])


def bake_geoid(width: int = 720, height: int = 360) -> dict:
    grid = load_egm96()
    # Output pixel centres fall midway between nodes: the mean of the four round each.
    wrapped = np.concatenate([grid, grid[:, :1]], axis=1)
    cells = (wrapped[:-1, :-1] + wrapped[:-1, 1:] + wrapped[1:, :-1] + wrapped[1:, 1:]) / 4
    mean, coverage = block_mean(cells, np.ones(cells.shape, bool), width, height)
    meta = write_field("geoid", geoid_code(mean), coverage)
    low = np.unravel_index(np.argmin(grid), grid.shape)
    high = np.unravel_index(np.argmax(grid), grid.shape)
    return meta | {"id": "geoid", "unit": "m", "encoding": "linear-signed", "range": GEOID_RANGE_M,
                   "min": round(float(grid.min()), 2), "max": round(float(grid.max()), 2),
                   "minAt": [round(low[1] * 0.25 - 180, 2), round(90 - low[0] * 0.25, 2)],
                   "maxAt": [round(high[1] * 0.25 - 180, 2), round(90 - high[0] * 0.25, 2)]}


def gravity_grid(width: int = 1440, height: int = 720) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    """(lats, lons, synthesis) at the centres of the image's pixels, rows from the north."""
    model = read_gfc(cached_fetch(XGM2019_URL, "fields/XGM2019.zip"), max_degree=GRAVITY_MAX_DEGREE)
    lats = 90 - (np.arange(height) + 0.5) * 180 / height
    lons = -180 + (np.arange(width) + 0.5) * 360 / width
    return lats, lons, synthesise(model, lats, lons)


def bake_gravity() -> dict:
    lats, lons, field = gravity_grid()
    anomaly = field["anomaly_mgal"]
    height, width = anomaly.shape
    FIELDS_DIR.mkdir(parents=True, exist_ok=True)
    out = FIELDS_DIR / "gravity-anomaly.jpg"
    Image.fromarray(np.clip(np.rint(gravity_code(anomaly)), 0, 255).astype(np.uint8), "L").save(
        out, quality=GRAVITY_JPEG_QUALITY, optimize=True)
    print(f"  {out.name}: {width} x {height}, {out.stat().st_size / 1024:.0f} KiB", file=sys.stderr)
    low = np.unravel_index(np.argmin(anomaly), anomaly.shape)
    high = np.unravel_index(np.argmax(anomaly), anomaly.shape)
    return {"file": out.name, "width": width, "height": height, "id": "gravity-anomaly", "unit": "mGal",
            "encoding": "signed-sqrt", "range": GRAVITY_RANGE_MGAL, "maxDegree": GRAVITY_MAX_DEGREE,
            "min": round(float(anomaly.min()), 1), "max": round(float(anomaly.max()), 1),
            "minAt": [round(float(lons[low[1]]), 3), round(float(lats[low[0]]), 3)],
            "maxAt": [round(float(lons[high[1]]), 3), round(float(lats[high[0]]), 3)]}


def load_crust1() -> np.ndarray:
    """Boundary heights, km above sea level, [180, 360, 9]: cells from 89.5 N and 179.5 W; the last boundary is the Moho."""
    with tarfile.open(cached_fetch(CRUST1_URL, "fields/crust1.0.tar.gz")) as archive:
        member = archive.extractfile("crust1.bnds")
        assert member is not None
        bounds = np.loadtxt(io.TextIOWrapper(member))
    if bounds.shape != (64800, 9):
        raise ValueError(f"crust1.bnds: unexpected shape {bounds.shape}")
    return bounds.reshape(180, 360, 9)


def bake_crust() -> list[dict]:
    bounds = load_crust1()
    moho_depth = -bounds[..., 8]
    # Boundaries 3..6 are the tops of the three sediment layers and the top of the crystalline crust.
    sediment = bounds[..., 2] - bounds[..., 5]
    full = np.ones(moho_depth.shape)
    moho = write_field("moho-depth", moho_code(moho_depth), full) | {
        "id": "moho-depth", "unit": "km", "encoding": "linear", "range": MOHO_MAX_KM,
        "min": round(float(moho_depth.min()), 2), "max": round(float(moho_depth.max()), 2)}
    sediments = write_field("sediment-thickness", sediment_code(sediment), full) | {
        "id": "sediment-thickness", "unit": "km", "encoding": "sqrt", "range": SEDIMENT_MAX_KM,
        "min": round(float(sediment.min()), 2), "max": round(float(sediment.max()), 2)}
    return [moho, sediments]


def load_heat_flow() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(lon, lat, heat flow mW/m2) of every measurement with a position and a positive value."""
    with zipfile.ZipFile(cached_fetch(GHFDB_URL, "fields/ghfdb-2024.zip", timeout=900)) as archive:
        lines = archive.read(GHFDB_TABLE).decode("latin-1").splitlines()
    header = next(i for i, line in enumerate(lines) if line.split("\t")[:5] == ["q", "q_uncertainty", "name", "lat_NS", "long_EW"])
    lon, lat, q = [], [], []
    for line in lines[header + 1:]:
        cells = line.split("\t")
        try:
            value, latitude, longitude = float(cells[0]), float(cells[3]), float(cells[4])
        except (ValueError, IndexError):
            continue
        if value > 0 and -90 <= latitude <= 90 and -180 <= longitude <= 180:
            lon.append(longitude)
            lat.append(latitude)
            q.append(value)
    return np.array(lon), np.array(lat), np.array(q)


def bake_heat_flow(width: int = 360, height: int = 180) -> dict:
    lon, lat, q = load_heat_flow()
    column = np.minimum(((lon + 180) / 360 * width).astype(int), width - 1)
    row = np.minimum(((90 - lat) / 180 * height).astype(int), height - 1)
    index = row * width + column
    order = np.argsort(index, kind="stable")
    cells, starts = np.unique(index[order], return_index=True)
    median = np.full(width * height, np.nan)
    for cell, group in zip(cells, np.split(q[order], starts[1:])):
        median[cell] = np.median(group)
    median = median.reshape(height, width)
    has = np.isfinite(median)
    meta = write_field("heat-flow", heat_flow_code(np.nan_to_num(median, nan=HEAT_FLOW_MIN)), has.astype(float))
    return meta | {"id": "heat-flow", "unit": "mW/m2", "encoding": "log", "range": [HEAT_FLOW_MIN, HEAT_FLOW_MAX],
                   "measurements": int(len(q)), "cells": int(has.sum()),
                   "median": round(float(np.median(q)), 1)}


def main() -> None:
    fields = []
    for bake in (bake_magnetic, bake_geoid, bake_gravity, bake_crust, bake_heat_flow):
        print(f"{bake.__name__}:", file=sys.stderr)
        result = bake()
        for field in result if isinstance(result, list) else [result]:
            print("  " + json.dumps({k: v for k, v in field.items() if k not in ("file", "width", "height")}), file=sys.stderr)
            fields.append(field)
    write_json(OUTPUT_DIR / "fields.json", {
        "note": "Red channel: the value's code (see generate_earth_fields.py); green: share of the pixel with data.",
        "fields": fields,
    })


if __name__ == "__main__":
    main()
