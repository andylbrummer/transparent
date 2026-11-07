#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: map outlines and place labels.

Downloads Natural Earth (public domain) vector data and writes the compact
JSON the app draws on the far-side surface:

    app/public/geo/outlines.json  coastlines, country borders, state/province lines
    app/public/geo/labels.json    country, state/province and city names

Outlines are polylines quantized to 0.01° (~1.1 km, finer than the 1:50m
source) and delta-encoded as flat integer arrays:
    [lon0, lat0, dlon1, dlat1, dlon2, dlat2, ...]  in hundredths of a degree

Labels are sorted by kind (countries, then states/provinces, then cities)
and within a kind by Natural Earth's minimum label zoom (lower = more
important). The app declutters by keeping whichever comes first, so a
region's name beats a city inside it: from Austin, "California" must not
lose to "Los Angeles" just because Natural Earth ranks the city higher.

Usage:
    python3 tools/pipeline/generate_geo.py [--source-dir DIR]

--source-dir reads already-downloaded <name>.geojson files instead of
fetching them. Requires only the Python standard library.
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

NATURAL_EARTH_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
QUANTUM_PER_DEG = 100

OUTLINE_SOURCES = {
    "coastline": "ne_50m_coastline",
    "borders": "ne_50m_admin_0_boundary_lines_land",
    "states": "ne_50m_admin_1_states_provinces_lines",
}

LABEL_SOURCES = {
    # kind: (dataset, name key, lon key, lat key, priority key)
    "country": ("ne_110m_admin_0_countries", "NAME", "LABEL_X", "LABEL_Y", "MIN_LABEL"),
    "state": ("ne_50m_admin_1_states_provinces", "name", "longitude", "latitude", "min_label"),
    "city": ("ne_110m_populated_places_simple", "name", "longitude", "latitude", "min_zoom"),
}

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "geo"


def load_geojson(name: str, source_dir: Path | None) -> dict:
    if source_dir is not None:
        return json.loads((source_dir / f"{name}.geojson").read_text(encoding="utf-8"))
    url = f"{NATURAL_EARTH_BASE}/{name}.geojson"
    print(f"fetching {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=120) as response:
        return json.load(response)


def line_parts(geometry: dict) -> list[list[list[float]]]:
    """Every polyline in a LineString or MultiLineString geometry."""
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiLineString":
        return geometry["coordinates"]
    raise ValueError(f"expected line geometry, got {geometry['type']}")


def encode_polyline(points: list[list[float]]) -> list[int] | None:
    """Quantize, drop repeated points, delta-encode. None if under two points remain."""
    quantized: list[tuple[int, int]] = []
    for lon, lat, *_ in points:
        q = (round(lon * QUANTUM_PER_DEG), round(lat * QUANTUM_PER_DEG))
        if not quantized or quantized[-1] != q:
            quantized.append(q)
    if len(quantized) < 2:
        return None
    encoded = [quantized[0][0], quantized[0][1]]
    for (lon0, lat0), (lon1, lat1) in zip(quantized, quantized[1:]):
        encoded += [lon1 - lon0, lat1 - lat0]
    return encoded


def decode_polyline(encoded: list[int]) -> list[tuple[float, float]]:
    """Inverse of encode_polyline, in degrees. Mirrors the app's decoder."""
    lon, lat = encoded[0], encoded[1]
    points = [(lon / QUANTUM_PER_DEG, lat / QUANTUM_PER_DEG)]
    for i in range(2, len(encoded), 2):
        lon += encoded[i]
        lat += encoded[i + 1]
        points.append((lon / QUANTUM_PER_DEG, lat / QUANTUM_PER_DEG))
    return points


def build_outlines(source_dir: Path | None) -> dict:
    layers = {}
    for layer, dataset in OUTLINE_SOURCES.items():
        polylines = []
        for feature in load_geojson(dataset, source_dir)["features"]:
            for part in line_parts(feature["geometry"]):
                encoded = encode_polyline(part)
                if encoded is not None:
                    polylines.append(encoded)
        layers[layer] = polylines
        points = sum(len(p) // 2 for p in polylines)
        print(f"{layer}: {len(polylines)} polylines, {points} points", file=sys.stderr)
    return {
        "source": "Natural Earth 1:50m (public domain), naturalearthdata.com",
        "encoding": "delta",
        "quantumPerDegree": QUANTUM_PER_DEG,
        "layers": layers,
    }


def build_labels(source_dir: Path | None) -> dict:
    labels = []
    for kind, (dataset, name_key, lon_key, lat_key, priority_key) in LABEL_SOURCES.items():
        for feature in load_geojson(dataset, source_dir)["features"]:
            props = feature["properties"]
            name, lon, lat, priority = (props.get(k) for k in (name_key, lon_key, lat_key, priority_key))
            if not name or lon is None or lat is None or priority is None:
                raise ValueError(f"{dataset}: feature missing label fields: {props.get(name_key)!r}")
            labels.append(
                {"kind": kind, "name": name, "lon": round(lon, 2), "lat": round(lat, 2), "priority": priority}
            )
    kind_order = list(LABEL_SOURCES)
    labels.sort(key=lambda label: (kind_order.index(label["kind"]), label["priority"], label["name"]))
    print(f"labels: {len(labels)}", file=sys.stderr)
    return {
        "source": "Natural Earth 1:110m countries and places, 1:50m states/provinces (public domain)",
        "labels": labels,
    }


def write_json(path: Path, data: dict) -> None:
    """Write atomically: a partial file must never be served to the app."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
    print(f"wrote {path.relative_to(REPO_ROOT)} ({path.stat().st_size} bytes)", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--source-dir", type=Path, help="read <name>.geojson files from here instead of fetching")
    args = parser.parse_args()
    outlines = build_outlines(args.source_dir)
    labels = build_labels(args.source_dir)
    write_json(OUTPUT_DIR / "outlines.json", outlines)
    write_json(OUTPUT_DIR / "labels.json", labels)


if __name__ == "__main__":
    main()
