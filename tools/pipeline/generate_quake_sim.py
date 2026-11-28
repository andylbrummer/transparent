#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: one earthquake's full wavefield at the surface, simulated.

    app/public/geo/quake-sim/tohoku2011.json   what is in the binary, the source, how to read it
    app/public/geo/quake-sim/tohoku2011.bin    the points, their triangles, the shaking frame by frame

The "Seismic waves" layer draws where the P and S fronts are, from rays. This adds what the whole planet's surface
does as the waves arrive: a simulation of the 2011 Tōhoku earthquake's ground motion at a few thousand points spread
evenly over the globe, so the playback can light the surface where it is shaking and leave it dark where it is not.

Simulation:

    EarthScope Syngine (Krischer et al. 2017, Seismol. Res. Lett. 88(4), 1127-1140; Instaseis on AxiSEM wavefield
    databases), model prem_a_10s: anisotropic PREM (Dziewonski & Anderson 1981), periods down to about 10 s. The
    one model Syngine offers that runs three hours (the ak135 ones stop at about 65 minutes, before the surface waves
    meet at the antipode); its body-wave times differ from the ak135 the fronts are drawn with by a second or two,
    less than a frame. A full wavefield in a radial Earth: it carries every
    phase - reflections off the surface and the core, conversions, diffraction round the core and the surface waves
    circling the globe - and the radiation pattern of the fault, which the ray drawing has none of.

    Source: the Global CMT moment tensor of the event (M201103110546A; Dziewonski et al. 1981, Ekström et al. 2012),
    read from the GCMT monthly catalogue, placed at the USGS ComCat hypocentre and origin time the layer plays
    (app/public/geo/quakes-notable.json), so the simulated surface and the drawn fronts share one source.
    Released at once: the real rupture lasted minutes (GCMT half duration 70 s), so a real record is longer and
    smoother than this.

What is stored: the vertical ground velocity's envelope, as log10 of metres a second, quantized to a byte, every
FRAME_S seconds, the loudest moment of each frame (so a short arrival is not missed between frames). The app
interpolates between the points over a triangulation of the sphere (the convex hull of the points), stored too.

    python tools/pipeline/generate_quake_sim.py      # about ten minutes the first time; cached after
    python tools/pipeline/test_quake_sim.py
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from obspy import read
from scipy.signal import hilbert
from scipy.spatial import ConvexHull

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_cache import CACHE_DIR, USER_AGENT, cached_fetch  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "app" / "public" / "geo" / "quake-sim"
KEY = "tohoku2011"
COMCAT_ID = "official20110311054624120_30"
GCMT_ID = "M201103110546A"
GCMT_NDK = "https://www.ldeo.columbia.edu/~gcmt/projects/CMT/catalog/NEW_MONTHLY/2011/mar11.ndk"
SYNGINE = "https://service.earthscope.org/irisws/syngine/1/query"
MODEL = "prem_a_10s"
POINTS = 3000
BATCH = 200
FRAME_S = 8
DT_S = 2
# Three hours: the longest playback span. The surface waves meet at the antipode at about 1.5 h and are back at the
# source at about 3 h.
LENGTH_S = 10800
# The quantization's range, in decades below the loudest moment anywhere: quieter is drawn as nothing.
DECADES = 4.0


def fibonacci_points(n: int) -> tuple[np.ndarray, np.ndarray]:
    """n points spread evenly over the sphere (golden-angle spiral): latitude and longitude in degrees."""
    i = np.arange(n) + 0.5
    lat = np.degrees(np.arcsin(1 - 2 * i / n))
    lon = (np.degrees(np.pi * (1 + 5**0.5) * i) + 180) % 360 - 180
    return lat, lon


def comcat_source() -> dict:
    data = json.loads((ROOT / "app" / "public" / "geo" / "quakes-notable.json").read_text())
    events = data["events"] if isinstance(data, dict) else data
    return next(e for e in events if e["id"] == COMCAT_ID)


def gcmt_tensor() -> dict:
    """The event's moment tensor from the GCMT monthly NDK file: five lines an event, the fourth the tensor."""
    lines = cached_fetch(GCMT_NDK, "quake-sim/mar11.ndk").read_text().splitlines()
    at = next(i for i, line in enumerate(lines) if line.startswith(GCMT_ID))
    centroid = lines[at + 1].split()
    tensor = lines[at + 2].split()
    exponent = int(tensor[0])
    # dyne-cm to newton-metres: 1e-7.
    scale = 10.0 ** (exponent - 7)
    mrr, mtt, mpp, mrt, mrp, mtp = (float(tensor[k]) * scale for k in (1, 3, 5, 7, 9, 11))
    half_duration = float(lines[at].split("TRIHD:")[1])
    return {
        "Mrr": mrr, "Mtt": mtt, "Mpp": mpp, "Mrt": mrt, "Mrp": mrp, "Mtp": mtp,
        "centroidTimeShiftS": float(centroid[1]),
        "halfDurationS": half_duration,
    }


def fetch_batch(index: int, lats: np.ndarray, lons: np.ndarray, source: dict, tensor: dict) -> Path:
    path = CACHE_DIR / "quake-sim" / KEY / f"batch-{index:03d}.mseed"
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    mt = ",".join(f"{tensor[k]:.4e}" for k in ("Mrr", "Mtt", "Mpp", "Mrt", "Mrp", "Mtp"))
    body = [
        f"model={MODEL}",
        f"sourcemomenttensor={mt}",
        f"origintime={source['time'].rstrip('Z')}",
        f"sourcelatitude={source['lat']}",
        f"sourcelongitude={source['lon']}",
        f"sourcedepthinmeters={source['depthKm'] * 1000:.0f}",
        "components=Z",
        "units=velocity",
        f"dt={DT_S}",
        f"endtime={LENGTH_S}",
        "format=miniseed",
    ]
    body += [f"{lat:.4f} {lon:.4f} XX P{index * BATCH + k:04d}" for k, (lat, lon) in enumerate(zip(lats, lons))]
    request = urllib.request.Request(SYNGINE, data="\n".join(body).encode(), headers={"User-Agent": USER_AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                data = response.read()
            if not data.startswith(b"0"):
                raise OSError(f"not miniSEED: {data[:120]!r}")
            partial = path.with_name(path.name + ".part")
            partial.write_bytes(data)
            partial.replace(path)
            return path
        except OSError as error:
            print(f"  batch {index} attempt {attempt + 1} failed: {error}", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"batch {index} failed")


def envelope(x: np.ndarray) -> np.ndarray:
    """|analytic signal|. The FFT behind the Hilbert transform is circular: the ground still ringing at the end of the
    trace would wrap round to its start, before any wave has arrived. Zero-padded to twice the length, it cannot."""
    return np.abs(hilbert(x, N=2 * len(x)))[: len(x)]


def envelopes(lat: np.ndarray, lon: np.ndarray, source: dict, tensor: dict) -> np.ndarray:
    """Per point, the envelope of vertical velocity (m/s), one sample a second."""
    traces: list[np.ndarray | None] = [None] * len(lat)
    for index in range(0, (len(lat) + BATCH - 1) // BATCH):
        sl = slice(index * BATCH, (index + 1) * BATCH)
        print(f"batch {index + 1}/{(len(lat) + BATCH - 1) // BATCH}", file=sys.stderr)
        stream = read(str(fetch_batch(index, lat[sl], lon[sl], source, tensor)))
        # Syngine renames receivers S0001... in the order sent.
        for k, trace in enumerate(sorted(stream, key=lambda t: t.stats.station)):
            assert abs(trace.stats.delta - DT_S) < 1e-6
            # Repeat each sample to one a second, so frames are counted in seconds whatever DT_S is.
            traces[index * BATCH + k] = np.repeat(envelope(trace.data.astype(np.float64)), DT_S)
    length = min(len(t) for t in traces if t is not None)
    assert all(t is not None for t in traces), "a receiver is missing"
    return np.stack([t[:length] for t in traces])


def main() -> None:
    source = comcat_source()
    tensor = gcmt_tensor()
    lat, lon = fibonacci_points(POINTS)
    env = envelopes(lat, lon, source, tensor)

    frames = env.shape[1] // FRAME_S
    loudest = env[:, : frames * FRAME_S].reshape(len(lat), frames, FRAME_S).max(axis=2)
    log = np.log10(np.maximum(loudest, 1e-30))
    top = float(np.percentile(log, 99.99))
    floor = top - DECADES
    quantized = np.clip(np.round((log - floor) / DECADES * 255), 0, 255).astype(np.uint8)

    xyz = np.stack([np.cos(np.radians(lat)) * np.cos(np.radians(lon)),
                    np.cos(np.radians(lat)) * np.sin(np.radians(lon)),
                    np.sin(np.radians(lat))], axis=1)
    triangles = ConvexHull(xyz).simplices.astype(np.int64)
    # Wind every triangle outward.
    a, b, c = xyz[triangles[:, 0]], xyz[triangles[:, 1]], xyz[triangles[:, 2]]
    inward = np.einsum("ij,ij->i", np.cross(b - a, c - a), a) < 0
    triangles[inward] = triangles[inward][:, [0, 2, 1]]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    blob = bytearray()
    layout = {}
    def put(name: str, array: np.ndarray) -> None:
        while len(blob) % 4:
            blob.append(0)
        layout[name] = {"offset": len(blob), "length": int(array.size), "type": str(array.dtype)}
        blob.extend(array.tobytes())
    put("lat", lat.astype(np.float32))
    put("lon", lon.astype(np.float32))
    put("triangles", triangles.astype(np.uint16).ravel())
    # Frame-major: frame f's points are contiguous, one texture row a frame.
    put("frames", quantized.T.copy().ravel())
    (OUT_DIR / f"{KEY}.bin").write_bytes(bytes(blob))

    manifest = {
        "formatVersion": 1,
        "key": KEY,
        "comcatId": COMCAT_ID,
        "gcmtId": GCMT_ID,
        "source": {
            "time": source["time"], "lat": source["lat"], "lon": source["lon"], "depthKm": source["depthKm"],
            "momentTensorNm": {k: tensor[k] for k in ("Mrr", "Mtt", "Mpp", "Mrt", "Mrp", "Mtp")},
            "gcmtHalfDurationS": tensor["halfDurationS"],
        },
        "model": MODEL,
        "component": "vertical velocity, envelope",
        "points": POINTS,
        "triangles": int(len(triangles)),
        "frames": int(frames),
        "frameS": FRAME_S,
        "log10FloorMs": round(floor, 4),
        "log10TopMs": round(top, 4),
        "layout": layout,
        "credits": [
            {"what": "Simulated ground motion of the 2011 Tōhoku earthquake (full wavefield, model prem_a_10s)",
             "source": "EarthScope Syngine (Krischer et al. 2017, Seismol. Res. Lett. 88(4), 1127–1140), Instaseis and AxiSEM",
             "url": "https://service.earthscope.org/irisws/syngine/1/"},
            {"what": "Moment tensor of the 2011 Tōhoku earthquake (M201103110546A)",
             "source": "Global CMT Project (Dziewonski et al. 1981; Ekström et al. 2012)",
             "url": "https://www.globalcmt.org/"},
        ],
    }
    (OUT_DIR / f"{KEY}.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: manifest[k] for k in ("points", "triangles", "frames", "log10FloorMs", "log10TopMs")}))
    print(f"{len(blob) / 1e6:.2f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
