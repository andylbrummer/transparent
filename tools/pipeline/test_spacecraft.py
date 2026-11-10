#!/usr/bin/env python3
"""
Data checks for the baked spacecraft table (app/public/space/spacecraft.json).

The table is JPL Horizons' own numbers, so there is nothing more
authoritative to hold it to; these check that it is whole and that it was
read the right way round - the right columns, in step, for the right
objects - against things known about where the spacecraft are. The app's
use of it (interpolation, the observer's parallax) is checked against
separate, topocentric Horizons queries in
app/src/layers/spacecraft/spacecraft.test.ts.

Usage:
    python3 tools/pipeline/test_spacecraft.py
"""

import datetime
import json
import math

from generate_spacecraft import CRAFT, OUTPUT, START, STOP
from geo_test_support import check, finish


# Europa Clipper (December 2026), JUICE (September 2026) and OSIRIS-APEX (2027) pass the Earth within the table.
EARTH_FLYBYS = {"-159", "-28", "-64"}


def unit(ra: float, dec: float) -> tuple[float, float, float]:
    a, d = math.radians(ra), math.radians(dec)
    return (math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d))


def separation(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))))


def sun_direction(date: datetime.date) -> tuple[float, float, float]:
    """The Sun's geocentric direction, to a few hundredths of a degree (Meeus ch. 25, low accuracy)."""
    n = (date - datetime.date(2000, 1, 1)).days - 0.5
    mean_longitude = math.radians((280.460 + 0.9856474 * n) % 360)
    anomaly = math.radians((357.528 + 0.9856003 * n) % 360)
    longitude = mean_longitude + math.radians(1.915) * math.sin(anomaly) + math.radians(0.020) * math.sin(2 * anomaly)
    obliquity = math.radians(23.439 - 0.0000004 * n)
    return (math.cos(longitude), math.cos(obliquity) * math.sin(longitude), math.sin(obliquity) * math.sin(longitude))


def main() -> None:
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    craft = {c["horizons"]: c for c in data["craft"]}
    check(data["start"] == START.isoformat() and data["stop"] == STOP.isoformat(), "the table says what range it covers")
    check(sorted(craft) == sorted(c[0] for c in CRAFT), f"all {len(CRAFT)} spacecraft are in the table")
    check(OUTPUT.stat().st_size < 400_000, f"spacecraft.json is {OUTPUT.stat().st_size / 1024:.0f} KB")

    for craft_id, where, step in CRAFT:
        c = craft[craft_id]
        n = len(c["ra"])
        whole = n == len(c["dec"]) == len(c["au"]) and n >= 2 and c["stepDays"] == step and c["where"] == where
        last = START + datetime.timedelta(days=c["offsetDays"] + step * (n - 1))
        in_range = c["offsetDays"] >= 0 and last <= STOP
        ok_values = all(0 <= ra < 360 for ra in c["ra"]) and all(-90 <= dec <= 90 for dec in c["dec"]) and all(au > 0 for au in c["au"])
        # No step is a leap: a swapped column or a missing row would show as one. The exception is real: a probe
        # swinging past the Earth for a gravity assist crosses the sky in a day or two (the app hides those steps).
        steps = [separation(unit(c["ra"][i], c["dec"][i]), unit(c["ra"][i + 1], c["dec"][i + 1])) for i in range(n - 1)]
        leaps = [i for i, angle in enumerate(steps) if angle > 8]
        near_earth = all(min(c["au"][i], c["au"][i + 1]) < 0.02 for i in leaps)
        steady = not leaps or (craft_id in EARTH_FLYBYS and len(leaps) <= 8 and near_earth)
        note = f", {len(leaps)} steps of an Earth flyby" if leaps else ""
        check(whole and in_range and ok_values and steady, f"{c['name']}: {n} samples to {last}, largest ordinary step {max(a for a in steps if a <= 8):.2f}°{note}")

    # The L1 craft keep within a wide halo of the Sun's direction, the L2 craft of the point opposite, 0.01 au away.
    for craft_id, where, step in CRAFT:
        if where == "deep":
            continue
        c = craft[craft_id]
        worst = 0.0
        for i in range(0, len(c["ra"]), 15):
            date = START + datetime.timedelta(days=c["offsetDays"] + i * step)
            off = separation(unit(c["ra"][i], c["dec"][i]), sun_direction(date))
            worst = max(worst, off if where == "L1" else 180 - off)
        near = all(0.006 < au < 0.013 for au in c["au"])
        check(worst < 40 and near, f"{c['name']}: within {worst:.0f}° of the {'Sun' if where == 'L1' else 'anti-Sun'}, 0.9 - 1.9 million km out")

    # Voyager 1 as Horizons gives it from Austin on 2026-11-09 (RA 258.79°, Dec +12.08°, 173.0 au): in Ophiuchus, receding.
    voyager = craft["-31"]
    i = ((datetime.date(2026, 11, 9) - START).days - voyager["offsetDays"]) // voyager["stepDays"]
    check(separation(unit(voyager["ra"][i], voyager["dec"][i]), unit(258.79, 12.08)) < 0.5, "Voyager 1 is in Ophiuchus, where Horizons has it")
    check(abs(voyager["au"][i] - 173.0) < 0.6, f"Voyager 1 is {voyager['au'][i]} au away in November 2026")
    check(voyager["au"][-1] - voyager["au"][0] > 5, "Voyager 1 recedes by more than 5 au over the two years")
    check(craft["-32"]["dec"][0] < -55, "Voyager 2 is deep in the southern sky")
    parker = craft["-96"]
    check(max(parker["au"]) > 1.5 and min(parker["au"]) < 0.9, "Parker Solar Probe swings between the near and far side of the Sun")
    finish()


if __name__ == "__main__":
    main()
