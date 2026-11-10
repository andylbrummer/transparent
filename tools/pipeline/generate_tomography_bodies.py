#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the slow bodies of the lower
mantle, in three dimensions.

Writes app/public/geo/tomography-bodies-slow.bin and
tomography-bodies.json: a triangle mesh, the surface on which the
shear-velocity anomaly of SEMUCB-WM1 (French & Romanowicz 2014; see
generate_tomography.py for the model and how it is read) equals
-THRESHOLD_PERCENT, between TOP_KM and the core-mantle boundary.

Inside it are the two large low-shear-velocity provinces (LLSVPs) that
sit on the core under Africa and the Pacific, and the columns that rise
from them. It is a contour of a smoothed model (degree 31, ~650 km), not
an object with edges: a different threshold or a different model draws a
different body, and the app says so.

MESHES can hold the fast side too (("fast", +THRESHOLD_PERCENT): the old
slabs under the rim of the Pacific and under Asia). It was baked and
drawn, and left out: from most places it is a wall of twenty-odd pieces
that hides more than it shows. The JSON records, for each connected piece bigger than
MIN_PIECE_MILLION_KM3, its volume, depth range, the direction of its
centre of volume and its mean depth; the app names the two biggest pieces
from where those centres are.

Method: the model's own layers from TOP_KM down (every 100 km) are
synthesised on a GRID_DEG grid. The model's deepest layer, 2850 km, is
taken to hold down to the core-mantle boundary (CMB_KM, PREM's 2891 km),
and a layer of zeros is put CAP_KM beyond either end, so the surface
closes with a flat cut at TOP_KM - where a column goes on up, it is seen
cut - and a flat base on the core. Marching cubes (scikit-image) runs on
that [depth, lat, lon] block; vertices are mapped to Earth-centred
coordinates on the sphere the app draws (radius EARTH_RADIUS_KM), then
welded where the grid's first and last meridians and its polar rows
coincide, so the mesh is a closed surface, wound to face outward.

Binary layout, little-endian:

    uint32 vertexCount, uint32 indexCount
    int16 x, y, z per vertex (unit: EARTH_RADIUS_KM / QUANTUM km)
    uint16 indices, three per triangle

Usage:
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install numpy pillow scikit-image
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_tomography_bodies.py
"""

import struct
import sys

import numpy as np
from skimage import measure

from generate_geo import OUTPUT_DIR, write_json
from generate_tomography import load_model, synthesize

THRESHOLD_PERCENT = 0.8
TOP_KM = 1050.0
CMB_KM = 2891.0
CAP_KM = 1.0
GRID_DEG = 2.5
EARTH_RADIUS_KM = 6371.0
QUANTUM = 32767
MIN_PIECE_MILLION_KM3 = 100.0
MESHES = (("slow", -THRESHOLD_PERCENT),)


def volume() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(depths km, lats, lons, dVs % [depth, lat, lon]) with a closing layer of zeros beyond either end."""
    layers = load_model()
    depths = sorted(d for d in layers if d >= TOP_KM)
    if depths[0] != TOP_KM:
        raise ValueError(f"TOP_KM {TOP_KM} is not a layer of the model")
    lats = np.arange(-90.0, 90.0 + 1e-9, GRID_DEG)
    lons = np.arange(-180.0, 180.0 + 1e-9, GRID_DEG)
    block = np.zeros((len(depths) + 3, lats.size, lons.size))
    for k, depth in enumerate(depths):
        lmax, coefficients = layers[depth]
        block[k + 1] = synthesize(lmax, coefficients, lons[None, :], lats[:, None])
    block[len(depths) + 1] = block[len(depths)]
    return np.array([TOP_KM - CAP_KM, *depths, CMB_KM, CMB_KM + CAP_KM]), lats, lons, block


def weld(points: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Merge vertices that share a position; drop the triangles that collapse and any left twice."""
    unique, inverse = np.unique(points, axis=0, return_inverse=True)
    faces = inverse.reshape(-1)[faces]
    faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])]
    _, first = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
    return unique, faces[np.sort(first)]


def signed_volume_km3(xyz: np.ndarray, faces: np.ndarray) -> float:
    """Volume enclosed, by the divergence theorem: positive when the triangles face outward."""
    a, b, c = xyz[faces[:, 0]], xyz[faces[:, 1]], xyz[faces[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0


def surface(depths: np.ndarray, lats: np.ndarray, lons: np.ndarray, block: np.ndarray, level: float) -> tuple[np.ndarray, np.ndarray]:
    """(vertices [n, 3] int16 in units of EARTH_RADIUS_KM / QUANTUM, Earth-centred; triangles [m, 3]) of block == level."""
    vertices, faces, _normals, _values = measure.marching_cubes(block, level=level)
    depth = np.interp(vertices[:, 0], np.arange(depths.size), depths)
    lat = np.radians(np.interp(vertices[:, 1], np.arange(lats.size), lats))
    lon = np.radians(np.interp(vertices[:, 2], np.arange(lons.size), lons))
    r = EARTH_RADIUS_KM - depth
    xyz = np.stack([r * np.cos(lat) * np.cos(lon), r * np.cos(lat) * np.sin(lon), r * np.sin(lat)], axis=1)
    points, faces = weld(np.rint(xyz / EARTH_RADIUS_KM * QUANTUM).astype(np.int16), faces)
    if signed_volume_km3(points.astype(float), faces) < 0:
        faces = faces[:, ::-1]
    return points, np.ascontiguousarray(faces)


def pieces(xyz: np.ndarray, faces: np.ndarray) -> list[dict]:
    """The connected pieces of a mesh bigger than MIN_PIECE_MILLION_KM3, biggest first."""
    parent = np.arange(xyz.shape[0])

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in faces:
        ra = find(a)
        for other in (b, c):
            ro = find(other)
            if ro != ra:
                parent[ro] = ra
    root = np.array([find(i) for i in range(xyz.shape[0])])
    out = []
    for label in np.unique(root):
        mine = faces[root[faces[:, 0]] == label]
        a, b, c = xyz[mine[:, 0]], xyz[mine[:, 1]], xyz[mine[:, 2]]
        # Tetrahedra from the Earth's centre: signed volumes, and centres at 3/4 of the way to each face.
        tetra = np.einsum("ij,ij->i", a, np.cross(b, c)) / 6.0
        total = float(tetra.sum())
        if total / 1e6 < MIN_PIECE_MILLION_KM3:
            continue
        centre = ((a + b + c) / 4.0 * tetra[:, None]).sum(axis=0) / total
        # The centre of volume of a shell-shaped body lies below it, so the depth given is the body's
        # mean depth instead: each tetrahedron's mass sits, on average, 3/4 of the way out to its face.
        mean_radius = float((0.75 * np.linalg.norm((a + b + c) / 3.0, axis=1) * tetra).sum() / total)
        radius = np.linalg.norm(xyz[np.unique(mine)], axis=1)
        out.append({
            "volumeMillionKm3": round(total / 1e6, 1),
            "centre": {
                "lon": round(float(np.degrees(np.arctan2(centre[1], centre[0]))), 1),
                "lat": round(float(np.degrees(np.arcsin(centre[2] / np.linalg.norm(centre)))), 1),
                "depthKm": round(EARTH_RADIUS_KM - mean_radius),
            },
            "topKm": round(float(EARTH_RADIUS_KM - radius.max())),
            "bottomKm": round(float(EARTH_RADIUS_KM - radius.min())),
        })
    return sorted(out, key=lambda piece: -piece["volumeMillionKm3"])


def main() -> None:
    depths, lats, lons, block = volume()
    meshes = []
    for name, level in MESHES:
        points, faces = surface(depths, lats, lons, block, level)
        if points.shape[0] > 65535:
            raise ValueError(f"{name}: {points.shape[0]} vertices do not fit 16-bit indices; coarsen GRID_DEG")
        out = OUTPUT_DIR / f"tomography-bodies-{name}.bin"
        out.write_bytes(struct.pack("<II", points.shape[0], faces.size) + points.astype("<i2").tobytes() + faces.astype("<u2").tobytes())
        xyz = points.astype(float) * EARTH_RADIUS_KM / QUANTUM
        meshes.append({"name": name, "file": out.name, "levelPercent": level,
                       "vertices": int(points.shape[0]), "triangles": int(faces.shape[0]),
                       "volumeMillionKm3": round(signed_volume_km3(xyz, faces) / 1e6, 1),
                       "pieces": pieces(xyz, faces)})
        print({k: v for k, v in meshes[-1].items() if k != "pieces"}, f"{out.stat().st_size / 1024:.0f} KiB", file=sys.stderr)
        for piece in meshes[-1]["pieces"][:4]:
            print("  ", piece, file=sys.stderr)
    write_json(OUTPUT_DIR / "tomography-bodies.json", {
        "source": "SEMUCB-WM1 (French & Romanowicz 2014, doi:10.1093/gji/ggu334), degree-31 expansion as distributed with hc",
        "thresholdPercent": THRESHOLD_PERCENT,
        "topKm": TOP_KM,
        "bottomKm": CMB_KM,
        "gridDeg": GRID_DEG,
        "earthRadiusKm": EARTH_RADIUS_KM,
        "quantum": QUANTUM,
        "meshes": meshes,
    })


if __name__ == "__main__":
    main()
