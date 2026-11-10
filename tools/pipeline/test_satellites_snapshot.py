#!/usr/bin/env python3
"""
Data checks for the baked satellite snapshot (app/public/space/gp/).

Element sets are checked against what is known about the orbits they
describe, by Kepler's third law alone: the ISS near 420 km at 51.6°, the
GPS satellites in 12-hour orbits at 55°, GOES 19 geostationary, Hubble at
28.5°. The positions the app computes from these elements are checked in
app/src/layers/satellites/orbit-math.test.ts against the python sgp4
package and JPL Horizons (generate_satellite_fixture.py).

Usage:
    python3 tools/pipeline/test_satellites_snapshot.py
"""

import csv
import datetime
import io
import json
import math

from generate_satellites_snapshot import GROUPS, KEEP, OUTPUT_DIR
from geo_test_support import check, finish

GM_KM3_S2 = 398600.4418
EARTH_RADIUS_KM = 6378.137


def semi_major_axis_km(mean_motion_rev_day: float) -> float:
    n = mean_motion_rev_day * 2 * math.pi / 86400
    return (GM_KM3_S2 / (n * n)) ** (1 / 3)


def load(group: str) -> list[dict[str, str]]:
    text = (OUTPUT_DIR / f"{group}.csv").read_text(encoding="utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def by_norad(rows: list[dict[str, str]], norad: int) -> dict[str, str] | None:
    return next((row for row in rows if row["NORAD_CAT_ID"] == str(norad)), None)


def main() -> None:
    manifest = json.loads((OUTPUT_DIR / "manifest.json").read_text(encoding="utf-8"))
    check(sorted(manifest["groups"]) == sorted(GROUPS), "the manifest lists every group")
    total_bytes = 0
    for group in GROUPS:
        path = OUTPUT_DIR / f"{group}.csv"
        total_bytes += path.stat().st_size
        rows = load(group)
        entry = manifest["groups"][group]
        check(len(rows) == entry["count"] and len(rows) > 0, f"{group}: {len(rows)} objects, as the manifest says")
        check(list(rows[0].keys()) == KEEP, f"{group}: exactly the columns SGP4 needs")
        bad = 0
        for row in rows:
            try:
                ok = (
                    0 < float(row["MEAN_MOTION"]) < 18
                    and 0 <= float(row["ECCENTRICITY"]) < 1
                    and 0 <= float(row["INCLINATION"]) <= 180
                    and int(row["NORAD_CAT_ID"]) > 0
                    and "," not in row["OBJECT_NAME"]
                )
                datetime.datetime.fromisoformat(row["EPOCH"])
                float(row["BSTAR"])
            except ValueError:
                ok = False
            bad += not ok
        check(bad == 0, f"{group}: every row is a plausible element set")
        fetched = datetime.datetime.fromisoformat(entry["fetched"].replace("Z", "+00:00"))
        median = datetime.datetime.fromisoformat(entry["epochMedian"].replace("Z", "+00:00"))
        check(abs((fetched - median).total_seconds()) < 4 * 86400, f"{group}: elements are fresh for the fetch date ({entry['epochMedian']})")
    check(total_bytes < 2.5e6, f"snapshot is {total_bytes / 1e6:.2f} MB in all")

    stations = load("stations")
    iss = by_norad(stations, 25544)
    check(iss is not None and iss["OBJECT_NAME"] == "ISS (ZARYA)", "the ISS is catalogue number 25544")
    if iss:
        height = semi_major_axis_km(float(iss["MEAN_MOTION"])) - EARTH_RADIUS_KM
        check(380 < height < 440, f"ISS mean height {height:.0f} km")
        check(abs(float(iss["INCLINATION"]) - 51.64) < 0.05, f"ISS inclination {iss['INCLINATION']}°")
    css = by_norad(stations, 48274)
    check(css is not None and abs(float(css["INCLINATION"]) - 41.47) < 0.1, "Tiangong's core module at 41.5°")

    gps = load("gps-ops")
    check(24 <= len(gps) <= 36, f"{len(gps)} operational GPS satellites")
    radii = [semi_major_axis_km(float(row["MEAN_MOTION"])) for row in gps]
    check(all(abs(a - 26560) < 60 for a in radii), "every GPS satellite is in the 12-hour orbit (a = 26,560 km)")
    check(all(53 < float(row["INCLINATION"]) < 57.5 for row in gps), "every GPS orbit is inclined about 55°")

    galileo = load("galileo")
    stray = sorted(row["OBJECT_NAME"].split()[0] for row in galileo if abs(semi_major_axis_km(float(row["MEAN_MOTION"])) - 29600) > 100)
    # Galileo 5 and 6 were left in a lower, elliptical orbit by their launcher in 2014 and still fly there.
    check(stray == ["GSAT0201", "GSAT0202"], f"Galileo orbits at a = 29,600 km, but for the two stranded in 2014 ({', '.join(stray)})")
    glonass = load("glo-ops")
    nominal = sum(1 for row in glonass if abs(semi_major_axis_km(float(row["MEAN_MOTION"])) - 25510) < 60)
    check(nominal >= 0.9 * len(glonass), f"{nominal} of {len(glonass)} GLONASS satellites at a = 25,510 km")

    geo = load("geo")
    goes19 = by_norad(geo, 60133)
    check(goes19 is not None and goes19["OBJECT_NAME"] == "GOES 19", "GOES 19 is in the geostationary group")
    if goes19:
        a = semi_major_axis_km(float(goes19["MEAN_MOTION"]))
        check(abs(a - 42164) < 10, f"GOES 19 at the geostationary radius ({a:.0f} km)")
        check(float(goes19["INCLINATION"]) < 0.5 and float(goes19["ECCENTRICITY"]) < 0.001, "GOES 19's orbit is equatorial and circular")
    synchronous = sum(1 for row in geo if abs(semi_major_axis_km(float(row["MEAN_MOTION"])) - 42164) < 100)
    check(synchronous > 0.9 * len(geo), f"{synchronous} of {len(geo)} in the geo group are within 100 km of the geostationary radius")

    hubble = by_norad(load("visual"), 20580)
    check(hubble is not None and abs(float(hubble["INCLINATION"]) - 28.47) < 0.05, "Hubble at 28.5°")
    chandra = by_norad(load("science"), 25867)
    check(chandra is not None and float(chandra["ECCENTRICITY"]) > 0.6, "Chandra's orbit is a long ellipse")

    starlink = load("starlink")
    check(len(starlink) > 5000, f"{len(starlink)} Starlink satellites")
    check(max(int(row["NORAD_CAT_ID"]) for row in starlink) > 99999, "catalogue numbers beyond the TLE format's five digits are present")
    fengyun = load("fengyun-1c-debris")
    check(sum("DEB" in row["OBJECT_NAME"] for row in fengyun) > 0.95 * len(fengyun), "the Fengyun-1C group is debris")
    finish()


if __name__ == "__main__":
    main()
