#!/usr/bin/env python3
"""
Data checks for the baked meteor shower list (app/public/space/meteor-showers.json).

The rows are held to what the IMO calendar prints (a few read off the PDF
by eye) and to each other: a maximum must fall inside its own activity
period, and its date and its solar longitude - two columns of the same
table - must describe the same moment of the year.

Usage:
    python3 tools/pipeline/test_meteor_showers.py
"""

import datetime
import json
import math

from generate_meteor_showers import OUTPUT, YEAR
from geo_test_support import check, finish


def solar_longitude(date: datetime.datetime) -> float:
    """The Sun's ecliptic longitude of date, degrees, to a few hundredths (Meeus ch. 25, low accuracy)."""
    n = (date - datetime.datetime(2000, 1, 1, 12)).total_seconds() / 86400
    mean = (280.460 + 0.9856474 * n) % 360
    anomaly = math.radians((357.528 + 0.9856003 * n) % 360)
    return (mean + 1.915 * math.sin(anomaly) + 0.020 * math.sin(2 * anomaly)) % 360


def day_of_year(month_day: list[int]) -> int:
    return datetime.date(YEAR, month_day[0], month_day[1]).timetuple().tm_yday


def main() -> None:
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    showers = {s["code"]: s for s in data["showers"]}
    check(data["year"] == YEAR and len(showers) == len(data["showers"]) == 37, "37 showers, each code once")

    # Read off Table 5 of the 2026 calendar.
    expected = {
        "QUA": ("Quadrantids", 10, [1, 3], 283.15, 230, 49, 41, 80),
        "LYR": ("April Lyrids", 6, [4, 22], 32.32, 271, 34, 49, 18),
        "ETA": ("η-Aquariids", 31, [5, 6], 45.5, 338, -1, 66, 50),
        "PER": ("Perseids", 7, [8, 13], 140.0, 48, 58, 59, 100),
        "ORI": ("Orionids", 8, [10, 21], 208.0, 95, 16, 66, 20),
        "LEO": ("Leonids", 13, [11, 17], 235.27, 152, 22, 71, 15),
        "GEM": ("Geminids", 4, [12, 14], 262.2, 112, 33, 35, 150),
        "URS": ("Ursids", 15, [12, 22], 270.7, 217, 76, 33, 10),
        "ACE": ("α-Centaurids", 102, [2, 8], 319.4, 211, -58, 58, 6),
        "PUP": ("Puppid-Velids", 301, [12, 7], 255.0, 123, -45, 44, 10),
    }
    for code, (name, iau, peak, longitude, ra, dec, speed, zhr) in expected.items():
        s = showers.get(code)
        same = s is not None and (s["name"], s["iau"], s["peak"], s["solarLongitude"], s["ra"], s["dec"], s["speedKmS"], s["zhr"]) == (name, iau, peak, longitude, ra, dec, speed, zhr)
        check(same, f"{code} {name}: as printed")
    variable = sorted(code for code, s in showers.items() if s["zhr"] is None)
    check(variable == ["AMO", "JBO", "PHO", "PPU"], f"the showers of variable rate: {', '.join(variable)}")

    for code, s in showers.items():
        start, end, peak = day_of_year(s["start"]), day_of_year(s["end"]), day_of_year(s["peak"])
        inside = start <= peak <= end if start <= end else peak >= start or peak <= end
        # The J2000 longitude the calendar uses runs 0.37° behind the longitude of date in 2026.
        at_noon = datetime.datetime(YEAR, s["peak"][0], s["peak"][1], 12)
        off = ((solar_longitude(at_noon) - 0.37 - s["solarLongitude"] + 180) % 360) - 180
        ok = inside and abs(off) < 1.5 and 0 <= s["ra"] < 360 and -90 <= s["dec"] <= 90 and 10 <= s["speedKmS"] <= 72
        check(ok, f"{code}: maximum inside its activity period, date and solar longitude {off:+.2f}° apart")
    finish()


if __name__ == "__main__":
    main()
