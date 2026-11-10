#!/usr/bin/env python3
"""
Checks for the tectonics/geology pipeline.

Unit-checks the simplifier and fault classification, then checks the
generated files against known geology: the Japan Trench is a subduction
zone, the Mid-Atlantic Ridge runs through Iceland, the San Andreas is a
strike-slip fault, and plates, hotspots and volcanoes sit where they belong.

Spreading rates are checked against PB2002's own step file (the values
quoted were read from PB2002_steps on 2026-11-09), and the side each
trench's teeth point to against Slab2: the overriding plate is the one the
slab lies under (needs app/public/geo/slabs.bin, from generate_slabs.py).

Usage:
    python3 tools/pipeline/generate_geology.py   # writes app/public/geo/
    python3 tools/pipeline/test_geology.py
"""

import json
import math

from generate_geo import OUTPUT_DIR, decode_polyline
from generate_geology import (FAULT_LAYERS, BOUNDARY_LAYERS, LABEL_KIND_ORDER, encode_steps, fault_layer,
                              overriding_side, plate_pair_codes, simplify)
from geo_test_support import check, finish, nearest_point_deg
from slab_file import SlabFile

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
check(overriding_side("OK/PA") == 1 and overriding_side("NZ\\SA") == -1,
      "'/' puts the overriding plate on the left of the digitising direction, a backslash on the right")
encoded, kept = encode_steps([[10.0, 0.0], [10.004, 0.0], [11.0, 0.0], [12.0, 0.0]], ["a", "b", "c"])
check(encoded == [1000, 0, 100, 0, 100, 0] and kept == ["b", "c"],
      "a step too short to survive quantising takes its value with it")

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

# --- ridges: PB2002's spreading rates ----------------------------------------

ridge_steps = tectonics["ridgeSteps"]
check(len(ridge_steps["rate10"]) == len(layers["ridge"]) == len(ridge_steps["azimuth"])
      and all(len(rates) == len(line) // 2 - 1 == len(azimuths)
              for rates, azimuths, line in zip(ridge_steps["rate10"], ridge_steps["azimuth"], layers["ridge"])),
      "every step of every ridge polyline has a rate and an azimuth")
check(all(isinstance(v, int) and v >= 0 for rates in ridge_steps["rate10"] for v in rates)
      and all(0 <= v <= 360 for azimuths in ridge_steps["azimuth"] for v in azimuths),
      "rates are whole tenths of mm/yr, azimuths degrees")


def ridge_motion_near(lon: float, lat: float, radius_deg: float) -> tuple[float, float, int]:
    """Mean full rate (mm/yr) and mean azimuth (deg, folded to 0-180) of the ridge steps starting within the radius."""
    rates, azimuths = [], []
    for line, rate10, azimuth in zip(layers["ridge"], ridge_steps["rate10"], ridge_steps["azimuth"]):
        for (plon, plat), rate, az in zip(decode_polyline(line), rate10, azimuth):
            dlon = (plon - lon + 180) % 360 - 180
            if math.hypot(dlon * math.cos(math.radians(lat)), plat - lat) <= radius_deg:
                rates.append(rate / 10)
                azimuths.append(az % 180)
    if not rates:
        return math.nan, math.nan, 0
    return sum(rates) / len(rates), sum(azimuths) / len(azimuths), len(rates)


# PB2002_steps: NA-AF steps at 28-30 N give 22.7-23.1 mm/yr toward 283; NZ-PA at 18-19 S 147.0-147.5 toward 103;
# SO-AN at 54-56 E 11.0-11.2 toward 358; AU-AN at 96-97 E 70.8-71.1 toward 32; NA-EU on the Gakkel Ridge 10.7-10.9.
rate, azimuth, count = ridge_motion_near(-42.5, 30.0, 2.0)
check(count > 0 and 20 <= rate <= 25 and 90 <= azimuth <= 115,
      f"the Mid-Atlantic Ridge at 30 N opens at 20-25 mm/yr, east-west ({rate:.1f} mm/yr, azimuth {azimuth:.0f}, {count} steps)")
rate, azimuth, count = ridge_motion_near(-113.4, -20.0, 2.0)
check(count > 0 and 130 <= rate <= 155 and 90 <= azimuth <= 115,
      f"the East Pacific Rise at 20 S opens at 130-155 mm/yr ({rate:.1f} mm/yr, azimuth {azimuth:.0f}, {count} steps)")
rate, azimuth, count = ridge_motion_near(57.0, -33.0, 2.5)
check(count > 0 and 9 <= rate <= 16, f"the Southwest Indian Ridge opens at 9-16 mm/yr ({rate:.1f} mm/yr, {count} steps)")
rate, azimuth, count = ridge_motion_near(98.0, -47.5, 2.5)
check(count > 0 and 65 <= rate <= 76, f"the Southeast Indian Ridge opens at about 71 mm/yr ({rate:.1f} mm/yr, {count} steps)")
rate, azimuth, count = ridge_motion_near(60.0, 86.8, 1.5)
check(count > 0 and 8 <= rate <= 13, f"the Gakkel Ridge opens at about 11 mm/yr ({rate:.1f} mm/yr, {count} steps)")
all_rates = [v / 10 for rates in ridge_steps["rate10"] for v in rates]
check(max(all_rates) < 210 and sorted(all_rates)[len(all_rates) // 2] < 40,
      f"no ridge opens faster than PB2002's 202 mm/yr, and most are slow (max {max(all_rates):.1f}, median "
      f"{sorted(all_rates)[len(all_rates) // 2]:.1f})")

# --- trenches: which side the teeth go ------------------------------------------

overriding = tectonics["subductionOverriding"]
check(len(overriding) == len(layers["subduction"]) and set(overriding) <= {1, -1},
      "every subduction polyline says which side overrides")


def destination(lon: float, lat: float, bearing_deg: float, km: float) -> tuple[float, float]:
    la, lo, b, d = math.radians(lat), math.radians(lon), math.radians(bearing_deg), km / 6371.0
    la2 = math.asin(math.sin(la) * math.cos(d) + math.cos(la) * math.sin(d) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(d) * math.cos(la), math.cos(d) - math.sin(la) * math.sin(la2))
    return math.degrees(lo2), math.degrees(la2)


def bearing(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    la1, la2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    return math.degrees(math.atan2(math.sin(dl) * math.cos(la2),
                                   math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl))) % 360


def trench_steps():
    """(mid lon, mid lat, bearing toward the overriding plate) for every step of every trench."""
    for line, side in zip(layers["subduction"], overriding):
        points = decode_polyline(line)
        for (lon1, lat1), (lon2, lat2) in zip(points, points[1:]):
            if abs(lon2 - lon1) > 180:
                continue
            # Left of the direction of travel is 90 degrees anticlockwise.
            yield (lon1 + lon2) / 2, (lat1 + lat2) / 2, (bearing(lon1, lat1, lon2, lat2) - 90 * side) % 360


def teeth_bearing_near(lon: float, lat: float) -> float:
    """Which way the teeth point on the trench step nearest a place."""
    def distance(step: tuple[float, float, float]) -> float:
        dlon = (step[0] - lon + 180) % 360 - 180
        return math.hypot(dlon * math.cos(math.radians(lat)), step[1] - lat)
    return min(trench_steps(), key=distance)[2]


def points_toward(lon: float, lat: float, compass_deg: float) -> bool:
    return abs((teeth_bearing_near(lon, lat) - compass_deg + 180) % 360 - 180) <= 50


check(points_toward(143.8, 38.0, 270), "Japan Trench: teeth point west, onto Honshu's plate")
check(points_toward(-125.3, 45.0, 90), "Cascadia: teeth point east, onto North America")
check(points_toward(-72.8, -33.0, 90), "Chile Trench off Valparaiso: teeth point east, onto South America")
check(points_toward(-173.0, -20.0, 270), "Tonga Trench: teeth point west, onto the Tonga plate")
check(points_toward(98.0, 0.0, 45), "Sunda Trench off Sumatra: teeth point north-east, onto Sumatra")
check(points_toward(-170.0, 50.8, 0), "Aleutian Trench: teeth point north")
check(points_toward(-59.5, 15.0, 270), "Lesser Antilles: teeth point west, onto the Caribbean plate")
check(points_toward(147.6, 15.0, 270), "Mariana Trench: teeth point west")

# Against Slab2 everywhere: 80 km from a trench the slab is a few tens of km
# down on the overriding side, and absent on the other. Where a slab lies
# shallow on exactly one side, the teeth must point to it.
slab_file = SlabFile(OUTPUT_DIR / "slabs.bin")
agree = disagree = 0
for lon, lat, toward in trench_steps():
    over = slab_file.shallowest_depth(*destination(lon, lat, toward, 80.0))
    under = slab_file.shallowest_depth(*destination(lon, lat, toward + 180, 80.0))
    over_shallow = over is not None and over < 100
    under_shallow = under is not None and under < 100
    if over_shallow != under_shallow:
        agree += over_shallow
        disagree += under_shallow
check(agree > 500 and disagree <= 0.02 * (agree + disagree),
      f"where Slab2 has a slab on one side of a trench, PB2002's teeth point to it ({agree} steps agree, {disagree} do not)")

order = [(LABEL_KIND_ORDER.index(label["kind"]), label["priority"]) for label in labels]
check(order == sorted(order), "labels sorted by kind, then priority")
plumes = {p["name"]: p for p in json.loads((OUTPUT_DIR / "geology.json").read_text(encoding="utf-8"))["plumes"]}
check(plumes.get("Iceland", {}).get("depthKm") == 2891, "Iceland's plume reaches the core-mantle boundary")
hawaii = plumes.get("Hawaii", {})
check(hawaii.get("depthKm") == 2891 and hawaii.get("rootLon") == -162.0, "Hawaii's plume leans to its ULVZ root")
check(plumes.get("Reunion", {}).get("possibleDepthKm") == 2891 and plumes["Reunion"]["depthKm"] == 1000,
      "a potentially deep plume is certain to 1000 km, possible to the CMB")
check(plumes.get("Eifel", {}).get("depthKm") == 660, "an upper-mantle plume stops at 660 km")
check("Yellowstone" not in plumes, "unclassified hotspots get no conduit")
volcanoes = [label["name"] for label in labels if label["kind"] == "volcano"]
check(volcanoes.index("Kilauea") < volcanoes.index("Yellowstone"), "a recently erupting volcano outranks an old one")

finish()
