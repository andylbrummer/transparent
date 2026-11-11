"""
Synthesis of a gravity field model on the ellipsoid: geoid height and
free-air gravity anomaly from fully normalised spherical-harmonic
coefficients (the ICGEM .gfc format), in plain numpy.

Points are on the GRS80 ellipsoid at geodetic latitude; each is turned
into its geocentric latitude and radius, and the series is continued to
that radius, (a/r)^n, rather than evaluated on a sphere: at the poles the
ellipsoid is 21 km inside the sphere of radius a, which matters for the
short wavelengths a gravity map is made of.

The normal field of GRS80 (its even zonal terms, J2..J10) is taken away,
so what is left is the disturbing potential T. Then, in the usual
spherical approximation (Heiskanen & Moritz 1967, 2-148 and 2-163):

    geoid height     N  = T / gamma
    gravity anomaly  dg = GM/r^2 sum_n (n - 1) (a/r)^n sum_m (dC cos m lon + S sin m lon) P_nm(sin lat_c)

with gamma Somigliana's normal gravity on the ellipsoid. Degrees 0 and 1
are left out: the mass of the model and the ellipsoid's are taken equal,
and the origin is the centre of mass.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# GRS80 (Moritz 2000, Geodetic Reference System 1980).
GRS80_A = 6378137.0
GRS80_GM = 3.986005e14
GRS80_F = 1 / 298.257222101
GRS80_J = {2: 1.08263e-3, 4: -2.37091222e-6, 6: 6.08347e-9, 8: -1.42681e-11, 10: 1.21439e-14}
GRS80_GAMMA_EQUATOR = 9.7803267715
GRS80_GAMMA_POLE = 9.8321863685
GRS80_B = GRS80_A * (1 - GRS80_F)
GRS80_E2 = GRS80_F * (2 - GRS80_F)


@dataclass
class GravityModel:
    gm: float
    radius: float
    max_degree: int
    c: np.ndarray  # [n, m], fully normalised
    s: np.ndarray


def read_gfc(source: Path | str, member: str | None = None, max_degree: int | None = None) -> GravityModel:
    """Read an ICGEM .gfc file (or one member of a zip), keeping degrees up to `max_degree`."""
    path = Path(source)
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as archive:
            text = archive.read(member or archive.namelist()[0]).decode()
    else:
        text = path.read_text()
    head, _, body = text.partition("end_of_head")
    keys = {}
    for line in head.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            keys[parts[0]] = parts[1]
    if keys.get("norm", "fully_normalized") != "fully_normalized":
        raise ValueError(f"not fully normalised: {keys.get('norm')}")
    top = int(keys["max_degree"]) if max_degree is None else min(max_degree, int(keys["max_degree"]))
    c = np.zeros((top + 1, top + 1))
    s = np.zeros((top + 1, top + 1))
    rows = np.loadtxt(io.StringIO(body.split("\n", 1)[1]), usecols=(1, 2, 3, 4), dtype=np.float64,
                      converters={k: (lambda v: float(v.replace("D", "E").replace("d", "e"))) for k in (3, 4)})
    keep = rows[:, 0] <= top
    n, m = rows[keep, 0].astype(int), rows[keep, 1].astype(int)
    c[n, m] = rows[keep, 2]
    s[n, m] = rows[keep, 3]
    return GravityModel(float(keys["earth_gravity_constant"]), float(keys["radius"]), top, c, s)


def normal_zonals(model: GravityModel) -> dict[int, float]:
    """GRS80's even zonal coefficients, fully normalised and rescaled to the model's GM and radius."""
    return {n: -j / np.sqrt(2 * n + 1) * (GRS80_GM / model.gm) * (GRS80_A / model.radius) ** n for n, j in GRS80_J.items()}


def ellipsoid_points(geodetic_lat_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(geocentric latitude in radians, radius in metres) of points on the GRS80 ellipsoid."""
    phi = np.radians(geodetic_lat_deg)
    nu = GRS80_A / np.sqrt(1 - GRS80_E2 * np.sin(phi) ** 2)
    x = nu * np.cos(phi)
    z = nu * (1 - GRS80_E2) * np.sin(phi)
    return np.arctan2(z, x), np.hypot(x, z)


def normal_gravity(geodetic_lat_deg: np.ndarray) -> np.ndarray:
    """Somigliana's normal gravity on the GRS80 ellipsoid, m/s^2."""
    phi = np.radians(geodetic_lat_deg)
    num = GRS80_A * GRS80_GAMMA_EQUATOR * np.cos(phi) ** 2 + GRS80_B * GRS80_GAMMA_POLE * np.sin(phi) ** 2
    return num / np.sqrt(GRS80_A**2 * np.cos(phi) ** 2 + GRS80_B**2 * np.sin(phi) ** 2)


def synthesise(model: GravityModel, lats_deg: np.ndarray, lons_deg: np.ndarray, max_degree: int | None = None) -> dict[str, np.ndarray]:
    """Geoid height (m) and free-air anomaly (mGal) on the grid lats x lons (geodetic degrees), [lat, lon]."""
    top = model.max_degree if max_degree is None else min(max_degree, model.max_degree)
    c = model.c[: top + 1, : top + 1].copy()
    s = model.s[: top + 1, : top + 1]
    for n, value in normal_zonals(model).items():
        if n <= top:
            c[n, 0] -= value
    c[:2, :] = 0.0
    lat_c, r = ellipsoid_points(np.asarray(lats_deg, float))
    t = np.sin(lat_c)  # cos of colatitude
    u = np.cos(lat_c)
    q = model.radius / r
    n_all = np.arange(top + 1)
    # Per degree: (a/r)^n for the potential, (n - 1)(a/r)^n for the anomaly.
    qn = q[None, :] ** n_all[:, None]
    potential_weight = qn
    anomaly_weight = (n_all[:, None] - 1) * qn
    # Coefficients of cos m lon and sin m lon per latitude, summed over n, for both quantities.
    a_pot = np.zeros((top + 1, t.size))
    b_pot = np.zeros((top + 1, t.size))
    a_dg = np.zeros((top + 1, t.size))
    b_dg = np.zeros((top + 1, t.size))
    # Fully normalised Legendre functions by the standard column recursion (Holmes & Featherstone 2002),
    # one order m at a time; sectoral seeds carried by their own recursion.
    p_mm = np.ones(t.size)  # P_00
    for m in range(top + 1):
        if m == 1:
            p_mm = np.sqrt(3.0) * u
        elif m > 1:
            p_mm = p_mm * u * np.sqrt((2 * m + 1) / (2 * m))
        p_prev = np.zeros(t.size)
        p = p_mm
        for n in range(m, top + 1):
            if n > m:
                a_nm = np.sqrt((2 * n - 1) * (2 * n + 1) / ((n - m) * (n + m)))
                b_nm = np.sqrt((2 * n + 1) * (n + m - 1) * (n - m - 1) / ((n - m) * (n + m) * (2 * n - 3)))
                p, p_prev = a_nm * t * p - b_nm * p_prev, p
            if n < 2:
                continue
            cp = c[n, m] * p
            sp = s[n, m] * p
            a_pot[m] += cp * potential_weight[n]
            b_pot[m] += sp * potential_weight[n]
            a_dg[m] += cp * anomaly_weight[n]
            b_dg[m] += sp * anomaly_weight[n]
    lam = np.radians(np.asarray(lons_deg, float))
    m_all = np.arange(top + 1)
    cos_ml = np.cos(m_all[:, None] * lam[None, :])
    sin_ml = np.sin(m_all[:, None] * lam[None, :])
    t_field = (a_pot.T @ cos_ml + b_pot.T @ sin_ml) * (model.gm / r)[:, None]
    dg_field = (a_dg.T @ cos_ml + b_dg.T @ sin_ml) * (model.gm / r**2)[:, None]
    gamma = normal_gravity(np.asarray(lats_deg, float))[:, None]
    return {"geoid_m": t_field / gamma, "anomaly_mgal": dg_field * 1e5}
