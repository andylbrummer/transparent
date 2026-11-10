#!/usr/bin/env python3
"""
Data checks for generate_seismic_waves.py's output.

Three oracles, so the bake is not only compared with the library that made it:

1. Published travel times. B.L.N. Kennett's ak135 summary tables (surface
   focus), Research School of Earth Sciences, ANU, "AK135 Travel Time
   Tables", version 1997: http://rses.anu.edu.au/seismology/ak135/intro.html
   (pages 2b-4b for P and S, 3c for the core phases; they are images, read
   by eye into PUBLISHED below). Those tables were computed with the IASPEI
   tau-spline software of Buland & Chapman, not with TauP.

2. An independent integration of the ray integrals, written here, through
   the ak135 velocity table as ANU publishes it
   (http://rses.anu.edu.au/seismology/ak135/ak135t.html, fetched and cached):
   no ObsPy code and not ObsPy's copy of the model. It covers what the
   published summary tables do not: deep sources, the shadow edges, and the
   radius of the front along the axis through the source.

3. ObsPy TauP itself, asked by distance (the bake shoots by ray parameter),
   at every baked depth.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_seismic_waves.py
"""

import json
import math
import re

import numpy as np
from obspy.taup import TauPyModel
from obspy.taup.seismic_phase import SeismicPhase

from fetch_cache import cached_fetch
from generate_seismic_waves import (
    DELTA_SCALE_DEG,
    MODEL_NAME,
    OUTPUT_BIN,
    OUTPUT_JSON,
    RADIUS_SCALE_KM,
    STEP_S,
    branch_ray_params,
    BRANCHES,
    trace,
)
from geo_test_support import check, finish

AK135_MODEL_URL = "http://rses.anu.edu.au/seismology/ak135/ak135t.html"

# (phase, distance deg): seconds, for a surface focus. Kennett's ak135 tables, as "min s" in the comment.
PUBLISHED = {
    ("P", 30.0): 370.27,  # 6 10.27
    ("P", 60.0): 608.34,  # 10 08.34
    ("P", 90.0): 781.40,  # 13 01.40
    ("P", 99.0): 822.59,  # 13 42.59, the last direct P in the table
    ("S", 30.0): 669.14,  # 11 09.14
    ("S", 60.0): 1101.89,  # 18 21.89
    ("S", 90.0): 1435.44,  # 23 55.44
    ("S", 99.0): 1514.47,  # 25 14.47
    ("PKIKP", 160.0): 1201.11,  # 20 01.11 (PKPdf)
    ("PKIKP", 180.0): 1212.53,  # 20 12.53 (PKPdf)
    ("PKP", 170.0): 1284.67,  # 21 24.67 (PKPab)
}

manifest = json.loads(OUTPUT_JSON.read_text(encoding="utf-8"))
blob = OUTPUT_BIN.read_bytes()
STEPS, RAYS = manifest["steps"], manifest["rays"]
R_EARTH, R_CMB, R_ICB = manifest["earthRadiusKm"], manifest["cmbRadiusKm"], manifest["icbRadiusKm"]
BRANCH = {b["phase"]: b for b in manifest["branches"]}


def load_slice(index: int):
    offset = manifest["slices"][index]["byteOffset"]
    texels = np.frombuffer(blob, "<u2", STEPS * RAYS * 2, offset).reshape(STEPS, RAYS, 2)
    radius = texels[..., 0] / 65535 * RADIUS_SCALE_KM
    delta = texels[..., 1] / 65535 * DELTA_SCALE_DEG
    tail = np.frombuffer(blob, "<f4", RAYS * 3, offset + STEPS * RAYS * 4).reshape(3, RAYS)
    return radius, delta, tail[0], tail[1], tail[2]


def arrivals(slice_index: int, phases: tuple[str, ...], distance_deg: float) -> list[float]:
    """Times at which the baked rays of these branches reach the surface at a distance, soonest first."""
    _r, _d, arrival_s, arrival_deg, _takeoff = load_slice(slice_index)
    times = []
    for phase in phases:
        branch = BRANCH[phase]
        for i in range(branch["start"], branch["start"] + branch["count"] - 1):
            d0, d1, t0, t1 = arrival_deg[i], arrival_deg[i + 1], arrival_s[i], arrival_s[i + 1]
            if not (np.isfinite(d0) and np.isfinite(d1)) or d0 == d1:
                continue
            # A ray that has passed the antipode arrives at 360 - its distance.
            for target in (distance_deg, 360.0 - distance_deg):
                w = (target - d0) / (d1 - d0)
                if 0.0 <= w <= 1.0:
                    times.append(float(t0 + w * (t1 - t0)))
    return sorted(times)


# --- oracle 2: the ray integrals, through ANU's table -------------------------------------


def read_ak135() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Depth (km), vp, vs (km/s) of the published model, top to centre, discontinuities as repeated depths."""
    text = cached_fetch(AK135_MODEL_URL, "seismic/ak135t.html").read_text(encoding="latin-1")
    rows = [
        [float(x) for x in line.split()[:3]]
        for line in re.sub(r"<[^>]*>", "", text).splitlines()
        if re.match(r"^\s+\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+", line)
    ]
    table = np.array(rows)
    # The page lists the model first, then the same table again in other forms: keep the first run to the centre.
    end = int(np.argmax(table[:, 0] >= 6371.0)) + 1
    table = table[:end]
    return table[:, 0], table[:, 1], table[:, 2]


AK_DEPTH, AK_VP, AK_VS = read_ak135()


def shells(wave: str, sub_km: float = 0.5) -> dict[str, np.ndarray]:
    """Thin shells from the surface down to the core: radii and slownesses at top and bottom (velocity linear in radius)."""
    velocity = AK_VP if wave == "P" else AK_VS
    rows = []
    for i in range(len(AK_DEPTH) - 1):
        z0, z1, v0, v1 = AK_DEPTH[i], AK_DEPTH[i + 1], velocity[i], velocity[i + 1]
        if z1 <= z0 or z1 > R_EARTH - R_CMB + 1e-6:
            continue
        n = max(1, int(math.ceil((z1 - z0) / sub_km)))
        for k in range(n):
            a, b = k / n, (k + 1) / n
            rows.append((R_EARTH - (z0 + a * (z1 - z0)), R_EARTH - (z0 + b * (z1 - z0)), v0 + a * (v1 - v0), v0 + b * (v1 - v0)))
    r_top, r_bot, v_top, v_bot = np.array(rows).T
    # Each thin shell is taken as v = a r^b, for which the ray integrals are closed.
    exponent = np.where(v_top != v_bot, np.log(v_top / v_bot) / np.log(r_top / r_bot), 0.0)
    return {"r_top": r_top, "r_bot": r_bot, "eta_top": r_top / v_top, "eta_bot": r_bot / v_bot, "b": exponent}


SHELLS = {"P": shells("P"), "S": shells("S")}


def leg(wave: str, p: float, r_from: float, r_to: float) -> tuple[float, float, bool]:
    """
    Time (s) and distance (rad) of a ray of parameter p (s/rad) going down through the mantle from
    r_from towards r_to, and whether it turned on the way. In a shell where v = a r^b,
    T = (sqrt(eta_top^2 - p^2) - sqrt(eta_bot^2 - p^2)) / (1 - b) with eta = r / v, and the distance
    is the same with acos(p / eta) in place of the square roots.
    """
    s = SHELLS[wave]
    inside = (s["r_top"] <= r_from + 1e-9) & (s["r_bot"] >= r_to - 1e-9)
    eta_top, eta_bot, b = s["eta_top"][inside], s["eta_bot"][inside], s["b"][inside]
    stopped = np.nonzero((eta_top <= p) | (eta_bot <= p))[0]
    turned = len(stopped) > 0
    last = int(stopped[0]) if turned else len(eta_top) - 1
    eta_top, eta_bot, b = eta_top[: last + 1], eta_bot[: last + 1], b[: last + 1]
    s_top = np.sqrt(np.maximum(eta_top**2 - p**2, 0.0))
    s_bot = np.sqrt(np.maximum(eta_bot**2 - p**2, 0.0))
    a_top = np.arccos(np.minimum(1.0, p / eta_top))
    a_bot = np.arccos(np.minimum(1.0, p / eta_bot))
    return float(np.sum((s_top - s_bot) / (1.0 - b))), float(np.sum((a_top - a_bot) / (1.0 - b))), turned


def mantle_ray(wave: str, p: float, source_depth: float) -> tuple[float, float] | None:
    """Time and distance (deg) of the ray leaving the source downwards and turning above the core."""
    r_source = R_EARTH - source_depth
    t_down, d_down, turned = leg(wave, p, r_source, R_CMB)
    if not turned:
        return None
    t_full, d_full, _ = leg(wave, p, R_EARTH, R_CMB)
    # Down from the source to the turning point, then up the full leg to the surface.
    return t_down + t_full, math.degrees(d_down + d_full)


def independent_first_arrival(wave: str, source_depth: float, distance_deg: float) -> float:
    """First arrival, at a distance, of the rays that turn in the mantle: a scan over ray parameter."""
    r_source = R_EARTH - source_depth
    velocity = AK_VP if wave == "P" else AK_VS
    v_source = float(np.interp(source_depth, AK_DEPTH, velocity))
    eta_cmb = R_CMB / float(velocity[np.searchsorted(AK_DEPTH, R_EARTH - R_CMB)])
    best = math.inf
    previous = None
    for p in np.linspace(eta_cmb * 1.000001, r_source / v_source * 0.999999, 4000):
        ray = mantle_ray(wave, float(p), source_depth)
        if ray is not None and previous is not None:
            (t0, d0), (t1, d1) = previous, ray
            if d0 != d1 and min(d0, d1) <= distance_deg <= max(d0, d1) and abs(d1 - d0) < 2.0:
                best = min(best, t0 + (distance_deg - d0) / (d1 - d0) * (t1 - t0))
        previous = ray
    return best


def vertical_time(wave_segments: list[tuple[str, float, float]]) -> float:
    """Travel time straight along a radius: the sum of the integrals of dr / v, v linear in r, exactly."""
    total = 0.0
    for wave, r_from, r_to in wave_segments:
        velocity = AK_VP if wave == "P" else AK_VS
        for i in range(len(AK_DEPTH) - 1):
            r0, r1 = R_EARTH - AK_DEPTH[i], R_EARTH - AK_DEPTH[i + 1]
            hi, lo = min(r0, r_from), max(r1, r_to)
            if hi <= lo:
                continue
            slope = (velocity[i + 1] - velocity[i]) / (r1 - r0)
            v_hi = velocity[i] + slope * (hi - r0)
            v_lo = velocity[i] + slope * (lo - r0)
            total += (hi - lo) / v_hi if abs(slope) < 1e-12 else abs(math.log(v_hi / v_lo) / slope)
    return total


def axis_radius(source_depth: float, t: float) -> float:
    """Radius of the P front, at time t, on the axis from the source through the centre and beyond."""
    r_source = R_EARTH - source_depth
    to_centre = vertical_time([("P", r_source, 0.0)])
    lo, hi = 0.0, r_source if t <= to_centre else R_EARTH
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if t <= to_centre:
            elapsed = vertical_time([("P", r_source, mid)])
            lo, hi = (mid, hi) if elapsed > t else (lo, mid)
        else:
            elapsed = to_centre + vertical_time([("P", mid, 0.0)])
            lo, hi = (lo, mid) if elapsed > t else (mid, hi)
    return 0.5 * (lo + hi)


# --- the checks ----------------------------------------------------------------------------

P_PHASES = ("PKIKP", "PKP", "P", "p")
S_PHASES = ("S", "s")
SURFACE = 0
DEEP = next(i for i, s in enumerate(manifest["slices"]) if s["depthKm"] == 600.0)

check(manifest["model"] == MODEL_NAME, f"model is {MODEL_NAME}")
check(len(blob) < 1.5e6, f"binary is under 1.5 MB ({len(blob) / 1e6:.2f} MB)")
check(abs(R_CMB - 3479.5) < 0.01 and abs(R_ICB - 1217.5) < 0.01, f"core radii {R_CMB} / {R_ICB} km are ak135's")

print("\npublished ak135 tables (Kennett 1997), surface focus:")
for (phase, distance), published in PUBLISHED.items():
    branches = P_PHASES if phase == "P" else S_PHASES if phase == "S" else (phase,)
    times = arrivals(SURFACE, branches, distance)
    got = times[0] if times else math.nan
    check(abs(got - published) < 0.25, f"{phase} at {distance:g} deg: baked {got:.2f} s, published {published:.2f} s")

print("\nindependent ray integrals through the ANU model table:")
through = vertical_time([("P", R_EARTH, 0.0)]) * 2
got = arrivals(SURFACE, ("PKIKP",), 180.0)[0]
check(abs(got - through) < 0.15, f"PKIKP straight through the centre: baked {got:.2f} s, integral of dr/v {through:.2f} s")
deep_through = vertical_time([("P", R_EARTH - 600.0, 0.0), ("P", R_EARTH, 0.0)])
got = arrivals(DEEP, ("PKIKP",), 180.0)[0]
check(abs(got - deep_through) < 0.15, f"PKIKP at 180 deg from 600 km: baked {got:.2f} s, integral {deep_through:.2f} s")
check(abs((through - deep_through) - vertical_time([("P", R_EARTH, R_EARTH - 600.0)])) < 1e-6 and 60 < through - deep_through < 80,
      f"a 600 km focus gains {through - deep_through:.1f} s on the antipode")
for wave, branches in (("P", P_PHASES), ("S", S_PHASES)):
    for depth_index, depth in ((SURFACE, 0.0), (DEEP, 600.0)):
        for distance in (30.0, 60.0, 90.0):
            got = arrivals(depth_index, branches, distance)[0]
            want = independent_first_arrival(wave, depth, distance)
            check(abs(got - want) < 0.5, f"{wave} at {distance:g} deg from {depth:g} km: baked {got:.2f} s, integrated {want:.2f} s")
for wave, key in (("P", "P"), ("S", "S")):
    velocity = AK_VP if wave == "P" else AK_VS
    eta = R_CMB / float(velocity[np.searchsorted(AK_DEPTH, R_EARTH - R_CMB)])
    time, edge = mantle_ray(wave, eta * 1.0000001, 0.0)
    _r, _d, arrival_s, arrival_deg, _t = load_slice(SURFACE)
    branch = BRANCH[key]
    last = float(np.nanmax(arrival_deg[branch["start"] : branch["start"] + branch["count"]]))
    check(abs(last - edge) < 0.15, f"direct {wave} ends at {last:.2f} deg; the ray grazing the core, integrated: {edge:.2f} deg at {time:.1f} s")

print("\nshadows, surface focus:")
_r, _d, arrival_s, arrival_deg, takeoff = load_slice(SURFACE)
p_cols = slice(BRANCH["PKIKP"]["start"], BRANCH["p"]["start"] + BRANCH["p"]["count"])
s_cols = slice(BRANCH["S to the core"]["start"], BRANCH["s"]["start"] + BRANCH["s"]["count"])
folded_p = np.where(arrival_deg[p_cols] > 180, 360 - arrival_deg[p_cols], arrival_deg[p_cols])
p_end = float(np.nanmax(arrival_deg[BRANCH["P"]["start"] : BRANCH["P"]["start"] + BRANCH["P"]["count"]]))
core_start = float(np.nanmin(folded_p[: BRANCH["PKIKP"]["count"] + BRANCH["PKP"]["count"]]))
check(98.0 < p_end < 100.5, f"direct P stops at {p_end:.2f} deg")
check(113.0 < core_start < 116.5, f"core P (PKIKP) first re-emerges at {core_start:.2f} deg")
in_shadow = np.sum((folded_p > p_end + 0.01) & (folded_p < core_start - 0.01))
check(in_shadow == 0, f"no P ray reaches the surface between {p_end:.1f} and {core_start:.1f} deg")
pkp = arrival_deg[BRANCH["PKP"]["start"] : BRANCH["PKP"]["start"] + BRANCH["PKP"]["count"]]
check(143.0 < float(np.nanmin(pkp)) < 146.0, f"PKP caustic (its nearest arrival) at {float(np.nanmin(pkp)):.2f} deg")
s_reach = arrival_deg[s_cols]
check(float(np.nanmax(s_reach)) < 100.5, f"no S beyond {float(np.nanmax(s_reach)):.2f} deg: the core's shadow")
check(np.all(np.isnan(arrival_s[BRANCH["S to the core"]["start"] : BRANCH["S to the core"]["start"] + BRANCH["S to the core"]["count"]])),
      "the S that strikes the core never reaches the surface")
for name in ("P", "S"):
    info = manifest["slices"][SURFACE]["diffracted"][name]
    edge_time = arrivals(SURFACE, (name,), info["fromDeg"] - 0.01)
    check(bool(edge_time) and abs(edge_time[-1] - info["fromS"]) < 0.5, f"{name}diff takes over where direct {name} ends ({info['fromDeg']} deg, {info['fromS']} s)")

print("\nObsPy TauP, asked by distance, at every baked depth:")
model = TauPyModel(MODEL_NAME)
worst = 0.0
count = 0
for index, entry in enumerate(manifest["slices"]):
    depth = entry["depthKm"]
    for distance in (2.0, 11.0, 25.0, 47.0, 72.0, 95.0, 120.0, 150.0, 165.0, 179.0):
        for taup_names, branches in ((["P", "p", "PKP", "PKIKP"], P_PHASES), (["S", "s"], S_PHASES)):
            expected = sorted(a.time for a in model.get_travel_times(depth, distance, taup_names))
            got = arrivals(index, branches, distance)
            if not expected:
                if got:
                    check(False, f"{branches[0][0]} at {distance} deg from {depth} km: baked {got[0]:.1f} s where TauP has none")
                continue
            if not got:
                check(False, f"{branches[0][0]} at {distance} deg from {depth} km: nothing baked, TauP {expected[0]:.1f} s")
                continue
            worst = max(worst, abs(got[0] - expected[0]))
            count += 1
check(worst < 0.6, f"first P and S arrivals at {count} (depth, distance) points agree with TauP within {worst:.2f} s")

print("\ngeometry of the fronts:")
for index, entry in enumerate(manifest["slices"]):
    radius, delta, arrival_s, arrival_deg, takeoff = load_slice(index)
    live = np.isfinite(takeoff)
    r_source = R_EARTH - entry["depthKm"]
    ok_start = np.all(np.abs(radius[0, live] - r_source) < 0.2) and np.all(delta[0, live] < 0.01)
    # Per step a ray moves at most the fastest speed of its family (plus quantisation) ...
    x = radius * np.sin(np.radians(delta))
    y = radius * np.cos(np.radians(delta))
    moved = np.hypot(np.diff(x, axis=0), np.diff(y, axis=0))
    steps_s = np.arange(STEPS)[:, None] * STEP_S
    worst_fast = 0.0
    held_ok = True
    inside_ok = True
    for branch in manifest["branches"]:
        cols = slice(branch["start"], branch["start"] + branch["count"])
        is_p = branch["family"] == "P"
        v_max = 13.67 if is_p else 7.29
        end_s = arrival_s[cols] if branch["reachesSurface"] else np.full(branch["count"], np.inf)
        flying = (steps_s[1:] <= np.where(np.isfinite(end_s), end_s, np.inf)[None, :]) & live[cols][None, :]
        if not branch["reachesSurface"]:
            # The S that dies at the core: in flight while it is still above it.
            flying = (radius[1:, cols] >= R_CMB) & live[cols][None, :]
            inside_ok &= bool(np.all(np.diff(radius[:, cols], axis=0)[flying] < 0.2))
        worst_fast = max(worst_fast, float(np.max(np.where(flying, moved[:, cols] / STEP_S - v_max, -1))))
        if branch["reachesSurface"]:
            landed = (steps_s > np.where(np.isfinite(end_s), end_s, -1)[None, :]) | ~live[cols][None, :]
            held_ok &= bool(np.all(radius[:, cols][landed] > R_EARTH))
            inside_ok &= bool(np.all(radius[:, cols][~landed] <= R_EARTH + 0.2))
    check(ok_start, f"{entry['depthKm']:g} km: every ray starts at the source")
    check(worst_fast < 0.05, f"{entry['depthKm']:g} km: no ray outruns its wave speed, across the core boundaries too ({worst_fast:+.3f} km/s)")
    check(held_ok and inside_ok, f"{entry['depthKm']:g} km: rays in flight are inside the Earth; landed ones are parked above it")
    s_core = BRANCH["S to the core"]
    s_radius = radius[:, s_core["start"] : s_core["start"] + s_core["count"]]
    check(float(s_radius.min()) > R_CMB - 150 and float(s_radius[-1].max()) < R_CMB,
          f"{entry['depthKm']:g} km: the S that strikes the core stops just inside it ({R_CMB - float(s_radius.min()):.0f} km at most)")
    # ... and the ray straight down is where the integral of dr/v says, through the centre to the antipode.
    worst_axis = 0.0
    for step in range(STEPS):
        t = step * STEP_S
        if t >= arrival_s[0]:
            break
        worst_axis = max(worst_axis, abs(radius[step, 0] - axis_radius(entry["depthKm"], t)))
    check(worst_axis < 0.5, f"{entry['depthKm']:g} km: the front on the axis through the centre is within {worst_axis:.2f} km of the integral")

print("\nbetween the stored steps (the app interpolates linearly):")
tau_model = model.model.depth_correct(manifest["slices"][SURFACE]["depthKm"])
radius, delta, *_ = load_slice(SURFACE)
worst_mid = 0.0
column = 0
for _family, _label, taup_name, n, kind in BRANCHES:
    phase = SeismicPhase(taup_name, tau_model)
    if len(phase.ray_param) == 0:
        column += n
        continue
    params = branch_ray_params(phase, n, kind)
    for k in range(0, n, 7):
        time, r_path, d_path, _angle = trace(phase, params[k], kind)
        for step in range(STEPS - 1):
            t = (step + 0.5) * STEP_S
            if t >= time[-1] - STEP_S:
                break
            r_true, d_true = np.interp(t, time, r_path), np.interp(t, time, d_path)
            # In the plane of the ray, as the app does it: a straight chord between the two stored points.
            x, y = (
                0.5 * sum(radius[i, column + k] * f(math.radians(delta[i, column + k])) for i in (step, step + 1))
                for f in (math.sin, math.cos)
            )
            error = math.hypot(x - r_true * math.sin(d_true), y - r_true * math.cos(d_true))
            worst_mid = max(worst_mid, error)
    column += n
check(worst_mid < 40.0, f"halfway between steps the interpolated ray is at most {worst_mid:.1f} km from the traced one")

print("\nsurface waves and events:")
speeds = {w["id"]: w["speedKmS"] for w in manifest["surfaceWaves"]}
check(speeds == {"love": 4.382, "rayleigh": 3.717}, "surface-wave speeds are PREM's (Table V: 0T36 4.382 km/s, 0S80 3.717 km/s)")
lap_h = 2 * math.pi * R_EARTH / speeds["rayleigh"] / 3600
check(2.9 < lap_h < 3.1, f"the Rayleigh ring circles the Earth in {lap_h:.2f} h")
deep = {e["id"]: e for e in manifest["deepEvents"]}
okhotsk, bolivia = deep["usb000h4jh"], deep["usp0006dzc"]
check(okhotsk["time"].startswith("2013-05-24T05:44:4") and abs(okhotsk["lat"] - 54.89) < 0.1 and abs(okhotsk["lon"] - 153.22) < 0.1
      and 590 < okhotsk["depthKm"] < 610 and okhotsk["mag"] == 8.3, f"Okhotsk 2013: {okhotsk['time']} {okhotsk['lat']} {okhotsk['lon']} {okhotsk['depthKm']} km M{okhotsk['mag']}")
check(bolivia["time"].startswith("1994-06-09T00:33:1") and abs(bolivia["lat"] + 13.84) < 0.1 and abs(bolivia["lon"] + 67.55) < 0.1
      and 620 < bolivia["depthKm"] < 650 and bolivia["mag"] == 8.2, f"Bolivia 1994: {bolivia['time']} {bolivia['lat']} {bolivia['lon']} {bolivia['depthKm']} km M{bolivia['mag']}")

finish()
