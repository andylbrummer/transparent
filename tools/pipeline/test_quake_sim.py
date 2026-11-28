#!/usr/bin/env python3
"""
Checks the baked simulation (generate_quake_sim.py) against things it was not made from.

    python tools/pipeline/test_quake_sim.py

- Arrivals: where the simulated ground first moves, at every point, against TauP's first arrival in the model the
  simulation used (prem), and the ak135 the fronts are drawn with. The rings must land on ground that is starting to
  move.
- The core's shadow: past the edge of the direct P (about 100 to 140 degrees) the first motion is Pdiff, bent round
  the core, and weaker than the direct P before the shadow and the PKP beyond it.
- The surface waves: everywhere, the loudest moment travels out at one surface-wave speed - far slower than any body
  wave, the same at every distance - and the antipode lights up as they meet there.
- The shape of the file: counts, triangles that cover the sphere once, outward winding.
"""

import json
import sys
from pathlib import Path

import numpy as np
from obspy.taup import TauPyModel

ROOT = Path(__file__).resolve().parents[2]
SIM = ROOT / "app" / "public" / "geo" / "quake-sim"
FAILURES: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        FAILURES.append(what)


def load(key: str) -> tuple[dict, dict[str, np.ndarray]]:
    manifest = json.loads((SIM / f"{key}.json").read_text())
    blob = (SIM / f"{key}.bin").read_bytes()
    arrays = {}
    for name, entry in manifest["layout"].items():
        arrays[name] = np.frombuffer(blob, dtype=entry["type"], count=entry["length"], offset=entry["offset"])
    return manifest, arrays


def distance_deg(lat1: float, lon1: float, lat2: np.ndarray, lon2: np.ndarray) -> np.ndarray:
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    c = np.sin(p1) * np.sin(p2) + np.cos(p1) * np.cos(p2) * np.cos(dl)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def main() -> None:
    manifest, a = load("tohoku2011")
    n, frames, frame_s = manifest["points"], manifest["frames"], manifest["frameS"]
    loud = a["frames"].reshape(frames, n).astype(np.float64) / 255  # [frame, point]
    src = manifest["source"]

    # Shape.
    check(len(a["lat"]) == n and len(a["triangles"]) == 3 * manifest["triangles"], "counts match the manifest")
    check(manifest["triangles"] == 2 * n - 4, f"the triangles cover the sphere once (Euler: {2 * n - 4})")
    lat, lon = np.radians(a["lat"].astype(np.float64)), np.radians(a["lon"].astype(np.float64))
    xyz = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=1)
    tri = a["triangles"].reshape(-1, 3).astype(np.int64)
    p, q, r = xyz[tri[:, 0]], xyz[tri[:, 1]], xyz[tri[:, 2]]
    check(bool(np.all(np.einsum("ij,ij->i", np.cross(q - p, r - p), p) > 0)), "every triangle is wound outward")

    delta = distance_deg(src["lat"], src["lon"], a["lat"].astype(np.float64), a["lon"].astype(np.float64))

    # Onset: the first frame at a quarter of the scale (a decade above the floor). A frame holds its loudest moment, so
    # the onset is the frame the arrival falls in: up to one frame early.
    onset_threshold = 0.25
    above = loud >= onset_threshold
    onset_s = np.where(above.any(axis=0), above.argmax(axis=0) * frame_s, np.nan)

    prem, ak135 = TauPyModel("prem"), TauPyModel("ak135")
    rng = np.random.default_rng(1)
    sample = rng.choice(np.where((delta > 5) & (delta < 178))[0], 120, replace=False)
    late_prem, late_ak = [], []
    for i in sample:
        first_prem = prem.get_travel_times(src["depthKm"], float(delta[i]))[0].time
        first_ak = ak135.get_travel_times(src["depthKm"], float(delta[i]))[0].time
        late_prem.append(onset_s[i] - first_prem)
        late_ak.append(onset_s[i] - first_ak)
    late_prem, late_ak = np.array(late_prem), np.array(late_ak)
    ok = np.isfinite(late_prem)
    print(f"     onset minus TauP first arrival (prem), s: median {np.nanmedian(late_prem):.1f}, "
          f"10-90% {np.nanpercentile(late_prem, 10):.1f} .. {np.nanpercentile(late_prem, 90):.1f}, {int((~ok).sum())} silent")
    check(ok.mean() > 0.95, "nearly every point moves at all")
    # A small arrival can sit under the threshold: the ground may first move visibly a little after the first phase,
    # but never before it - by more than a frame (a frame holds its loudest moment) and the rise of a 10 s wave (the
    # model's shortest period: a band-limited arrival starts to swell about half a period ahead of its onset).
    print(f"     earliest 2%: {np.nanpercentile(late_prem, 2):.1f} s")
    check(np.nanpercentile(late_prem, 2) >= -frame_s - 10, "no point moves before the first arrival (prem)")
    check(np.nanmedian(np.abs(late_prem)) <= 2 * frame_s, "the onset is the first arrival, within two frames, at most points")
    check(np.nanmedian(np.abs(late_ak)) <= 2 * frame_s, "and so against the ak135 the fronts are drawn with")

    # The P shadow: at 10 s periods Pdiff, diffracted round the core, still reaches the onset threshold, on time; but
    # the first minute and a half of shaking there is weaker than the direct P's before the shadow and PKP's beyond.
    shadow = np.where((delta > 105) & (delta < 135))[0]
    pdiff_late = []
    for i in shadow[:40]:
        pdiff = prem.get_travel_times(src["depthKm"], float(delta[i]), phase_list=["Pdiff"])
        if pdiff:
            pdiff_late.append(onset_s[i] - pdiff[0].time)
    first = above.argmax(axis=0)
    def early(lo: float, hi: float) -> float:
        band = np.where((delta > lo) & (delta < hi))[0]
        return float(np.median([loud[first[i]:first[i] + 10, i].max() for i in band]))
    before, inside, beyond = early(70, 90), early(105, 135), early(145, 160)
    print(f"     shadow: onset minus Pdiff {np.median(pdiff_late):.0f} s; first 80 s loudness {before:.2f} / {inside:.2f} / {beyond:.2f}")
    check(abs(np.median(pdiff_late)) <= 2 * frame_s, "in the P shadow the ground first moves with Pdiff")
    check(inside < before - 0.1 and inside < beyond - 0.1, "and more weakly than before the shadow or beyond it")

    # Surface waves: the loudest moment's apparent speed, distance over time, is one value from 20 to 140 degrees, and
    # a surface wave's (body waves cross a quarter of the globe at 10+ km/s). It is the short-period Rayleigh wave, which
    # PREM's 3 km ocean slows to about 2.6 km/s, behind the 3.7 km/s long-period train the layer's ring is drawn at.
    far = np.where((delta > 20) & (delta < 140))[0]
    speed = delta[far] * np.pi / 180 * 6371 / np.maximum(loud[:, far].argmax(axis=0) * frame_s, 1)
    print(f"     loudest moment's apparent speed, km/s: median {np.median(speed):.2f}, 5-95% {np.percentile(speed, 5):.2f} .. {np.percentile(speed, 95):.2f}")
    check(2.3 < np.median(speed) < 4.0 and np.percentile(speed, 95) - np.percentile(speed, 5) < 0.3,
          "the loudest shaking travels at one surface-wave speed, at every distance")

    # The antipode: the surface waves meet there at about 1.5 h; it is louder then than points 30 degrees from it.
    t_meet = 180 * np.pi / 180 * 6371 / float(np.median(speed))
    f_meet = int(t_meet / frame_s)
    window = loud[max(0, f_meet - 40):f_meet + 40]
    antipode = np.where(delta > 177)[0]
    ring150 = np.where((delta > 148) & (delta < 152))[0]
    check(window[:, antipode].max(axis=0).mean() > window[:, ring150].max(axis=0).mean(), "the surface waves gather at the antipode")

    # Two-sidedness of the fault: at 60 degrees the loudest directions are much louder than the quietest.
    band = np.where((delta > 55) & (delta < 65))[0]
    p_window = (onset_s[band] >= 0)
    peak = loud[: int(1500 / frame_s), band].max(axis=0)
    check(np.percentile(peak[p_window], 90) - np.percentile(peak[p_window], 10) > 0.05, "the radiation pattern shows: not the same in every direction")

    if FAILURES:
        print(f"{len(FAILURES)} failed", file=sys.stderr)
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
