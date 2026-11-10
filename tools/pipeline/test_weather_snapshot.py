#!/usr/bin/env python3
"""
Data checks for generate_weather_snapshot.py's output and for grib2.py.

The snapshot is one arbitrary day's weather, so nothing here pins a value of
the day. The checks are of shape, of bookkeeping (valid times, scales) and of
climate: things true of any day's atmosphere - westerly jet streams in both
mid-latitudes, easterly trades, a warm equator - and of the Earth at night
(the Nile is lit, the Sahara is not). A field decoded upside down, shifted in
longitude or scaled wrongly fails them.

grib2.py is checked against ecCodes 2.50: fixtures/grib2_gfs_u250_subregion.json
holds a real GFS subregion (U at 250 hPa, 20-60N 120-160E, 2026-11-09 12Z +3 h)
twice - as NOMADS served it (simple packing) and re-encoded by ecCodes with
complex packing and second-order spatial differencing, NCEP's packing for the
global files - with ecCodes' own decode of sample points.

Usage:
    python3 tools/pipeline/test_weather_snapshot.py
"""

import base64
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

import grib2
from generate_weather_snapshot import IMAGE_HEIGHT, IMAGE_WIDTH, OUTPUT_DIR, parse_inventory, parse_time
from geo_test_support import check, finish

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "grib2_gfs_u250_subregion.json"
NI, NJ = 360, 181


def check_grib2() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for name, case in fixture.items():
        field = grib2.decode(base64.b64decode(case["base64"]))
        flat = field.values.ravel()
        worst = max(abs(flat[int(i)] - v) for i, v in case["picks"].items())
        check(worst < 1e-5, f"grib2 {name} packing: sample points match ecCodes (worst {worst:.1e})")
        check(abs(flat.sum() - case["sum"]) < 1e-3, f"grib2 {name} packing: sum of all points matches ecCodes")
        check((field.ni, field.nj) == (41, 41), f"grib2 {name}: 41x41 grid")
        check((field.lat_first, field.lat_step, field.lon_first, field.lon_step) == (20.0, 1.0, 120.0, 1.0), f"grib2 {name}: grid origin and steps")
        check(field.reference_time == "2026-11-09T12:00:00Z" and field.forecast_hours == 3, f"grib2 {name}: run and forecast hour")
        check((field.category, field.number, field.level_type, field.level_value) == (2, 2, 100, 25000.0), f"grib2 {name}: U wind at 250 hPa")
    try:
        grib2.decode(b"GRIB" + bytes(40))
        check(False, "grib2 rejects a message that is not edition 2")
    except grib2.Grib2Error:
        check(True, "grib2 rejects a message that is not edition 2")


def check_inventory() -> None:
    text = "1:0:d=2026110912:PRMSL:mean sea level:anl:\n2:82365:d=2026110912:UGRD:250 mb:anl:\n3:93077:d=2026110912:VGRD:250 mb:anl:\n"
    ranges = parse_inventory(text)
    check(ranges["UGRD:250 mb"] == (82365, 93076), "inventory: a message runs to the byte before the next")
    check(ranges["VGRD:250 mb"] == (93077, None), "inventory: the last message has no known end")


def load_grid(meta: dict, name: str, components: int) -> np.ndarray:
    raw = np.frombuffer((OUTPUT_DIR / meta[name]["file"]).read_bytes(), dtype=np.int8)
    check(raw.size == components * NI * NJ, f"{name}: {components} x {NI} x {NJ} bytes")
    return raw.astype(np.float64).reshape(components, NJ, NI) * meta[name]["scale"]


def band_mean(field: np.ndarray, lat_from: float, lat_to: float) -> float:
    """Area-weighted mean over the rows between two latitudes (rows run 90N to 90S)."""
    lats = 90.0 - np.arange(NJ)
    rows = (lats >= min(lat_from, lat_to)) & (lats <= max(lat_from, lat_to))
    weights = np.cos(np.radians(lats[rows]))
    return float((field[rows].mean(axis=1) * weights).sum() / weights.sum())


def check_gfs(snapshot: dict) -> None:
    gfs = snapshot["gfs"]
    cycle, valid = parse_time(gfs["cycle"]), parse_time(gfs["validTime"])
    check(cycle.hour % 6 == 0 and cycle.minute == 0, f"GFS run {gfs['cycle']} is a 00/06/12/18Z cycle")
    check(valid - cycle == timedelta(hours=gfs["forecastHours"]) and gfs["forecastHours"] % 3 == 0, "GFS valid time = run + forecast hours, on the 3-hourly files")
    check(gfs["grid"] == {"ni": NI, "nj": NJ, "latFirst": 90, "latStep": -1, "lonFirst": 0, "lonStep": 1}, "GFS grid is 1 degree, 90N to 90S from 0E")

    u250, v250 = load_grid(gfs, "wind-250hpa", 2)
    speed250 = np.hypot(u250, v250)
    check(30 < speed250.max() < 130, f"250 hPa: strongest wind {speed250.max():.0f} m/s is a jet-stream speed")
    for name, a, b in (("northern", 30, 60), ("southern", -60, -30)):
        mean = band_mean(u250, a, b)
        check(10 < mean < 45, f"250 hPa: {name} mid-latitude mean zonal wind is westerly ({mean:+.1f} m/s)")
    check(abs(band_mean(v250, -90, 90)) < 2, "250 hPa: no net meridional wind over the globe")
    check(band_mean(speed250, -10, 10) < band_mean(speed250, 30, 50), "250 hPa: the equator is calmer than the jet latitudes")

    u10, v10 = load_grid(gfs, "wind-10m", 2)
    speed10 = np.hypot(u10, v10)
    check(12 < speed10.max() < 60, f"10 m: strongest wind {speed10.max():.0f} m/s")
    check(4 < band_mean(speed10, -90, 90) < 10, f"10 m: global mean speed {band_mean(speed10, -90, 90):.1f} m/s")
    for name, a, b in (("northern", 8, 22), ("southern", -22, -8)):
        mean = band_mean(u10, a, b)
        check(mean < -1.5, f"10 m: {name} trade winds are easterly ({mean:+.1f} m/s)")
    check(band_mean(u10, -60, -45) > 3, f"10 m: the roaring forties and fifties are westerly ({band_mean(u10, -60, -45):+.1f} m/s)")
    check(band_mean(speed250, -90, 90) > 2 * band_mean(speed10, -90, 90), "250 hPa wind is much stronger than 10 m wind")

    (celsius,) = load_grid(gfs, "temperature", 1)
    check(-80 < celsius.min() < -15 and 30 < celsius.max() < 55, f"2 m temperature spans {celsius.min():.0f} to {celsius.max():.0f} degC")
    check(22 < band_mean(celsius, -10, 10) < 30, f"equatorial mean {band_mean(celsius, -10, 10):.1f} degC")
    check(band_mean(celsius, -90, -75) < -15, f"Antarctic plateau mean {band_mean(celsius, -90, -75):.1f} degC")
    # Longitude registration: the Sahara (25N, 0-30E) is far warmer by day or night than
    # the Tibetan plateau at the same latitude band (32N, 80-95E), 4-5 km up.
    sahara = celsius[90 - 25, 0:31].mean()
    tibet = celsius[90 - 33, 80:96].mean()
    check(sahara - tibet > 12, f"Sahara ({sahara:.0f} degC) is warmer than Tibet ({tibet:.0f} degC)")


def pixel(lat: float, lon: float) -> tuple[int, int]:
    """(row, column) of a place in a -180..180, north-up image."""
    return int((90 - lat) / 180 * IMAGE_HEIGHT), int((lon + 180) / 360 * IMAGE_WIDTH)


def box(image: np.ndarray, lat: float, lon: float, half: int = 6) -> np.ndarray:
    row, column = pixel(lat, lon)
    return image[row - half : row + half + 1, column - half : column + half + 1]


def check_images(snapshot: dict, now: datetime) -> None:
    clouds = Image.open(OUTPUT_DIR / snapshot["clouds"]["file"])
    check(clouds.size == (IMAGE_WIDTH, IMAGE_HEIGHT) and clouds.mode == "L", "clouds: 2048x1024 greyscale")
    grey = np.array(clouds).astype(np.float64) / 255
    inside = grey[pixel(60, 0)[0] : pixel(-60, 0)[0]]
    check(0.03 < (inside > 0.6).mean() < 0.4, f"clouds: {(inside > 0.6).mean():.0%} of 60S-60N is cold cloud top")
    check((inside < 0.3).mean() > 0.15, f"clouds: {(inside < 0.3).mean():.0%} of 60S-60N is warm clear surface")
    check(grey[: pixel(75, 0)[0]].min() > 0.95, "clouds: no data poleward of the mosaic (white fill)")
    # Warm ground reads dark in the infrared; the eastern Sahara is clear almost every day,
    # and warmer than the same latitude of the Antarctic-facing Southern Ocean.
    check(box(grey, 23, 28, 20).mean() < box(grey, -62, 28, 20).mean(), "clouds: the Sahara is darker (warmer) than the Southern Ocean")

    rain = Image.open(OUTPUT_DIR / snapshot["precipitation"]["file"]).convert("RGBA")
    check(rain.size == (IMAGE_WIDTH, IMAGE_HEIGHT), "precipitation: 2048x1024")
    rgba = np.array(rain)
    wet = rgba[..., 3] > 0
    check(0.01 < wet.mean() < 0.2, f"precipitation: {wet.mean():.1%} of the globe has rain or snow")
    check(rgba[~wet].max() == 0, "precipitation: dry pixels are transparent black")
    tropics = wet[pixel(15, 0)[0] : pixel(-15, 0)[0]].mean()
    deserts = min(box(wet, 23, 15, 40).mean(), box(wet, -24, 133, 30).mean())
    check(tropics > 0.02 and tropics > deserts, f"precipitation: more of the tropics ({tropics:.1%}) is wet than of a desert ({deserts:.1%})")

    lights = Image.open(OUTPUT_DIR / snapshot["nightLights"]["file"])
    check(lights.size == (IMAGE_WIDTH, IMAGE_HEIGHT) and lights.mode == "RGB", "night lights: 2048x1024 RGB")
    glow = np.array(lights).astype(np.float64).max(axis=2)
    lit = {"Cairo": (30.05, 31.25), "Delhi": (28.6, 77.2), "Jakarta": (-6.2, 106.85), "Sao Paulo": (-23.55, -46.63), "Chicago": (41.85, -87.65)}
    dark = {"Sahara": (23.0, 12.0), "central Pacific": (0.0, -150.0), "Amazon": (-5.0, -65.0), "Tibet": (34.0, 88.0)}
    darkest_city = min(box(glow, *place, half=2).max() for place in lit.values())
    brightest_wild = max(box(glow, *place, half=2).max() for place in dark.values())
    for name, place in lit.items():
        check(box(glow, *place, half=2).max() > 150, f"night lights: {name} is lit ({box(glow, *place, half=2).max():.0f}/255)")
    # Black Marble shows unlit land faintly moonlit, snow and sand most of all.
    check(brightest_wild < 100 and brightest_wild < darkest_city, f"night lights: deserts, ocean and forest are dark (at most {brightest_wild:.0f}/255)")
    # The Nile: a lit ribbon through the desert between Cairo and Luxor.
    nile = box(glow, 27.2, 31.1, half=3).max()
    check(nile > 2 * box(glow, 27.2, 27.0, half=3).max(), f"night lights: the Nile valley ({nile:.0f}) outshines the desert west of it")

    for name in ("clouds", "precipitation"):
        valid = parse_time(snapshot[name]["validTime"])
        check(valid <= parse_time(snapshot["generated"]), f"{name}: valid time {snapshot[name]['validTime']} is not after the bake")
        check(now - valid < timedelta(days=3650), f"{name}: valid time parses as a date")


def main() -> None:
    check_grib2()
    check_inventory()
    snapshot = json.loads((OUTPUT_DIR / "snapshot.json").read_text(encoding="utf-8"))
    check_gfs(snapshot)
    check_images(snapshot, datetime.now(timezone.utc))
    total = sum(path.stat().st_size for path in OUTPUT_DIR.iterdir())
    check(total < 1_500_000, f"snapshot is {total / 1e6:.2f} MB in all")
    finish()


if __name__ == "__main__":
    main()
