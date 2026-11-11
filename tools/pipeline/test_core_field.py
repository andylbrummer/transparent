#!/usr/bin/env python3
"""
Data checks for generate_core_field.py.

The spherical-harmonic sum is held to an independent model first: at the
surface, IGRF 2025 must give the declinations NOAA publishes as test
values for the World Magnetic Model 2025 (a different model of the same
field, so they agree to a fraction of a degree, not exactly). Then the
core's surface, against what is known of it: no net flux (no monopoles),
the two pairs of high-latitude flux lobes under Canada, Siberia and their
southern counterparts, and the reversed flux under the South Atlantic,
which has grown since 1900 as the field has weakened there.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/test_core_field.py
"""

import json
import math

import numpy as np
from PIL import Image

from fetch_cache import cached_fetch
from generate_core_field import CMB_RADIUS_KM, IGRF_URL, META, REPO_ROOT, SCALE_NT, field_spherical, grid, read_igrf
from geo_test_support import check, finish

# NOAA NCEI WMM2025_TestValues.txt, epoch 2025.0: (height km, geodetic lat, lon, declination deg); as in
# packages/core/src/magnetic/index.test.ts. The point at 89 N is left out: declination there turns on tiny fields.
WMM_TEST_VALUES = [
    (48, 80, -96, -29.91),
    (54, 82, 87, 54.89),
    (65, 43, 93, 0.50),
    (51, -33, 109, -5.49),
    (39, -59, -8, -15.75),
    (3, -50, -103, 27.96),
    (94, -29, -110, 15.74),
    (66, 14, 143, -0.19),
    (18, 0, 21, 1.29),
]
WGS84_A = 6378.137
WGS84_F = 1 / 298.257223563


def geodetic_to_geocentric(lat_deg: float, height_km: float) -> tuple[float, float, float]:
    """Geocentric radius (km), colatitude (rad), and geodetic minus geocentric latitude (rad)."""
    e2 = WGS84_F * (2 - WGS84_F)
    lat = math.radians(lat_deg)
    n = WGS84_A / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    p = (n + height_km) * math.cos(lat)
    z = (n * (1 - e2) + height_km) * math.sin(lat)
    r = math.hypot(p, z)
    geocentric = math.atan2(z, p)
    return r, math.pi / 2 - geocentric, lat - geocentric


def declination(model: dict, height_km: float, lat: float, lon: float) -> float:
    r, theta, tilt = geodetic_to_geocentric(lat, height_km)
    br, bt, bp = field_spherical(model, r, np.array(theta), np.array(math.radians(lon)), max_degree=13)
    north = -float(bt) * math.cos(tilt) - float(br) * math.sin(tilt)
    return math.degrees(math.atan2(float(bp), north))


def box_extreme(br: np.ndarray, theta: np.ndarray, phi: np.ndarray, lat: float, lon: float, half: float, sign: int) -> float:
    lat_grid, lon_grid = 90 - np.degrees(theta), np.degrees(phi)
    inside = (np.abs(lat_grid - lat) <= half) & (np.abs((lon_grid - lon + 180) % 360 - 180) <= half)
    return float((sign * br[inside]).max() * sign)


def main() -> None:
    models = read_igrf(cached_fetch(IGRF_URL, "core-field/igrf14coeffs.txt").read_text())
    check(sorted(models)[0] == 1900 and sorted(models)[-1] == 2025 and len(models) == 26, "IGRF-14: 26 epochs, 1900 to 2025")
    for height, lat, lon, expected in WMM_TEST_VALUES:
        got = declination(models[2025], height, lat, lon)
        check(abs(got - expected) < 0.5, f"declination at {lat},{lon}: IGRF 2025 {got:.2f} deg, WMM2025 {expected:.2f}")

    theta, phi = grid()
    weight = np.sin(theta)
    fields = {year: field_spherical(models[year], CMB_RADIUS_KM, theta, phi)[0] for year in (1900, 1950, 2020)}
    for year, br in fields.items():
        net = float((br * weight).sum() / (np.abs(br) * weight).sum())
        check(abs(net) < 0.01, f"{year}: no net flux through the core's surface ({net:.4f} of the total)")
        check(0.5e6 < np.abs(br).max() < 1.2e6, f"{year}: strongest radial field {np.abs(br).max() / 1e6:.2f} mT, under the scale")
    # Flux lobes (Jackson, Jonkers & Walker 2000): inward under Canada and Siberia, outward south of Australia,
    # each over half a millitesla. Not checked: a fourth lobe "south of Africa", from memory, not from a source;
    # the reversed flux under the South Atlantic and southern Africa has eaten into that side (0.11 mT there).
    br = fields[2020]
    for name, lat, lon, sign in (("Canada", 60, -100, -1), ("Siberia", 60, 120, -1), ("south of Australia", -60, 140, 1)):
        value = box_extreme(br, theta, phi, lat, lon, 15, sign)
        check(sign * value > 0.5e6, f"2020: flux lobe under {name}, {value / 1e6:+.2f} mT")
    # The South Atlantic: inward field where the south should be outward.
    value = box_extreme(br, theta, phi, -30, -20, 20, -1)
    check(value < 0, f"2020: reversed flux under the South Atlantic ({value / 1e6:+.2f} mT)")

    meta = json.loads(META.read_text())
    share = {entry["year"]: entry["reversedSouth"] for entry in meta["epochs"]}
    check(share[2025] > share[1950] > share[1900], f"reversed flux in the south grows: 1900 {share[1900]:.1%}, 1950 {share[1950]:.1%}, 2025 {share[2025]:.1%}")
    check([entry["year"] for entry in meta["epochs"]] == sorted(models), "every epoch baked, in order")

    image = np.asarray(Image.open(REPO_ROOT / "app" / "public" / meta["epochs"][-2]["file"])).astype(float)
    decoded = (image - 128) / 127 * SCALE_NT
    check(meta["epochs"][-2]["year"] == 2020 and float(np.abs(decoded - np.clip(br, -SCALE_NT, SCALE_NT)).max()) < SCALE_NT / 127, "2020 picture decodes to the field")
    finish()


if __name__ == "__main__":
    main()
