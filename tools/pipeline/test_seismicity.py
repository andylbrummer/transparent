#!/usr/bin/env python3
"""
Checks for the slab and earthquake pipeline.

Checks the generated files against known subduction geometry: the Pacific
slab lies under northeast Japan and the Nazca slab under the central Andes,
slabs reach 600+ km, deep earthquakes cluster under Tonga, and the great
2011 Tohoku earthquake is labelled where it happened.

Usage:
    python3 tools/pipeline/generate_seismicity.py   # writes app/public/geo/
    python3 tools/pipeline/test_seismicity.py
"""

import json
import math

from generate_geo import OUTPUT_DIR
from generate_seismicity import quake_region
from geo_test_support import check, finish, nearest_point_deg

check(quake_region("near the east coast of Honshu, Japan") == "Japan", "regions come from the place's last part")
check(quake_region("2004 Sumatra - Andaman Islands Earthquake") == "Sumatra - Andaman Islands",
      "named events lose their year and 'Earthquake'")

slabs = json.loads((OUTPUT_DIR / "slabs.json").read_text(encoding="utf-8"))
by_depth = {c["depthKm"]: c["polylines"] for c in slabs["contours"]}
check(nearest_point_deg(by_depth[120], 140.5, 38.5) < 1.5, "the Pacific slab is 120 km under northeast Japan")
check(nearest_point_deg(by_depth[120], -68.5, -24.0) < 1.5, "the Nazca slab is 120 km under the central Andes")
check(max(by_depth) >= 600, "slabs reach 600 km")
# The nearest is the Cocos slab under central Mexico, ~10 degrees south.
check(min(nearest_point_deg(lines, -97.74, 30.27) for lines in by_depth.values()) > 8, "no slab under Austin")

quakes = json.loads((OUTPUT_DIR / "quakes.json").read_text(encoding="utf-8"))
q = quakes["quantumPerDegree"]
columns = [quakes["lon"], quakes["lat"], quakes["depthKm"], quakes["magnitude10"]]
check(len({len(c) for c in columns}) == 1 and len(quakes["lon"]) > 80000, "80k+ quakes in equal-length columns")
check(quakes["magnitude10"] == sorted(quakes["magnitude10"]), "quakes sorted by magnitude, largest last")
check(min(quakes["magnitude10"]) >= 50, "nothing under M5")


def within(lon0: float, lat0: float, lon: float, lat: float, deg: float) -> bool:
    dlon = (lon - lon0 + 180) % 360 - 180
    return abs(lat - lat0) <= deg and abs(dlon) * math.cos(math.radians(lat0)) <= deg


tonga_deep = sum(1 for lon, lat, d in zip(quakes["lon"], quakes["lat"], quakes["depthKm"])
                 if d >= 300 and within(-178, -20, lon / q, lat / q, 8))
check(tonga_deep > 500, f"deep quakes cluster under Tonga-Fiji ({tonga_deep} at 300+ km)")
check(max(quakes["depthKm"]) > 650, "the deepest quakes are near 700 km")

tohoku = next((label for label in quakes["labels"] if label["name"] == "M9.1 Japan 2011"), None)
check(tohoku is not None and abs(tohoku["lon"] - 142.4) < 1 and abs(tohoku["lat"] - 38.3) < 1
      and 10 < tohoku["depthKm"] < 50, "Tohoku 2011 is labelled off Honshu at its hypocentre depth")
check(all(label["kind"] == "quake" for label in quakes["labels"]), "quake labels are kind 'quake'")

finish()
