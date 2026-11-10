#!/usr/bin/env python3
"""
Data checks for the small-body files (generate_small_bodies.py).

Run after the generator:
    python3 tools/pipeline/test_small_bodies.py

The orbital facts pinned here are the textbook ones (semi-major axis,
eccentricity and inclination of Ceres, Pluto, Eris, Vesta, Hektor, Encke).
Where the generator's download cache is present, the baked - rounded -
elements are also propagated and compared afresh with the JPL Horizons
places fetched when baking.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_small_bodies as gen  # noqa: E402
from fetch_cache import CACHE_DIR  # noqa: E402
from geo_test_support import check, finish  # noqa: E402

data = json.loads(gen.BODIES_OUT.read_text(encoding="utf-8"))
bodies = {b["name"]: b for b in data["bodies"]}
comets = {c["name"]: c for c in data["comets"]}


def semi_major(body: dict) -> float:
    return body["q"] / (1 - body["e"])


def near(value: float, target: float, tolerance: float) -> bool:
    return abs(value - target) <= tolerance


# ---------------------------------------------------------------- named bodies

check(data["epochJd"] == 2461406.5, "elements are for 2027 Jan 1.0 TDB")
check(data["validFromJd"] < data["epochJd"] < data["validToJd"], "the epoch lies inside the validity window")
check(data["validToJd"] - data["validFromJd"] == 730, "the window is two years")

for name in ["Ceres", "Pluto", "Eris", "Haumea", "Makemake"]:
    check(name in bodies and bodies[name]["group"] == "dwarf", f"{name} is there, as a dwarf planet")
for name in ["Vesta", "Pallas", "Hygiea", "Juno", "Psyche", "Eros", "Apophis", "Bennu", "Hektor", "Chiron", "Sedna"]:
    check(name in bodies, f"{name} is there")
check(sum(b["group"] == "asteroid" for b in data["bodies"]) == gen.MAIN_BELT_NAMED, f"{gen.MAIN_BELT_NAMED} main-belt asteroids")
check(len({b["name"] for b in data["bodies"]}) == len(data["bodies"]), "no body twice")

PINS = {
    # name: (a au, e, i deg) with tolerances wide enough for osculating wobble
    "Ceres": (2.77, 0.079, 10.59),
    "Vesta": (2.36, 0.089, 7.14),
    "Pluto": (39.5, 0.249, 17.1),
    "Eris": (67.9, 0.44, 44.0),
    "Hektor": (5.26, 0.023, 18.2),
    "Eros": (1.458, 0.223, 10.83),
}
for name, (a, e, inc) in PINS.items():
    b = bodies[name]
    check(near(semi_major(b), a, 0.02 * a), f"{name}: a = {semi_major(b):.3f} au (about {a})")
    check(near(b["e"], e, 0.012), f"{name}: e = {b['e']:.3f} (about {e})")
    check(near(b["i"], inc, 0.25), f"{name}: i = {b['i']:.2f} deg (about {inc})")

check(near(bodies["Ceres"]["h"], 3.34, 0.2), f"Ceres: H = {bodies['Ceres']['h']}")
check(near(bodies["Vesta"]["h"], 3.2, 0.3), f"Vesta: H = {bodies['Vesta']['h']}")
check(900 < bodies["Ceres"].get("diameterKm", 0) < 980, "Ceres: about 940 km across")
check(all(b["h"] < 8.5 for b in data["bodies"] if b["group"] == "asteroid"), "the named main-belt asteroids are the intrinsically bright ones (H < 8.5)")

worst = max(data["bodies"] + data["comets"], key=lambda b: b["errorArcsec"])
check(worst["errorArcsec"] < gen.MAX_ERROR_DEG * 3600, f"worst place when baked: {worst['name']}, {worst['errorArcsec']} arcsec from Horizons")
median = float(np.median([b["errorArcsec"] for b in data["bodies"] + data["comets"]]))
check(median < 60, f"median worst-case error {median:.0f} arcsec")

# ---------------------------------------------------------------- comets

check(20 <= len(comets) <= 60, f"{len(comets)} comets")
check("2P/Encke" in comets, "Encke, at perihelion in February 2027, is among them")
if "2P/Encke" in comets:
    encke = comets["2P/Encke"]
    check(near(encke["q"], 0.339, 0.01) and near(encke["e"], 0.847, 0.005) and near(encke["i"], 11.35, 0.3), "Encke: q 0.34 au, e 0.85, i 11.3 deg")
    period = semi_major(encke) ** 1.5
    check(near(period, 3.3, 0.05), f"Encke: period {period:.2f} years")
check(all(not c["name"].startswith(("D/", "X/")) for c in data["comets"]), "no lost or orbit-less comets")
check(all("m1" in c and "k1" in c for c in data["comets"]), "every comet has M1 and K1")
check(any(c["e"] > 1 for c in data["comets"]) and any(c["e"] < 0.9 for c in data["comets"]), "hyperbolic and periodic comets both")

# ---------------------------------------------------------------- afresh against Horizons

cache = CACHE_DIR / gen.CACHE
if (cache / "places_1.txt").exists():
    jd_utc = [gen.EPOCH_JD + d for d in gen.CHECK_OFFSETS_D]
    earth = gen.earth_positions([jd + gen.TDB_MINUS_UTC_S / 86400 for jd in jd_utc], "check")
    for name, slug, limit in [("Ceres", "1", 110), ("Pluto", "134340", 5), ("Hektor", "624", 20), ("Eris", "136199", 5), ("2P/Encke", "2P", 20)]:
        body = bodies.get(name) or comets[name]
        rows = gen.table_rows((cache / f"places_{slug}.txt").read_text(encoding="utf-8")) if (cache / f"places_{slug}.txt").exists() else None
        if rows is None:
            # Pluto's places were fetched date by date.
            rows = [gen.table_rows((cache / f"places_{slug}_{jd}.txt").read_text(encoding="utf-8"))[0] for jd in jd_utc]
        errors = []
        for jd, e, fields in zip(jd_utc, earth, rows):
            direction, _, _ = gen.astrometric(body, e, jd + gen.TDB_MINUS_UTC_S / 86400)
            errors.append(gen.separation_deg(direction, gen.unit(float(fields[3]), float(fields[4]))) * 3600)
        at_epoch = errors[gen.CHECK_OFFSETS_D.index(0)]
        check(max(errors) < limit, f"{name}: baked elements within {max(errors):.1f} arcsec of Horizons over the window (limit {limit})")
        check(at_epoch < 1.5, f"{name}: {at_epoch:.2f} arcsec at the epoch")
else:
    print("skip  no download cache: the comparison with Horizons was made when baking")

# ---------------------------------------------------------------- the cloud

header = json.loads(gen.CLOUD_JSON_OUT.read_text(encoding="utf-8"))
raw = gen.CLOUD_BIN_OUT.read_bytes()
n = header["count"]
check(len(raw) == 13 * n, f"cloud file is 13 bytes x {n} bodies")
check(len(raw) < 500_000, f"cloud file is {len(raw) / 1024:.0f} KB")
columns = np.frombuffer(raw[: 12 * n], dtype="<u2").reshape(6, n)
a = header["aMinAu"] * np.exp(columns[0] / 65535 * math.log(header["aMaxAu"] / header["aMinAu"]))
e = columns[1] / 65535
inc = columns[2] / 65535 * 180
classes = {c["key"]: c for c in header["classes"]}
check(sum(c["count"] for c in header["classes"]) == n, "the classes tile the file")


def of(key: str, values: np.ndarray) -> np.ndarray:
    c = classes[key]
    return values[c["start"] : c["start"] + c["count"]]


check(classes["trojan"]["count"] == 5000 and bool(np.all((of("trojan", a) > 4.6) & (of("trojan", a) < 5.6))), "5000 Jupiter Trojans, all between 4.6 and 5.6 au")
check(bool(np.all((of("hilda", a) > 3.7) & (of("hilda", a) < 4.2))), "Hildas between 3.7 and 4.2 au")
check(bool(np.all(of("tno", a) > 30)), "trans-Neptunian objects beyond 30 au")
# An H-limited sample leans outward: dark outer-belt bodies must be big to make the cut.
check(near(float(np.median(of("main-belt", a))), 2.8, 0.25), f"main belt centred on {float(np.median(of('main-belt', a))):.2f} au")
check(float(np.median(of("main-belt", inc))) < 12, "main belt lies near the ecliptic")
check(bool(np.all(e < 0.985)), "no near-parabolic orbit in the cloud")
# The Kirkwood gap at the 3:1 resonance with Jupiter, 2.50 au, is real structure the cloud must keep.
belt = of("main-belt", a)
gap = np.sum((belt > 2.49) & (belt < 2.51)) / 0.02
shoulder = np.sum((belt > 2.40) & (belt < 2.46)) / 0.06
check(gap < 0.25 * shoulder, f"the 3:1 Kirkwood gap at 2.50 au is empty ({gap:.0f} per au against {shoulder:.0f} beside it)")

finish()
