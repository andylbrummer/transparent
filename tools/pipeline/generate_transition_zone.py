#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the depth of the 410 and 660 km discontinuities.

Writes
    app/public/geo/transition-zone/410.png   512x256 equirectangular (lon -180..180, north up), grey:
    app/public/geo/transition-zone/660.png   128 is the map's own area-weighted mean depth, 1 and
                                             255 are SCALE_KM shallower and deeper
    app/public/geo/transition-zone.json      per boundary: the mean, the range, the file

Source
    Waszek, L., Tauzin, B., Schmerr, N.C., Ballmer, M.D. & Afonso, J.C. (2021), A poorly mixed mantle
    transition zone and its thermal state inferred from seismic waves, Nature Geoscience 14, 949-955.
    Data: "Measurements of the 410 and 660 km discontinuities from global SS and PP precursors",
    ISC Seismological Dataset Repository, doi:10.31905/7M3LMG8X,
    https://download.isc.ac.uk/datarepository/410660.tgz (21 MB). No licence is stated; the readme
    asks: "When using this dataset, please cite Waszek et al., Nat. Geosci., 2021."

    The SS-precursor files, corrected for the 3-D structure above (s410s_corrected.txt,
    s660s_corrected.txt): latitude, longitude, depth (km), its error, amplitude, its error, on a
    complete 0.5 degree grid of nodes (361 x 721, the -180/180 column repeated), already smoothed.
    SS rather than PP: the 660 is mostly invisible to PP, which is the paper's point.

Method
    Read the two files straight out of the archive (nothing is unpacked, so the macOS ._ files in it
    never touch the disk), interpolate bilinearly to pixel centres, and write the depth as a
    difference from the map's own mean: the 660 here averages 654 km, so "660" is a name, not a depth.

Usage (needs numpy, scipy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_transition_zone.py
"""

import io
import json
import tarfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.interpolate import RegularGridInterpolator

from fetch_cache import cached_fetch

ARCHIVE_URL = "https://download.isc.ac.uk/datarepository/410660.tgz"
BOUNDARIES = {"410": "410660/s410s_corrected.txt", "660": "410660/s660s_corrected.txt"}
THERMAL_MODEL = "410660/thermalmodel.txt"
WIDTH, HEIGHT = 512, 256
# The largest departure from the mean is 25 km (the 660 off Peru, over the subducting slab); grey spans +-30 km.
SCALE_KM = 30.0

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "app" / "public" / "geo" / "transition-zone"
OUT_JSON = REPO_ROOT / "app" / "public" / "geo" / "transition-zone.json"


def archive() -> tarfile.TarFile:
    return tarfile.open(cached_fetch(ARCHIVE_URL, "transition-zone/410660.tgz"))


def read_grid(tar: tarfile.TarFile, member: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(lats ascending, lons ascending, values[lat, lon]) from a lat lon value ... file in the archive."""
    handle = tar.extractfile(member)
    assert handle is not None, member
    rows = np.loadtxt(io.StringIO(handle.read().decode("ascii")))
    lats, lons = np.unique(rows[:, 0]), np.unique(rows[:, 1])
    values = np.full((lats.size, lons.size), np.nan)
    values[np.searchsorted(lats, rows[:, 0]), np.searchsorted(lons, rows[:, 1])] = rows[:, 2]
    return lats, lons, values


def area_mean(lats: np.ndarray, values: np.ndarray) -> float:
    weights = np.cos(np.radians(lats))[:, None] * np.ones_like(values)
    return float((values * weights).sum() / weights.sum())


def pixel_centres() -> tuple[np.ndarray, np.ndarray]:
    """Latitudes north to south (image rows) and longitudes west to east (columns)."""
    lats = 90.0 - (np.arange(HEIGHT) + 0.5) * 180.0 / HEIGHT
    lons = -180.0 + (np.arange(WIDTH) + 0.5) * 360.0 / WIDTH
    return lats, lons


def resample(lats: np.ndarray, lons: np.ndarray, values: np.ndarray) -> np.ndarray:
    interpolate = RegularGridInterpolator((lats, lons), values)
    rows, cols = pixel_centres()
    lat_grid, lon_grid = np.meshgrid(rows, cols, indexing="ij")
    return interpolate(np.stack([lat_grid, lon_grid], axis=-1))


def encode(anomaly_km: np.ndarray) -> np.ndarray:
    """Positive is deeper. 128 + 127 * anomaly / SCALE_KM, clipped to 1..255."""
    return np.clip(np.rint(128 + 127 * anomaly_km / SCALE_KM), 1, 255).astype(np.uint8)


def decode(grey: np.ndarray) -> np.ndarray:
    return (grey.astype(float) - 128) / 127 * SCALE_KM


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tar = archive()
    entries = []
    for name, member in BOUNDARIES.items():
        lats, lons, depth = read_grid(tar, member)
        assert not np.isnan(depth).any(), f"{member}: gaps in the grid"
        mean = area_mean(lats, depth)
        image = encode(resample(lats, lons, depth) - mean)
        path = OUT_DIR / f"{name}.png"
        Image.fromarray(image, mode="L").save(path, optimize=True)
        entries.append(
            {
                "id": name,
                "file": f"geo/transition-zone/{name}.png",
                "meanKm": round(mean, 1),
                "minKm": round(float(depth.min()), 1),
                "maxKm": round(float(depth.max()), 1),
            }
        )
        print(f"{name}: mean {mean:.1f} km, {depth.min():.1f}-{depth.max():.1f} km, {path.stat().st_size} bytes")
    OUT_JSON.write_text(
        json.dumps({"width": WIDTH, "height": HEIGHT, "scaleKm": SCALE_KM, "boundaries": entries}, indent=1) + "\n"
    )


if __name__ == "__main__":
    main()
