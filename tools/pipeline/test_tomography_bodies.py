#!/usr/bin/env python3
"""
Checks for the lower-mantle bodies: app/public/geo/tomography-bodies-slow.bin
and tomography-bodies.json against the model they were contoured from.

The mesh is read back from the file as the app reads it, and asked
one question many times: is this point inside? (A ray straight up from
the point crosses a closed surface an odd number of times if it is.)

- At a lattice of points through the lower mantle the answer must be the
  model's: inside the mesh where SEMUCB-WM1, interpolated between its
  layers, is slower than the threshold, outside where it is not.
- The geography is what every global S-wave model agrees on (Garnero,
  McNamara & Shim 2016, Nature Geoscience 9, 481, doi:10.1038/ngeo2733;
  Cottaar & Lekic 2016, Geophys. J. Int. 207, 1122, doi:10.1093/gji/ggw324):
  two large low-shear-velocity provinces on the core, one under Africa
  and the south-east Atlantic and one under the central and south
  Pacific; none under the fast rim of the Pacific - east Asia, northern
  North America, the Southern Ocean off Australia - nor where the
  Farallon slab lies under eastern North America and the Tethyan slabs
  under India in the mid mantle (van der Meer et al. 2018,
  Tectonophysics 723, 309, doi:10.1016/j.tecto.2017.10.004).
- The mesh is a closed surface facing outward, between the cut at the
  top and the core-mantle boundary, and within the size budget.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_tomography_bodies.py
    python3 tools/pipeline/test_tomography_bodies.py     # needs numpy
"""

import json
import math
import struct

import numpy as np

from generate_geo import OUTPUT_DIR
from generate_tomography import load_model, synthesize
from geo_test_support import check, finish

# The bake's constants, held here on purpose: a change to either must be made twice.
THRESHOLD_PERCENT = 0.8
TOP_KM, CMB_KM, CAP_KM = 1050.0, 2891.0, 1.0
EARTH_RADIUS_KM = 6371.0
MAX_BYTES = 500_000

meta = json.loads((OUTPUT_DIR / "tomography-bodies.json").read_text())
check(meta["thresholdPercent"] == THRESHOLD_PERCENT and meta["topKm"] == TOP_KM and meta["bottomKm"] == CMB_KM,
      f"contours at ∓{THRESHOLD_PERCENT} % from {TOP_KM:.0f} km to the core at {CMB_KM:.0f} km")
check([m["name"] for m in meta["meshes"]] == ["slow"] and [m["levelPercent"] for m in meta["meshes"]] == [-0.8],
      "one mesh: slow, at -0.8 %")


def read_mesh(entry: dict) -> tuple[np.ndarray, np.ndarray]:
    """(vertices [n, 3] km, triangles [m, 3]) of a tomography-bodies-*.bin."""
    data = (OUTPUT_DIR / entry["file"]).read_bytes()
    vertices, indices = struct.unpack_from("<II", data)
    check(len(data) == 8 + 6 * vertices + 2 * indices, f"{entry['file']}: {vertices} vertices and {indices // 3} triangles fill the file exactly")
    check(len(data) <= MAX_BYTES, f"{entry['file']}: {len(data) / 1024:.0f} KiB, within {MAX_BYTES // 1000} kB")
    check(vertices == entry["vertices"] and indices == 3 * entry["triangles"], f"{entry['file']}: counts as the JSON says")
    xyz = np.frombuffer(data, "<i2", 3 * vertices, 8).reshape(-1, 3).astype(float) * EARTH_RADIUS_KM / meta["quantum"]
    faces = np.frombuffer(data, "<u2", indices, 8 + 6 * vertices).reshape(-1, 3).astype(np.int64)
    check(int(faces.max()) < vertices and np.unique(faces).size == vertices, f"{entry['file']}: every index is a vertex and every vertex is used")
    return xyz, faces


def unit(lon: float, lat: float) -> np.ndarray:
    lo, la = math.radians(lon), math.radians(lat)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def inside(xyz: np.ndarray, faces: np.ndarray, lon: float, lat: float, depth_km: float) -> bool:
    """Whether the point is inside the closed mesh: crossings of the ray straight up from it (Moller-Trumbore)."""
    direction = unit(lon, lat)
    origin = direction * (EARTH_RADIUS_KM - depth_km)
    a = xyz[faces[:, 0]]
    e1, e2 = xyz[faces[:, 1]] - a, xyz[faces[:, 2]] - a
    h = np.cross(direction, e2)
    det = np.einsum("ij,ij->i", e1, h)
    ok = np.abs(det) > 1e-9
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = origin - a
    u = np.einsum("ij,ij->i", s, h) * inv
    q = np.cross(s, e1)
    v = (q @ direction) * inv
    t = np.einsum("ij,ij->i", e2, q) * inv
    return int((ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)).sum()) % 2 == 1


layers = load_model()
model_depths = np.array(sorted(d for d in layers if d >= TOP_KM))


def model_percent(lon: np.ndarray, lat: np.ndarray, depth_km: float) -> np.ndarray:
    """dVs % of the model at each (lon, lat), linear between its layers; the deepest layer holds down to the core."""
    below = min(int(np.searchsorted(model_depths, depth_km, side="right")), model_depths.size - 1)
    above = max(below - 1, 0)
    upper = synthesize(*layers[model_depths[above]], np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
    lower = synthesize(*layers[model_depths[below]], np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
    span = model_depths[below] - model_depths[above]
    weight = 0.0 if span == 0 else min(max((depth_km - model_depths[above]) / span, 0.0), 1.0)
    return upper + (lower - upper) * weight


def model_at(lon: float, lat: float, depth_km: float) -> float:
    return float(model_percent(np.array([lon]), np.array([lat]), depth_km)[0])


meshes = {}
for entry in meta["meshes"]:
    name = entry["name"]
    xyz, faces = read_mesh(entry)
    meshes[name] = (xyz, faces)

    radius = np.linalg.norm(xyz, axis=1)
    top, bottom = EARTH_RADIUS_KM - radius.max(), EARTH_RADIUS_KM - radius.min()
    check(TOP_KM - CAP_KM - 0.5 <= top and bottom <= CMB_KM + CAP_KM + 0.5,
          f"{name}: between the cut at {TOP_KM:.0f} km and the core ({top:.1f} .. {bottom:.1f} km deep)")

    # A closed, consistently wound surface: each edge is walked once in each direction.
    directed = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    keys = directed[:, 0] * 65536 + directed[:, 1]
    reverse = directed[:, 1] * 65536 + directed[:, 0]
    unique, counts = np.unique(keys, return_counts=True)
    unmatched = int((~np.isin(keys, reverse)).sum())
    repeated = int((counts > 1).sum())
    check(unmatched == 0, f"{name}: watertight - every edge has its opposite ({unmatched} of {keys.size} without)")
    # Two sheets of a contour may meet along an edge of the grid: allowed, but rare.
    check(repeated <= 0.002 * unique.size, f"{name}: {repeated} of {unique.size} edges are shared by more than two triangles")

    a, b, c = xyz[faces[:, 0]], xyz[faces[:, 1]], xyz[faces[:, 2]]
    volume = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0
    check(volume > 0 and abs(volume / 1e6 - entry["volumeMillionKm3"]) < 0.5,
          f"{name}: faces outward, enclosing {volume / 1e9:.1f} billion km3 as the JSON says")

mantle = 4 / 3 * math.pi * (EARTH_RADIUS_KM ** 3 - (EARTH_RADIUS_KM - CMB_KM) ** 3)
slow_share = meta["meshes"][0]["volumeMillionKm3"] * 1e6 / mantle
check(0.01 < slow_share < 0.05, f"the slow bodies are {100 * slow_share:.1f} % of the mantle's volume (a few per cent)")

# The meshes against the model, at a lattice kept off the grid's own nodes and away from the contour itself.
agree = {"slow": [0, 0]}
lattice_lon, lattice_lat = np.meshgrid(np.arange(-171.1, 180, 23.3), np.arange(-78.3, 80, 19.7))
for depth in (1210.0, 1630.0, 2040.0, 2470.0, 2810.0):
    values = model_percent(lattice_lon.ravel(), lattice_lat.ravel(), depth)
    for lon, lat, value in zip(lattice_lon.ravel(), lattice_lat.ravel(), values):
        for name, sign in (("slow", -1),):
            margin = sign * value - THRESHOLD_PERCENT
            if abs(margin) < 0.15:
                continue
            agree[name][1] += 1
            agree[name][0] += inside(*meshes[name], lon, lat, depth) == (margin > 0)
for name, (right, total) in agree.items():
    check(total > 400 and right == total, f"{name}: inside the mesh exactly where the model is beyond the threshold ({right} of {total} points)")

# (name, lon, lat, depth km, in the slow mesh)
PLACES = [
    ("under southern Africa, on the core", 20, -20, 2850, True),
    ("under the south-east Atlantic, on the core", 5, -25, 2850, True),
    ("under southern Africa, 1,000 km above the core", 20, -20, 1900, True),
    ("under the central Pacific, on the core", -165, -10, 2850, True),
    ("under the south Pacific superswell, on the core", -150, -18, 2850, True),
    ("under east Asia, on the core", 120, 40, 2850, False),
    ("under northern North America, on the core", -95, 60, 2850, False),
    ("under the Southern Ocean south-west of Australia, on the core", 110, -40, 2850, False),
    ("under South America, on the core", -60, -20, 2850, False),
    ("the Farallon slab under eastern North America, mid mantle", -80, 35, 1400, False),
    ("the Tethyan slabs under India, at 1,200 km", 75, 20, 1200, False),
]
for name, lon, lat, depth, slow in PLACES:
    got = inside(*meshes["slow"], lon, lat, depth)
    check(got == slow, f"{name}: {'inside' if slow else 'outside'} the slow body (model {model_at(lon, lat, depth):+.2f} %; inside: {got})")

pieces = meta["meshes"][0]["pieces"]
african, pacific = pieces[0], pieces[1]
check(0 < african["centre"]["lon"] < 35 and -35 < african["centre"]["lat"] < 0,
      f"the biggest slow piece is centred under southern Africa ({african['centre']['lon']} E, {african['centre']['lat']} N)")
check(-180 < pacific["centre"]["lon"] < -135 and -30 < pacific["centre"]["lat"] < 5,
      f"the second is centred under the central Pacific ({pacific['centre']['lon']} E, {pacific['centre']['lat']} N)")
both = (african["volumeMillionKm3"] + pacific["volumeMillionKm3"]) / meta["meshes"][0]["volumeMillionKm3"]
check(both > 0.85, f"the two provinces are {100 * both:.0f} % of the slow volume")
check(all(p["bottomKm"] >= CMB_KM - 1 and p["topKm"] <= TOP_KM + 1 for p in (african, pacific)),
      "both stand on the core and reach the cut at the top")
check(all(TOP_KM < p["centre"]["depthKm"] < CMB_KM for m in meta["meshes"] for p in m["pieces"]), "each piece's mean depth is inside the lower mantle")

finish()
