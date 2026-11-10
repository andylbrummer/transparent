#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: ultra-low velocity zones (ULVZs)
on the core-mantle boundary.

Writes app/public/geo/ulvz.json: where seismologists have looked at the
base of the mantle for the thin patches in which seismic waves slow by
tens of per cent, and what they found there, from the compilation

    Yu, S. & Garnero, E.J. (2018), Ultralow Velocity Zone Locations: A
    Global Assessment, Geochemistry, Geophysics, Geosystems 19, 396-414,
    doi:10.1002/2017GC007281,

whose data set is "ULVZ Distribution Database from 54 studies", v1.0.1,
Zenodo, doi:10.5281/zenodo.1064217 (ULVZ-Database-1.0.1.zip, 119 MB,
md5 ddeda60b1f71c6d22eec0bf83086ed74). Zenodo gives its licence as
"Other (Open)" with no further description: open access, no named
licence. See docs/data-sources/earth-extras.md.

Only the folder 1_Database is read, the locations as digitised from each
study's figures ("Raw" in the paper): one file per study, region and
result, named Data.<phase>.<code>.<yes|no|may>.<point|line|area>, holding
"longitude latitude" lines with ">" between groups.

  - yes / no / may: a ULVZ was found, was looked for and not found, or
    the evidence is weak or uncertain;
  - point: where a ray met the core-mantle boundary;
    line: the two ends of a path along it (a diffracted leg);
    area: the outline of a region.

Everything is kept, with longitudes brought to -180..180. Nothing is
added: the paper's 0.5-degree Fresnel-zone grids (2_FresnelZoneAdded) are
not used, so a point here is a ray's pierce point, not the width of
boundary the wave actually sensed.

The four "mega" ULVZs named in the app:

  - Hawaii, Iceland and Samoa are regions of the database (studies 45,
    54 and 46). Their centre and, for the two drawn as circles, their
    width are measured here from the outline; height and velocity drop
    are the database's Details table (ULVZ_DB.MariaDB.sql: Thickness in
    km, dVs in per cent - the Hawaii row's 20 and -20 are the "~20 km in
    height" and "20%" of that paper's abstract).
  - Samoa's outline is not a circle; its size is the paper's own words,
    "roughly 250 x 800 km in lateral dimension and 10-15 km thick"
    (Thorne et al. 2013, Earth Planet. Sci. Lett. 364, 59-67,
    doi:10.1016/j.epsl.2012.12.034, abstract).
  - Galapagos is later than the database: "centered at 105 W and 2 N",
    "a width of ~600 km, a height of 20 km, a shear wave velocity
    reduction of 25%" (Cottaar, Martin, Li & Parai 2022, Seismica 1(1),
    doi:10.26443/seismica.v1i1.197, CC BY 4.0), with stated uncertainties
    of at least 2 degrees, 100 km, 5 km and 5 %.
  The Marquesas ULVZ (Kim et al. 2020) is left out: the paper says its
  data "does not constrain its precise location and characteristics".

Output:

    {source, depthKm, quantumPerDegree, studies, files,
     points: {yes, no, may: [lon, lat, ...]},
     lines:  {yes, no, may: [[lon, lat, lon, lat], ...]},
     areas:  {yes, no, may: [[lon, lat, ...], ...]},
     mega: [{name, lon, lat, widthKm, heightKm, dVsPercent, size, cite}]}

with coordinates as integers of 1 / quantumPerDegree degree.

Usage:
    python3 tools/pipeline/generate_ulvz.py
"""

import io
import math
import re
import sys
import zipfile

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

ZIP_URL = "https://zenodo.org/api/records/1064217/files/ULVZ-Database-1.0.1.zip/content"
ROOT = "ULVZ-Database-1.0.1/1_Database/"
CMB_DEPTH_KM = 2891.0
EARTH_RADIUS_KM = 6371.0
QUANTUM_PER_DEGREE = 100
RESULTS = ("yes", "no", "may")
KINDS = ("point", "line", "area")
FILE_NAME = re.compile(r"^No\.(\d+)/Data\.([A-Za-z]+)\.(\w+)\.(yes|no|may)\.(point|line|area)$")

# (name, study, code, the group of the file that is the body itself or None for the whole file, drawn as a circle,
#  size in the paper's words or None to state the measured width, short citation)
MEGA_IN_DATABASE = (
    ("Hawaiian mega-ULVZ", 45, "ZF2", None, True, None, "Cottaar & Romanowicz 2012"),
    ("Iceland mega-ULVZ", 54, "Iceland", None, True, None, "Yuan & Romanowicz 2017"),
    ("Samoan mega-ULVZ", 46, "SWP", "Primary", False, "250 × 800 km, 10–15 km high", "Thorne et al. 2013"),
)
# Later than the database: the paper's own numbers (see the docstring).
MEGA_FROM_PAPERS = (
    {"name": "Galápagos mega-ULVZ", "lon": -105.0, "lat": 2.0, "widthKm": 600, "heightKm": 20, "dVsPercent": -25,
     "size": None, "cite": "Cottaar et al. 2022"},
)


def wrap(lon: float) -> float:
    return (lon + 180.0) % 360.0 - 180.0


def read_groups(text: str) -> list[tuple[str, list[tuple[float, float]]]]:
    """[(label after ">", [(lon, lat), ...]), ...] of one file; groups without points are dropped."""
    groups: list[tuple[str, list[tuple[float, float]]]] = [("", [])]
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(">"):
            groups.append((line[1:].strip(), []))
            continue
        lon, lat = (float(token) for token in line.split())
        if not (-180.0 <= lon <= 360.0 and -90.0 <= lat <= 90.0):
            raise ValueError(f"not a longitude and latitude: {line!r}")
        groups[-1][1].append((wrap(lon), lat))
    return [group for group in groups if group[1]]


def quantise(points: list[tuple[float, float]]) -> list[int]:
    return [round(value * QUANTUM_PER_DEGREE) for point in points for value in point]


def unit(lon: float, lat: float) -> tuple[float, float, float]:
    lo, la = math.radians(lon), math.radians(lat)
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def centre_and_radius(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """(lon, lat) of the mean direction of an outline's vertices, and their mean angular distance from it, degrees."""
    vectors = [unit(lon, lat) for lon, lat in points]
    mean = [sum(v[i] for v in vectors) / len(vectors) for i in range(3)]
    norm = math.sqrt(sum(c * c for c in mean))
    mean = [c / norm for c in mean]
    radius = sum(math.degrees(math.acos(max(-1.0, min(1.0, sum(a * b for a, b in zip(v, mean)))))) for v in vectors) / len(vectors)
    return math.degrees(math.atan2(mean[1], mean[0])), math.degrees(math.asin(mean[2])), radius


def details(sql: str) -> dict[tuple[int, str], dict]:
    """(study, code) -> {dVs %, thickness km, paper} of the Details table; absent values are None."""
    rows = {}
    values = sql[sql.index("INSERT INTO `Details` VALUES") :]
    row = re.compile(r"\((\d+),'([^']*)',(NULL|-?[\d.]+),(NULL|-?[\d.]+),(NULL|-?[\d.]+),(NULL|-?[\d.]+),'([^']*)',")
    for ref, code, _dvp, dvs, _drho, thickness, paper in row.findall(values):
        rows[(int(ref), code)] = {"dVs": None if dvs == "NULL" else float(dvs),
                                  "thickness": None if thickness == "NULL" else float(thickness), "paper": paper}
    return rows


def main() -> None:
    archive = zipfile.ZipFile(io.BytesIO(cached_fetch(ZIP_URL, "ulvz/ULVZ-Database-1.0.1.zip", timeout=1800).read_bytes()))
    out = {kind: {result: [] for result in RESULTS} for kind in KINDS}
    studies: set[int] = set()
    files = 0
    named: dict[tuple[int, str], list[tuple[str, list[tuple[float, float]]]]] = {}
    for name in sorted(archive.namelist()):
        if not name.startswith(ROOT) or "/Data." not in name:
            continue
        match = FILE_NAME.match(name[len(ROOT):])
        if not match:
            # Never drop a study's file quietly because its name is of a new kind.
            raise ValueError(f"{name}: not Data.<phase>.<code>.<yes|no|may>.<point|line|area>")
        study, _phase, code, result, kind = int(match[1]), match[2], match[3], match[4], match[5]
        groups = read_groups(archive.read(name).decode("utf-8"))
        files += 1
        studies.add(study)
        if kind == "area" and result == "yes":
            named[(study, code)] = groups
        for _label, points in groups:
            if kind == "point":
                out["point"][result] += quantise(points)
            elif kind == "line":
                if len(points) != 2:
                    raise ValueError(f"{name}: a path with {len(points)} ends")
                out["line"][result].append(quantise(points))
            else:
                out["area"][result].append(quantise(points))

    table = details(archive.read(ROOT + "ULVZ_DB.MariaDB.sql").decode("utf-8"))
    cmb_km_per_degree = math.radians(1.0) * (EARTH_RADIUS_KM - CMB_DEPTH_KM)
    mega = []
    for name, study, code, group, circle, size, cite in MEGA_IN_DATABASE:
        outline = [p for label, points in named[(study, code)] if group is None or label == group for p in points]
        lon, lat, radius = centre_and_radius(outline)
        row = table[(study, code)]
        mega.append({"name": name, "lon": round(lon, 2), "lat": round(lat, 2),
                     "widthKm": round(2 * radius * cmb_km_per_degree, -1) if circle else None,
                     "heightKm": row["thickness"], "dVsPercent": row["dVs"], "size": size, "cite": cite})
    mega += [dict(entry) for entry in MEGA_FROM_PAPERS]

    for kind in KINDS:
        print(kind, {result: (len(out[kind][result]) // 2 if kind == "point" else len(out[kind][result])) for result in RESULTS}, file=sys.stderr)
    for entry in mega:
        print("  ", entry, file=sys.stderr)
    write_json(OUTPUT_DIR / "ulvz.json", {
        "source": "Yu, S. & Garnero, E.J. (2018), Geochem. Geophys. Geosyst. 19, 396-414, doi:10.1002/2017GC007281; "
                  "ULVZ Distribution Database from 54 studies v1.0.1, Zenodo, doi:10.5281/zenodo.1064217",
        "depthKm": CMB_DEPTH_KM,
        "quantumPerDegree": QUANTUM_PER_DEGREE,
        "studies": len(studies),
        "files": files,
        "points": out["point"],
        "lines": out["line"],
        "areas": out["area"],
        "mega": mega,
    })


if __name__ == "__main__":
    main()
