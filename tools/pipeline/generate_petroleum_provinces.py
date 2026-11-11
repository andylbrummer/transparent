#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the world's petroleum provinces.

Writes app/public/geo/petroleum-provinces.png and petroleum-provinces.json:
the 1,023 geologic provinces the USGS drew for its World Petroleum
Assessment 2000, and, for the provinces whose oil and gas it assessed,
the main commodity and the volumes it reported.

    U.S. Geological Survey World Energy Assessment Team (2000), U.S.
    Geological Survey World Petroleum Assessment 2000 - Description and
    Results, USGS Digital Data Series DDS-60; shapefile "Geologic
    Provinces of the World, 2000 World Petroleum Assessment, all defined
    provinces" (Osmonson, Persits, Steinshouer & Klett), ScienceBase item
    60ad2fd7d34e4043c850edb3. Public domain (U.S. Government work; the
    metadata's use constraints: "None.").

The picture (province_raster.py) holds a class in red - 1 a province
that was not assessed, 2 one assessed as mainly oil, 3 mainly gas, 4
assessed with no main commodity given ("NA") - the outlines of every
province in green, and coverage in blue. The JSON gives the counts, and
labels for the provinces with the most oil and gas found by 2000.

Known volumes are those of the USGS's own tables: discovered petroleum
(oil, gas and gas liquids as barrels of oil equivalent), cumulative
production plus remaining reserves, as of the assessment. They are not
today's figures.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_petroleum_provinces.py
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import province_raster as raster
from generate_oil_gas_fields import label_point
from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, write_json

PROVINCES_URL = "https://www.sciencebase.gov/catalog/file/get/60ad2fd7d34e4043c850edb3"
MEMBERS = ("WEP_PRVG/WEP_PRVG.SHP", "WEP_PRVG/WEP_PRVG.DBF", "WEP_PRVG/WEP_PRVG.prj")
CLASSES = {"": 1, "Oil": 2, "Gas": 3, "NA": 4}
LABELS = 14
# Pinned here rather than taken from province_raster's default: provinces are hundreds of km across.
WIDTH, HEIGHT = 2048, 1024
OUT_PNG = OUTPUT_DIR / "petroleum-provinces.png"
OUT_JSON = OUTPUT_DIR / "petroleum-provinces.json"


def members() -> Path:
    """The shapefile's parts, unpacked into their own cache folder."""
    archive = cached_fetch(PROVINCES_URL, "oil-gas/wpa2000-provinces.zip")
    folder = CACHE_DIR / "oil-gas" / "wep_prvg"
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for name in MEMBERS:
            target = folder / Path(name).name
            if not target.exists():
                target.write_bytes(z.read(name))
    if "WGS_1984" not in (folder / "WEP_PRVG.prj").read_text():
        raise ValueError("expected longitude and latitude on WGS 84")
    return folder


def load() -> list[tuple[dict[str, str], list[raster.Ring]]]:
    folder = members()
    rows = raster.read_dbf(folder / "WEP_PRVG.DBF")
    shapes = raster.read_polygon_records(folder / "WEP_PRVG.SHP")
    if len(rows) != len(shapes):
        raise ValueError(f"{len(rows)} records but {len(shapes)} shapes")
    return list(zip(rows, shapes))


def has_hole(rings: list[raster.Ring]) -> bool:
    return any(len(ring) >= 3 and raster.signed_area(ring) > 0 for ring in rings)


def volume(row: dict[str, str], key: str) -> float | None:
    """A volume from the table, or None for its no-data value (-9999) or a blank."""
    try:
        value = float(row[key])
    except ValueError:
        return None
    return None if value <= -9999 else value


def main() -> None:
    raster.WIDTH, raster.HEIGHT = WIDTH, HEIGHT
    provinces = load()
    unknown = {row["O_G"] for row, _ in provinces} - set(CLASSES)
    if unknown:
        raise ValueError(f"unexpected commodity codes {unknown}")
    # Shapes with holes first: drawing a hole clears whatever lies under it, which must not be another province
    # (the Canadian Shield's hole would wipe out Hudson Bay). Then assessed provinces last, so they show where two overlap.
    order = sorted(provinces, key=lambda p: (not has_hole(p[1]), CLASSES[p[0]["O_G"]] > 1))
    picture = raster.bake([(rings, CLASSES[row["O_G"]]) for row, rings in order])
    raster.save_png(picture, OUT_PNG)
    print(f"  {OUT_PNG.name}: {OUT_PNG.stat().st_size / 1024:.0f} KiB", file=sys.stderr)

    # The same province can be several records (its separate parts): grouped by code.
    by_code: dict[str, list[tuple[dict[str, str], list[raster.Ring]]]] = {}
    for row, rings in provinces:
        by_code.setdefault(row["CODE"], []).append((row, rings))
    labelled = []
    for code, parts in by_code.items():
        row = parts[0][0]
        known = volume(row, "KWN_PET")
        if row["O_G"] in ("Oil", "Gas") and known is not None and known > 0:
            _, _, km2 = raster.area_centroid([rings for _, rings in parts])
            # Inside the province: an arc such as the Zagros has its area centre outside it.
            outers = [[ring] for _, rings in parts for ring in rings if len(ring) >= 3 and raster.signed_area(ring) < 0]
            lon, lat = label_point(outers)
            labelled.append({
                "code": code, "name": row["NAME"], "commodity": row["O_G"].lower(),
                "lon": round(lon, 2), "lat": round(lat, 2), "areaKm2": round(km2),
                "knownMmboe": round(known), "undiscoveredMmboe": round(volume(row, "UNDS_PET") or 0),
            })
    labelled.sort(key=lambda p: -p["knownMmboe"])
    counts = {name or "not assessed": sum(1 for row, _ in provinces if row["O_G"] == name) for name in CLASSES}
    write_json(OUT_JSON, {
        "source": "USGS World Petroleum Assessment 2000 (DDS-60), geologic provinces; public domain",
        "classes": {"1": "not assessed", "2": "oil", "3": "gas", "4": "assessed, no main commodity given"},
        "records": len(provinces),
        "provinces": len(by_code),
        "counts": counts,
        "labels": labelled[:LABELS],
    })
    print(f"  {len(provinces)} records, {len(by_code)} provinces, {counts}", file=sys.stderr)


if __name__ == "__main__":
    main()
