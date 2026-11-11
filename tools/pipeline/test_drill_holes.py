#!/usr/bin/env python3
"""
Checks for app/public/geo/drill-holes.json.

References: the Deep Sea Drilling Project's first leg, in 1968, drilled in
the Gulf of Mexico; Hole 504B, on the Costa Rica Rift south of Panama, was
reopened by DSDP and then ODP cruise after cruise (the table lists nine);
the Kola Superdeep Borehole (69.4 N, 30.6 E) was drilled on land by the
Soviet Union and is no part of these programmes. The rest are the table's
own counts.

Usage:
    python3 tools/pipeline/generate_drill_holes.py
    python3 tools/pipeline/test_drill_holes.py
"""

import json
import math

import generate_drill_holes as bake
from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, REPO_ROOT
from geo_test_support import check, finish

data = json.loads((OUTPUT_DIR / "drill-holes.json").read_text())
holes = {h[0]: h for h in data["holes"]}
rows = bake.read(cached_fetch(bake.CSV_URL, bake.CACHE_NAME))
check(len(rows) == 4283 and data["rows"] == 4283, f"the table has 4,283 rows ({len(rows)})")
check(len(holes) == 4216 == len(data["holes"]), f"4,216 holes once revisits are one ({len(holes)})")
check(sum(h[4] for h in holes.values()) == len({(r['site'] + r['hole'], r['leg'] or r['expedition']) for r in rows}),
      "every hole-and-cruise pair is counted once")

check(bake.programme("1") == bake.DSDP and bake.programme("96") == bake.DSDP and bake.programme("78B") == bake.DSDP, "legs 1-96 are DSDP")
check(bake.programme("100") == bake.ODP and bake.programme("210") == bake.ODP, "legs 100-210 are ODP")
check(bake.programme("301") == bake.IODP and bake.programme("384T") == bake.IODP, "expeditions 301 on are IODP")
by_programme = {p: sum(1 for h in holes.values() if h[3] & p) for p in (bake.DSDP, bake.ODP, bake.IODP)}
check(all(n > 1000 for n in by_programme.values()), f"over a thousand holes from each programme ({by_programme})")

first = holes["1"]
check(18 < first[1] < 31 and -98 < first[2] < -80, f"DSDP site 1 is in the Gulf of Mexico ({first[1]}, {first[2]})")
hole504 = holes["504B"]
check(hole504[4] == 9 and hole504[3] & bake.DSDP and hole504[3] & bake.ODP, f"504B: nine cruises, DSDP and ODP ({hole504})")
check(abs(hole504[1] - 1.23) < 0.05 and abs(hole504[2] + 83.73) < 0.05, "504B is on the Costa Rica Rift, 1.23 N 83.73 W")
check(data["holes"][0][0] == "504B", "504B is the most-visited hole")
check(not any(math.hypot(h[1] - 69.4, h[2] - 30.6) < 1 for h in holes.values()), "no hole at Kola: it is not ocean drilling")
check(all(-90 <= h[1] <= 90 and -180 <= h[2] <= 180 for h in holes.values()), "every position is on the globe")

app = (REPO_ROOT / "app/src/layers/drill-holes/holes.ts").read_text()
check("REVISITED_MIN_CRUISES = 3" in app, "the app names holes worked on three cruises or more")
finish()
