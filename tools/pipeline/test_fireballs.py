#!/usr/bin/env python3
"""
Checks for app/public/geo/fireballs.json.

The reference is the Chelyabinsk airburst of 15 February 2013, the largest
event in the table: CNEOS lists it at 54.8 N 61.1 E, peak brightness 23.3 km
up at 18.6 km/s, 440 kt (the city of Chelyabinsk is at 55.16 N 61.40 E; the
meteorite was recovered from Lake Chebarkul, 54.96 N 60.32 E). The Bering
Sea fireball of 18 December 2018 is the second largest: 49 kt, 56.9 N
172.4 E, 26 km up.

Usage:
    python3 tools/pipeline/generate_fireballs.py
    python3 tools/pipeline/test_fireballs.py
"""

import json

from generate_fireballs import build
from generate_geo import OUTPUT_DIR, REPO_ROOT
from geo_test_support import check, finish

sample = {
    "fields": ["date", "energy", "impact-e", "lat", "lat-dir", "lon", "lon-dir", "alt", "vel"],
    "data": [
        ["2020-01-01 00:00:00", "2.0", "0.1", "10.5", "S", "20.5", "W", None, None],
        ["2020-01-02 00:00:00", "3.0", "0.2", None, None, None, None, None, None],
        ["2020-01-03 00:00:00", "9.0", "0.5", "1.0", "N", "2.0", "E", "30.1", "15.5"],
    ],
}
built, without = build(sample)
check(without == 1 and len(built) == 2, "an event without a position is counted and left out")
check(built[0]["energyKt"] == 0.5 and built[0]["altKm"] == 30.1, "largest energy first, altitude kept")
check(built[1]["lat"] == -10.5 and built[1]["lon"] == -20.5 and built[1]["altKm"] is None,
      "S and W are negative; a missing altitude stays null")
check(built[1]["radiatedJ"] == 2.0e10, "radiated energy is in joules")

path = OUTPUT_DIR / "fireballs.json"
data = json.loads(path.read_text())
fireballs = data["fireballs"]
check(path.stat().st_size < 150_000, f"under 150 kB ({path.stat().st_size} bytes)")
check(800 <= len(fireballs) <= 3000, f"several hundred located fireballs ({len(fireballs)})")
check(data["total"] == len(fireballs) + data["withoutPosition"], "located + unlocated = the table's count")
check(len({f["t"] for f in fireballs}) == len(fireballs), "no event twice")
check(all(-90 <= f["lat"] <= 90 and -180 <= f["lon"] <= 180 for f in fireballs), "every position is on the globe")
check(all(f["altKm"] is None or 10 < f["altKm"] < 120 for f in fireballs),
      "altitudes are where meteors burn: 10 to 120 km")
check(all(f["velKms"] is None or 9 < f["velKms"] < 75 for f in fireballs), "speeds between 9 and 75 km/s")
check(all(f["energyKt"] > 0 for f in fireballs), "every event has an energy")
check(min(f["t"] for f in fireballs).startswith("1988"), "the record starts in 1988")
check([f["energyKt"] for f in fireballs] == sorted((f["energyKt"] for f in fireballs), reverse=True), "largest first")
# The sensors see the whole planet: neither hemisphere is lost in either direction.
for label, key, sign in (("north", "lat", 1), ("south", "lat", -1), ("east", "lon", 1), ("west", "lon", -1)):
    share = sum(1 for f in fireballs if f[key] * sign > 0) / len(fireballs)
    check(0.35 < share < 0.65, f"about half are in the {label} ({share:.2f})")

chelyabinsk = fireballs[0]
check(chelyabinsk.get("name") == "Chelyabinsk" and chelyabinsk["t"] == "2013-02-15T03:20:26Z",
      "the largest is Chelyabinsk, 15 Feb 2013 03:20:26 UTC")
check(abs(chelyabinsk["lat"] - 54.8) < 0.05 and abs(chelyabinsk["lon"] - 61.1) < 0.05,
      f"Chelyabinsk at 54.8 N 61.1 E ({chelyabinsk['lat']}, {chelyabinsk['lon']})")
check(abs(chelyabinsk["lat"] - 55.16) < 1 and abs(chelyabinsk["lon"] - 61.40) < 1, "within a degree of the city itself")
check(abs(chelyabinsk["altKm"] - 23.3) < 0.05, f"Chelyabinsk peaked 23.3 km up ({chelyabinsk['altKm']})")
check(abs(chelyabinsk["velKms"] - 18.6) < 0.05, f"at 18.6 km/s ({chelyabinsk['velKms']})")
check(400 <= chelyabinsk["energyKt"] <= 500, f"about 440 kt ({chelyabinsk['energyKt']})")
bering = fireballs[1]
check(bering.get("name") == "Bering Sea" and bering["t"].startswith("2018-12-18"), "the second largest is the Bering Sea fireball")
check(abs(bering["lat"] - 56.9) < 0.05 and abs(bering["lon"] - 172.4) < 0.05 and bering["altKm"] == 26.0,
      "Bering Sea at 56.9 N 172.4 E, 26 km up")
check(sum(1 for f in fireballs if "name" in f) == 2, "only the two events NASA names carry a name")

caption = (REPO_ROOT / "app/src/layers/fireballs/layer.ts").read_text()
check(f"{len(fireballs)} fireballs" in caption, f"the app's caption says {len(fireballs)} fireballs")

finish()
