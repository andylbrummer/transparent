#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: rays through the inner core.

Writes app/public/geo/inner-core.json: every PKIKP ray in the compilation
behind Frost, Lasbleis, Chandler & Romanowicz (2021), Dynamic history of
the inner core constrained by seismic anisotropy, Nature Geoscience 14,
531-535, doi:10.1038/s41561-021-00761-w; data on Zenodo,
doi:10.5281/zenodo.4721364, CC BY 4.0. It gathers six sources: Vinnik et
al. 1994, Breger et al. 2000, Tkalcic et al. 2002 and Leykam et al. 2010
(one set), Cao & Romanowicz 2007, Romanowicz et al. 2015, Frost &
Romanowicz 2019, Soergel 2015 and Frost et al. 2021.

Each ray is one earthquake seen at one station. What is measured is how
much earlier or later the wave through the inner core (PKIKP, "DF")
arrived than the wave that only grazes it or stays in the outer core
(PKP "BC" or "AB"), against a 1-D model: a differential travel time, so
the mantle on the way, which both waves cross nearly together, mostly
cancels. Positive: the inner-core leg was faster than the model.

Per ray the file keeps where it enters and leaves the inner core, how deep
it turns, its residual and which pair of waves gave it. Its angle to the
Earth's axis (the "xi" of the file) is not kept: it is the angle of the
chord from entry to exit, which the app works out, and the check holds the
two together.

The file's columns: date, station, event lat lon depth, station lat lon,
inner-core entry lat lon, exit lat lon, turning point lat lon, turning
depth (km from the surface), PKP(AB-DF) residual, PKP(BC-DF) residual (0
where not measured; no ray has both), xi, source.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_inner_core.py
"""

from __future__ import annotations

import sys

import numpy as np

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

FROST_URL = ("https://zenodo.org/api/records/4721364/files/"
             "PKPica_combined_datasets_FrostDA_2021_NatureGeoscience.dat/content")
EARTH_RADIUS_KM = 6371.0
# PREM's inner-core radius.
INNER_CORE_RADIUS_KM = 1221.5
QUANTUM_PER_DEGREE = 100
# Stored in hundredths of a second.
RESIDUAL_QUANTUM_S = 0.01


def read_rays() -> tuple[np.ndarray, list[str]]:
    """[n, 15] numbers (from event lat to xi) and the source of each row, for every data row of the file."""
    rows, sources = [], []
    path = cached_fetch(FROST_URL, "inner-core/frost2021.dat")
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) < 18:
            continue
        try:
            rows.append([float(value) for value in parts[2:17]])
        except ValueError:
            continue  # the reference list and the header
        sources.append(" ".join(parts[17:]))
    return np.array(rows), sources


# Columns of read_rays()'s array.
EVENT_LAT, EVENT_LON, EVENT_DEPTH, STATION_LAT, STATION_LON = range(5)
ENTRY_LAT, ENTRY_LON, EXIT_LAT, EXIT_LON, TURN_LAT, TURN_LON, TURN_DEPTH, AB_DF, BC_DF, XI = range(5, 15)


def build() -> dict:
    rays, sources = read_rays()
    ab, bc = rays[:, AB_DF], rays[:, BC_DF]
    if np.any((ab != 0) & (bc != 0)):
        raise ValueError("a ray with both residuals: the file has changed")
    measured = (ab != 0) | (bc != 0)
    rays = rays[measured]
    kept_sources = [s for s, m in zip(sources, measured) if m]
    residual = np.where(rays[:, BC_DF] != 0, rays[:, BC_DF], rays[:, AB_DF])
    phase = (rays[:, BC_DF] != 0).astype(int)  # 1: BC-DF, 0: AB-DF
    studies = sorted(set(kept_sources))
    q = QUANTUM_PER_DEGREE
    flat: list[int] = []
    for ray, r, p, source in zip(rays, residual, phase, kept_sources):
        flat += [round(ray[ENTRY_LON] * q), round(ray[ENTRY_LAT] * q), round(ray[EXIT_LON] * q), round(ray[EXIT_LAT] * q),
                 round(ray[TURN_DEPTH]), round(r / RESIDUAL_QUANTUM_S), int(p), studies.index(source)]
    print(f"  {len(rays)} rays with a residual of {len(sources)} rows; {int(phase.sum())} BC-DF, {int((1 - phase).sum())} AB-DF",
          file=sys.stderr)
    return {
        "source": "Frost, Lasbleis, Chandler & Romanowicz 2021, Nature Geoscience 14, 531-535; Zenodo 10.5281/zenodo.4721364 (CC BY 4.0)",
        "innerCoreRadiusKm": INNER_CORE_RADIUS_KM,
        "quantumPerDegree": q,
        "residualQuantumS": RESIDUAL_QUANTUM_S,
        "fields": ["entryLon", "entryLat", "exitLon", "exitLat", "turnDepthKm", "residual", "bcDf", "study"],
        "studies": studies,
        "rays": flat,
    }


def main() -> None:
    write_json(OUTPUT_DIR / "inner-core.json", build())


if __name__ == "__main__":
    main()
