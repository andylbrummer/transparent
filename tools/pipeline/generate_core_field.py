#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the magnetic field on the surface of the core, 1900-2025.

Writes
    app/public/geo/core-field/<year>.png   512x256 equirectangular (lon -180..180, north up), grey:
                                           128 is no radial field, 1 and 255 are -/+ SCALE_NT
    app/public/geo/core-field.json         the epochs, the scale, the degree, and per epoch the
                                           share of the core's southern half where the field
                                           points the "wrong" way (the reversed flux patches)

Source
    International Geomagnetic Reference Field, 14th generation (IAGA Division V Working Group V-MOD,
    released December 2024): Schmidt semi-normalised Gauss coefficients, 1900.0-2025.0 every five
    years, https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt (served by NOAA NCEI).
    Models from 1945 on are definitive (DGRF); 1900-1940 are not and are less certain.

Method
    The field measured at and above the surface comes from the core; below the crust it can be
    continued down to the core-mantle boundary (r = 3480 km) as a potential field, because the
    mantle is a near insulator. The radial component there is
        Br = sum_n (n+1) (a/r)^(n+2) sum_m P_n^m(cos theta) (g cos m phi + h sin m phi),  a = 6371.2 km.
    Continuing down multiplies degree n by (a/r)^(n+2): the small scales grow most, so the map is
    cut at degree 10, as every model before 2000 is (later ones go to 13). The crust's own field
    (degree 14 and up) is not part of the core's and is not in IGRF.

Usage (needs numpy, scipy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_core_field.py
"""

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.special import lpmv

from fetch_cache import cached_fetch

IGRF_URL = "https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt"
REFERENCE_RADIUS_KM = 6371.2
CMB_RADIUS_KM = 3480.0
MAX_DEGREE = 10
WIDTH, HEIGHT = 512, 256
# At the core's surface the radial field reaches about a millitesla; the grey scale spans +-1.2 mT.
SCALE_NT = 1.2e6

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "app" / "public" / "geo" / "core-field"
META = REPO_ROOT / "app" / "public" / "geo" / "core-field.json"


def read_igrf(text: str) -> dict[int, dict[tuple[str, int, int], float]]:
    """{year: {(g|h, n, m): nT}} for the main-field epochs (the last column, secular variation, is left out)."""
    lines = [line.split() for line in text.splitlines() if line.strip() and not line.startswith("#")]
    header = next(fields for fields in lines if fields[0] == "g/h")
    years = [int(float(value)) for value in header[3:] if "-" not in value]
    models: dict[int, dict[tuple[str, int, int], float]] = {year: {} for year in years}
    for fields in lines:
        if fields[0] not in ("g", "h"):
            continue
        kind, n, m = fields[0], int(fields[1]), int(fields[2])
        for year, value in zip(years, fields[3:]):
            models[year][(kind, n, m)] = float(value)
    return models


def schmidt(n: int, m: int, x: np.ndarray) -> np.ndarray:
    """Schmidt semi-normalised associated Legendre function, without the Condon-Shortley phase."""
    p = lpmv(m, n, x) * (-1) ** m
    if m == 0:
        return p
    return p * math.sqrt(2 * math.factorial(n - m) / math.factorial(n + m))


def schmidt_derivative(n: int, m: int, theta: np.ndarray) -> np.ndarray:
    """dP_n^m(cos theta)/d theta, by central difference (only the surface checks need it)."""
    step = 1e-6
    return (schmidt(n, m, np.cos(theta + step)) - schmidt(n, m, np.cos(theta - step))) / (2 * step)


def field_spherical(model: dict, r_km: float, theta: np.ndarray, phi: np.ndarray, max_degree: int = MAX_DEGREE):
    """(Br, Btheta, Bphi) in nT at geocentric radius r, colatitude theta, longitude phi (radians)."""
    br = np.zeros(np.broadcast(theta, phi).shape)
    bt = np.zeros_like(br)
    bp = np.zeros_like(br)
    sin_theta = np.sin(theta)
    for n in range(1, max_degree + 1):
        ratio = (REFERENCE_RADIUS_KM / r_km) ** (n + 2)
        for m in range(n + 1):
            g = model[("g", n, m)]
            h = model.get(("h", n, m), 0.0)
            cos_m, sin_m = np.cos(m * phi), np.sin(m * phi)
            p = schmidt(n, m, np.cos(theta))
            br += (n + 1) * ratio * p * (g * cos_m + h * sin_m)
            bt -= ratio * schmidt_derivative(n, m, theta) * (g * cos_m + h * sin_m)
            bp += ratio * m * p * (g * sin_m - h * cos_m) / np.maximum(sin_theta, 1e-12)
    return br, bt, bp


def grid() -> tuple[np.ndarray, np.ndarray]:
    lon = (np.arange(WIDTH) + 0.5) / WIDTH * 360 - 180
    lat = 90 - (np.arange(HEIGHT) + 0.5) / HEIGHT * 180
    lon2, lat2 = np.meshgrid(lon, lat)
    return np.radians(90 - lat2), np.radians(lon2)


def reversed_share(br: np.ndarray, theta: np.ndarray) -> float:
    """Area share of the southern half of the core where Br points inward, as in the north: the reversed patches."""
    south = theta > math.pi / 2
    weight = np.sin(theta)
    return float((weight * (south & (br < 0))).sum() / (weight * south).sum())


def main() -> None:
    models = read_igrf(cached_fetch(IGRF_URL, "core-field/igrf14coeffs.txt").read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    theta, phi = grid()
    epochs = []
    for year in sorted(models):
        br, _, _ = field_spherical(models[year], CMB_RADIUS_KM, theta, phi)
        grey = np.clip(np.round(128 + br / SCALE_NT * 127), 1, 255).astype(np.uint8)
        path = OUT_DIR / f"{year}.png"
        Image.fromarray(grey, "L").save(path, optimize=True)
        share = reversed_share(br, theta)
        epochs.append({"year": year, "file": f"geo/core-field/{year}.png", "definitive": year >= 1945, "reversedSouth": round(share, 4)})
        print(f"{year}: |Br| max {np.abs(br).max() / 1e6:.2f} mT, reversed south {share:.1%}, {path.stat().st_size / 1024:.0f} KB")
    META.write_text(
        json.dumps(
            {"width": WIDTH, "height": HEIGHT, "radiusKm": CMB_RADIUS_KM, "scaleNt": SCALE_NT, "maxDegree": MAX_DEGREE, "epochs": epochs},
            indent=1,
        )
        + "\n"
    )
    print(f"wrote {len(epochs)} epochs and {META.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
