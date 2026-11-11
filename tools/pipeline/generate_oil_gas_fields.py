#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: oil and gas field outlines.

Writes app/public/geo/oil-gas-fields.png and oil-gas-fields.json from the
Oil and Gas Infrastructure Mapping database (OGIM) v3.0, layer
Oil_and_Natural_Gas_Fields: 17,742 outlines gathered from 16 public
sources by the Environmental Defense Fund and MethaneSAT.

    Omara, M., Gautam, R., O'Brien, M. et al. (2023), Developing a
    spatially explicit global oil and gas infrastructure database for
    characterizing methane emission sources at high resolution, Earth
    Syst. Sci. Data 15, 3761-3790, doi:10.5194/essd-15-3761-2023;
    OGIM v3.0, Zenodo record 22835235. CC BY 4.0.

What is left out, and why (each is counted in the JSON):
  - source 36, Italy's ministry map of "mining titles for exploration and
    production of hydrocarbons": exploration permits and production
    concessions, not the outlines of fields;
  - source 232, Mexico's "areas with resources": the same agency's
    reserve fields (233) are kept; these other areas are not said to be
    discovered fields.

The coverage is uneven, and the layer says so: in the United States only
the basins in the EIA's 2005 maps (the Rockies, the Appalachians, the
northern plains, Alaska, some of California; nothing in Texas, Oklahoma,
Kansas, Louisiana or the US Gulf of Mexico); no fields at all for China, Brazil, Venezuela,
Argentina, Colombia or Malaysia. The fields of the Gulf states, Iran,
Iraq, Nigeria, Australia and others come from one 2014 website, now
defunct (OGIM source 22); most of Russia's from a GIS forum thread whose
original author is unknown (source 181). The database is CC BY 4.0;
those upstream sources state no licence of their own.

The fluid is normalised from the free-text RESERVOIR_TYPE: oil, gas
(condensate is gas that condenses at the surface), oil and gas, or not
given. The picture (province_raster.py) holds that class in red and the
share of each pixel inside a field in blue; the JSON gives counts by
class and source, and labels for the largest fields the data names,
by area worked out from their outlines (the table's own AREA_KM2 is
-999 for all of Russia).

GeoPackage geometry is read with sqlite3 and struct: a small header,
then standard WKB.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_oil_gas_fields.py
"""

from __future__ import annotations

import math
import sqlite3
import struct
import sys
from collections import Counter

import numpy as np

import province_raster as raster
from generate_geo import OUTPUT_DIR, write_json
from ranged_fetch import ranged_fetch

OGIM_URL = "https://zenodo.org/api/records/22835235/files/OGIM_v3.0.gpkg/content"
OGIM_BYTES = 3_422_806_016
TABLE = "Oil_and_Natural_Gas_Fields"
LEFT_OUT = {"36": "Italy: exploration permits and production concessions, not fields",
            "232": "Mexico: 'areas with resources', not said to be discovered fields"}
FLUIDS = {"oil": 1, "gas": 2, "oil and gas": 3, "not given": 4}
OIL = {"OIL", "OIL FIELD", "OIL FIELDS"}
GAS = {"GAS", "GAS FIELD", "GAS FIELDS", "CONDENSATE", "CONDENSATE FIELD", "GAS/CONDENSATE"}
BOTH = {"OIL & GAS FIELDS", "OIL AND GAS", "OIL & GAS", "OIL/GAS", "OIL/CONDENSATE"}
NOT_GIVEN = {"N/A", "NAN", "RESERVES FIELDS", "AREAS WITH RESOURCES", "", None}
LABELS_PER_REGION = 3
# Well known, and named so in the data: labelled whatever their size. Ghawar, the largest oil field, is in the
# data only as its parts, two of which are here under their own names.
NAMED = ("PRUDHOE BAY", "BURGAN", "SAMOTLORSKOE", "SHEDGUM", "HARADH", "ROMASHKINSKOE AND SHUGUROVSKOE")
LABEL_MIN_KM2 = 300
# Pinned here rather than taken from province_raster's default: most fields are a few km across, and at 20 km
# pixels the picture would grow them past twice their area.
WIDTH, HEIGHT = 4096, 2048
OUT_PNG = OUTPUT_DIR / "oil-gas-fields.png"
OUT_JSON = OUTPUT_DIR / "oil-gas-fields.json"


def fluid(reservoir_type: str | None) -> str:
    text = (reservoir_type or "").strip().upper()
    if text in OIL:
        return "oil"
    if text in GAS:
        return "gas"
    if text in BOTH:
        return "oil and gas"
    if text in NOT_GIVEN:
        return "not given"
    raise ValueError(f"unknown reservoir type {reservoir_type!r}")


# --- GeoPackage geometry ------------------------------------------------------
ENVELOPE_DOUBLES = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}


def wkb_polygons(blob: bytes) -> list[list[raster.Ring]]:
    """The polygons (each a list of rings of (lon, lat), outer first) of a GeoPackage geometry blob."""
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry")
    flags = blob[3]
    if flags & 0b10000:
        return []  # empty geometry
    at = 8 + 8 * ENVELOPE_DOUBLES[(flags >> 1) & 0b111]
    polygons: list[list[raster.Ring]] = []

    def read(position: int) -> int:
        order = "<" if blob[position] == 1 else ">"
        kind = struct.unpack_from(order + "I", blob, position + 1)[0]
        position += 5
        base, dims = kind % 1000, 2 + (kind // 1000 in (1, 2)) + (kind // 1000 == 3) * 2
        if kind & 0x80000000 or kind & 0x40000000:
            raise ValueError("EWKB flags are not expected in a GeoPackage")
        if base == 3:
            rings = []
            (count,) = struct.unpack_from(order + "I", blob, position)
            position += 4
            for _ in range(count):
                (points,) = struct.unpack_from(order + "I", blob, position)
                position += 4
                xy = np.frombuffer(blob, dtype=order + "f8", count=points * dims, offset=position).reshape(points, dims)
                position += 8 * points * dims
                rings.append([(float(x), float(y)) for x, y in xy[:, :2]])
            polygons.append(rings)
            return position
        if base in (6, 7):
            (count,) = struct.unpack_from(order + "I", blob, position)
            position += 4
            for _ in range(count):
                position = read(position)
            return position
        raise ValueError(f"unexpected geometry type {kind}")

    read(at)
    return polygons


def oriented(polygon: list[raster.Ring]) -> list[raster.Ring]:
    """Outer ring clockwise and holes anticlockwise, as province_raster (shapefile order) expects."""
    out = []
    for i, ring in enumerate(polygon):
        if len(ring) < 3:
            continue
        clockwise = raster.signed_area(ring) < 0
        out.append(ring if clockwise == (i == 0) else ring[::-1])
    return out


def area_km2(polygons: list[list[raster.Ring]]) -> float:
    """Area on the sphere, the outer rings less their holes (equal-area by cos(latitude), fine at field size)."""
    total = 0.0
    for polygon in polygons:
        for i, ring in enumerate(polygon):
            if len(ring) < 3:
                continue
            lat = math.radians(sum(p[1] for p in ring) / len(ring))
            km2 = abs(raster.signed_area(raster.unwrapped(ring))) * 111.195**2 * math.cos(lat)
            total += km2 if i == 0 else -km2
    return total


def load() -> list[dict]:
    path = ranged_fetch(OGIM_URL, "oil-gas/OGIM_v3.0.gpkg", size=OGIM_BYTES)
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    columns = "geom, OGIM_ID, REGION, COUNTRY, STATE_PROV, SRC_REF_ID, NAME, RESERVOIR_TYPE, ON_OFFSHORE, AREA_KM2"
    fields = []
    for geom, ogim_id, region, country, state, source, name, reservoir, shore, table_km2 in db.execute(f"SELECT {columns} FROM {TABLE}"):
        polygons = [oriented(p) for p in wkb_polygons(geom)] if geom else []
        fields.append({
            "id": ogim_id, "region": region, "country": country, "state": state, "source": source,
            "name": None if name in (None, "", "N/A") else " ".join(name.split()),
            "fluid": fluid(reservoir), "shore": shore, "tableKm2": table_km2,
            "polygons": [p for p in polygons if p],
        })
    return fields


def label_point(polygons: list[list[raster.Ring]]) -> tuple[float, float]:
    """A point inside the largest polygon: its area centre if that is inside, else the vertex nearest it."""
    largest = max(polygons, key=lambda p: area_km2([p]))
    lon, lat, _ = raster.area_centroid([[largest[0]]])
    ring = raster.unwrapped(largest[0])
    if inside(lon, lat, ring) or inside(lon + 360, lat, ring) or inside(lon - 360, lat, ring):
        return lon, lat
    nearest = min(ring, key=lambda p: (p[0] - lon) ** 2 + (p[1] - lat) ** 2)
    return ((nearest[0] + 180) % 360) - 180, nearest[1]


def inside(lon: float, lat: float, ring: raster.Ring) -> bool:
    crossings = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > lat) != (y1 > lat) and lon < x0 + (lat - y0) * (x1 - x0) / (y1 - y0):
            crossings = not crossings
    return crossings


def main() -> None:
    every = load()
    raster.WIDTH, raster.HEIGHT = WIDTH, HEIGHT
    kept = [f for f in every if f["source"] not in LEFT_OUT and f["polygons"]]
    for field in kept:
        field["km2"] = area_km2(field["polygons"])
    # Shapes with holes first (drawing a hole clears what lies under it), then smallest last, so a small field
    # inside a large one stays visible.
    shapes = [(polygon, FLUIDS[f["fluid"]]) for f in sorted(kept, key=lambda f: (not any(len(p) > 1 for p in f["polygons"]), -f["km2"]))
              for polygon in f["polygons"]]
    picture = raster.bake(shapes, outlines=False)
    raster.save_png(picture, OUT_PNG)
    print(f"  {OUT_PNG.name}: {OUT_PNG.stat().st_size / 1024:.0f} KiB", file=sys.stderr)

    by_region: dict[str, list[dict]] = {}
    for field in kept:
        if field["name"] and field["km2"] >= LABEL_MIN_KM2:
            by_region.setdefault(field["region"] or "", []).append(field)
    labels = []
    for region, fields in sorted(by_region.items()):
        for field in sorted(fields, key=lambda f: -f["km2"])[:LABELS_PER_REGION]:
            lon, lat = label_point(field["polygons"])
            labels.append({"name": field["name"], "country": field["country"], "region": region, "fluid": field["fluid"],
                           "km2": round(field["km2"]), "lon": round(lon, 3), "lat": round(lat, 3), "source": field["source"]})
    labelled = {label["name"] for label in labels}
    for name in NAMED:
        matches = [f for f in kept if f["name"] == name]
        if not matches:
            raise ValueError(f"{name} is not in the data")
        field = max(matches, key=lambda f: f["km2"])
        if name in labelled:
            continue
        lon, lat = label_point(field["polygons"])
        labels.append({"name": name, "country": field["country"], "region": field["region"], "fluid": field["fluid"],
                       "km2": round(field["km2"]), "lon": round(lon, 3), "lat": round(lat, 3), "source": field["source"]})
    covered = float((picture[..., 2].astype(np.float64) / 255 * raster.cell_areas()).sum())
    write_json(OUT_JSON, {
        "source": "OGIM v3.0 (EDF / MethaneSAT), Oil_and_Natural_Gas_Fields; CC BY 4.0",
        "classes": {str(v): k for k, v in FLUIDS.items()},
        "records": len(every),
        "drawn": len(kept),
        "leftOut": {source: {"why": why, "records": sum(1 for f in every if f["source"] == source)} for source, why in LEFT_OUT.items()},
        "noGeometry": sum(1 for f in every if not f["polygons"] and f["source"] not in LEFT_OUT),
        "fluids": dict(Counter(f["fluid"] for f in kept)),
        "countries": dict(Counter(f["country"] for f in kept).most_common()),
        "sources": dict(Counter(f["source"] for f in kept).most_common()),
        "areaKm2": round(sum(f["km2"] for f in kept)),
        "sphereShare": round(covered, 6),
        "labels": labels,
    })
    print(f"  {len(kept)} of {len(every)} fields drawn, {len(labels)} labels", file=sys.stderr)


if __name__ == "__main__":
    main()
