#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the continents through deep time.

Writes two files:

  app/public/geo/deep-time/plates.bin   the present-day coastlines and
        continental blocks of a published global plate model, each piece
        tagged with the plate it rides on and the span of ages it exists
        for, and - per plate - the finite rotation that carries it from
        where it is today to where the model puts it at every age back to
        1,000 Ma.
  app/public/geo/deep-time/timescale.json   the International
        Chronostratigraphic Chart: eons, eras, periods and epochs with
        their boundary ages and the chart's own colours.

The app does not get a stack of reconstructed snapshots. It gets the shapes
once and the rotations, and turns each plate itself (in the vertex shader),
so the continents move smoothly at any age and the whole billion years is a
few hundred kilobytes.

Sources

  Plate model: Merdith, A.S., Williams, S.E., Collins, A.S., Tetley, M.G.,
    Mulder, J.A., Blades, M.L., Young, A., Armistead, S.E., Cannon, J.,
    Zahirovic, S. & Müller, R.D. (2021), Extending full-plate tectonic
    models into deep time: Linking the Neoproterozoic and the Phanerozoic,
    Earth-Science Reviews 214, 103477, doi:10.1016/j.earscirev.2020.103477.
    Files: the rotation file, coastlines, continental polygons and static
    polygons of the model as distributed by EarthByte / GPlates
    (https://repo.gplates.org/webdav/pmm/merdith2021/, the copy the
    GPlates Web Service and plate-model-manager serve; Zenodo
    doi:10.5281/zenodo.13635864). CC BY 4.0.
    Reference frame: palaeomagnetic - the plates are placed relative to the
    Earth's spin axis, so latitudes are palaeolatitudes; longitude is not
    constrained by palaeomagnetism and is the model's choice.
  Time scale: International Commission on Stratigraphy, International
    Chronostratigraphic Chart v2024/12 (Cohen, K.M., Harper, D.A.T.,
    Gibbard, P.L. & Car, N. (2025), Episodes 48, 105-115,
    doi:10.18814/epiiugs/2025/025001), machine-readable edition
    https://github.com/i-c-stratigraphy/chart. CC BY 4.0.

How the rotations are stored

  pygplates gives each plate's total rotation relative to the model's
  anchor (plate 0, the spin axis) at every whole million years. A plate's
  series is then thinned to key ages: a key is dropped while spherical
  interpolation between its neighbours reproduces every dropped sample to
  within KEY_TOLERANCE_DEG. The rotation file holds jumps (a terrane handed
  from one parent plate to another); those survive as two keys one million
  years apart. Rotations are quaternions (x, y, z, w) in the app's frame -
  x through 0°N 0°E, y through 0°N 90°E, z through the north pole - as
  int16 / 32767.

  A piece exists from its `begin` age (when the model says that crust
  appears; clamped to the model's 1,000 Ma) to its `end` age (0 for
  everything that reaches the present).

File layout (little-endian)

  "TEDT" u32 version u32 headerBytes, header JSON (padded to 4 bytes), then
  the arrays the header names by byte offset from the end of the header:
    plateIds   int32[plates]
    keyCounts  uint16[plates]
    keyAges    uint16[keys]          Ma, ascending per plate, first is 0
    keyQuats   int16[keys * 4]
  and per set ("coast", "continents"):
    ringPlate  uint16[rings]         index into plateIds
    ringBegin  uint16[rings]         Ma
    ringEnd    uint16[rings]         Ma
    ringCounts uint16[rings]         points per ring (closed: first == last)
    points     int16[points * 2]     lon, lat in 1/QUANTUM_PER_DEG degrees:
                                     each ring's first point absolute, the
                                     rest deltas (longitude deltas wrapped)
    interior   uint16[points]        for the step from this point to the
                                     next: 0 an outer edge at every age; N
                                     not an edge from today back to N Ma
                                     (land lies on both sides: the model
                                     cuts continents into terranes); 65535
                                     never an edge
  and for "continents", whose pieces are also drawn filled:
    fillPoints int16[extra * 2]      points added inside the pieces so that
                                     no fill triangle is long enough to sag
                                     under the sphere (lon, lat, absolute)
    fillRing   uint16[extra]         the ring each added point belongs to
    triangles  uint16[n * 3]         indices: below the set's point count a
                                     ring point, above it an added point

Needs pygplates and mapbox-earcut, which are not in the system Python:

    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install pygplates numpy mapbox-earcut
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_deep_time.py
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_deep_time.py
"""

from __future__ import annotations

import json
import math
import re
import struct
import sys
import zipfile
from pathlib import Path

import numpy as np

from fetch_cache import CACHE_DIR, cached_fetch

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "app" / "public" / "geo" / "deep-time"
MODEL_BASE = "https://repo.gplates.org/webdav/pmm/merdith2021"
MODEL_DIR = CACHE_DIR / "deep-time" / "merdith2021"
CHART_URL = "https://raw.githubusercontent.com/i-c-stratigraphy/chart/main/chart.ttl"

MODEL_NAME = "Merdith et al. (2021)"
MODEL_CITATION = (
    "Merdith, A.S., Williams, S.E., Collins, A.S., Tetley, M.G., Mulder, J.A., Blades, M.L., Young, A., "
    "Armistead, S.E., Cannon, J., Zahirovic, S. & Müller, R.D. (2021), Extending full-plate tectonic models into "
    "deep time: Linking the Neoproterozoic and the Phanerozoic, Earth-Science Reviews 214, 103477, "
    "doi:10.1016/j.earscirev.2020.103477"
)
MAX_AGE_MA = 1000
QUANTUM_PER_DEG = 100
# About 3 km on the ground: under a pixel from across the planet, and far inside what a plate model knows.
SIMPLIFY_DEG = 0.03
# Rings narrower than this are specks at planet scale.
MIN_RING_EXTENT_DEG = 0.35
# No step of an outline longer than this: see densify_ring.
MAX_SEGMENT_DEG = 2.0
# How far to either side of a step's middle to look for land of the same plate: see mark_interior_steps.
INTERIOR_PROBE_DEG = 0.1
# Two plates that have moved a seam less than this apart still count as joined there (about 110 km).
INTERIOR_DRIFT_DEG = 1.0
ALWAYS_INTERIOR = 65535
# No edge of a fill triangle longer than this: a 4° chord sags 4 km at its middle.
MAX_FILL_EDGE_DEG = 4.0
# 0.02° of rotation moves a point at most 2.2 km.
KEY_TOLERANCE_DEG = 0.02
VERSION = 1

LAYERS = {
    "coast": ("Coastlines", "Coastlines/shapes_coastlines_Merdith_et_al_v2.gpmlz"),
    "continents": ("ContinentalPolygons", "ContinentalPolygons/shapes_continents.gpml"),
}
ROTATION_FILE = "Rotations/1000_0_rotfile_Merdith_etal.rot"
STATIC_POLYGONS = "StaticPolygons/shapes_static_polygons_Merdith_etal.gpml"

# The continents the app names as they move: plate ID -> the name the
# model's own static polygons give that plate. The bake fails if the model
# does not carry that name for that plate, so none of these is ours.
NAMED_PLATES = {
    101: "North America",
    102: "Greenland",
    201: "South America",
    302: "Baltica",
    304: "Iberia",
    401: "Siberia",
    501: "India",
    503: "Arabia",
    602: "South China",
    701: "Africa",
    702: "Madagascar",
    714: "Northwest Africa",
    801: "Australia",
    802: "Antarctica",
}


def model_file(relative: str) -> Path:
    """A file of the model, downloading and unpacking its archive on first use."""
    path = MODEL_DIR / relative
    if not path.exists():
        archive_name = relative.split("/")[0]
        archive = cached_fetch(f"{MODEL_BASE}/{archive_name}.zip", f"deep-time/{archive_name}.zip")
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.namelist():
                target = (MODEL_DIR / member).resolve()
                # Refuse anything that would unpack outside the model's own folder.
                if not target.is_relative_to(MODEL_DIR.resolve()):
                    raise ValueError(f"unsafe path in {archive_name}.zip: {member}")
            bundle.extractall(MODEL_DIR)
    if not path.exists():
        raise FileNotFoundError(f"{relative} is not in the model archive")
    return path


def unit(lon_deg: float, lat_deg: float) -> np.ndarray:
    lon, lat = math.radians(lon_deg), math.radians(lat_deg)
    return np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])


def unit_array(lonlat: np.ndarray) -> np.ndarray:
    lon, lat = np.radians(lonlat[:, 0]), np.radians(lonlat[:, 1])
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=1)


def lonlat_of(vector: np.ndarray) -> tuple[float, float]:
    return math.degrees(math.atan2(vector[1], vector[0])), math.degrees(math.asin(max(-1.0, min(1.0, vector[2]))))


# --- rotations ---------------------------------------------------------------


def quaternion(rotation) -> np.ndarray:
    """A pygplates FiniteRotation as (x, y, z, w) in the app's frame."""
    if rotation.represents_identity_rotation():
        return np.array([0.0, 0.0, 0.0, 1.0])
    lat, lon, angle = rotation.get_lat_lon_euler_pole_and_angle_degrees()
    axis = unit(lon, lat)
    half = math.radians(angle) / 2
    return np.array([*(axis * math.sin(half)), math.cos(half)])


def rotate(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Turn unit vector(s) `v` by quaternion `q`."""
    u, w = q[:3], q[3]
    return v + 2 * np.cross(u, np.cross(u, v) + w * v)


def slerp(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    dot = float(a @ b)
    if dot < 0:
        b, dot = -b, -dot
    if dot > 0.9999995:
        mixed = a + (b - a) * t
        return mixed / np.linalg.norm(mixed)
    theta = math.acos(dot)
    return (math.sin((1 - t) * theta) * a + math.sin(t * theta) * b) / math.sin(theta)


def rotation_between_deg(a: np.ndarray, b: np.ndarray) -> float:
    """The angle of the rotation that separates two orientations."""
    return 2 * math.degrees(math.acos(min(1.0, abs(float(a @ b)))))


def plate_series(rotation_model, plate_id: int, oldest: int) -> np.ndarray:
    """The plate's quaternion at 0, 1, ... oldest Ma, signs chosen so neighbours agree."""
    series = np.empty((oldest + 1, 4))
    for age in range(oldest + 1):
        q = quaternion(rotation_model.get_rotation(float(age), plate_id))
        if age and float(q @ series[age - 1]) < 0:
            q = -q
        series[age] = q
    return series


def key_ages(series: np.ndarray, tolerance_deg: float = KEY_TOLERANCE_DEG) -> list[int]:
    """Ages to keep so that slerp between kept neighbours stays within tolerance of every sample."""
    last = len(series) - 1
    keys = [0]
    start = 0
    while start < last:
        # Reach as far as the samples in between allow; never less than one step.
        end = start + 1
        candidate = end + 1
        while candidate <= last:
            span = candidate - start
            if all(
                rotation_between_deg(slerp(series[start], series[candidate], (k - start) / span), series[k]) <= tolerance_deg
                for k in range(start + 1, candidate)
            ):
                end = candidate
                candidate += 1
            else:
                break
        keys.append(end)
        start = end
    return keys


# --- shapes ------------------------------------------------------------------


def simplify_ring(points: np.ndarray, tolerance_deg: float) -> np.ndarray:
    """Douglas-Peucker on the sphere for a closed ring (first point repeated last); keeps it closed."""
    vectors = unit_array(points)
    count = len(points)
    if count <= 4:
        return points
    # Split the ring at the point farthest from its start, so neither half is degenerate.
    far = int(np.argmin(vectors @ vectors[0]))
    if far in (0, count - 1):
        return points
    keep = np.zeros(count, dtype=bool)
    keep[[0, far, count - 1]] = True
    tolerance = math.radians(tolerance_deg)
    stack = [(0, far), (far, count - 1)]
    while stack:
        first, last = stack.pop()
        if last - first < 2:
            continue
        a, b = vectors[first], vectors[last]
        inner = vectors[first + 1 : last]
        chord = b - a
        length2 = float(chord @ chord)
        if length2 < 1e-18:
            distances = np.linalg.norm(inner - a, axis=1)
        else:
            along = np.clip(((inner - a) @ chord) / length2, 0, 1)
            distances = np.linalg.norm(inner - (a + along[:, None] * chord), axis=1)
        worst = int(np.argmax(distances))
        if distances[worst] > tolerance:
            index = first + 1 + worst
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return points[keep]


def ring_extent_deg(points: np.ndarray) -> float:
    vectors = unit_array(points)
    centre = vectors.mean(axis=0)
    centre /= np.linalg.norm(centre)
    return 2 * math.degrees(math.acos(float(np.clip((vectors @ centre).min(), -1, 1))))


def quantise(points: np.ndarray) -> np.ndarray:
    """Whole quanta, closed, with repeats removed."""
    q = np.rint(points * QUANTUM_PER_DEG).astype(np.int64)
    q[:, 0] = (q[:, 0] + 180 * QUANTUM_PER_DEG) % (360 * QUANTUM_PER_DEG) - 180 * QUANTUM_PER_DEG
    keep = np.ones(len(q), dtype=bool)
    keep[1:] = np.any(q[1:] != q[:-1], axis=1)
    q = q[keep]
    if len(q) and np.any(q[0] != q[-1]):
        q = np.vstack([q, q[:1]])
    return q


def densify_ring(points: np.ndarray, max_deg: float) -> np.ndarray:
    """Add points along the great circle so no step of the ring is longer than `max_deg`.

    The app joins a ring's points with straight chords. A long chord dips
    under the surface, and seen from inside the planet it does not lie
    where the great-circle edge it stands for does.
    """
    vectors = unit_array(points)
    out = [points[:1]]
    for k in range(1, len(points)):
        a, b = vectors[k - 1], vectors[k]
        angle = math.degrees(math.acos(float(np.clip(a @ b, -1, 1))))
        pieces = math.ceil(angle / max_deg)
        for step in range(1, pieces):
            t = step / pieces
            mid = slerp(a, b, t)
            out.append(np.array([lonlat_of(mid)]))
        out.append(points[k : k + 1])
    return np.vstack(out)


def triangulate(rings: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Triangles filling one polygon (outer ring, then holes; quantised lon/lat, closed).

    Ear-clipped on an equal-area azimuthal map centred on the polygon, so
    one that holds a pole or straddles the antimeridian is a plain polygon
    like any other. Ear clipping makes triangles as long as the polygon; a
    flat triangle that long sags hundreds of kilometres under the sphere.
    So every edge longer than MAX_FILL_EDGE_DEG is then halved, the new
    point put back on the sphere, until none is left - each long edge is
    split at the same point for both triangles that share it, so no cracks.

    Returns (triangles, extra): index triples and the added points
    (quantised lon/lat). An index below the polygon's ring-point count
    (closing points included, never referenced) is a ring point; above it,
    an added point.
    """
    import mapbox_earcut

    vectors = [unit_array(ring[:-1] / QUANTUM_PER_DEG) for ring in rings]
    centre = np.vstack(vectors).mean(axis=0)
    centre /= np.linalg.norm(centre)
    east = np.cross([0.0, 0.0, 1.0], centre)
    if np.linalg.norm(east) < 1e-6:
        east = np.array([1.0, 0.0, 0.0])
    east /= np.linalg.norm(east)
    north = np.cross(centre, east)
    planar = []
    for ring in vectors:
        cos_c = np.clip(ring @ centre, -1, 1)
        scale = np.sqrt(2 / (1 + cos_c))
        planar.append(np.stack([(ring @ east) * scale, (ring @ north) * scale], axis=1))
    ends = np.cumsum([len(p) for p in planar]).astype(np.uint32)
    local = mapbox_earcut.triangulate_float64(np.vstack(planar), ends).astype(np.int64)

    ring_points = int(ends[-1])
    points = [v for ring in vectors for v in ring]
    midpoints: dict[tuple[int, int], int] = {}
    limit = math.cos(math.radians(MAX_FILL_EDGE_DEG))
    triangles = [tuple(int(v) for v in t) for t in local.reshape(-1, 3)]
    done = []
    while triangles:
        a, b, c = triangles.pop()
        edges = ((a, b, c), (b, c, a), (c, a, b))
        dots = [float(points[u] @ points[v]) for u, v, _ in edges]
        longest = int(np.argmin(dots))
        if dots[longest] >= limit:
            done.append((a, b, c))
            continue
        u, v, w = edges[longest]
        key = (min(u, v), max(u, v))
        if key not in midpoints:
            mid = points[u] + points[v]
            # Where the app will have it: on the sphere, at a whole quantum.
            lon, lat = lonlat_of(mid / np.linalg.norm(mid))
            snapped = np.rint(np.array([lon, lat]) * QUANTUM_PER_DEG) / QUANTUM_PER_DEG
            midpoints[key] = len(points)
            points.append(unit(*snapped))
        m = midpoints[key]
        triangles.append((u, m, w))
        triangles.append((m, v, w))
    extra = np.array([lonlat_of(p) for p in points[ring_points:]]).reshape(-1, 2)
    extra = np.rint(extra * QUANTUM_PER_DEG).astype(np.int64)

    # Local ring indices skip each ring's closing point; the stored ones do not.
    closing = np.zeros(ring_points, dtype=np.int64)
    position = 0
    for index, ring in enumerate(planar):
        closing[position : position + len(ring)] = index
        position += len(ring)
    stored_ring_points = ring_points + len(rings)
    out = np.array(done, dtype=np.int64).reshape(-1, 3)
    out = np.where(out < ring_points, out + closing[np.minimum(out, ring_points - 1)], out - ring_points + stored_ring_points)
    return out, extra


def load_set(path: Path) -> list[dict]:
    """Every polygon of a feature collection: rings, plate, ages and name."""
    import pygplates

    pieces = []
    for feature in pygplates.FeatureCollection(str(path)):
        begin, end = feature.get_valid_time()
        begin = MAX_AGE_MA if not math.isfinite(begin) else min(MAX_AGE_MA, math.ceil(begin))
        end = 0 if not math.isfinite(end) else max(0, math.floor(end))
        if begin <= end:
            continue
        for geometry in feature.get_geometries():
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            rings = [geometry.get_exterior_ring_points()]
            rings += [geometry.get_interior_ring_points(i) for i in range(geometry.get_number_of_interior_rings())]
            lonlat = []
            for ring in rings:
                array = np.array([[p.to_lat_lon()[1], p.to_lat_lon()[0]] for p in ring])
                if np.any(array[0] != array[-1]):
                    array = np.vstack([array, array[:1]])
                lonlat.append(array)
            pieces.append(
                {
                    "plate": feature.get_reconstruction_plate_id(),
                    "begin": begin,
                    "end": end,
                    "name": feature.get_name(),
                    "rings": lonlat,
                    "area": geometry.get_area(),
                    "centroid": geometry.get_interior_centroid().to_lat_lon(),
                }
            )
    return pieces


def prepare_set(pieces: list[dict]) -> list[dict]:
    """Simplify and quantise; drop specks. Each kept piece gets `quantised`: its rings, outer first."""
    kept = []
    for piece in pieces:
        if ring_extent_deg(piece["rings"][0]) < MIN_RING_EXTENT_DEG:
            continue
        rings = []
        for index, ring in enumerate(piece["rings"]):
            if index and ring_extent_deg(ring) < MIN_RING_EXTENT_DEG:
                continue
            q = quantise(densify_ring(simplify_ring(ring, SIMPLIFY_DEG), MAX_SEGMENT_DEG))
            if len(q) >= 4:
                rings.append(q)
            elif index == 0:
                break
        else:
            kept.append({**piece, "quantised": rings})
    return kept


def windings(ring_vectors: np.ndarray, points: np.ndarray) -> np.ndarray:
    """How many times a ring (unit vectors, closed) goes round each of `points`: 0 outside."""
    east = np.cross([0.0, 0.0, 1.0], points)
    norms = np.linalg.norm(east, axis=1)
    east[norms < 1e-9] = [1.0, 0.0, 0.0]
    east /= np.linalg.norm(east, axis=1)[:, None]
    north = np.cross(points, east)
    out = np.empty(len(points), dtype=np.int64)
    # Bearings from every point to every vertex: in slices, to bound the memory.
    for first in range(0, len(points), 2000):
        chunk = slice(first, first + 2000)
        bearing = np.arctan2(east[chunk] @ ring_vectors.T, north[chunk] @ ring_vectors.T)
        step = np.diff(bearing, axis=1)
        step = (step + math.pi) % (2 * math.pi) - math.pi
        out[chunk] = np.rint(step.sum(axis=1) / (2 * math.pi))
    return out


def relative_series(series_a: np.ndarray, series_b: np.ndarray) -> np.ndarray:
    """Per age, the rotation that takes a point riding plate B to where it would be riding plate A, undone by B."""
    count = min(len(series_a), len(series_b))
    a, b = series_a[:count], series_b[:count]
    # conj(b) * a
    bx, by, bz, bw = -b[:, 0], -b[:, 1], -b[:, 2], b[:, 3]
    ax, ay, az, aw = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
    return np.stack(
        [
            bw * ax + bx * aw + by * az - bz * ay,
            bw * ay - bx * az + by * aw + bz * ax,
            bw * az + bx * ay - by * ax + bz * aw,
            bw * aw - bx * ax - by * ay - bz * az,
        ],
        axis=1,
    )


def together_until(relative: np.ndarray, points: np.ndarray, limit_deg: float) -> np.ndarray:
    """For each point, the oldest age up to which the two plates have carried it less than `limit_deg` apart."""
    u, w = relative[:, None, :3], relative[:, None, 3:]
    v = points[None, :, :]
    moved = v + 2 * np.cross(u, np.cross(u, v) + w * v)
    apart = np.einsum("tpk,pk->tp", moved, points) < math.cos(math.radians(limit_deg))
    first = np.where(apart.any(axis=0), apart.argmax(axis=0), len(relative))
    return first - 1


def mark_interior_steps(pieces: list[dict], series: dict[int, np.ndarray]) -> int:
    """Give each ring step the age up to which it is not an outer edge, in `piece["interior"]` (one array per ring).

    The model cuts a continent into terranes, each its own polygon; drawn
    as they are, Africa is a web of internal lines. A step is interior when
    the ground INTERIOR_PROBE_DEG to both sides of its middle is land - its
    own polygon on one side, a neighbour on the other. It stays interior
    back to the age at which that neighbour first appears, or, when the
    neighbour rides another plate, back to the age at which the two plates
    have drifted more than INTERIOR_DRIFT_DEG apart there: the suture
    between India and Asia is a seam today and a coast by 2 Ma.

    Stored per point for the step that starts there: 0, an outer edge at
    every age; N, interior from today back to N Ma and an edge before;
    65535, interior for as long as its own polygon exists.
    """
    for piece in pieces:
        outer = unit_array(piece["quantised"][0] / QUANTUM_PER_DEG)
        centre = outer.mean(axis=0)
        centre /= np.linalg.norm(centre)
        piece["_outer"] = outer
        piece["_centre"] = centre
        piece["_reach"] = math.acos(float(np.clip((outer @ centre).min(), -1, 1)))
    centres = np.array([piece["_centre"] for piece in pieces])
    reaches = np.array([piece["_reach"] for piece in pieces])
    probe = math.radians(INTERIOR_PROBE_DEG)
    hidden = 0
    for piece in pieces:
        piece["interior"] = []
        # Only pieces whose bounding caps touch this one's can lie beside it.
        gap = np.arccos(np.clip(centres @ piece["_centre"], -1, 1))
        neighbours = [pieces[k] for k in np.flatnonzero(gap <= reaches + piece["_reach"] + 2 * probe) if pieces[k]["end"] <= piece["end"]]
        for ring in piece["quantised"]:
            vectors = unit_array(ring / QUANTUM_PER_DEG)
            a, b = vectors[:-1], vectors[1:]
            middle = a + b
            middle /= np.linalg.norm(middle, axis=1)[:, None]
            side = np.cross(middle, b - a)
            side /= np.maximum(np.linalg.norm(side, axis=1), 1e-12)[:, None]
            until = []
            for sign in (1, -1):
                probes = middle * math.cos(probe) + sign * side * math.sin(probe)
                best = np.zeros(len(middle), dtype=np.int64)
                for other in neighbours:
                    near = (probes @ other["_centre"]) >= math.cos(min(math.pi, other["_reach"] + probe))
                    if not near.any():
                        continue
                    inside = np.flatnonzero(near)[windings(other["_outer"], probes[near]) != 0]
                    if len(inside) == 0:
                        continue
                    shared = min(piece["begin"], other["begin"])
                    if other["plate"] == piece["plate"]:
                        lasts = np.full(len(inside), shared)
                    else:
                        relative = relative_series(series[piece["plate"]][: shared + 1], series[other["plate"]][: shared + 1])
                        lasts = together_until(relative, middle[inside], INTERIOR_DRIFT_DEG)
                    lasts = np.where(lasts >= piece["begin"], ALWAYS_INTERIOR, lasts)
                    best[inside] = np.maximum(best[inside], lasts)
                until.append(best)
            interior = np.minimum(until[0], until[1])
            hidden += int((interior > 0).sum())
            # One value per point: the step that starts there. The closing point starts none.
            piece["interior"].append(np.append(interior, 0))
    for piece in pieces:
        del piece["_outer"], piece["_centre"], piece["_reach"]
    return hidden


def encode_points(rings: list[np.ndarray]) -> np.ndarray:
    """int16 pairs: each ring's first point absolute, then deltas with longitude wrapped."""
    out = []
    wrap = 360 * QUANTUM_PER_DEG
    for ring in rings:
        delta = np.diff(ring, axis=0)
        delta[:, 0] = (delta[:, 0] + wrap // 2) % wrap - wrap // 2
        out.append(ring[:1])
        out.append(delta)
    flat = np.vstack(out)
    if flat.min() < -32768 or flat.max() > 32767:
        raise ValueError("a point or step does not fit int16")
    return flat.astype("<i2")


# --- time scale --------------------------------------------------------------

RANKS = {"Eon": "eon", "Era": "era", "Period": "period", "Epoch": "epoch"}


def parse_chart(text: str) -> tuple[str, list[dict]]:
    """Units of the ICS chart's machine-readable edition, and the chart version it states."""
    version = re.search(r"Modified (\d{4}-\d{2})\.\"@en", text)
    if not version:
        raise ValueError("the chart does not state its version where expected")
    units = []
    for block in re.split(r"\n(?=gtsd:[A-Za-z0-9]+\n)", text):
        head = re.match(r"gtsd:([A-Za-z0-9]+)\n", block)
        ranks = re.search(r"gts:rank\s+((?:rank:[\w-]+\s*[,;]\s*)+)", block)
        # The Pridoli is both an age and an epoch; the coarser rank is the one drawn.
        found = set(re.findall(r"rank:([\w-]+)", ranks.group(1))) if ranks else set()
        rank = next((r for r in RANKS if r in found), None)
        if not head or rank is None:
            continue
        label = re.search(r"skos:prefLabel\n(?:.*\n)*?\s+\"([^\"]+)\"@en [,;]", block)
        begin = re.search(r"time:hasBeginning\s*\[[^\]]*?gtsd:inMYA ([\d.]+)", block)
        end = re.search(r"time:hasEnd\s*\[[^\]]*?gtsd:inMYA ([\d.]+)", block)
        colour = re.search(r"schema:color \"(#[0-9A-Fa-f]{6})\"", block)
        if not (begin and end and colour):
            raise ValueError(f"cannot read chart unit {head.group(1)}")
        # A few epochs (the Mississippian's and Pennsylvanian's) carry no label of their own: their identifier is the name, run together.
        name = label.group(1) if label else re.sub(r"(?<=[a-z])(?=[A-Z])", " ", head.group(1))
        units.append(
            {
                "name": name,
                "rank": RANKS[rank],
                "begin": float(begin.group(1)),
                "end": float(end.group(1)),
                "color": colour.group(1).upper(),
            }
        )
    order = list(RANKS.values())
    units.sort(key=lambda u: (order.index(u["rank"]), u["end"]))
    return version.group(1).replace("-", "/"), units


def write_timescale() -> None:
    chart = cached_fetch(CHART_URL, "deep-time/ics-chart.ttl").read_text(encoding="utf-8")
    version, units = parse_chart(chart)
    payload = {
        "source": (
            f"International Commission on Stratigraphy, International Chronostratigraphic Chart v{version} "
            "(Cohen, Harper, Gibbard & Car 2025, Episodes 48, 105-115), CC BY 4.0"
        ),
        "version": version,
        "units": units,
    }
    path = OUTPUT_DIR / "timescale.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size:,} bytes, {len(units)} units, chart v{version})")


# --- the bake ----------------------------------------------------------------


def block_names(static_path: Path, land: list[dict]) -> list[dict]:
    """For each named plate: the model's name for it and a point inside its largest piece of land."""
    import pygplates

    named: set[tuple[int, str]] = set()
    for feature in pygplates.FeatureCollection(str(static_path)):
        named.add((feature.get_reconstruction_plate_id(), feature.get_name()))
    blocks = []
    for plate, name in NAMED_PLATES.items():
        pieces = [p for p in land if p["plate"] == plate]
        if not pieces or (plate, name) not in named:
            raise ValueError(f"the model has no continental plate {plate} named {name}")
        # The static polygon of a plate takes in its ocean floor; the name belongs on the land.
        # ... and on land that is still there: the model's Greater India ends at 10 Ma, under Tibet.
        lat, lon = max((p for p in pieces if p["end"] == 0), key=lambda p: p["area"])["centroid"]
        blocks.append(
            {
                "plate": plate,
                "name": name,
                "lon": round(lon, 2),
                "lat": round(lat, 2),
                "begin": max(p["begin"] for p in pieces),
            }
        )
    return blocks


def build() -> tuple[dict, bytes]:
    import pygplates

    rotation_model = pygplates.RotationModel(str(model_file(ROTATION_FILE)))
    sets = {}
    for name, (_, relative) in LAYERS.items():
        loaded = load_set(model_file(relative))
        sets[name] = prepare_set(loaded)
        print(f"{name}: {len(loaded)} polygons, {len(sets[name])} kept", file=sys.stderr)

    oldest: dict[int, int] = {}
    for pieces in sets.values():
        for piece in pieces:
            oldest[piece["plate"]] = max(oldest.get(piece["plate"], 0), piece["begin"])
    plate_ids = sorted(oldest)
    plate_index = {plate: i for i, plate in enumerate(plate_ids)}

    key_counts, ages, quats = [], [], []
    all_series: dict[int, np.ndarray] = {}
    worst = 0.0
    for plate in plate_ids:
        series = plate_series(rotation_model, plate, oldest[plate])
        all_series[plate] = series
        keys = key_ages(series)
        key_counts.append(len(keys))
        ages.extend(keys)
        quats.append(series[keys])
        # What the app will reproduce, from the quantised keys.
        stored = np.rint(series[keys] * 32767) / 32767
        stored /= np.linalg.norm(stored, axis=1)[:, None]
        for a, b, qa, qb in zip(keys, keys[1:], stored, stored[1:]):
            for k in range(a, b + 1):
                worst = max(worst, rotation_between_deg(slerp(qa, qb, (k - a) / (b - a)), series[k]))
    print(f"{len(plate_ids)} plates, {len(ages)} keys, worst rotation error {worst:.4f}°", file=sys.stderr)
    for name, pieces in sets.items():
        hidden = mark_interior_steps(pieces, all_series)
        print(f"{name}: {hidden} steps interior at some age", file=sys.stderr)

    arrays: list[tuple[str, bytes]] = [
        ("plateIds", np.array(plate_ids, dtype="<i4").tobytes()),
        ("keyCounts", np.array(key_counts, dtype="<u2").tobytes()),
        ("keyAges", np.array(ages, dtype="<u2").tobytes()),
        ("keyQuats", np.rint(np.vstack(quats) * 32767).astype("<i2").tobytes()),
    ]
    set_headers = {}
    for name, pieces in sets.items():
        ring_plate, ring_begin, ring_end, ring_counts, rings, triangles = [], [], [], [], [], []
        extra_points, extra_ring = [], []
        interior: list[np.ndarray] = []
        total_points = sum(len(ring) for piece in pieces for ring in piece["quantised"])
        point_base = 0
        for piece in pieces:
            first_ring = len(rings)
            for ring in piece["quantised"]:
                ring_plate.append(plate_index[piece["plate"]])
                ring_begin.append(piece["begin"])
                ring_end.append(piece["end"])
                ring_counts.append(len(ring))
                rings.append(ring)
            interior.extend(piece["interior"])
            piece_points = sum(len(ring) for ring in piece["quantised"])
            if name == "continents":
                local, extra = triangulate(piece["quantised"])
                # Ring points keep their place in the set; added points follow all of the set's ring points.
                extra_base = total_points + sum(len(e) for e in extra_points)
                triangles.append(np.where(local < piece_points, local + point_base, local - piece_points + extra_base))
                extra_points.append(extra)
                extra_ring.extend([first_ring] * len(extra))
            point_base += piece_points
        if max(ring_counts) > 65535:
            raise ValueError("a ring has too many points for uint16")
        set_headers[name] = {"rings": len(rings), "points": point_base}
        arrays += [
            (f"{name}.ringPlate", np.array(ring_plate, dtype="<u2").tobytes()),
            (f"{name}.ringBegin", np.array(ring_begin, dtype="<u2").tobytes()),
            (f"{name}.ringEnd", np.array(ring_end, dtype="<u2").tobytes()),
            (f"{name}.ringCounts", np.array(ring_counts, dtype="<u2").tobytes()),
            (f"{name}.points", encode_points(rings).tobytes()),
            (f"{name}.interior", np.concatenate(interior).astype("<u2").tobytes()),
        ]
        if triangles:
            extras = np.vstack(extra_points)
            all_triangles = np.concatenate(triangles)
            if all_triangles.max() > 65535:
                raise ValueError("too many fill points for uint16 indices")
            set_headers[name]["fillPoints"] = len(extras)
            arrays += [
                (f"{name}.fillPoints", extras.astype("<i2").tobytes()),
                (f"{name}.fillRing", np.array(extra_ring, dtype="<u2").tobytes()),
                (f"{name}.triangles", all_triangles.astype("<u2").tobytes()),
            ]

    offsets = {}
    body = bytearray()
    for name, data in arrays:
        while len(body) % 4:
            body.append(0)
        offsets[name] = [len(body), len(data)]
        body += data

    header = {
        "model": MODEL_NAME,
        "citation": MODEL_CITATION,
        "licence": "CC BY 4.0",
        "referenceFrame": "palaeomagnetic",
        "maxAgeMa": MAX_AGE_MA,
        "quantumPerDegree": QUANTUM_PER_DEG,
        "simplifyDeg": SIMPLIFY_DEG,
        "maxSegmentDeg": MAX_SEGMENT_DEG,
        "maxFillEdgeDeg": MAX_FILL_EDGE_DEG,
        "keyToleranceDeg": KEY_TOLERANCE_DEG,
        "worstRotationErrorDeg": round(worst, 4),
        "plates": len(plate_ids),
        "keys": len(ages),
        "sets": set_headers,
        "blocks": block_names(model_file(STATIC_POLYGONS), sets["continents"] + sets["coast"]),
        "arrays": offsets,
    }
    return header, bytes(body)


def write(header: dict, body: bytes) -> Path:
    encoded = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    path = OUTPUT_DIR / "plates.bin"
    path.write_bytes(b"TEDT" + struct.pack("<II", VERSION, len(encoded)) + encoded + body)
    return path


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_timescale()
    header, body = build()
    path = write(header, body)
    print(f"wrote {path} ({path.stat().st_size:,} bytes)")
    for name, info in header["sets"].items():
        print(f"  {name}: {info['rings']} rings, {info['points']} points")
    print(f"  {header['plates']} plates, {header['keys']} rotation keys")
    for block in header["blocks"]:
        print(f"  block {block['plate']}: {block['name']} at {block['lon']}, {block['lat']} (to {block['begin']} Ma)")


if __name__ == "__main__":
    main()
