#!/usr/bin/env python3
"""
Data checks for generate_stars.py's output: known stars at known places.

Reference positions are ICRS at epoch 2026.0, worked from the SIMBAD
J2000 position and proper motion of each star (not from Hipparcos's own
J1991.25 record, so the proper-motion step is checked independently).

Usage:
    python3 tools/pipeline/test_stars.py
"""

import json
import math

from generate_stars import OUTPUT, MAG_LIMIT
from geo_test_support import check, finish

# name: (ra J2000 deg, dec J2000 deg, pmRA*cos(dec) mas/yr, pmDec mas/yr, V)  — SIMBAD
REFERENCE = {
    "Sirius": (101.287155, -16.716116, -546.01, -1223.07, -1.46),
    "Arcturus": (213.915300, 19.182409, -1093.39, -2000.06, -0.05),
    "Vega": (279.234735, 38.783689, 200.94, 286.23, 0.03),
    "Polaris": (37.954561, 89.264109, 44.48, -11.85, 1.98),
    "Betelgeuse": (88.792939, 7.407064, 27.54, 11.30, 0.42),
    "Rigil Kentaurus": (219.902066, -60.833975, -3679.25, 473.67, 0.01),
    "Barnard's Star": None,  # V = 9.5: must be absent
}


def separation_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(a1 - a2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c)))) * 3600


def main() -> None:
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    count = len(data["ra"])
    check(all(len(data[k]) == count for k in ("dec", "mag", "bv")), "columns are the same length")
    check(14000 < count < 17000, f"{count} stars to V {MAG_LIMIT} (Hipparcos has ~15,500)")
    check(data["mag"] == sorted(data["mag"]), "sorted brightest first")
    check(max(data["mag"]) <= MAG_LIMIT * 100, "none fainter than the limit")
    check(all(0 <= r < 360000 for r in data["ra"]) and all(-90000 <= d <= 90000 for d in data["dec"]), "coordinates in range")

    by_name = {name: index for index, name in data["names"]}
    years = data["epochYear"] - 2000.0
    quantum = data["quantumPerDegree"]
    for name, ref in REFERENCE.items():
        if ref is None:
            check(name not in by_name, f"{name} (too faint) is absent")
            continue
        check(name in by_name, f"{name} is present and named")
        if name not in by_name:
            continue
        i = by_name[name]
        ra0, dec0, pm_ra, pm_dec, v = ref
        dec = dec0 + pm_dec * years / 3.6e6
        ra = ra0 + pm_ra * years / 3.6e6 / math.cos(math.radians(dec0))
        sep = separation_arcsec(data["ra"][i] / quantum, data["dec"][i] / quantum, ra, dec)
        # 0.001 deg quantum = 3.6 arcsec; Alpha Cen's orbit adds a few more.
        check(sep < 8, f"{name} within 8 arcsec of its 2026 place ({sep:.1f} arcsec)")
        check(abs(data["mag"][i] / 100 - v) < 0.15, f"{name} magnitude {data['mag'][i] / 100} ~ {v}")

    # The sky is not uniform: the Milky Way's plane holds more stars than its poles.
    def galactic_latitude(ra_deg: float, dec_deg: float) -> float:
        ra, dec = math.radians(ra_deg), math.radians(dec_deg)
        pole_ra, pole_dec = math.radians(192.85948), math.radians(27.12825)
        s = math.sin(dec) * math.sin(pole_dec) + math.cos(dec) * math.cos(pole_dec) * math.cos(ra - pole_ra)
        return math.degrees(math.asin(s))

    lats = [abs(galactic_latitude(r / quantum, d / quantum)) for r, d in zip(data["ra"], data["dec"])]
    low = sum(1 for b in lats if b < 30)  # half the sky's area
    check(low > 0.55 * count, f"stars concentrate toward the galactic plane ({low / count:.0%} within 30 deg)")
    finish()


if __name__ == "__main__":
    main()
