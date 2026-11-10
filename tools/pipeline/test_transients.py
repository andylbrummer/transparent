#!/usr/bin/env python3
"""
Data checks for generate_transients.py's output: known events at known
places and times.

Reference positions come from SIMBAD (the host galaxy, the counterpart or
the object itself) and, for the interstellar objects, from JPL Horizons:
the direction each was at in 1900, centuries before it arrived, as seen
from the Sun - independent of the two-body asymptote the bake computes
from the osculating elements.

Usage:
    python3 tools/pipeline/test_transients.py
"""

import json
import math
import urllib.parse

from fetch_cache import cached_fetch
from generate_transients import CACHE, IN_LANDMARKS, MJD_2000, OUTPUT_DIR, mjd_of
from geo_test_support import check, finish
from sky_catalog_support import separation_deg, simbad_position

HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"


def load(name: str) -> dict:
    return json.loads((OUTPUT_DIR / f"{name}.json").read_text(encoding="utf-8"))


def position(data: dict, row: int) -> tuple[float, float]:
    q = data["quantumPerDegree"]
    return data["ra"][row] / q, data["dec"][row] / q


def find(data: dict, text: str) -> int | None:
    """Row of the event whose label starts with `text`."""
    for row, label, _ in data["labels"]:
        if label.startswith(text):
            return row
    return None


def days(year: int, month: int, day: float) -> float:
    return mjd_of(year, month, day) - MJD_2000


def near(data: dict, row: int | None, reference: str, limit_deg: float, what: str) -> None:
    if row is None:
        check(False, f"{what}: not labelled")
        return
    ra, dec = position(data, row)
    sep = separation_deg(ra, dec, *simbad_position(reference))
    check(sep < limit_deg, f"{what} is {sep:.3f} deg from SIMBAD's {reference} (limit {limit_deg})")


def horizons_direction_1900(designation: str) -> tuple[float, float, float]:
    """(RA, Dec, range rate km/s) of a body seen from the Sun's centre on 1900-01-01."""
    params = {
        "format": "text",
        "COMMAND": f"'DES={designation};'",
        "OBJ_DATA": "NO",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'500@10'",
        "START_TIME": "'1900-01-01'",
        "STOP_TIME": "'1900-01-02'",
        "STEP_SIZE": "'1d'",
        "QUANTITIES": "'1,20'",
        "ANG_FORMAT": "DEG",
        "CSV_FORMAT": "YES",
    }
    safe = "".join(c if c.isalnum() else "_" for c in designation)
    text = cached_fetch(f"{HORIZONS}?{urllib.parse.urlencode(params)}", f"{CACHE}/horizons_{safe}_1900.txt").read_text()
    line = text.split("$$SOE")[1].strip().splitlines()[0]
    fields = [f.strip() for f in line.split(",")]
    return float(fields[3]), float(fields[4]), float(fields[6])


def sorted_by_time(data: dict, name: str) -> None:
    check(all(a <= b for a, b in zip(data["t"], data["t"][1:])), f"{name}: events are in time order")
    n = len(data["t"])
    check(all(len(data[k]) == n for k in ("ra", "dec", "cls", "val")), f"{name}: columns have one length ({n})")
    check(all(-90000 <= d <= 90000 for d in data["dec"]) and all(0 <= r < 360000 for r in data["ra"]), f"{name}: positions are on the sphere")


def test_grb() -> None:
    data = load("grb")
    sorted_by_time(data, "grb")
    check(data["counts"]["fermi"] > 4000 and data["counts"]["swift"] > 1700, f"grb: {data['counts']}")
    check(300 < data["counts"]["both"] < 900, f"grb: {data['counts']['both']} bursts seen by both are merged")
    boat = find(data, "GRB 221009A")
    near(data, boat, "GRB 221009A", 0.05, "GRB 221009A")
    if boat is not None:
        check(abs(data["t"][boat] - days(2022, 10, 9.553)) < 0.02, "GRB 221009A is dated 9 Oct 2022 13:17 UTC")
        check(data["labels"][0][0] == boat, "GRB 221009A has the highest fluence of the Fermi catalogue")
        check(data["val"][boat] == max(data["val"]), "and the largest value in the file")
    near(data, find(data, "GRB 130427A"), "GRB 130427A", 0.05, "GRB 130427A")
    near(data, find(data, "GRB 080319B"), "GRB 080319B", 0.05, "GRB 080319B (Swift only: before Fermi's launch)")
    near(data, find(data, "GRB 090423"), "GRB 090423", 0.05, "GRB 090423")
    merger = find(data, "GRB 170817A")
    near(data, merger, "NGC 4993", 0.1, "GRB 170817A")
    if merger is not None:
        check(abs(data["t"][merger] - days(2017, 8, 17 + (12 * 3600 + 41 * 60 + 6) / 86400)) < 0.006, "GRB 170817A is dated 17 Aug 2017 12:41 UTC")
    names = data["classes"]
    short = sum(1 for c in data["cls"] if names[c] == "short") / len(data["cls"])
    check(0.1 < short < 0.25, f"grb: {short:.0%} are short bursts (about one in six is expected)")
    # Bursts come from everywhere: the mean direction of an isotropic sky is near zero.
    q = data["quantumPerDegree"]
    sx = sy = sz = 0.0
    for ra, dec in zip(data["ra"], data["dec"]):
        a, d = math.radians(ra / q), math.radians(dec / q)
        sx += math.cos(d) * math.cos(a)
        sy += math.cos(d) * math.sin(a)
        sz += math.sin(d)
    dipole = math.sqrt(sx * sx + sy * sy + sz * sz) / len(data["ra"])
    check(dipole < 0.1, f"grb: the bursts are spread evenly over the sky (mean direction {dipole:.3f})")


def test_frb() -> None:
    data = load("frb")
    sorted_by_time(data, "frb")
    check(data["counts"] == {"sources": 492, "repeaters": 18}, f"frb: {data['counts']} (the catalogue: 474 one-off sources and 18 repeaters)")
    # CHIME's own positions are good to a fraction of a degree.
    near(data, find(data, "FRB 20121102A"), "FRB 20121102A", 0.5, "FRB 20121102A")
    near(data, find(data, "FRB 20180916B"), "FRB 20180916B", 0.5, "FRB 20180916B")
    magnetar = find(data, "FRB 20200428")
    near(data, magnetar, "PSR J1935+2154", 0.01, "FRB 20200428")
    if magnetar is not None:
        check(data["t"][magnetar] == days(2020, 4, 28), "FRB 20200428 is dated 28 Apr 2020")
    check(min(data["dec"]) > -15000, "frb: nothing south of -15 deg (CHIME sees the northern sky)")


def test_supernovae() -> None:
    data = load("supernovae")
    sorted_by_time(data, "supernovae")
    labels = [label for _, label, _ in data["labels"]]
    check(not any(label.startswith(tuple(IN_LANDMARKS)) for label in labels), "supernovae: SN 1987A and SN 1885A are left to Sky landmarks")
    near(data, find(data, "SN 2014J"), "M 82", 0.05, "SN 2014J")
    near(data, find(data, "SN 1993J"), "M 81", 0.08, "SN 1993J")
    near(data, find(data, "SN 1972E"), "NGC 5253", 0.05, "SN 1972E")
    near(data, find(data, "SN 2011fe"), "SN 2011fe", 0.01, "SN 2011fe")
    near(data, find(data, "SN 2023ixf"), "M 101", 0.2, "SN 2023ixf")
    near(data, find(data, "SN 2017cbv"), "NGC 5643", 0.1, "SN 2017cbv (ASAS-SN catalogue)")
    row = find(data, "SN 2014J")
    if row is not None:
        check(data["val"][row] in range(100, 125), f"SN 2014J: magnitude {data['val'][row] / 10} at maximum")
        check(abs(data["t"][row] - days(2014, 1, 31)) < 15, "SN 2014J is dated to the end of January 2014")
    check(data["span"] == [1895, 2020], f"supernovae: measured ones span {data['span']}")
    check(all(v <= 140 or v == 999 for v in data["val"]), "supernovae: none fainter than magnitude 14 unless shown by name")


def test_neutrinos() -> None:
    data = load("neutrinos")
    sorted_by_time(data, "neutrinos")
    check(len(data["t"]) + data["counts"]["vetoed"] == 348, f"neutrinos: {len(data['t'])} alerts and {data['counts']['vetoed']} vetoed make IceCat-1's 348")
    check(len(data["boxes"]) == len(data["t"]), "neutrinos: every alert has its 90% rectangle")
    # IceCube-170922A, the alert that pointed at the blazar TXS 0506+056: found by its date.
    target = days(2017, 9, 22 + (20 * 3600 + 54 * 60 + 30) / 86400)
    row = min(range(len(data["t"])), key=lambda i: abs(data["t"][i] - target))
    check(abs(data["t"][row] - target) < 0.01, "neutrinos: an alert at 2017-09-22 20:54 UTC (IceCube-170922A)")
    ra, dec = position(data, row)
    sep = separation_deg(ra, dec, *simbad_position("TXS 0506+056"))
    check(sep < 0.5, f"IceCube-170922A is {sep:.2f} deg from TXS 0506+056")
    box = next(b for b in data["boxes"] if b[0] == row)
    check(all(0 < side < 3 for side in box[1:]), f"IceCube-170922A: 90% rectangle {box[1:]} deg")
    top = data["labels"][0]
    check(data["val"][top[0]] == max(data["val"]) and "PeV" in top[1], f"neutrinos: the most energetic is named first ({top[1]})")


def test_gw() -> None:
    data = load("gw")
    sorted_by_time(data, "gw")
    counts = data["counts"]
    check(counts["events"] > 350 and counts["withMap"] > 250, f"gw: {counts}")
    check(len(data["regions"]) == counts["drawn"] and counts["drawn"] >= 20, f"gw: {counts['drawn']} events are placed well enough to draw")
    q = data["quantumPerDegree"]
    row = find(data, "GW170817")
    check(row is not None, "gw: GW170817 is drawn and named")
    if row is not None:
        check(abs(data["t"][row] - days(2017, 8, 17 + (12 * 3600 + 41 * 60 + 4) / 86400)) < 0.006, "GW170817 is dated 17 Aug 2017 12:41:04 UTC")
        check(data["val"][row] < 40, f"GW170817: 90% region of {data['val'][row]} deg2")
        check(data["classes"][data["cls"][row]] == "neutron stars", "GW170817 is a pair of neutron stars")
        region = next(r for r in data["regions"] if r["row"] == row)
        host = simbad_position("NGC 4993")
        nearest = min(separation_deg(a / q, d / q, *host) for a, d in zip(region["ra"], region["dec"]))
        check(nearest < 0.5, f"GW170817: its 90% region reaches within {nearest:.2f} deg of the host, NGC 4993")
        sep = separation_deg(*position(data, row), *host)
        check(sep < 6, f"GW170817: the most probable direction is {sep:.1f} deg from NGC 4993")
    best = find(data, "GW190814")
    check(best is not None and data["val"][best] < 30, "gw: GW190814 is among the best localised (under 30 deg2)")
    for region in data["regions"]:
        centre = position(data, region["row"])
        spread = max(separation_deg(a / q, d / q, *centre) for a, d in zip(region["ra"], region["dec"]))
        if spread > 100:
            # A two-lobed region on opposite sides of the sky is real for three-detector events; nothing wider is.
            check(data["val"][region["row"]] <= data["drawnMaxDeg2"], f"gw: a region {spread:.0f} deg across still has a small area")
    first = data["t"][0]
    check(abs(first - days(2015, 9, 14 + (9 * 3600 + 50 * 60 + 45) / 86400)) < 0.006, "gw: the first event is GW150914, 14 Sep 2015 09:50:45 UTC")


def test_interstellar() -> None:
    data = load("interstellar")
    sorted_by_time(data, "interstellar")
    for obj, designation in zip(data["objects"], ["1I", "C/2019 Q4", "C/2025 N1"]):
        ra, dec, range_rate = horizons_direction_1900(designation)
        sep = separation_deg(*obj["arrival"], ra, dec)
        check(sep < 0.5, f"{obj['name']}: arrival direction is {sep:.2f} deg from where Horizons has it in 1900")
        check(abs(obj["speedKms"] + range_rate) < 0.2, f"{obj['name']}: {obj['speedKms']} km/s far out; Horizons has it closing at {-range_rate:.2f} km/s in 1900")
    # 1I came from near Vega, in Lyra; 2I from Cassiopeia; 3I from Sagittarius.
    vega = simbad_position("Vega")
    sep = separation_deg(*data["objects"][0]["arrival"], *vega)
    check(sep < 6, f"1I: arrival direction is {sep:.1f} deg from Vega")
    wind = find(data, "Interstellar wind")
    check(wind is not None, "interstellar: the helium wind is named")
    if wind is not None:
        # Ecliptic 255.8, +5.16 (the abstract's numbers) turned to the equator of J2000: in Ophiuchus, some 11 deg from Antares (which lies 6 deg behind it in ecliptic longitude and 10 deg south).
        ra, dec = position(data, wind)
        check(abs(ra - 255.15) < 0.1 and abs(dec + 17.55) < 0.1, f"interstellar wind from RA {ra:.2f}, Dec {dec:.2f}")
        sep = separation_deg(ra, dec, *simbad_position("Antares"))
        check(10.5 < sep < 12.5, f"interstellar wind comes from {sep:.1f} deg from Antares")
        check(data["wind"] == {"eclipticLon": 255.8, "eclipticLat": 5.16, "speedKms": 25.8, "temperatureK": 7440.0}, "wind numbers are the paper's")


def main() -> None:
    test_grb()
    test_frb()
    test_supernovae()
    test_neutrinos()
    test_gw()
    test_interstellar()
    finish()


if __name__ == "__main__":
    main()
