#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the constellations.

Writes app/public/sky/constellations.json:

- `figures`: the 88 IAU constellations - Latin name, abbreviation, a place
  for the name, and the stick figure as polylines through its stars. From
  d3-celestial (Olaf Frohn, BSD 3-Clause): constellations.json and
  constellations.lines.json, which follow the IAU / Sky & Telescope charts
  (https://www.iau.org/public/themes/constellations/) "with name positions
  and some line modifications" by Frohn.

- `boundaries`: the IAU boundaries (Delporte 1930), from the Catalogue of
  Constellation Boundary Data, Davenhall & Leggett 1989 (CDS VI/49), file
  constbnd.dat (B. Gray's 2007 edition, which names the constellation on
  each side of every edge, so each edge is kept once).
  The boundaries are arcs of constant right ascension or declination for
  the equinox B1875.0. Each edge is walked in that frame in steps of at
  most BOUNDARY_STEP_DEG and the points precessed to J2000 (IAU 1976
  precession), where they are no longer straight - which is why corners
  alone would not do.

Coordinates are ICRS/J2000 in units of 1/QUANTUM_PER_DEGREE degree,
polylines flattened to [ra, dec, ra, dec, ...].

Usage:
    python3 tools/pipeline/generate_constellations.py

Raw downloads are cached in tools/pipeline/.cache/. Standard library only.
"""

import json
import math
from pathlib import Path

from fetch_cache import cached_fetch

D3_CELESTIAL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/"
BOUNDARY_URLS = [
    "https://vizier.cfa.harvard.edu/ftp/cats/VI/49/constbnd.dat",
    "https://cdsarc.cds.unistra.fr/ftp/cats/VI/49/constbnd.dat",
]

QUANTUM_PER_DEGREE = 1000
BOUNDARY_STEP_DEG = 1.0
# Besselian epoch B1875.0 as a Julian Date.
B1875_JD = 2415020.31352 - 25 * 365.242198781
J2000_JD = 2451545.0

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "constellations.json"


def precession_matrix(jd: float) -> list[list[float]]:
    """J2000 mean equator and equinox -> those of `jd` (IAU 1976; Meeus 21.2). Same as core's precessionMatrix."""
    t = (jd - J2000_JD) / 36525
    arcsec = math.radians(1 / 3600)
    zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t**3) * arcsec
    z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t**3) * arcsec
    theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t**3) * arcsec
    cz, sz = math.cos(z), math.sin(z)
    ct, st = math.cos(theta), math.sin(theta)
    cx, sx = math.cos(zeta), math.sin(zeta)
    return [
        [cz * ct * cx - sz * sx, -cz * ct * sx - sz * cx, -cz * st],
        [sz * ct * cx + cz * sx, -sz * ct * sx + cz * cx, -sz * st],
        [st * cx, -st * sx, ct],
    ]


B1875_FROM_J2000 = precession_matrix(B1875_JD)


def b1875_to_j2000(ra_deg: float, dec_deg: float) -> tuple[float, float]:
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    v = (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec))
    # The inverse of a rotation is its transpose.
    m = B1875_FROM_J2000
    x, y, z = (sum(m[row][col] * v[row] for row in range(3)) for col in range(3))
    return math.degrees(math.atan2(y, x)) % 360, math.degrees(math.asin(max(-1.0, min(1.0, z))))


def quantize(ra_deg: float, dec_deg: float) -> list[int]:
    return [round((ra_deg % 360) * QUANTUM_PER_DEGREE) % (360 * QUANTUM_PER_DEGREE), round(dec_deg * QUANTUM_PER_DEGREE)]


def build_figures(names: dict, lines: dict) -> list[dict]:
    lines_by_id: dict[str, list[list]] = {}
    for feature in lines["features"]:
        lines_by_id.setdefault(feature["id"], []).append(feature["geometry"]["coordinates"])

    def distance_deg(polylines: list, lon: float, lat: float) -> float:
        points = [point for polyline in polylines for point in polyline]
        return min(math.hypot(((p[0] - lon + 180) % 360 - 180) * math.cos(math.radians(lat)), p[1] - lat) for p in points)

    figures = []
    for feature in names["features"]:
        ident = feature["id"]
        lon, lat = feature["geometry"]["coordinates"]
        # Serpens is two figures under one abbreviation, head and tail: each name takes the lines beside it.
        candidates = lines_by_id.get(ident, [])
        polylines = min(candidates, key=lambda c: distance_deg(c, lon, lat)) if candidates else []
        figures.append(
            {
                "id": ident,
                "name": feature["properties"]["name"],
                # d3-celestial ranks the constellations 1 (prominent) to 3.
                "rank": int(feature["properties"]["rank"]),
                "at": quantize(lon, lat),
                "lines": [[v for lon, lat in polyline for v in quantize(lon, lat)] for polyline in polylines],
            }
        )
    return sorted(figures, key=lambda figure: figure["name"])


def parse_boundary_edges(text: str) -> list[tuple[tuple[float, float], tuple[float, float], str, str]]:
    """Edges (start, end, constellation, neighbour) in B1875 degrees, in file order."""
    edges = []
    previous: tuple[float, float] | None = None
    for line in text.splitlines():
        if not line.strip():
            continue
        point = (float(line[0:8]) * 15, float(line[9:18]))
        constellation = line[19:23].strip()
        neighbour = line[24:28].strip()
        # A blank neighbour marks the first point of a constellation's circuit.
        if neighbour and previous is not None:
            edges.append((previous, point, constellation, neighbour))
        previous = point
    return edges


def walk_edge(start: tuple[float, float], end: tuple[float, float]) -> list[tuple[float, float]]:
    """Points along an edge of constant RA or Dec in B1875, ends included."""
    d_ra = (end[0] - start[0] + 180) % 360 - 180
    d_dec = end[1] - start[1]
    steps = max(1, math.ceil(max(abs(d_ra), abs(d_dec)) / BOUNDARY_STEP_DEG))
    return [(start[0] + d_ra * i / steps, start[1] + d_dec * i / steps) for i in range(steps + 1)]


def build_boundaries(text: str) -> list[list[int]]:
    polylines = []
    seen: set[tuple] = set()
    for start, end, constellation, neighbour in parse_boundary_edges(text):
        # Every edge is listed from both sides; the unordered pair of ends names it once.
        key = (min(start, end), max(start, end))
        if key in seen:
            continue
        seen.add(key)
        polylines.append([v for ra, dec in walk_edge(start, end) for v in quantize(*b1875_to_j2000(ra, dec))])
    return polylines


def main() -> None:
    names = json.loads(cached_fetch(D3_CELESTIAL + "constellations.json", "d3-celestial-constellations.json").read_text())
    lines = json.loads(
        cached_fetch(D3_CELESTIAL + "constellations.lines.json", "d3-celestial-constellations.lines.json").read_text()
    )
    figures = build_figures(names, lines)
    boundaries = build_boundaries(cached_fetch(BOUNDARY_URLS, "vi49-constbnd.dat").read_text())
    data = {
        "frame": "ICRS",
        "quantumPerDegree": QUANTUM_PER_DEGREE,
        "figures": figures,
        "boundaries": boundaries,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    line_points = sum(len(polyline) // 2 for figure in figures for polyline in figure["lines"])
    boundary_points = sum(len(polyline) // 2 for polyline in boundaries)
    print(
        f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB): {len(figures)} figures, "
        f"{line_points} line points, {len(boundaries)} boundary edges, {boundary_points} boundary points"
    )


if __name__ == "__main__":
    main()
