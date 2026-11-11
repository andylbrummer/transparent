#!/usr/bin/env python3
"""
Checks for app/public/geo/deep-caves.json.

References, read on 2026-11-11 (English Wikipedia, article leads):
"Veryovkina Cave" - in the Arabika Massif, Gagra Range, Western Caucasus,
Abkhazia, Georgia; "a known depth of 2,209 meters as of 2025", the second
deepest after Krubera Cave. "Krubera Cave" - "the deepest known cave on
Earth", in the Arabika Massif of the Gagra Range, Abkhazia. "Hranice
Abyss" - the deepest flooded pit cave, near Hranice, Czech Republic,
"greatest confirmed depth is 519.5 m".

Wikidata gives Veryovkina 2,212 m and Krubera 2,199 m, so on Wikidata
Veryovkina comes first; which of the two is deepest is therefore not
checked, only that the Arabika caves lead and Veryovkina's depth agrees
with its article to within a few metres.

Usage:
    python3 tools/pipeline/generate_deep_caves.py
    python3 tools/pipeline/test_deep_caves.py
"""

import json

import generate_deep_caves as bake
from generate_geo import OUTPUT_DIR, REPO_ROOT
from generate_landmarks import distance_km
from geo_test_support import check, finish

data = json.loads((OUTPUT_DIR / "deep-caves.json").read_text())
caves = data["caves"]
check(data["licence"] == "CC0 1.0", "Wikidata's licence is recorded")
check(len(caves) > 200, f"over 200 caves with a depth and a position ({len(caves)})")
check(all(len(c) == 5 and c[3] > 0 for c in caves), "each row is [name, lat, lon, depth, links] with a depth")
check(all(-90 <= c[1] <= 90 and -180 <= c[2] <= 180 for c in caves), "every position is on the globe")
check(all(caves[i - 1][3] >= caves[i][3] for i in range(1, len(caves))), "deepest first")
check(len({c[0] for c in caves}) > 0.95 * len(caves), "names are nearly all distinct")

points = [{"lat": c[1], "lon": c[2]} for c in caves]
close = [(caves[i][0], caves[j][0]) for i in range(len(caves)) for j in range(i + 1, len(caves))
         if distance_km(points[i], points[j]) <= bake.SAME_CAVE_KM]
check(not close, f"no two caves within {bake.SAME_CAVE_KM} km: one cave entered twice is merged ({close[:3]})")

top = {c[0]: c for c in caves[:3]}
check(set(top) == {"Veryovkina Cave", "Krubera Cave", "Sarma Cave"}, f"the three deepest are the Arabika caves ({list(top)})")
check(all(43.3 < c[1] < 43.5 and 40.2 < c[2] < 40.5 for c in top.values()), "all three in the Arabika Massif, Abkhazia")
check(all(c[3] > 1800 for c in top.values()), "each deeper than 1.8 km")
very = top.get("Veryovkina Cave")
check(very is not None and abs(very[3] - 2209) <= 15, f"Veryovkina about 2,209 m, as its article says ({very})")
hranice = [c for c in caves if c[0] == "Hranice Abyss"]
check(len(hranice) == 1 and hranice[0][3] == 520 and 49.4 < hranice[0][1] < 49.7 and 17.6 < hranice[0][2] < 17.9,
      f"Hranice Abyss: 519.5 m, near Hranice, Czech Republic ({hranice})")

app = (REPO_ROOT / "app/src/layers/deep-caves/caves.ts").read_text()
check("NAMED_MIN_DEPTH_M = 500" in app, "the app names caves of 500 m and more")
check(sum(1 for c in caves if c[3] >= 500) >= 5, "at least five caves are named")

finish()
