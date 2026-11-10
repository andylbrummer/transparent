#!/usr/bin/env python3
"""
Data checks for generate_constellations.py's output: figures that join
real stars, and boundaries where the IAU drew them.

The figures are checked against the star layer's own catalogue
(app/public/sky/stars.json): a figure whose corners miss the stars would
be visibly wrong on screen. The boundaries are checked against the J2000
table of the same catalogue (CDS VI/49 bound_20.dat, which the CfA mirror
serves sorted by right ascension - usable as a set of points, not as
outlines) and against stars whose constellation is not in doubt.

Usage:
    python3 tools/pipeline/test_constellations.py
"""

import gzip
import json
import math

from fetch_cache import cached_fetch
from generate_constellations import OUTPUT, REPO_ROOT, b1875_to_j2000
from geo_test_support import check, finish

BOUND_20_URLS = [
    "https://vizier.cfa.harvard.edu/ftp/cats/VI/49/bound_20.dat.gz",
    "https://cdsarc.cds.unistra.fr/ftp/cats/VI/49/bound_20.dat.gz",
]
STARS = REPO_ROOT / "app" / "public" / "sky" / "stars.json"


def separation_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(a1 - a2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def main() -> None:
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    quantum = data["quantumPerDegree"]
    figures = data["figures"]
    by_name = {figure["name"]: figure for figure in figures}

    check(len(figures) == 89, f"{len(figures)} figures: the 88 constellations, Serpens in two parts")
    check(len({figure["id"] for figure in figures}) == 88, "88 distinct IAU abbreviations")
    check(all(figure["lines"] for figure in figures), "every constellation has a figure")
    for name in ("Orion", "Ursa Major", "Crux", "Serpens Caput", "Serpens Cauda", "Octans", "Scorpius"):
        check(name in by_name, f"{name} is present under its Latin name")

    stars = json.loads(STARS.read_text(encoding="utf-8"))
    star_quantum = stars["quantumPerDegree"]
    star_points = [(ra / star_quantum, dec / star_quantum) for ra, dec in zip(stars["ra"], stars["dec"])]
    star_index = {name: star_points[index] for index, name in stars["names"]}

    def nearest_star_deg(ra: float, dec: float) -> float:
        return min(separation_deg(ra, dec, s_ra, s_dec) for s_ra, s_dec in star_points if abs(s_dec - dec) < 0.5)

    vertices = {
        (polyline[i] / quantum, polyline[i + 1] / quantum)
        for figure in figures
        for polyline in figure["lines"]
        for i in range(0, len(polyline), 2)
    }
    misses = sorted(((nearest_star_deg(ra, dec), ra, dec) for ra, dec in vertices), reverse=True)
    far = [miss for miss in misses if miss[0] > 0.1]
    # The one exception is not the figure's fault: xi UMa (HIP 55203, V 3.8), a close binary for which the
    # Hipparcos main catalogue gives no position, so stars.json lacks it. Ursa Major's hind foot ends there.
    xi_uma = (169.547, 31.531)
    check(
        [(round(ra, 3), round(dec, 3)) for _, ra, dec in far] == [xi_uma],
        f"all {len(vertices)} figure corners sit on a catalogue star, but for xi UMa "
        f"(worst other miss {misses[len(far)][0] * 60:.1f} arcmin)",
    )

    def joined(figure_name: str, star_a: str, star_b: str) -> bool:
        """Whether the figure has a line running directly between the two named stars."""
        a, b = star_index[star_a], star_index[star_b]
        for polyline in by_name[figure_name]["lines"]:
            points = [(polyline[i] / quantum, polyline[i + 1] / quantum) for i in range(0, len(polyline), 2)]
            for p, q in zip(points, points[1:]):
                for u, v in ((p, q), (q, p)):
                    if separation_deg(*u, *a) < 0.1 and separation_deg(*v, *b) < 0.1:
                        return True
        return False

    for figure_name, chain in (
        ("Orion", ["Alnitak", "Alnilam", "Mintaka"]),
        ("Ursa Major", ["Alkaid", "Mizar", "Alioth", "Megrez", "Dubhe", "Merak", "Phecda", "Megrez"]),
        ("Crux", ["Acrux", "Gacrux"]),
        ("Crux", ["Mimosa", "Imai"]),
        ("Cassiopeia", ["Caph", "Schedar"]),
        ("Scorpius", ["Antares", "Paikauhale"]),
    ):
        ok = all(joined(figure_name, a, b) for a, b in zip(chain, chain[1:]))
        check(ok, f"{figure_name}: {' - '.join(chain)} are joined")

    for figure in figures:
        ra, dec = figure["at"][0] / quantum, figure["at"][1] / quantum
        nearest = min(separation_deg(ra, dec, v_ra, v_dec) for v_ra, v_dec in vertices)
        if nearest > 25:
            check(False, f"{figure['name']}: name is {nearest:.0f} degrees from any figure")
    check(True, "every name sits within 25 degrees of a figure")
    orion = by_name["Orion"]
    check(
        separation_deg(orion["at"][0] / quantum, orion["at"][1] / quantum, *star_index["Betelgeuse"]) < 8,
        "Orion's name is by its shoulders",
    )

    # Boundaries.
    boundaries = data["boundaries"]
    boundary_points = [
        (polyline[i] / quantum, polyline[i + 1] / quantum) for polyline in boundaries for i in range(0, len(polyline), 2)
    ]
    check(700 < len(boundaries) < 900, f"{len(boundaries)} boundary edges, each kept once")
    longest = max(
        separation_deg(polyline[i] / quantum, polyline[i + 1] / quantum, polyline[i + 2] / quantum, polyline[i + 3] / quantum)
        for polyline in boundaries
        for i in range(0, len(polyline) - 2, 2)
    )
    check(longest <= 1.01, f"no boundary step longer than a degree ({longest:.2f})")

    # Crux is a rectangle in B1875: 11h50m-12h50m, -55 to -64. d3-celestial's J2000 corner: 179.0708, -55.6958.
    ra, dec = b1875_to_j2000(11.83333 * 15, -55.0)
    check(separation_deg(ra, dec, 179.0708, -55.6958) < 0.002, f"Crux's north-west corner precesses to {ra:.4f}, {dec:.4f}")

    with gzip.open(cached_fetch(BOUND_20_URLS, "vi49-bound_20.dat.gz"), "rt") as handle:
        reference = [(float(line[0:11]), float(line[12:23])) for line in handle if line.strip()]
    check(len(reference) > 12000, f"{len(reference)} reference points in VI/49 bound_20.dat")
    # Every reference point must lie on one of our edges: within half a step of a baked point.
    buckets: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for point in boundary_points:
        buckets.setdefault((int(point[0] // 5), int(point[1] // 5)), []).append(point)

    def nearest_boundary_deg(ra: float, dec: float) -> float:
        best = math.inf
        # Near the poles a 5 degree cell of right ascension is narrow: widen the search.
        span = 1 if abs(dec) < 60 else 36
        for d_ra in range(-span, span + 1):
            for d_dec in (-1, 0, 1):
                for p in buckets.get((int(ra // 5 + d_ra) % 72, int(dec // 5) + d_dec), []):
                    best = min(best, separation_deg(ra, dec, *p))
        return best

    worst = max(nearest_boundary_deg(ra, dec) for ra, dec in reference[::7])
    check(worst < 0.55, f"VI/49's own J2000 points lie on the baked edges (worst {worst:.2f} degrees from a baked point)")

    finish()


if __name__ == "__main__":
    main()
