#!/usr/bin/env python3
"""
Data checks for the close-approach list (generate_neo_approaches.py).

Run after the generator:
    python3 tools/pipeline/test_neo_approaches.py

The list comes from CNEOS and the position tables from Horizons - two JPL
services reading one orbit solution - so the strongest check is that each
table, interpolated at CNEOS's time of closest approach, gives CNEOS's
miss distance. The pinned events are as CNEOS listed them on the bake date.
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_neo_approaches as gen  # noqa: E402
from geo_test_support import check, finish  # noqa: E402

data = json.loads(gen.OUTPUT.read_text(encoding="utf-8"))
approaches = data["approaches"]
by_des = {a["des"]: a for a in approaches}
tabled = [a for a in approaches if "xyz" in a]


def cubic(a: dict, jd: float) -> tuple[float, float, float]:
    """The same four-point interpolation as the app's approachPositionKm."""
    xyz = a["xyz"]
    count = len(xyz) // 3
    steps = (jd - a["t0"]) * 1440 / a["stepMin"]
    assert 0 <= steps <= count - 1
    i0 = min(count - 4, max(0, math.floor(steps) - 1))
    u = steps - i0
    w = [-(u - 1) * (u - 2) * (u - 3) / 6, u * (u - 2) * (u - 3) / 2, -u * (u - 1) * (u - 3) / 2, u * (u - 1) * (u - 2) / 6]
    return tuple(sum(w[n] * xyz[(i0 + n) * 3 + axis] for n in range(4)) for axis in range(3))


check(data["baked"] == gen.BAKE_DATE, f"baked on {data['baked']}")
check(150 < len(approaches) < 1000, f"{len(approaches)} approaches within {data['maxLd']} LD")
check(all(approaches[i]["jd"] <= approaches[i + 1]["jd"] for i in range(len(approaches) - 1)), "in order of time")
check(all(a["distLd"] <= data["maxLd"] + 0.001 for a in approaches), "all within 10 LD")
check(all(a["distMinLd"] <= a["distLd"] <= a["distMaxLd"] for a in approaches), "nominal distance inside its 3-sigma range")
check(all(0.3 < a["vRel"] < 45 for a in approaches), "relative speeds are those of solar-system bodies (under 45 km/s)")
check(len(tabled) > 0.8 * len(approaches), f"{len(tabled)} have a position table")
check(all(a["sigmaMin"] <= gen.MAX_TIME_SIGMA_MIN for a in tabled), "none of them is uncertain in time by more than an hour")
check(len(gen.OUTPUT.read_bytes()) < 500_000, f"file is {len(gen.OUTPUT.read_bytes()) / 1024:.0f} KB")

# Past approaches are all recent discoveries; the far future holds only objects known for years.
jd_bake = 2440587.5 + __import__("datetime").datetime.fromisoformat(data["baked"] + "T00:00:00+00:00").timestamp() / 86400
check(sum(a["jd"] < jd_bake for a in approaches) > 3 * sum(a["jd"] > jd_bake + 60 for a in approaches) / 5, "the past two months are far better populated than the year ahead")

worst = 0.0
worst_name = ""
for a in tabled:
    count = len(a["xyz"]) // 3
    centred = abs((a["t0"] + (count - 1) * a["stepMin"] / 1440 / 2) - a["jd"]) < 0.01
    if not centred:
        check(False, f"{a['des']}: table is not centred on the approach")
    distance = math.hypot(*cubic(a, a["jd"])) / data["ldKm"]
    error = abs(distance / a["distLd"] - 1)
    if error > worst:
        worst, worst_name = error, a["des"]
check(worst < 0.01, f"every table gives CNEOS's miss distance at CNEOS's time: worst {worst * 100:.2f} % ({worst_name})")
closest_sample = min(min(math.hypot(*a["xyz"][3 * k : 3 * k + 3]) for k in range(len(a["xyz"]) // 3)) for a in tabled)
check(closest_sample > 6378, f"nothing in the tables is inside the Earth (closest sample {closest_sample:.0f} km from the centre)")

# As CNEOS listed them on 9 Nov 2026.
tp = by_des.get("2026 TP128")
check(tp is not None and tp["date"].startswith("2026-Oct-15") and abs(tp["distLd"] - 0.0195) < 0.001, "2026 TP128 passed at 0.0195 LD (7,490 km from the centre) on 15 Oct 2026")
if tp is not None:
    check(tp["stepMin"] == 2, "... and is sampled every two minutes")
big = by_des.get("535844")
check(big is not None and big["date"].startswith("2027-Mar-04") and abs(big["distLd"] - 9.18) < 0.05, "(535844) passes at 9.18 LD on 4 Mar 2027")
check(big is not None and "xyz" in big, "... with a table, though a year away: its orbit is well known")
check(sum("diameterM" in a for a in approaches) >= 1, "at least one has a measured diameter")

finish()
