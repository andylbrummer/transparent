#!/usr/bin/env python3
"""
Checks for the tectonics/geology pipeline.

Unit-checks the simplifier and fault classification, then checks the
generated files against known geology: the Japan Trench is a subduction
zone, the Mid-Atlantic Ridge runs through Iceland, the San Andreas is a
strike-slip fault, and plates, hotspots and volcanoes sit where they belong.

Usage:
    python3 tools/pipeline/generate_geology.py   # writes app/public/geo/
    python3 tools/pipeline/test_geology.py
"""

import json

from generate_geo import OUTPUT_DIR
from generate_geology import FAULT_LAYERS, BOUNDARY_LAYERS, LABEL_KIND_ORDER, fault_layer, plate_pair_codes, simplify
from geo_test_support import check, finish, nearest_point_deg

# Simplifier: collinear interior points go, a real corner stays, ends stay.
line = [(0, 0), (1, 0), (2, 0), (3, 0)]
check(simplify(line, 1) == [(0, 0), (3, 0)], "collinear points are simplified away")
corner = [(0, 0), (5, 0), (5, 5)]
check(simplify(corner, 1) == corner, "a corner beyond tolerance is kept")

check(fault_layer("Normal-Dextral") == "fault-normal", "normal-oblique faults are normal")
check(fault_layer("Reverse-Strike-Slip") == "fault-reverse", "reverse-oblique faults are reverse")
check(fault_layer("Dextral") == "fault-strike-slip", "dextral faults are strike-slip")
check(fault_layer("Dextral_Transform") is None, "oceanic transforms are left to PB2002")
check(fault_layer("Anticline") is None, "folds are not faults")
check(plate_pair_codes("NA\\PA") == ("NA", "PA"), "subduction boundary names split into plates")

tectonics = json.loads((OUTPUT_DIR / "tectonics.json").read_text(encoding="utf-8"))
layers = tectonics["layers"]
check(set(layers) == set(BOUNDARY_LAYERS) | set(FAULT_LAYERS), "all tectonic layers present")
check(nearest_point_deg(layers["subduction"], 143.5, 38.0) < 1.0, "Japan Trench is subduction")
check(nearest_point_deg(layers["subduction"], -72.5, -33.0) < 1.0, "Peru-Chile Trench off Valparaiso is subduction")
check(nearest_point_deg(layers["ridge"], -18.0, 64.5) < 1.5, "the Mid-Atlantic Ridge crosses Iceland")
check(nearest_point_deg(layers["fault-strike-slip"], -120.43, 35.9) < 0.2, "San Andreas at Parkfield is strike-slip")
check(nearest_point_deg(layers["fault-normal"], -111.9, 40.6) < 0.3, "Wasatch at Salt Lake City is normal")
check(nearest_point_deg(layers["subduction"], -97.74, 30.27) > 10, "no subduction near Austin")

labels = json.loads((OUTPUT_DIR / "geology.json").read_text(encoding="utf-8"))["labels"]
# Hotspot and volcano can share a name (Yellowstone): the first, by kind order, wins here.
by_name: dict = {}
for label in labels:
    by_name.setdefault(label["name"], label)


def near(name: str, lon: float, lat: float, tolerance: float) -> bool:
    label = by_name.get(name)
    return label is not None and abs(label["lon"] - lon) <= tolerance and abs(label["lat"] - lat) <= tolerance


check(near("Africa plate", 15.0, 0.0, 20), "Africa plate label is over Africa")
check(near("North America plate", -95.0, 50.0, 20), "North America plate label is over North America")
pacific = by_name.get("Pacific plate")
check(pacific is not None and (pacific["lon"] < -130 or pacific["lon"] > 150) and abs(pacific["lat"]) < 30,
      "Pacific plate label is over the Pacific")
check(near("Hawaii", -155.0, 19.0, 1), "Hawaii hotspot")
check(near("Iceland", -17.0, 64.0, 1), "Iceland hotspot")
check(near("Kilauea", -155.29, 19.42, 0.05), "Kilauea volcano")
check(near("Nazca–South America subduction", -73.0, -25.0, 15), "Nazca subduction is labelled off South America")
deep = [label for label in labels if label["kind"] == "deep"]
check(len(deep) > 0 and all(0 < label["depthKm"] < 2891 for label in deep), "deep structures sit inside the mantle")

order = [(LABEL_KIND_ORDER.index(label["kind"]), label["priority"]) for label in labels]
check(order == sorted(order), "labels sorted by kind, then priority")
volcanoes = [label["name"] for label in labels if label["kind"] == "volcano"]
check(volcanoes.index("Kilauea") < volcanoes.index("Yellowstone"), "a recently erupting volcano outranks an old one")

finish()
