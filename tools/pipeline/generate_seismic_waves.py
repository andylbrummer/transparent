#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: seismic wavefronts inside the Earth.

    app/public/geo/seismic-waves.json   what is in the binary, and how to read it
    app/public/geo/seismic-waves.bin    the rays

What the app draws is the wavefront of an earthquake at a time t: the surface
that the P (or S) wave has reached t seconds after the origin. In a
spherically symmetric Earth that surface is a curve in the plane through the
source and the Earth's centre, turned about the source's axis; and the curve
is the locus, over every take-off angle, of the point a ray has reached at t.
So this script shoots a fan of rays from each of a set of source depths and
stores where each ray is every STEP_S seconds: (radius, angular distance from
the source). The app joins the rays into a mesh and moves its vertices.

Model and method:

    ak135 (Kennett, Engdahl & Buland 1995, Geophys. J. Int. 122, 108-124),
    a 1-D (radial) Earth model, traced with ObsPy's TauP (Crotwell, Owens &
    Ritsema 1999; ObsPy is LGPL-3.0 and is used here, offline, only). Rays
    are shot by ray parameter, not by distance, so the fan is even in
    take-off angle and holds every branch of a triplication.

Rays stored, in order of take-off angle from straight down to straight up:

    P family   PKIKP (through the inner core), PKP (turning in the outer
               core), P (turning in the mantle), p (leaving upwards).
    S family   the S that strikes the core (kept to the core-mantle boundary,
               where it ends: the outer core is liquid and carries no shear),
               S (turning in the mantle), s (leaving upwards).

Every ray ends where it first meets the surface. Not traced: reflections
(PP, PcP, ScS, pP ...), conversions (SKS, PS ...), the total reflection off
the inner core (PKiKP: the 0.4 degree wide gap between PKIKP and PKP in the
fan) and diffraction along the core. Pdiff and Sdiff, which are what first
arrives just inside the shadows, are kept as arrival times only (TauP's
range for them, 60 degrees of diffraction, is a convention, not a limit of
nature).

A ray that has ended is stored one step beyond its end (just above the
surface, or just inside the core for the S that died there) and held there:
the app clips the mesh at the surface and at the core, so the front's edge
lands on the boundary rather than a ray short of it.

Surface waves do not come from ray tracing: the app moves a ring at a fixed
group speed. The speeds are those of PREM's fundamental modes (Dziewonski &
Anderson 1981, Phys. Earth Planet. Inter. 25, 297-356, Table V): Rayleigh
(spheroidal 0S80, period 120 s) 3.717 km/s - the table runs from 3.57 km/s
at 216 s to 3.79 km/s at 83 s - and Love (toroidal 0T36, 220 s) 4.382 km/s.
Real surface waves are dispersed (each period has its own speed) and the
speeds differ under oceans and continents; one ring is a simplification.

Two deep earthquakes, to show what depth does, come from the USGS ANSS
Comprehensive Catalog (ComCat, public domain) by event id.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_seismic_waves.py

Requirements (in a venv, never system-wide):
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install obspy numpy
"""

import json
import math
import sys

import numpy as np
from obspy.taup import TauPyModel
from obspy.taup.seismic_phase import SeismicPhase

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

MODEL_NAME = "ak135"
OUTPUT_JSON = OUTPUT_DIR / "seismic-waves.json"
OUTPUT_BIN = OUTPUT_DIR / "seismic-waves.bin"
# What TauP itself says, for the app's tests of its reading of the rays.
FIXTURE_TS = OUTPUT_DIR.parents[1] / "src" / "layers" / "seismic-waves" / "taup.fixture.ts"

# Source depths, km. None sits on a discontinuity of ak135 (20, 35, 120, 210,
# 410, 660 km), where the velocity at the source would be ambiguous. 12 and
# 30 km are where the shallow presets are; 600 km is the 2013 Okhotsk event.
DEPTHS_KM = (0.0, 12.0, 30.0, 60.0, 150.0, 300.0, 450.0, 600.0, 700.0)

STEP_S = 20.0
# 0 .. 1540 s: the last S to reach the surface from a surface source (100 degrees) takes 1523 s.
STEPS = 78

# Stored as two uint16 per sample: radius and angular distance.
RADIUS_SCALE_KM = 7000.0
DELTA_SCALE_DEG = 225.0
U16 = 65535

# (family, phase name in the file, TauP phase, rays, how the path is used)
#   'full'  the whole path, to the surface
#   'down'  only as far as the path's deepest point (the S that ends at the core)
#   'up'    an upgoing phase: take-off angle runs from 90 to 180 degrees
BRANCHES = (
    ("P", "PKIKP", "PKIKP", 32, "full"),
    ("P", "PKP", "PKP", 56, "full"),
    ("P", "P", "P", 140, "full"),
    ("P", "p", "p", 44, "up"),
    ("S", "S to the core", "ScS", 52, "down"),
    ("S", "S", "S", 100, "full"),
    ("S", "s", "s", 40, "up"),
)
RAYS = sum(branch[3] for branch in BRANCHES)

SURFACE_WAVES = (
    {"id": "love", "label": "Love wave", "speedKmS": 4.382, "mode": "0T36, period 220 s"},
    {"id": "rayleigh", "label": "Rayleigh wave", "speedKmS": 3.717, "mode": "0S80, period 120 s"},
)

FDSN_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid={id}"
# ComCat event ids: Sea of Okhotsk 2013 (M8.3, 598 km) and northern Bolivia 1994 (M8.2, 631 km).
DEEP_EVENTS = (("usb000h4jh", "Sea of Okhotsk 2013"), ("usp0006dzc", "Bolivia 1994"))


def spread(n: int) -> np.ndarray:
    """n values from 0 to 1, crowded towards both ends, where neighbouring rays part fastest."""
    s = np.linspace(0.0, 1.0, n)
    return 0.5 * s + 0.25 * (1.0 - np.cos(np.pi * s))


def branch_ray_params(phase: SeismicPhase, n: int, kind: str) -> np.ndarray:
    """Ray parameters (s/rad) of the branch's rays, in order of take-off angle."""
    low, high = phase.min_ray_param, phase.max_ray_param
    # Even in take-off angle: p = u sin(i), u the slowness at the source.
    u = high if kind == "up" else source_slowness(phase)
    if kind == "up":
        angles = math.pi / 2 + (math.pi / 2) * spread(n)
    else:
        a0, a1 = math.asin(min(1.0, low / u)), math.asin(min(1.0, high / u))
        angles = a0 + (a1 - a0) * spread(n)
    margin = 1e-7 * (high - low)
    return np.clip(u * np.sin(angles), low + margin, high - margin)


def source_slowness(phase: SeismicPhase) -> float:
    """Slowness (s/rad) of this phase's first leg at the source depth, on the downgoing side."""
    tau_model = phase.tau_model
    is_p = phase.name[0] in "Pp"
    layer = tau_model.s_mod.get_slowness_layer(tau_model.source_branch, is_p)
    return float(layer["top_p"])


def trace(phase: SeismicPhase, ray_param: float, kind: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """Time (s), radius (km), distance (rad) along one ray, and its take-off angle (deg)."""
    arrival = phase.shoot_ray(0.0, float(ray_param))
    phase.calc_path_from_arrival(arrival)
    path = arrival.path
    time, dist, depth = path["time"], path["dist"], path["depth"]
    if kind == "down":
        end = int(np.argmax(depth)) + 1
        time, dist, depth = time[:end], dist[:end], depth[:end]
    radius = phase.tau_model.radius_of_planet - depth
    return time, radius, dist, float(arrival.takeoff_angle)


# A ray past its end is held at least this far beyond the boundary it ended on,
# so that a ray arriving at a grazing angle is still clearly out.
MIN_OVERSHOOT_KM = 3.0


def sample(time: np.ndarray, radius: np.ndarray, dist: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The ray at every step; past its end, one step of straight-line overshoot, then held."""
    steps = np.arange(STEPS) * STEP_S
    r = np.interp(steps, time, radius)
    d = np.interp(steps, time, dist)
    end = time[-1]
    # The last stretch of the path with a measurable duration gives the overshoot's direction.
    j = len(time) - 2
    while j > 0 and end - time[j] < 1e-3:
        j -= 1
    span = end - time[j]
    dr = (radius[-1] - radius[j]) / span
    dd = (dist[-1] - dist[j]) / span
    first_after = int(math.floor(end / STEP_S)) + 1
    if first_after < STEPS:
        over = first_after * STEP_S - end
        # Outwards for a ray that came up to the surface, inwards for one that went down into the core.
        outwards = 1.0 if dr >= 0 else -1.0
        r[first_after:] = radius[-1] + outwards * max(abs(dr) * over, MIN_OVERSHOOT_KM)
        d[first_after:] = dist[-1] + dd * over
    return r, d


def diffracted(tau_model, name: str) -> dict | None:
    """Where and when TauP's diffracted phase reaches the surface: linear in distance between the ends."""
    phase = SeismicPhase(name, tau_model)
    if len(phase.ray_param) == 0:
        return None
    order = np.argsort(phase.dist)
    dist, time = np.degrees(phase.dist[order]), phase.time[order]
    return {
        "fromDeg": round(float(dist[0]), 3),
        "toDeg": round(float(dist[-1]), 3),
        "fromS": round(float(time[0]), 2),
        "toS": round(float(time[-1]), 2),
    }


def bake_depth(model: TauPyModel, depth_km: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    tau_model = model.model.depth_correct(depth_km)
    radius = np.empty((STEPS, RAYS))
    delta = np.empty((STEPS, RAYS))
    arrival_s = np.full(RAYS, np.nan, dtype=np.float32)
    arrival_deg = np.full(RAYS, np.nan, dtype=np.float32)
    takeoff = np.full(RAYS, np.nan, dtype=np.float32)
    column = 0
    for _family, _label, taup_name, count, kind in BRANCHES:
        phase = SeismicPhase(taup_name, tau_model)
        if len(phase.ray_param) == 0:
            # No such rays from this depth (nothing leaves a surface source upwards):
            # parked above the surface from the start, where the app never draws.
            radius[:, column : column + count] = RADIUS_SCALE_KM
            delta[:, column : column + count] = 0.0
            column += count
            continue
        for ray_param in branch_ray_params(phase, count, kind):
            time, r_path, d_path, angle = trace(phase, ray_param, kind)
            radius[:, column], delta[:, column] = sample(time, r_path, d_path)
            takeoff[column] = angle
            if kind != "down":
                arrival_s[column] = time[-1]
                arrival_deg[column] = math.degrees(d_path[-1])
            column += 1
    info = {"P": diffracted(tau_model, "Pdiff"), "S": diffracted(tau_model, "Sdiff")}
    return radius, delta, arrival_s, arrival_deg, takeoff, info


def encode(radius: np.ndarray, delta: np.ndarray) -> bytes:
    """STEPS x RAYS texels of 4 bytes: radius then distance, each uint16 little-endian."""
    r16 = np.clip(np.rint(radius / RADIUS_SCALE_KM * U16), 0, U16).astype("<u2")
    d16 = np.clip(np.rint(np.degrees(delta) / DELTA_SCALE_DEG * U16), 0, U16).astype("<u2")
    return np.stack([r16, d16], axis=-1).tobytes()


def deep_events() -> list[dict]:
    events = []
    for event_id, name in DEEP_EVENTS:
        path = cached_fetch(FDSN_URL.format(id=event_id), f"comcat/event-{event_id}.geojson")
        feature = json.loads(path.read_text(encoding="utf-8"))
        properties = feature["properties"]
        lon, lat, depth = feature["geometry"]["coordinates"]
        if properties["type"] != "earthquake":
            raise ValueError(f"{event_id} is not an earthquake")
        time_ms = properties["time"]
        iso = np.datetime64(time_ms, "ms").astype(str) + "Z"
        events.append(
            {
                "id": event_id,
                "time": iso,
                "lon": lon,
                "lat": lat,
                "depthKm": depth,
                "mag": properties["mag"],
                "name": name,
                "place": properties["place"],
            }
        )
    return events


# Depths (km) of real earthquakes, none of them a baked depth: Türkiye 2023, Tōhoku 2011,
# two intermediate ones, Okhotsk 2013 and Bolivia 1994.
FIXTURE_DEPTHS_KM = (10.0, 29.0, 100.0, 240.0, 598.1, 631.3)
FIXTURE_DISTANCES_DEG = (5.0, 20.0, 40.0, 64.7, 92.5, 105.0, 130.0, 150.0, 172.0, 180.0)


def fixture_arrivals(model: TauPyModel) -> list[dict]:
    """TauP's first arrival of each phase, asked by distance, for sources between the baked depths."""
    cases = []
    for depth in FIXTURE_DEPTHS_KM:
        for distance in FIXTURE_DISTANCES_DEG:
            first: dict[str, float] = {}
            for arrival in model.get_travel_times(depth, distance, ["P", "p", "Pdiff", "PKP", "PKIKP", "S", "s", "Sdiff"]):
                # The upgoing leg is the same wave as the downgoing one.
                name = {"p": "P", "s": "S"}.get(arrival.name, arrival.name)
                first[name] = min(first.get(name, math.inf), round(float(arrival.time), 2))
            cases.append({"depthKm": depth, "distanceDeg": distance, "times": first})
    return cases


def fixture_ray_points(model: TauPyModel) -> list[dict]:
    """Points on traced rays at times that are not stored steps, straight from TauP's paths."""
    points = []
    for depth in (30.0, 600.0):
        tau_model = model.model.depth_correct(depth)
        column = 0
        for _family, _label, taup_name, count, kind in BRANCHES:
            phase = SeismicPhase(taup_name, tau_model)
            params = branch_ray_params(phase, count, kind) if len(phase.ray_param) else []
            for k in range(3, len(params), 17):
                time, r_path, d_path, _angle = trace(phase, params[k], kind)
                for fraction in (0.23, 0.61, 0.94):
                    t = round(fraction * float(time[-1]), 1)
                    points.append(
                        {
                            "depthKm": depth,
                            "ray": column + k,
                            "timeS": t,
                            "radiusKm": round(float(np.interp(t, time, r_path)), 2),
                            "deltaDeg": round(math.degrees(float(np.interp(t, time, d_path))), 4),
                        }
                    )
            column += count
    return points


FIXTURE_HEADER = """/**
 * What ObsPy TauP (ak135) says, for the tests of the app's reading of the baked rays.
 *
 * `arrivals`: the first arrival (s) of each phase at a distance, asked of TauP by distance, for
 * source depths that are not baked depths. `rayPoints`: points on traced rays at times between
 * the stored steps, from TauP's ray paths.
 *
 * Generated by tools/pipeline/generate_seismic_waves.py: do not edit.
 */

export interface TaupFixture {
  readonly arrivals: readonly {
    readonly depthKm: number;
    readonly distanceDeg: number;
    readonly times: Readonly<Record<string, number>>;
  }[];
  readonly rayPoints: readonly {
    readonly depthKm: number;
    readonly ray: number;
    readonly timeS: number;
    readonly radiusKm: number;
    readonly deltaDeg: number;
  }[];
}

"""


def write_fixture(model: TauPyModel) -> None:
    body = json.dumps({"arrivals": fixture_arrivals(model), "rayPoints": fixture_ray_points(model)}, separators=(",", ":"))
    text = FIXTURE_HEADER + "export const TAUP_FIXTURE = JSON.parse(\n  '" + body + "'\n) as TaupFixture;\n"
    FIXTURE_TS.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_TS.write_text(text, encoding="utf-8")
    print(f"wrote {FIXTURE_TS} ({FIXTURE_TS.stat().st_size} bytes)", file=sys.stderr)


def main() -> None:
    model = TauPyModel(MODEL_NAME)
    tau = model.model
    planet_radius = float(tau.radius_of_planet)
    blob = bytearray()
    slices = []
    for depth_km in DEPTHS_KM:
        print(f"depth {depth_km:g} km", file=sys.stderr)
        radius, delta, arrival_s, arrival_deg, takeoff, info = bake_depth(model, depth_km)
        slices.append({"depthKm": depth_km, "byteOffset": len(blob), "diffracted": info})
        blob += encode(radius, delta)
        for array in (arrival_s, arrival_deg, takeoff):
            blob += array.astype("<f4").tobytes()

    branches = []
    start = 0
    for family, label, _taup, count, kind in BRANCHES:
        branches.append(
            {
                "family": family,
                "phase": label,
                "start": start,
                "count": count,
                # Below this radius the branch is not drawn: the S that ends at the core.
                "minRadiusKm": planet_radius - float(tau.cmb_depth) if kind == "down" else 0.0,
                "reachesSurface": kind != "down",
            }
        )
        start += count

    manifest = {
        "model": MODEL_NAME,
        "source": (
            "ak135 (Kennett, Engdahl & Buland 1995), rays traced with ObsPy TauP "
            "by tools/pipeline/generate_seismic_waves.py. Surface-wave speeds: PREM "
            "(Dziewonski & Anderson 1981, Table V). Deep events: USGS ComCat."
        ),
        "earthRadiusKm": planet_radius,
        "cmbRadiusKm": planet_radius - float(tau.cmb_depth),
        "icbRadiusKm": planet_radius - float(tau.iocb_depth),
        "stepS": STEP_S,
        "steps": STEPS,
        "rays": RAYS,
        "radiusScaleKm": RADIUS_SCALE_KM,
        "deltaScaleDeg": DELTA_SCALE_DEG,
        "layout": (
            "per depth, at byteOffset: steps x rays texels (row = time step, column = ray) of "
            "uint16le radius, uint16le distance; then float32le[rays] x 3: the time (s) and distance "
            "(deg) at which each ray reaches the surface (NaN if it does not), and its take-off "
            "angle (deg from straight down; NaN if the depth has no such ray)"
        ),
        "branches": branches,
        "slices": slices,
        "surfaceWaves": list(SURFACE_WAVES),
        "deepEvents": deep_events(),
    }
    OUTPUT_BIN.write_bytes(bytes(blob))
    write_json(OUTPUT_JSON, manifest)
    write_fixture(model)
    print(f"wrote {OUTPUT_BIN} ({len(blob) / 1e6:.2f} MB) and {OUTPUT_JSON}", file=sys.stderr)


if __name__ == "__main__":
    main()
