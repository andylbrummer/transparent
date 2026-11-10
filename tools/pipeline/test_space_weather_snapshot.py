#!/usr/bin/env python3
"""
Data checks for the baked space-weather snapshot (app/public/space/) - and,
through it, for the way the app lays the OVATION aurora grid on the globe.

The auroral ovals are rings around the geomagnetic poles, not the
geographic ones, and are widest and brightest toward local midnight. If
the grid were mirrored, shifted in longitude or flipped north-south, the
baked image would fail these:

- each oval's centre of light is near that hemisphere's geomagnetic pole
  (NOAA, from WMM2025: 80.8°N 72.8°W and 80.8°S 107.2°E), which puts the
  northern oval's centre on the Canadian side of the geographic pole and
  the southern one's on the Australian side;
- each oval's light is weighted toward the night side: seen from its
  geomagnetic pole, the brightness-weighted mean direction of the oval
  is within 75° of the direction of the point opposite the Sun at the
  forecast time.

Usage:
    python3 tools/pipeline/test_space_weather_snapshot.py
Needs pillow.
"""

import datetime
import json
import math

from PIL import Image

from generate_space_weather_snapshot import HEIGHT, OUTPUT_DIR, WIDTH
from geo_test_support import check, finish

# NCEI "Wandering of the Geomagnetic Poles", WMM2025 at 2025.0 (geocentric latitude).
GEOMAGNETIC_NORTH = (80.79, -72.76)


def separation_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    a, b = math.radians(lat1), math.radians(lat2)
    c = math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(math.radians(lon1 - lon2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def unit(lat: float, lon: float) -> tuple[float, float, float]:
    a, b = math.radians(lat), math.radians(lon)
    return (math.cos(a) * math.cos(b), math.cos(a) * math.sin(b), math.sin(a))


def hemisphere(pixels, north: bool):
    """(weight, unit vector) of every pixel poleward of 45° in one hemisphere."""
    for row in range(HEIGHT):
        lat = 90 - row
        if (lat > 45) if north else (lat < -45):
            for column in range(WIDTH):
                if pixels[column, row] > 0:
                    yield pixels[column, row], unit(lat, column - 180)


def centre_of_light(pixels, north: bool) -> tuple[float, float]:
    """Latitude and longitude of the middle of one hemisphere's oval: the mean direction of every pixel where aurora is at all likely, each counted once (weighting by brightness would pull the middle toward the brighter night side)."""
    x = y = z = 0.0
    for weight, (px, py, pz) in hemisphere(pixels, north):
        if weight >= 2:
            x, y, z = x + px, y + py, z + pz
    return math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))


def tangent(pole: tuple[float, float, float], point: tuple[float, float, float]) -> tuple[float, float, float]:
    """The direction from `pole` toward `point` along the sphere: `point` with its part along `pole` removed."""
    d = sum(a * b for a, b in zip(pole, point))
    return tuple(b - d * a for a, b in zip(pole, point))


def night_side_offset_deg(pixels, north: bool, pole: tuple[float, float], antisolar: tuple[float, float]) -> float:
    """Angle at the geomagnetic pole between the oval's brightness-weighted mean direction and the antisolar point."""
    m = unit(*pole)
    total = [0.0, 0.0, 0.0]
    for weight, point in hemisphere(pixels, north):
        t = tangent(m, point)
        for i in range(3):
            # Squared, so that the bright arc outweighs the faint ring.
            total[i] += weight * weight * t[i]
    night = tangent(m, unit(*antisolar))
    c = sum(a * b for a, b in zip(total, night)) / (math.hypot(*total) * math.hypot(*night))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def main() -> None:
    snapshot = json.loads((OUTPUT_DIR / "space-weather.json").read_text(encoding="utf-8"))
    image = Image.open(OUTPUT_DIR / "aurora.png")
    check(image.size == (WIDTH, HEIGHT) and image.mode == "L", f"aurora.png is {WIDTH} x {HEIGHT} greyscale")
    pixels = image.load()
    peak = max(pixels[c, r] for c in range(WIDTH) for r in range(HEIGHT))
    check(0 < peak <= 100, f"values are percent (peak {peak})")
    # SWPC's grid carries stray 1 % values along the equator row; the app draws nothing below 1.5 %.
    check(all(pixels[c, r] <= 1 for c in range(WIDTH) for r in range(HEIGHT // 2 - 40, HEIGHT // 2 + 41)), "no aurora within 40° of the equator")

    north = centre_of_light(pixels, True)
    south = centre_of_light(pixels, False)
    off_north = separation_deg(north[0], north[1], *GEOMAGNETIC_NORTH)
    off_south = separation_deg(south[0], south[1], -GEOMAGNETIC_NORTH[0], GEOMAGNETIC_NORTH[1] + 180)
    check(off_north < 10, f"northern oval centred {off_north:.1f}° from the geomagnetic north pole ({north[0]:.1f}, {north[1]:.1f})")
    check(off_south < 10, f"southern oval centred {off_south:.1f}° from the geomagnetic south pole ({south[0]:.1f}, {south[1]:.1f})")
    check(-130 < north[1] < -20, "northern oval is displaced toward North America")
    check(60 < south[1] < 160, "southern oval is displaced toward Australia")

    forecast = datetime.datetime.fromisoformat(snapshot["aurora"]["forecast"].replace("Z", "+00:00"))
    observed = datetime.datetime.fromisoformat(snapshot["aurora"]["observed"].replace("Z", "+00:00"))
    check(datetime.timedelta(0) < forecast - observed < datetime.timedelta(hours=2), "the forecast is 0 - 2 h ahead of its observation")
    # The point opposite the Sun at the forecast time: the Sun's declination to a degree, no equation of time.
    hours = forecast.hour + forecast.minute / 60
    day_of_year = forecast.timetuple().tm_yday
    declination = -23.44 * math.cos(2 * math.pi * (day_of_year + 10) / 365.25)
    antisolar = (-declination, ((-hours * 15 + 180) % 360) - 180)
    south_pole = (-GEOMAGNETIC_NORTH[0], GEOMAGNETIC_NORTH[1] + 180)
    for name, is_north, pole in (("northern", True, GEOMAGNETIC_NORTH), ("southern", False, south_pole)):
        off = night_side_offset_deg(pixels, is_north, pole, antisolar)
        check(off < 75, f"{name} oval is brightest on the night side: {off:.0f}° from magnetic midnight")

    wind = snapshot["solarWind"]
    check(200 < wind["speedKmS"] < 2000 and 0 < wind["densityCm3"] < 200 and abs(wind["bzNt"]) < 100, f"solar wind is plausible: {wind}")
    check(snapshot["kp"] is not None and 0 <= snapshot["kp"]["kp"] <= 9, f"Kp is on its scale: {snapshot['kp']}")
    power = snapshot["aurora"]["hemisphericPowerGw"]
    check(power is not None and 0 < power["north"] < 500 and 0 < power["south"] < 500, f"hemispheric power in gigawatts: {power}")
    finish()


if __name__ == "__main__":
    main()
