#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: subducting slabs as surfaces.

Writes app/public/geo/slabs.bin: the top surface and thickness of every
slab of Slab2, sampled from its depth grids, which the app triangulates
into the sheets it draws inside the Earth.

Source (public domain, US Government; see app/public/geo/ATTRIBUTION.md):

    Hayes, G. P., et al. (2018) Slab2, a comprehensive subduction zone
    geometry model, Science 362, 58-61, doi:10.1126/science.aat4723.
    Data release doi:10.5066/F7PV6JNV, ScienceBase item
    5aa1b00ee4b0b1c392e86467 (Slab2Distribute_Mar2018.tar.gz, 140 MB):
    per slab, NetCDF-4 grids of depth (*_dep_*.grd) and thickness
    (*_thk_*.grd) at 0.05 deg (0.02 deg for five small slabs). Nodes outside
    a slab's clipping mask are NaN. Slab names are the region names of the
    release's 27 child items.

What is baked

    Each slab is its source grid, point-sampled every STEP_COARSE_DEG - or
    STEP_FINE_DEG where the coarse sampling would bend the surface by more
    than the tolerances below. No smoothing or averaging: every baked node
    is a source node, to the depth quantum. Along with depth each node
    carries the slab's thickness (Slab2's, from the plate's age) and its
    distance from the slab's edge in the source grid, so the app can cut
    the outline between nodes instead of in grid steps. One ring of nodes
    outside the edge is kept for that, carrying the nearest slab node's
    thickness and the depth the slab would have there if it ran on straight
    past its edge.

    The geometric error of the result is measured here, not assumed: the
    baked nodes are joined into the app's triangles and compared with every
    source node they cover, the cells along the edge included. It is printed per slab and written into the
    file's header (`errorKm`).

    Slab2 gives four slabs (izu, ker, man, sol) an extra list of nodes
    where they overturn past vertical. A surface over longitude and
    latitude cannot hold those, and they are left out, as they are from
    the grids themselves.

File layout (little-endian)

    bytes 0-3   "SLB1"
    bytes 4-7   uint32 n, the header's length
    n bytes     JSON header, padded with spaces to a multiple of four
    payload     per slab, at the header's `offset` from the payload's start:
                  runs       runCount x (row, firstColumn, length) uint16
                  depth      vertexCount x uint16, in depthUnitKm, down
                  thickness  vertexCount x uint8, in thicknessUnitKm
                  edge       vertexCount x int8, in edgeUnitCells of this
                             slab's step: positive inside the slab, zero on
                             its outline, clamped to +-127
                padded to an even length. A slab's nodes are its runs in
                order: row r, column c is at lon0 + c * stepDeg,
                lat0 + r * stepDeg. Longitudes run 0-360, as Slab2's do.

Usage:
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install numpy h5py scipy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_slabs.py [--source-dir DIR]

--source-dir reads the unpacked archive (the folder holding the .grd files)
instead of fetching it into tools/pipeline/.cache/slab2/.
"""

import argparse
import json
import struct
import sys
import tarfile
from pathlib import Path

import h5py
import numpy as np
from scipy import ndimage

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR

SLAB2_URL = ("https://www.sciencebase.gov/catalog/file/get/5aa1b00ee4b0b1c392e86467"
             "?f=__disk__d5%2F91%2F39%2Fd591399bf4f249ab49ffec8a366e5070fe96e0ba")

# Region names of the data release's child items
# (https://www.sciencebase.gov/catalog/items?parentId=5aa1b00ee4b0b1c392e86467),
# keyed by the three-letter code in the file names.
SLAB_NAMES = {
    "alu": "Alaska",
    "cal": "Calabria",
    "cam": "Central America",
    "car": "Caribbean",
    "cas": "Cascadia",
    "cot": "Cotabato",
    "hal": "Halmahera",
    "hel": "Hellenic Arc",
    "him": "Himalaya",
    "hin": "Hindu Kush",
    "izu": "Izu-Bonin",
    "ker": "Kermadec",
    "kur": "Kamchatka-Kuril Islands-Japan",
    "mak": "Makran",
    "man": "Manila Trench",
    "mue": "Muertos Trough",
    "pam": "Pamir",
    "phi": "Philippines",
    "png": "New Guinea",
    "puy": "Puysegur",
    "ryu": "Ryukyu",
    "sam": "South America",
    "sco": "Scotia Sea",
    "sol": "Solomon Islands",
    "sul": "Sulawesi",
    "sum": "Sumatra-Java",
    "van": "Vanuatu",
}

STEP_COARSE_DEG = 0.2
STEP_FINE_DEG = 0.1
# A slab keeps the coarse step if the surface it gives stays this close to
# the source nodes: 99 % within the first, all within the second. For scale,
# Slab2's own depth uncertainty is 10 km and more through most of a slab.
TOLERANCE_P99_KM = 2.5
TOLERANCE_MAX_KM = 5.0

DEPTH_UNIT_KM = 1 / 80  # uint16 reaches 819 km; the deepest node is 701 km
THICKNESS_UNIT_KM = 1
EDGE_UNIT_CELLS = 1 / 64


def load_grids(source_dir: Path | None) -> Path:
    """The folder holding Slab2's .grd files, downloading and unpacking it if need be."""
    if source_dir is not None:
        return source_dir
    target = CACHE_DIR / "slab2" / "x"
    folder = target / "Slab2Distribute_Mar2018"
    if not any(folder.glob("*_dep_*.grd")):
        archive = cached_fetch(SLAB2_URL, "slab2/Slab2Distribute_Mar2018.tar.gz", timeout=900)
        target.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, mode="r:gz") as tar:
            tar.extractall(target, members=[m for m in tar.getmembers() if m.name.endswith(".grd")], filter="data")
    return folder


def read_grid(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with h5py.File(path, "r") as grid:
        return grid["x"][:], grid["y"][:], grid["z"][:].astype(np.float64)


def triangle_surface(coarse: np.ndarray, stride: int, shape: tuple[int, int]) -> np.ndarray:
    """Depth at every source node of the surface the app draws through the coarse nodes.

    Each coarse cell is two triangles split along the diagonal from its
    (row, column) corner to the opposite one, as in the app's slab mesh.
    NaN where any corner of the triangle is missing.
    """
    rows = np.arange(shape[0]) / stride
    cols = np.arange(shape[1]) / stride
    r0 = np.minimum(rows.astype(int), coarse.shape[0] - 2)
    c0 = np.minimum(cols.astype(int), coarse.shape[1] - 2)
    fy = (rows - r0)[:, None]
    fx = (cols - c0)[None, :]
    a = coarse[r0][:, c0]
    b = coarse[r0][:, c0 + 1]
    c = coarse[r0 + 1][:, c0]
    d = coarse[r0 + 1][:, c0 + 1]
    lower = a + fx * (b - a) + fy * (d - b)
    upper = a + fx * (d - c) + fy * (c - a)
    return np.where(fx >= fy, lower, upper)


def extend_past_edge(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """`values` with every node outside the slab given the value the slab's
    surface would have there if it ran on straight from its nearest node:
    that node's value plus its slope times the offset. Slopes are differences
    between slab nodes only."""
    def slope(axis: int) -> np.ndarray:
        ahead = np.roll(values, -1, axis)
        behind = np.roll(values, 1, axis)
        has_ahead = np.roll(valid, -1, axis) & valid
        has_behind = np.roll(valid, 1, axis) & valid
        edge = [slice(None), slice(None)]
        edge[axis] = -1
        has_ahead[tuple(edge)] = False
        edge[axis] = 0
        has_behind[tuple(edge)] = False
        both = has_ahead & has_behind
        return np.where(both, (ahead - behind) / 2,
                        np.where(has_ahead, ahead - values, np.where(has_behind, values - behind, 0.0)))

    rows, cols = np.indices(values.shape)
    near_row, near_col = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
    base = np.where(valid, values, 0.0)
    row_slope = np.where(valid, slope(0), 0.0)
    col_slope = np.where(valid, slope(1), 0.0)
    return (base[near_row, near_col] + row_slope[near_row, near_col] * (rows - near_row)
            + col_slope[near_row, near_col] * (cols - near_col))


def surface_error(depth: np.ndarray, extended: np.ndarray, stride: int) -> tuple[float, float, float]:
    """(rms, 99th percentile, max) km between the source nodes and the sampled surface.

    The surface is sampled from `extended`, so the cells the outline cuts
    through - which hang on nodes beyond the slab's edge - are measured too.
    """
    sample = (slice(None, None, stride), slice(None, None, stride))
    stored = ndimage.binary_dilation(np.isfinite(depth)[sample], structure=np.ones((3, 3), dtype=bool))
    coarse = np.where(stored, extended[sample], np.nan)
    error = np.abs(triangle_surface(coarse, stride, depth.shape) - depth)
    error = error[np.isfinite(error)]
    return float(np.sqrt(np.mean(error ** 2))), float(np.percentile(error, 99)), float(error.max())


def build_slab(code: str, folder: Path) -> tuple[dict, bytes]:
    """One slab's header entry and payload."""
    lon, lat, z = read_grid(next(folder.glob(f"{code}_slab2_dep_*.grd")))
    _, _, thickness = read_grid(next(folder.glob(f"{code}_slab2_thk_*.grd")))
    depth = -z  # Slab2 depths are negative km
    valid = np.isfinite(depth)
    if not np.array_equal(valid, np.isfinite(thickness)):
        # A handful of nodes have a depth and no thickness; give them their neighbour's.
        nearest = ndimage.distance_transform_edt(~np.isfinite(thickness), return_distances=False, return_indices=True)
        thickness = thickness[tuple(nearest)]
    source_step = round(float(lon[1] - lon[0]), 4)
    filled_depth = extend_past_edge(depth, valid)
    nearest = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
    filled_thickness = thickness[tuple(nearest)]

    step, stride, error = STEP_FINE_DEG, 0, (0.0, 0.0, 0.0)
    for candidate in (STEP_COARSE_DEG, STEP_FINE_DEG):
        stride = round(candidate / source_step)
        error = surface_error(depth, filled_depth, stride)
        step = candidate
        if error[1] <= TOLERANCE_P99_KM and error[2] <= TOLERANCE_MAX_KM:
            break

    # Distance from the slab's edge in source nodes, positive inside. The
    # edge lies half a node beyond the last valid one; the grid's own border
    # counts as outside.
    padded = np.pad(valid, 1, constant_values=False)
    inside_distance = ndimage.distance_transform_edt(padded)[1:-1, 1:-1]
    outside_distance = ndimage.distance_transform_edt(~valid)
    edge = np.where(valid, inside_distance - 0.5, 0.5 - outside_distance) / stride

    sample = (slice(None, None, stride), slice(None, None, stride))
    inside = valid[sample]
    # Every node of a cell that holds any of the slab: the slab and one ring around it.
    stored = ndimage.binary_dilation(inside, structure=np.ones((3, 3), dtype=bool))
    rows, cols = np.nonzero(stored)
    if len(rows) == 0:
        raise ValueError(f"{code}: no nodes survive sampling at {step} deg")
    r0, r1, c0, c1 = rows.min(), rows.max(), cols.min(), cols.max()
    stored = stored[r0:r1 + 1, c0:c1 + 1]
    crop = (slice(r0, r1 + 1), slice(c0, c1 + 1))
    # The ring's extended depths may run above the surface or below the integer's reach.
    depth_q = np.clip(np.rint(filled_depth[sample][crop] / DEPTH_UNIT_KM), 0, 65535)
    thickness_q = np.rint(filled_thickness[sample][crop] / THICKNESS_UNIT_KM)
    edge_q = np.clip(np.rint(edge[sample][crop] / EDGE_UNIT_CELLS), -127, 127)
    if depth_q[stored].max() > 65535 or thickness_q[stored].max() > 255:
        raise ValueError(f"{code}: a depth or thickness overflows its integer")
    # Rounding must not move a node across the outline.
    inside_crop = inside[crop]
    edge_q = np.where(inside_crop, np.maximum(edge_q, 1), np.minimum(edge_q, -1))

    runs: list[tuple[int, int, int]] = []
    for r in range(stored.shape[0]):
        row = np.flatnonzero(stored[r])
        if len(row) == 0:
            continue
        breaks = np.flatnonzero(np.diff(row) > 1)
        starts = np.concatenate(([row[0]], row[breaks + 1]))
        ends = np.concatenate((row[breaks], [row[-1]]))
        runs += [(r, int(s), int(e - s + 1)) for s, e in zip(starts, ends)]
    order = stored  # boolean indexing walks rows, then columns: the runs' order
    payload = b"".join([
        np.array(runs, dtype="<u2").tobytes(),
        depth_q[order].astype("<u2").tobytes(),
        thickness_q[order].astype("u1").tobytes(),
        edge_q[order].astype("i1").tobytes(),
    ])
    if len(payload) % 2:
        payload += b"\0"

    # The name goes on the slab node nearest the middle of the slab.
    in_rows, in_cols = np.nonzero(inside_crop)
    lons = lon[::stride][c0 + in_cols]
    lats = lat[::stride][r0 + in_rows]
    depths = depth_q[in_rows, in_cols] * DEPTH_UNIT_KM
    radius = 6371.0 - depths
    xyz = np.stack([radius * np.cos(np.radians(lats)) * np.cos(np.radians(lons)),
                    radius * np.cos(np.radians(lats)) * np.sin(np.radians(lons)),
                    radius * np.sin(np.radians(lats))], axis=1)
    middle = int(np.argmin(np.linalg.norm(xyz - xyz.mean(axis=0), axis=1)))

    entry = {
        "code": code,
        "name": SLAB_NAMES[code],
        "lon0": round(float(lon[::stride][c0]), 4),
        "lat0": round(float(lat[::stride][r0]), 4),
        "stepDeg": step,
        "columns": int(stored.shape[1]),
        "rows": int(stored.shape[0]),
        "runCount": len(runs),
        "vertexCount": int(stored.sum()),
        "insideCount": int(inside_crop.sum()),
        "maxDepthKm": round(float(depths.max()), 1),
        "label": {"lon": round(float(lons[middle]), 2), "lat": round(float(lats[middle]), 2),
                  "depthKm": round(float(depths[middle]), 1)},
        "errorKm": {"rms": round(error[0], 2), "p99": round(error[1], 2), "max": round(error[2], 2)},
    }
    return entry, payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--source-dir", type=Path, help="folder holding Slab2's .grd files, instead of fetching")
    args = parser.parse_args()
    folder = load_grids(args.source_dir)

    entries = []
    payloads = []
    offset = 0
    for code in sorted(SLAB_NAMES):
        entry, payload = build_slab(code, folder)
        entry["offset"] = offset
        offset += len(payload)
        entries.append(entry)
        payloads.append(payload)
        print(f"{code} {entry['name']}: step {entry['stepDeg']}, {entry['insideCount']} nodes "
              f"(+{entry['vertexCount'] - entry['insideCount']} ring), to {entry['maxDepthKm']} km, "
              f"error rms {entry['errorKm']['rms']} p99 {entry['errorKm']['p99']} max {entry['errorKm']['max']} km",
              file=sys.stderr)
    found = {path.name[:3] for path in folder.glob("*_slab2_dep_*.grd")}
    if found != set(SLAB_NAMES):
        raise ValueError(f"slab grids {sorted(found ^ set(SLAB_NAMES))} are not in SLAB_NAMES, or are missing")

    header = json.dumps({
        "source": "Hayes et al. (2018) Slab2, USGS, doi:10.5066/F7PV6JNV, public domain. See ATTRIBUTION.md.",
        "depthUnitKm": DEPTH_UNIT_KM,
        "thicknessUnitKm": THICKNESS_UNIT_KM,
        "edgeUnitCells": EDGE_UNIT_CELLS,
        "slabs": entries,
    }, separators=(",", ":")).encode("utf-8")
    header += b" " * (-len(header) % 4)
    data = b"SLB1" + struct.pack("<I", len(header)) + header + b"".join(payloads)
    path = OUTPUT_DIR / "slabs.bin"
    path.write_bytes(data)
    print(f"wrote {path} ({len(data) / 1024:.0f} KiB, {sum(e['vertexCount'] for e in entries)} nodes)", file=sys.stderr)


if __name__ == "__main__":
    main()
