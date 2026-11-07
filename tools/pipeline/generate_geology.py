#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: tectonics and geology labels.

Writes the line and label data the app draws through the see-through Earth:

    app/public/geo/tectonics.json  plate boundaries by kind, and active faults
    app/public/geo/geology.json    plates, deep-Earth structures, hotspots,
                                   subduction zones and volcanoes, plus the
                                   plume conduit under each classified hotspot

Sources (attribution required where noted, see app/public/geo/ATTRIBUTION.md):

    Plate boundaries, plates  Bird (2003) PB2002, doi:10.1029/2001GC000252,
                              as converted by Ahlenius/Nordpil (fraxen/tectonicplates).
                              Open Data Commons Attribution 1.0.
    Active faults             GEM Global Active Faults Database (Styron & Pagani 2020,
                              doi:10.1177/8755293020944182). CC BY-SA 4.0, so the
                              fault layers of tectonics.json are CC BY-SA 4.0 too.
    Hotspots                  Whittaker et al. (2015), doi:10.1038/ngeo2437, via
                              EarthByte. CC BY 3.0.
    Volcanoes                 NOAA NCEI Volcano Locations Database. Public domain.
    Deep structures           Curated below from the cited literature. Centres are
                              approximate (several degrees): these are broad
                              structures, not points.

Lines use the same delta encoding as outlines.json (see generate_geo.py).
Labels are sorted by kind, then priority (lower = more important).

Faults are drawn but not named: GEM's names are local segment names
("Wellington Hutt Valley 3"), and major faults such as the North Anatolian
carry none. Subduction zones are named by the two plates PB2002 puts on
either side, without claiming which one descends.

Usage:
    python3 tools/pipeline/generate_geology.py [--source-dir DIR]

--source-dir reads already-downloaded files instead of fetching:
    pb2002_steps.json, pb2002_plates.json, gem_active_faults.geojson,
    ncei_volcanoes.json (the API's items list), hotspots.gpmlz
Requires only the Python standard library.
"""

import argparse
import gzip
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, encode_polyline, write_json

PB2002_BASE = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON"
GEM_URL = (
    "https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/"
    "geojson/gem_active_faults_harmonized.geojson"
)
NCEI_VOLCANO_URL = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/volcanolocs"
HOTSPOTS_URL = "https://www.earthbyte.org/webdav/ftp/earthbyte/GPlates/GPlates2.3_GeoData/Individual/Hotspots.zip"

# PB2002 step classes -> boundary layers.
BOUNDARY_CLASSES = {
    "SUB": "subduction",
    "OSR": "ridge",  # oceanic spreading ridge
    "CRB": "ridge",  # continental rift
    "OTF": "transform",
    "CTF": "transform",
    "OCB": "collision",  # oceanic convergent, no subduction
    "CCB": "collision",  # continental collision
}
BOUNDARY_LAYERS = ["ridge", "transform", "collision", "subduction"]
FAULT_LAYERS = ["fault-normal", "fault-reverse", "fault-strike-slip"]

# Fault traces simplified to within this many quanta (0.02°, ~2 km): finer
# detail is sub-pixel from anywhere but the fault itself.
FAULT_SIMPLIFY_QUANTA = 2

# NCEI last-eruption codes, most recent first: D1 = 1964 or later ... D7 = BC.
ERUPTION_RANK = {"D1": 1, "D2": 2, "D3": 3, "D4": 4, "D5": 5, "D6": 6, "D7": 7}
UNDATED_RANK = 8

# How deep tomography traces each plume class (Whittaker et al. 2015, after
# Montelli et al. 2006 and Courtillot et al. 2003), as conduit extents in km:
# (depth the class is imaged to, depth it may reach). Secondary/tertiary and
# unclassified hotspots get no conduit: the catalogue makes no depth claim.
CMB_DEPTH_KM = 2891  # PREM core-mantle boundary, 6371 - 3480
PLUME_EXTENT_KM = {
    "Deep": (CMB_DEPTH_KM, None),
    "Potentially Deep": (1000, CMB_DEPTH_KM),
    "mid-mantle": (1000, None),
    "upper mantle": (660, None),
}
# French & Romanowicz (2015) Nature 525, 95 image Hawaii's plume as a broad
# conduit rooted at the core-mantle boundary; Montelli et al. (2006) did not
# resolve it below the mid-mantle.
PLUME_TYPE_OVERRIDES = {"Hawaii": "Deep"}
# Deep plumes whose root has been imaged off-axis end at that root, so the
# conduit leans the way the plume does.
PLUME_ROOTS = {"Hawaii": "Hawaiian mega-ULVZ", "Iceland": "Iceland ULVZ"}

HOTSPOT_RANK = {"Deep": 1, "Potentially Deep": 2, "mid-mantle": 3, "upper mantle": 4, "Secondary/Tertiary": 5}
UNKNOWN_PLUME_RANK = 6

# Deep-Earth structures. Centres are approximate; depth is where the label
# sits, in km below the surface. Priority orders them for declutter.
DEEP_STRUCTURES = [
    # Large low-shear-velocity provinces; names from Burke (2011), extent from
    # Garnero, McNamara & Shim (2016) Nature Geoscience 9, 481.
    {"name": "Tuzo (African LLSVP)", "lat": -15.0, "lon": 15.0, "depthKm": 2600, "priority": 1},
    {"name": "Jason (Pacific LLSVP)", "lat": -10.0, "lon": -155.0, "depthKm": 2600, "priority": 1},
    # Lynner & Long (2014) GRL 41, 3447.
    {"name": "Perm Anomaly", "lat": 58.0, "lon": 52.0, "depthKm": 2700, "priority": 3},
    # Sunken slabs: Grand (1994) JGR 99, 11591; van der Meer et al. (2018)
    # Tectonophysics 723, 309 (Atlas of the Underworld).
    {"name": "Farallon slab", "lat": 35.0, "lon": -80.0, "depthKm": 1500, "priority": 2},
    {"name": "Tethyan slabs", "lat": 15.0, "lon": 78.0, "depthKm": 1400, "priority": 2},
    # Fukao, Obayashi & Nakakuki (2009) Annu. Rev. Earth Planet. Sci. 37, 19.
    {"name": "Stagnant Pacific slab", "lat": 40.0, "lon": 125.0, "depthKm": 600, "priority": 3},
    # Ultra-low velocity zones at the core-mantle boundary: Cottaar &
    # Romanowicz (2012) EPSL 355, 213; Yuan & Romanowicz (2017) Science 357, 393.
    {"name": "Hawaiian mega-ULVZ", "lat": 20.0, "lon": -162.0, "depthKm": 2880, "priority": 3},
    {"name": "Iceland ULVZ", "lat": 63.0, "lon": -20.0, "depthKm": 2880, "priority": 3},
]

LABEL_KIND_ORDER = ["plate", "deep", "hotspot", "subduction", "volcano"]


def fetch_json(url: str):
    print(f"fetching {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=180) as response:
        return json.load(response)


def fetch_bytes(url: str) -> bytes:
    print(f"fetching {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=180) as response:
        return response.read()


def load_sources(source_dir: Path | None) -> dict:
    if source_dir is not None:
        return {
            "steps": json.loads((source_dir / "pb2002_steps.json").read_text(encoding="utf-8")),
            "plates": json.loads((source_dir / "pb2002_plates.json").read_text(encoding="utf-8")),
            "faults": json.loads((source_dir / "gem_active_faults.geojson").read_text(encoding="utf-8")),
            "volcanoes": json.loads((source_dir / "ncei_volcanoes.json").read_text(encoding="utf-8")),
            "hotspots": gzip.decompress((source_dir / "hotspots.gpmlz").read_bytes()).decode("utf-8"),
        }
    import io
    import zipfile

    volcanoes = []
    page = 1
    while True:
        result = fetch_json(f"{NCEI_VOLCANO_URL}?itemsPerPage=200&page={page}")
        volcanoes += result["items"]
        if page >= result["totalPages"]:
            break
        page += 1
    if len(volcanoes) != result["totalItems"]:
        raise ValueError(f"NCEI returned {len(volcanoes)} volcanoes, expected {result['totalItems']}")
    with zipfile.ZipFile(io.BytesIO(fetch_bytes(HOTSPOTS_URL))) as archive:
        gpmlz = archive.read("Hotspots/Hotspots_Compilation_Whittaker_etal.gpmlz")
    return {
        "steps": fetch_json(f"{PB2002_BASE}/PB2002_steps.json"),
        "plates": fetch_json(f"{PB2002_BASE}/PB2002_plates.json"),
        "faults": fetch_json(GEM_URL),
        "volcanoes": volcanoes,
        "hotspots": gzip.decompress(gpmlz).decode("utf-8"),
    }


def simplify(points: list[tuple[int, int]], tolerance: float) -> list[tuple[int, int]]:
    """Douglas-Peucker on quantized lon/lat, keeping endpoints."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (x0, y0), (x1, y1) = points[start], points[end]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        best, best_i = -1.0, -1
        for i in range(start + 1, end):
            px, py = points[i]
            d = abs(dy * (px - x0) - dx * (py - y0)) / length if length else math.hypot(px - x0, py - y0)
            if d > best:
                best, best_i = d, i
        if best > tolerance:
            keep[best_i] = True
            stack += [(start, best_i), (best_i, end)]
    return [p for p, k in zip(points, keep) if k]


def quantize(coords: list[list[float]]) -> list[tuple[int, int]]:
    return [(round(lon * QUANTUM_PER_DEG), round(lat * QUANTUM_PER_DEG)) for lon, lat, *_ in coords]


def to_degrees(points: list[tuple[int, int]]) -> list[list[float]]:
    return [[x / QUANTUM_PER_DEG, y / QUANTUM_PER_DEG] for x, y in points]


def build_boundaries(steps: dict) -> tuple[dict[str, list[list[int]]], list[tuple[str, list[list[float]]]]]:
    """
    Chain PB2002 steps into polylines per boundary kind. Also returns, per
    plate pair (in either order, as PB2002 names both), the boundary name
    and its longest subduction polyline, where the pair's label goes.
    """
    layers: dict[str, list[list[int]]] = {name: [] for name in BOUNDARY_LAYERS}
    longest_subduction: dict[tuple[str, str], tuple[str, list[list[float]]]] = {}
    ordered = sorted(steps["features"], key=lambda f: f["properties"]["SEQNUM"])

    def flush(points: list[list[float]], layer: str, pair: str) -> None:
        encoded = encode_polyline(points)
        if encoded is None:
            return
        layers[layer].append(encoded)
        if layer != "subduction":
            return
        key = tuple(sorted(plate_pair_codes(pair)))
        if len(points) > len(longest_subduction.get(key, ("", []))[1]):
            longest_subduction[key] = (pair, points)

    current: list[list[float]] = []
    current_key = None
    for feature in ordered:
        props = feature["properties"]
        key = (BOUNDARY_CLASSES[props["STEPCLASS"]], props["PLATEBOUND"])
        start = [props["STARTLONG"], props["STARTLAT"]]
        end = [props["FINALLONG"], props["FINALLAT"]]
        if current and key == current_key and current[-1] == start:
            current.append(end)
            continue
        if current:
            flush(current, *current_key)
        current, current_key = [start, end], key
    if current:
        flush(current, *current_key)
    return layers, list(longest_subduction.values())


def plate_pair_codes(boundary: str) -> tuple[str, str]:
    """PB2002 names a boundary by its plates, e.g. 'PA-PS' or 'NA\\PA'."""
    codes = re.split(r"[-/\\]", boundary)
    if len(codes) != 2:
        raise ValueError(f"unexpected PB2002 boundary name {boundary!r}")
    return codes[0], codes[1]


def build_subduction_labels(longest: list[tuple[str, list[list[float]]]], names_by_code: dict[str, str]) -> list[dict]:
    """One label per plate pair, at the middle of its longest subduction run; longest first."""
    labels = []
    for boundary, points in longest:
        a, b = plate_pair_codes(boundary)
        lon, lat = points[len(points) // 2]
        labels.append({"kind": "subduction", "name": f"{names_by_code[a]}–{names_by_code[b]} subduction",
                       "lon": round(lon, 2), "lat": round(lat, 2), "length": len(points)})
    labels.sort(key=lambda label: -label["length"])
    for rank, label in enumerate(labels):
        del label["length"]
        label["priority"] = rank
    return labels


def fault_layer(slip_type: str | None) -> str | None:
    """Mechanism layer for a GEM slip type; None for traces drawn elsewhere or not faults."""
    if not slip_type:
        return None
    if slip_type.endswith("_Transform") or slip_type in ("Spreading_Ridge", "Subduction_Thrust"):
        return None  # oceanic plate boundaries: PB2002 draws these
    if slip_type.startswith("Normal"):
        return "fault-normal"
    if slip_type.startswith("Reverse") or slip_type == "Blind Thrust":
        return "fault-reverse"
    if slip_type.startswith(("Dextral", "Sinistral", "Strike-Slip")):
        return "fault-strike-slip"
    return None  # Anticline, Syncline: folds, not faults


def build_faults(faults: dict) -> dict[str, list[list[int]]]:
    layers: dict[str, list[list[int]]] = {name: [] for name in FAULT_LAYERS}
    skipped = 0
    for feature in faults["features"]:
        props = feature["properties"]
        layer = fault_layer(props.get("slip_type"))
        if layer is None:
            skipped += 1
            continue
        points = simplify(quantize(feature["geometry"]["coordinates"]), FAULT_SIMPLIFY_QUANTA)
        encoded = encode_polyline(to_degrees(points))
        if encoded is None:
            continue
        layers[layer].append(encoded)
    print(f"faults: skipped {skipped} traces (oceanic boundaries, folds, untyped)", file=sys.stderr)
    return layers


def unit_vector(lon: float, lat: float) -> tuple[float, float, float]:
    lo, la = math.radians(lon), math.radians(lat)
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def plate_names(plates: dict) -> dict[str, str]:
    return {f["properties"]["Code"]: f["properties"]["PlateName"] for f in plates["features"]}


def build_plate_labels(plates: dict) -> list[dict]:
    """One label per plate at its area-weighted centroid; bigger plates first."""
    sums: dict[str, list] = {}
    for feature in plates["features"]:
        props = feature["properties"]
        entry = sums.setdefault(props["Code"], [props["PlateName"], 0.0, 0.0, 0.0, 0.0])
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for ring in (polygon[0] for polygon in polygons):  # outer rings; PB2002 plates have no holes
            # Fan triangles weighted by signed area; the ring's winding sets
            # the overall sign, which is normalised away per ring.
            ring_sum = [0.0, 0.0, 0.0, 0.0]
            p0 = unit_vector(*ring[0][:2])
            for a, b in zip(ring[1:], ring[2:]):
                p1, p2 = unit_vector(*a[:2]), unit_vector(*b[:2])
                cross = (p1[1] * p2[2] - p1[2] * p2[1], p1[2] * p2[0] - p1[0] * p2[2], p1[0] * p2[1] - p1[1] * p2[0])
                weight = (p0[0] * cross[0] + p0[1] * cross[1] + p0[2] * cross[2]) / 2
                for k in range(3):
                    ring_sum[k] += weight * (p0[k] + p1[k] + p2[k]) / 3
                ring_sum[3] += weight
            sign = 1.0 if ring_sum[3] >= 0 else -1.0
            for k in range(4):
                entry[1 + k] += sign * ring_sum[k]
    labels = []
    for code, (name, x, y, z, area) in sums.items():
        norm = math.sqrt(x * x + y * y + z * z)
        if norm == 0:
            raise ValueError(f"plate {code}: degenerate centroid")
        x, y, z = x / norm, y / norm, z / norm
        labels.append({"kind": "plate", "name": f"{name} plate", "lon": round(math.degrees(math.atan2(y, x)), 2),
                       "lat": round(math.degrees(math.asin(z)), 2), "area": abs(area)})
    labels.sort(key=lambda label: -label["area"])
    for rank, label in enumerate(labels):
        del label["area"]
        label["priority"] = rank
    return labels


def parse_hotspots(gpml: str) -> list[dict]:
    """name, lon, lat and plume class of each Whittaker hotspot."""
    hotspots = []
    for member in gpml.split("<gml:featureMember>")[1:]:
        attrs = dict(re.findall(
            r"<gpml:key>(.*?)</gpml:key>\s*<gpml:valueType[^>]*>[^<]*</gpml:valueType>\s*<gpml:value>(.*?)</gpml:value>",
            member))
        pos = re.search(r"<gml:pos>\s*([-0-9.eE]+)\s+([-0-9.eE]+)\s*</gml:pos>", member)
        if not pos or "HotspotNam" not in attrs:
            raise ValueError("hotspot feature without a name or position")
        name = attrs["HotspotNam"].replace("_", " ")
        hotspots.append({"name": name, "lat": float(pos.group(1)), "lon": float(pos.group(2)),
                         "plumeType": PLUME_TYPE_OVERRIDES.get(name, attrs.get("PlumeType"))})
    return hotspots


def build_hotspot_labels(hotspots: list[dict]) -> list[dict]:
    return [{"kind": "hotspot", "name": h["name"], "lon": round(h["lon"], 2), "lat": round(h["lat"], 2),
             "priority": HOTSPOT_RANK.get(h["plumeType"], UNKNOWN_PLUME_RANK)} for h in hotspots]


def build_plumes(hotspots: list[dict]) -> list[dict]:
    """Plume conduits: from the hotspot down to the depth its class is imaged
    to (depthKm), and on to possibleDepthKm where the class may reach deeper."""
    roots = {s["name"]: s for s in DEEP_STRUCTURES}
    plumes = []
    for h in hotspots:
        extent = PLUME_EXTENT_KM.get(h["plumeType"])
        if extent is None:
            continue
        depth, possible = extent
        root = roots[PLUME_ROOTS[h["name"]]] if h["name"] in PLUME_ROOTS else h
        plume = {"name": h["name"], "lon": round(h["lon"], 2), "lat": round(h["lat"], 2),
                 "rootLon": root["lon"], "rootLat": root["lat"], "depthKm": depth}
        if possible is not None:
            plume["possibleDepthKm"] = possible
        plumes.append(plume)
    return plumes


def build_volcano_labels(volcanoes: list[dict]) -> list[dict]:
    """Most recently active first; taller first within an eruption period."""
    labels = []
    for v in volcanoes:
        name = (v.get("name") or "").strip()
        if not name or name.lower().startswith("unnamed") or v.get("latitude") is None:
            continue
        rank = ERUPTION_RANK.get(v.get("timeErupt"), UNDATED_RANK)
        height = min(max(v.get("elevation") or 0, 0), 9000)
        labels.append({"kind": "volcano", "name": name, "lon": round(v["longitude"], 2), "lat": round(v["latitude"], 2),
                       "priority": round(rank + (1 - height / 9000) * 0.99, 3)})
    return labels


def build_deep_labels() -> list[dict]:
    return [{"kind": "deep", **s} for s in DEEP_STRUCTURES]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--source-dir", type=Path, help="read source files from here instead of fetching")
    args = parser.parse_args()
    sources = load_sources(args.source_dir)

    boundaries, longest_subduction = build_boundaries(sources["steps"])
    fault_lines = build_faults(sources["faults"])
    layers = {**boundaries, **fault_lines}
    for name, polylines in layers.items():
        print(f"{name}: {len(polylines)} polylines, {sum(len(p) // 2 for p in polylines)} points", file=sys.stderr)

    hotspots = parse_hotspots(sources["hotspots"])
    plumes = build_plumes(hotspots)
    print(f"plumes: {len(plumes)}", file=sys.stderr)
    labels = (build_plate_labels(sources["plates"]) + build_deep_labels() + build_hotspot_labels(hotspots)
              + build_subduction_labels(longest_subduction, plate_names(sources["plates"]))
              + build_volcano_labels(sources["volcanoes"]))
    labels.sort(key=lambda label: (LABEL_KIND_ORDER.index(label["kind"]), label["priority"], label["name"]))
    print(f"labels: {len(labels)}", file=sys.stderr)

    write_json(OUTPUT_DIR / "tectonics.json", {
        "source": "Plate boundaries: Bird (2003) PB2002, ODC-By 1.0. Faults: GEM Global Active Faults Database, "
                  "CC BY-SA 4.0. See ATTRIBUTION.md.",
        "encoding": "delta",
        "quantumPerDegree": QUANTUM_PER_DEG,
        "layers": layers,
    })
    write_json(OUTPUT_DIR / "geology.json", {
        "source": "PB2002 plates (ODC-By 1.0), Whittaker et al. 2015 hotspots (CC BY 3.0), GEM faults (CC BY-SA 4.0), "
                  "NOAA NCEI volcanoes (public domain), deep structures curated from literature. See ATTRIBUTION.md.",
        "labels": labels,
        "plumes": plumes,
    })


if __name__ == "__main__":
    main()
