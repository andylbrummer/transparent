#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: seismic tomography.

Writes app/public/geo/tomography/dvs-<depth>.png, one small image per
depth shell, and tomography.json describing them: the shear-velocity
anomaly dVs/Vs of the mantle, in per cent of the model's own radial
average, from the global tomographic model

    SEMUCB-WM1: French, S.W. & Romanowicz, B.A. (2014), Whole-mantle
    radially anisotropic shear velocity structure from spectral-element
    waveform tomography, Geophys. J. Int. 199, 1303-1327,
    doi:10.1093/gji/ggu334.

It is read as the spherical-harmonic expansion to degree 31 that ships
with hc (github.com/geodynamics/hc, tomography/semucb-wm1.31.m.ab; the
same file generate_mantle_flow.py drives its flow model with): 41 depth
layers from 75 to 2850 km, each a set of fully normalised real harmonic
coefficients in the "physical" convention of Dahlen & Tromp (1998).
Degree 31 resolves structure about 650 km across: the model drawn here is
the smooth, long-wavelength mantle, and the app says so. The shells kept
are layers of the file itself, with no interpolation in depth.

It is a model, an inversion of seismograms, not a measurement: the app
names it wherever it is drawn.

Each image is an equirectangular grey map, longitude -180..180 left to
right, north up, WIDTH x HEIGHT; a pixel's value v codes

    dVs/Vs [%] = (v - 128) / 127 * rangePercent

with rangePercent per shell in tomography.json (the anomalies are 8 % in
the lithosphere and 2 % in the mid mantle; one fixed scale would show
nothing of the latter).

The synthesis here is numpy only; test_tomography.py pins it against
values computed by hc's own sh_syn.

Usage:
    python3 tools/pipeline/generate_tomography.py     # needs numpy and pillow
"""

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

HC_COMMIT = "7bb6d0385d88e25510f5e4646e835d8b018f2073"
MODEL_URL = f"https://raw.githubusercontent.com/geodynamics/hc/{HC_COMMIT}/tomography/semucb-wm1.31.m.ab"
# Depth of each shell drawn (a layer of the file), and the anomaly its grey scale spans, per cent.
SHELLS = ((150, 8.0), (400, 3.0), (700, 2.0), (1250, 1.5), (2050, 1.5), (2850, 3.0))
WIDTH, HEIGHT = 720, 360
TOMOGRAPHY_DIR = OUTPUT_DIR / "tomography"


def read_layers(path: Path) -> dict[float, tuple[int, np.ndarray]]:
    """depth km -> (lmax, coefficients [(lmax+1)(lmax+2)/2, 2] as A, B ordered l then m)."""
    tokens = path.read_text().split()
    count = int(tokens[0])
    at = 1
    layers = {}
    for _ in range(count):
        depth, lmax = float(tokens[at]), int(tokens[at + 1])
        size = (lmax + 1) * (lmax + 2) // 2
        layers[depth] = (lmax, np.array(tokens[at + 2:at + 2 + 2 * size], dtype=float).reshape(size, 2))
        at += 2 + 2 * size
    if at != len(tokens):
        raise ValueError(f"{len(tokens) - at} stray values after the last layer")
    return layers


def normalised_legendre(lmax: int, x: np.ndarray) -> dict[tuple[int, int], np.ndarray]:
    """P_lm(x) scaled so that the complex harmonic P_lm e^(im phi) has unit norm over the sphere; no Condon-Shortley phase."""
    s = np.sqrt(1 - x * x)
    p = {(0, 0): np.full_like(x, math.sqrt(1 / (4 * math.pi)))}
    for m in range(1, lmax + 1):
        p[(m, m)] = math.sqrt((2 * m + 1) / (2 * m)) * s * p[(m - 1, m - 1)]
    for m in range(lmax):
        p[(m + 1, m)] = math.sqrt(2 * m + 3) * x * p[(m, m)]
    for m in range(lmax + 1):
        for l in range(m + 2, lmax + 1):
            a = math.sqrt((4 * l * l - 1) / (l * l - m * m))
            b = math.sqrt(((l - 1) ** 2 - m * m) / (4 * (l - 1) ** 2 - 1))
            p[(l, m)] = a * (x * p[(l - 1, m)] - b * p[(l - 2, m)])
    return p


def synthesize(lmax: int, coefficients: np.ndarray, lon_deg: np.ndarray, lat_deg: np.ndarray) -> np.ndarray:
    """The expansion's value at each (lon, lat) pair, as hc's sh_syn gives it.

    hc's convention: f = sum over l, m of w_m (-1)^m P_lm(sin lat) (A_lm cos m lon + B_lm sin m lon),
    with w_0 = 1 and w_m = sqrt(2) for m > 0.
    """
    lon = np.radians(np.asarray(lon_deg, dtype=float))
    legendre = normalised_legendre(lmax, np.sin(np.radians(np.asarray(lat_deg, dtype=float))))
    value = np.zeros(np.broadcast(lon, legendre[(0, 0)]).shape)
    k = 0
    for l in range(lmax + 1):
        for m in range(l + 1):
            a, b = coefficients[k]
            k += 1
            weight = (math.sqrt(2) if m else 1.0) * (-1) ** m
            value += weight * legendre[(l, m)] * (a * np.cos(m * lon) + b * np.sin(m * lon))
    return value


def shell_grid(lmax: int, coefficients: np.ndarray, width: int = WIDTH, height: int = HEIGHT) -> np.ndarray:
    """dVs % at pixel centres, [height, width], north row first, longitude from -180."""
    lon = -180 + (np.arange(width) + 0.5) * 360 / width
    lat = 90 - (np.arange(height) + 0.5) * 180 / height
    return synthesize(lmax, coefficients, lon[None, :], lat[:, None])


def code(percent: np.ndarray, range_percent: float) -> np.ndarray:
    return np.clip(np.rint(128 + 127 * percent / range_percent), 1, 255).astype(np.uint8)


def load_model() -> dict[float, tuple[int, np.ndarray]]:
    return read_layers(cached_fetch(MODEL_URL, "tomography/semucb-wm1.31.m.ab"))


def main() -> None:
    layers = load_model()
    TOMOGRAPHY_DIR.mkdir(parents=True, exist_ok=True)
    area = np.cos(np.radians(90 - (np.arange(HEIGHT) + 0.5) * 180 / HEIGHT))[:, None] * np.ones((1, WIDTH))
    shells = []
    for depth, range_percent in SHELLS:
        lmax, coefficients = layers[float(depth)]
        grid = shell_grid(lmax, coefficients)
        out = TOMOGRAPHY_DIR / f"dvs-{depth}.png"
        Image.fromarray(code(grid, range_percent), "L").save(out, optimize=True)
        rms = math.sqrt(float((grid * grid * area).sum() / area.sum()))
        clipped = float((np.abs(grid) > range_percent).sum()) / grid.size
        shells.append({"depthKm": depth, "file": out.name, "rangePercent": range_percent,
                       "minPercent": round(float(grid.min()), 2), "maxPercent": round(float(grid.max()), 2),
                       "rmsPercent": round(rms, 2)})
        print(f"{depth} km: dVs {grid.min():+.2f} .. {grid.max():+.2f} %, rms {rms:.2f} %, "
              f"{100 * clipped:.2f} % of pixels beyond the scale; {out.name} {out.stat().st_size / 1024:.0f} KiB",
              file=sys.stderr)
    write_json(OUTPUT_DIR / "tomography.json", {
        "source": "SEMUCB-WM1 (French & Romanowicz 2014, doi:10.1093/gji/ggu334), spherical-harmonic expansion "
                  "to degree 31 as distributed with hc (github.com/geodynamics/hc)",
        "quantity": "dVs/Vs, per cent of the model's radial average",
        "lmax": 31,
        "width": WIDTH,
        "height": HEIGHT,
        "shells": shells,
    })


if __name__ == "__main__":
    main()
