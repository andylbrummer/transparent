#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: subducting slabs and earthquakes at depth.

Writes what the app draws inside the see-through Earth, below the surface:

    app/public/geo/slabs.json   Slab2 depth contours of every subducting slab,
                                every SLAB_CONTOUR_STEP_KM down to 700 km
    app/public/geo/quakes.json  every M >= MIN_MAGNITUDE earthquake since
                                CATALOG_START, at its hypocentre, plus labels
                                for the great (M >= LABEL_MAGNITUDE) ones

Sources (see app/public/geo/ATTRIBUTION.md), both public domain (USGS):

    Slabs        Hayes et al. (2018) Slab2, a comprehensive subduction zone
                 geometry model, Science 362, 58. doi:10.1126/science.aat4723.
                 ScienceBase item 5aa1b00ee4b0b1c392e86467.
    Earthquakes  USGS ANSS Comprehensive Catalog (ComCat), via the FDSN
                 event web service.

slabs.json uses the delta polyline encoding of outlines.json (see
generate_geo.py), grouped by contour depth. Slab2 longitudes run 0-360 and
are kept so, which keeps contours crossing the antimeridian continuous.

quakes.json is columnar, sorted by ascending magnitude so the app draws the
largest events last, on top: lon and lat in quanta (1/quantumPerDegree
degrees), depthKm rounded to whole km, magnitude10 = magnitude * 10.

Usage:
    python3 tools/pipeline/generate_seismicity.py [--source-dir DIR]

--source-dir reads already-downloaded files instead of fetching:
    Slab2_CONTOURS/*_dep_*_contours.in  (from Slab2Distribute_Mar2018.tar.gz)
    usgs_quakes.csv                     (FDSN csv, one header, any year order)
Requires only the Python standard library.
"""

import argparse
import csv
import io
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, write_json
from generate_geology import simplify

SLAB2_URL = ("https://www.sciencebase.gov/catalog/file/get/5aa1b00ee4b0b1c392e86467"
             "?f=__disk__d5%2F91%2F39%2Fd591399bf4f249ab49ffec8a366e5070fe96e0ba")
FDSN_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"

# A contour every 40 km reads as a surface through the planet; Slab2's 20 km
# spacing only doubles the line count without showing more shape.
SLAB_CONTOUR_STEP_KM = 40
SLAB_SIMPLIFY_QUANTA = 2

# M5 is complete worldwide since the early 1970s and already outlines every
# Wadati-Benioff zone; M4.5 would triple the file for the same picture.
MIN_MAGNITUDE = 5.0
CATALOG_START_YEAR = 1973
# Fixed end, so a rerun reproduces the same file.
CATALOG_END = "2026-11-01"
LABEL_MAGNITUDE = 8.0
# The FDSN service caps one response at 20000 events; a year of M5+ is ~1700.
FETCH_YEARS_PER_REQUEST = 5

SLAB_CONTOUR_FILE = re.compile(r"(?:^|/)([a-z]{3})_slab2_dep_[0-9.]+_contours\.in$")


def fetch_bytes(url: str) -> bytes:
    print(f"fetching {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=600) as response:
        return response.read()


def load_slab_contours(source_dir: Path | None) -> dict[str, str]:
    """Slab2 depth-contour files by three-letter slab code."""
    if source_dir is not None:
        files = sorted((source_dir / "Slab2_CONTOURS").glob("*_dep_*_contours.in"))
        if not files:
            raise FileNotFoundError(f"no Slab2 depth contours under {source_dir / 'Slab2_CONTOURS'}")
        return {SLAB_CONTOUR_FILE.search(f.name).group(1): f.read_text(encoding="utf-8") for f in files}
    contours = {}
    with tarfile.open(fileobj=io.BytesIO(fetch_bytes(SLAB2_URL)), mode="r:gz") as archive:
        for member in archive.getmembers():
            match = SLAB_CONTOUR_FILE.search(member.name)
            if match and "/Slab2_CONTOURS/" in member.name:
                contours[match.group(1)] = archive.extractfile(member).read().decode("utf-8")
    if not contours:
        raise ValueError("Slab2 archive carried no depth contours")
    return contours


def load_quake_rows(source_dir: Path | None) -> list[dict]:
    if source_dir is not None:
        return list(csv.DictReader((source_dir / "usgs_quakes.csv").read_text(encoding="utf-8").splitlines()))
    rows = []
    end_year = int(CATALOG_END[:4])
    for start in range(CATALOG_START_YEAR, end_year + 1, FETCH_YEARS_PER_REQUEST):
        stop = min(start + FETCH_YEARS_PER_REQUEST, end_year + 1)
        stop_date = CATALOG_END if stop > end_year else f"{stop}-01-01"
        url = (f"{FDSN_URL}?format=csv&orderby=time-asc&minmagnitude={MIN_MAGNITUDE}"
               f"&starttime={start}-01-01&endtime={stop_date}")
        chunk = list(csv.DictReader(fetch_bytes(url).decode("utf-8").splitlines()))
        if len(chunk) >= 20000:
            raise ValueError(f"{url} hit the 20000-event cap; shorten FETCH_YEARS_PER_REQUEST")
        rows += chunk
    return rows


def parse_slab_contours(text: str) -> list[tuple[int, list[list[float]]]]:
    """(depth km, [[lon, lat], ...]) per contour line of one Slab2 file."""
    lines: list[tuple[int, list[list[float]]]] = []
    for raw in text.splitlines():
        if raw.startswith(">"):
            lines.append((round(-float(raw.split()[1])), []))
        elif raw.strip():
            lon, lat, _depth = raw.split()
            lines[-1][1].append([float(lon), float(lat)])
    return lines


def build_slabs(contour_files: dict[str, str]) -> list[dict]:
    """Contours grouped by depth, shallowest first, simplified and delta-encoded."""
    by_depth: dict[int, list[list[int]]] = {}
    for code in sorted(contour_files):
        for depth, points in parse_slab_contours(contour_files[code]):
            if depth <= 0 or depth % SLAB_CONTOUR_STEP_KM:
                continue
            quantized = [(round(lon * QUANTUM_PER_DEG), round(lat * QUANTUM_PER_DEG)) for lon, lat in points]
            kept = simplify(quantized, SLAB_SIMPLIFY_QUANTA)
            if len(kept) < 2:
                continue
            encoded = [kept[0][0], kept[0][1]]
            for (lon0, lat0), (lon1, lat1) in zip(kept, kept[1:]):
                encoded += [lon1 - lon0, lat1 - lat0]
            by_depth.setdefault(depth, []).append(encoded)
    return [{"depthKm": depth, "polylines": by_depth[depth]} for depth in sorted(by_depth)]


def quake_region(place: str) -> str:
    """'near the east coast of Honshu, Japan' -> 'Japan'; named events lose
    their year and 'Earthquake': '2004 Sumatra - Andaman Islands Earthquake'
    -> 'Sumatra - Andaman Islands'."""
    if not place:
        return "unlocated"
    region = place.rsplit(",", 1)[-1].strip()
    return re.sub(r"^\d{4} | Earthquake$", "", region)


def build_quakes(rows: list[dict]) -> tuple[dict, list[dict]]:
    events = []
    seen = set()
    for row in rows:
        # ComCat also lists explosions and quarry blasts at M5+.
        if row.get("type") != "earthquake" or not row.get("mag") or not row.get("depth"):
            continue
        key = row["id"]
        if key in seen:  # chunk edges can repeat an event
            continue
        seen.add(key)
        events.append({
            "lon": float(row["longitude"]),
            "lat": float(row["latitude"]),
            "depth": max(0.0, float(row["depth"])),
            "mag": float(row["mag"]),
            "year": row["time"][:4],
            "place": row.get("place") or "",
        })
    events.sort(key=lambda e: (e["mag"], e["year"]))
    columns = {
        "lon": [round(e["lon"] * QUANTUM_PER_DEG) for e in events],
        "lat": [round(e["lat"] * QUANTUM_PER_DEG) for e in events],
        "depthKm": [round(e["depth"]) for e in events],
        "magnitude10": [round(e["mag"] * 10) for e in events],
    }
    great = [e for e in events if e["mag"] >= LABEL_MAGNITUDE]
    labels = [{"kind": "quake", "name": f"M{e['mag']:.1f} {quake_region(e['place'])} {e['year']}",
               "lon": round(e["lon"], 2), "lat": round(e["lat"], 2), "depthKm": round(e["depth"]),
               "priority": round(10 - e["mag"], 2)} for e in reversed(great)]
    return columns, labels


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--source-dir", type=Path, help="read source files from here instead of fetching")
    args = parser.parse_args()

    slabs = build_slabs(load_slab_contours(args.source_dir))
    print(f"slab contours: {sum(len(c['polylines']) for c in slabs)} polylines, "
          f"{sum(len(p) // 2 for c in slabs for p in c['polylines'])} points", file=sys.stderr)
    columns, labels = build_quakes(load_quake_rows(args.source_dir))
    print(f"quakes: {len(columns['lon'])}, labelled: {len(labels)}", file=sys.stderr)

    write_json(OUTPUT_DIR / "slabs.json", {
        "source": "Hayes et al. (2018) Slab2, USGS, public domain. See ATTRIBUTION.md.",
        "encoding": "delta",
        "quantumPerDegree": QUANTUM_PER_DEG,
        "contours": slabs,
    })
    write_json(OUTPUT_DIR / "quakes.json", {
        "source": f"USGS ANSS ComCat, M>={MIN_MAGNITUDE} {CATALOG_START_YEAR} to {CATALOG_END}, public domain. "
                  "See ATTRIBUTION.md.",
        "quantumPerDegree": QUANTUM_PER_DEG,
        **columns,
        "labels": labels,
    })


if __name__ == "__main__":
    main()
