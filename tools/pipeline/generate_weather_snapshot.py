#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the weather layers' offline snapshot.

The weather layers are live: the browser fetches clouds, rain and the wind
field itself. This script bakes one real snapshot of the same products into
app/public/weather/, which a layer shows - under a chip that says "offline"
and names the snapshot's date - when its live fetch fails. It also bakes the
city lights the day/night layer puts on the night side, which never change.

Outputs:
    clouds.jpg          NOAA/NESDIS GMGSI longwave infrared mosaic, greyscale
                        (cold cloud tops bright), 2048x1024 equirectangular,
                        no data poleward of about 72.7 degrees
    precipitation.png   NASA GPM IMERG half-hourly precipitation rate in the
                        GIBS palette (rain and snow ramps), transparent where dry
    wind-10m.bin        NOAA GFS 1 degree, u then v, int8, value = byte * scale
    wind-250hpa.bin     the same at 250 hPa (the jet-stream level)
    temperature.bin     GFS 2 m air temperature, int8, degC = byte * scale
    night-lights.jpg    NASA Black Marble 2016 (VIIRS day/night band), 2048x1024
    snapshot.json       valid times, grid, scales and sources of the above

Grids are GFS's own: 181 rows from 90N to 90S, 360 columns from 0E eastward.
Images are longitude -180..180 left to right, north up.

Sources (all U.S. Government works, public domain, no key):
    GFS      https://noaa-gfs-bdp-pds.s3.amazonaws.com  (NOAA Open Data Dissemination)
             single GRIB2 messages fetched by byte range from the .idx inventory
    GMGSI    https://nowcoast.noaa.gov/geoserver/satellite/wms
    IMERG, Black Marble
             https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi

Usage:
    python3 tools/pipeline/generate_weather_snapshot.py            # the latest of everything
    python3 tools/pipeline/generate_weather_snapshot.py --offline  # rebuild from .cache only

Raw downloads are cached in tools/pipeline/.cache/weather/, named by product
time, so a re-run within the same hour fetches nothing. Needs numpy and
pillow; GRIB2 is decoded by grib2.py beside this file.
"""

import argparse
import io
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

import grib2
from fetch_cache import CACHE_DIR, USER_AGENT

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "weather"
CACHE = CACHE_DIR / "weather"

GFS_BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
NOWCOAST_WMS = "https://nowcoast.noaa.gov/geoserver/satellite/wms"
GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
GIBS_WMTS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi"

IMAGE_WIDTH, IMAGE_HEIGHT = 2048, 1024
CLOUD_LAYER = "global_longwave_imagery_mosaic"
PRECIP_LAYER = "IMERG_Precipitation_Rate_30min"
NIGHT_LIGHTS_LAYER = "VIIRS_Black_Marble"
NIGHT_LIGHTS_TIME = "2016-01-01"

#: name -> (GRIB inventory keys for u and v)
WIND_LEVELS = {
    "wind-10m": ("UGRD:10 m above ground", "VGRD:10 m above ground"),
    "wind-250hpa": ("UGRD:250 mb", "VGRD:250 mb"),
}
TEMPERATURE_KEY = "TMP:2 m above ground"
TEMPERATURE_SCALE = 0.75
KELVIN = 273.15


def fetch(url: str, name: str, *, byte_range: tuple[int, int] | None = None, offline: bool = False) -> bytes:
    """GET `url` (optionally one byte range), cached under .cache/weather/`name`."""
    path = CACHE / name
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    if offline:
        raise FileNotFoundError(f"{name} is not in the cache and --offline was given")
    headers = {"User-Agent": USER_AGENT}
    if byte_range:
        headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
    print(f"fetching {url}" + (f" [{headers.get('Range')}]" if byte_range else ""), file=sys.stderr)
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=180) as response:
        data = response.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(data)
    partial.replace(path)
    return data


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def compact(moment: datetime) -> str:
    return moment.strftime("%Y%m%dT%H%MZ")


# --- GFS -------------------------------------------------------------------


def gfs_file_url(cycle: datetime, forecast_hours: int) -> str:
    return (
        f"{GFS_BUCKET}/gfs.{cycle:%Y%m%d}/{cycle:%H}/atmos/"
        f"gfs.t{cycle:%H}z.pgrb2.1p00.f{forecast_hours:03d}"
    )


def parse_inventory(text: str) -> dict[str, tuple[int, int | None]]:
    """wgrib2 .idx lines `n:offset:d=YYYYMMDDHH:VAR:level:forecast:` -> "VAR:level" -> (start, end)."""
    rows = [line.split(":") for line in text.splitlines() if line.strip()]
    ranges: dict[str, tuple[int, int | None]] = {}
    for i, row in enumerate(rows):
        end = int(rows[i + 1][1]) - 1 if i + 1 < len(rows) else None
        ranges.setdefault(f"{row[3]}:{row[4]}", (int(row[1]), end))
    return ranges


def latest_gfs_run(now: datetime, offline: bool) -> tuple[datetime, int, dict[str, tuple[int, int | None]]]:
    """The newest run on the bucket and its forecast hour (a multiple of 3) nearest `now`."""
    cycle = now.replace(minute=0, second=0, microsecond=0)
    cycle -= timedelta(hours=cycle.hour % 6)
    for _ in range(8):
        hours = round((now - cycle).total_seconds() / 3600 / 3) * 3
        name = f"gfs_{cycle:%Y%m%d%H}_f{hours:03d}.idx"
        try:
            text = fetch(gfs_file_url(cycle, hours) + ".idx", name, offline=offline).decode("ascii")
            return cycle, hours, parse_inventory(text)
        except (urllib.error.HTTPError, FileNotFoundError):
            cycle -= timedelta(hours=6)
    raise RuntimeError("no GFS run found in the last two days")


def gfs_field(cycle: datetime, hours: int, inventory: dict, key: str, offline: bool) -> grib2.Grib2Field:
    start, end = inventory[key]
    if end is None:
        raise RuntimeError(f"{key} is the last message of the file: its length is unknown")
    name = f"gfs_{cycle:%Y%m%d%H}_f{hours:03d}_{re.sub(r'[^A-Za-z0-9]+', '_', key)}.grib2"
    field = grib2.decode(fetch(gfs_file_url(cycle, hours), name, byte_range=(start, end), offline=offline))
    if (field.ni, field.nj, field.lat_first, field.lat_step, field.lon_first, field.lon_step) != (360, 181, 90.0, -1.0, 0.0, 1.0):
        raise RuntimeError(f"{key}: unexpected grid {field.ni}x{field.nj}")
    return field


def quantise(values: np.ndarray, scale: float) -> np.ndarray:
    return np.clip(np.rint(values / scale), -127, 127).astype(np.int8)


def bake_gfs(now: datetime, offline: bool) -> dict:
    cycle, hours, inventory = latest_gfs_run(now, offline)
    valid = cycle + timedelta(hours=hours)
    meta: dict = {
        "source": "NOAA/NCEP Global Forecast System, 1 degree, via NOAA Open Data Dissemination",
        "cycle": iso(cycle),
        "forecastHours": hours,
        "validTime": iso(valid),
        "grid": {"ni": 360, "nj": 181, "latFirst": 90, "latStep": -1, "lonFirst": 0, "lonStep": 1},
    }
    for name, (u_key, v_key) in WIND_LEVELS.items():
        u = gfs_field(cycle, hours, inventory, u_key, offline).values
        v = gfs_field(cycle, hours, inventory, v_key, offline).values
        # One byte per component: the scale is whatever fits the day's strongest wind.
        scale = float(np.ceil(max(np.abs(u).max(), np.abs(v).max()) / 127 * 100) / 100)
        (OUTPUT_DIR / f"{name}.bin").write_bytes(quantise(u, scale).tobytes() + quantise(v, scale).tobytes())
        meta[name] = {"file": f"{name}.bin", "scale": scale, "units": "m/s", "components": ["u", "v"]}
    celsius = gfs_field(cycle, hours, inventory, TEMPERATURE_KEY, offline).values - KELVIN
    (OUTPUT_DIR / "temperature.bin").write_bytes(quantise(celsius, TEMPERATURE_SCALE).tobytes())
    meta["temperature"] = {"file": "temperature.bin", "scale": TEMPERATURE_SCALE, "units": "degC"}
    return meta


# --- images ----------------------------------------------------------------


def wms_url(base: str, layer: str, image_format: str, time: str | None, transparent: bool = False) -> str:
    return (
        f"{base}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS={layer}&STYLES=&CRS=EPSG:4326"
        f"&BBOX=-90,-180,90,180&WIDTH={IMAGE_WIDTH}&HEIGHT={IMAGE_HEIGHT}&FORMAT=image/{image_format}"
        + ("&TRANSPARENT=true" if transparent else "")
        + (f"&TIME={time}" if time else "")
    )


def parse_time(text: str) -> datetime:
    text = text.strip().replace(".000Z", "Z")
    form = "%Y-%m-%dT%H:%M:%SZ" if "T" in text else "%Y-%m-%d"
    return datetime.strptime(text, form).replace(tzinfo=timezone.utc)


def latest_cloud_time(now: datetime, offline: bool) -> datetime:
    """The newest hour of the GMGSI mosaic, from the WMS capabilities' time dimension."""
    name = f"nowcoast_caps_{now:%Y%m%dT%H}.xml"
    text = fetch(f"{NOWCOAST_WMS}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0", name, offline=offline).decode("utf-8")
    layer = text[text.index(f"<Name>{CLOUD_LAYER}</Name>") :]
    times = re.search(r'<Dimension name="time"[^>]*>([^<]+)</Dimension>', layer)
    if not times:
        raise RuntimeError("the GMGSI layer lists no times")
    return max(parse_time(t) for t in times.group(1).split(","))


def latest_gibs_time(layer: str, now: datetime, offline: bool) -> datetime:
    """The end of the last period in the layer's WMTS time domain."""
    name = f"gibs_domain_{layer}_{now:%Y%m%dT%H}.xml"
    text = fetch(f"{GIBS_WMTS}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=DescribeDomains&LAYER={layer}", name, offline=offline).decode("utf-8")
    domain = re.search(r"<Domain>([^<]+)</Domain>", text)
    if not domain:
        raise RuntimeError(f"{layer} has no time domain")
    return max(parse_time(period.split("/")[1]) for period in domain.group(1).split(","))


def bake_clouds(now: datetime, offline: bool) -> dict:
    time = latest_cloud_time(now, offline)
    data = fetch(wms_url(NOWCOAST_WMS, CLOUD_LAYER, "png", iso(time)), f"gmgsi_lw_{compact(time)}.png", offline=offline)
    image = Image.open(io.BytesIO(data)).convert("L")
    image.save(OUTPUT_DIR / "clouds.jpg", quality=80, optimize=True)
    return {
        "file": "clouds.jpg",
        "validTime": iso(time),
        "source": "NOAA/NESDIS Global Mosaic of Geostationary Satellite Imagery (GMGSI), longwave infrared, via NOAA nowCOAST",
    }


def bake_precipitation(now: datetime, offline: bool) -> dict:
    time = latest_gibs_time(PRECIP_LAYER, now, offline)
    data = fetch(wms_url(GIBS_WMS, PRECIP_LAYER, "png", iso(time), transparent=True), f"imerg_{compact(time)}.png", offline=offline)
    rgba = np.array(Image.open(io.BytesIO(data)).convert("RGBA"))
    # Dry pixels to transparent black, so that linear filtering in the app
    # fades a rain cell's own colour out instead of blending toward grey.
    rgba[rgba[..., 3] == 0] = 0
    colours = np.unique(rgba.reshape(-1, 4), axis=0)
    if len(colours) > 256:
        raise RuntimeError(f"IMERG image has {len(colours)} colours: not the palette product expected")
    # The product is a palette of well under 256 colours: an indexed PNG holds it exactly.
    palette_index = {tuple(c): i for i, c in enumerate(colours.tolist())}
    keys = (rgba[..., 0].astype(np.uint32) << 24) | (rgba[..., 1].astype(np.uint32) << 16) | (rgba[..., 2].astype(np.uint32) << 8) | rgba[..., 3]
    lookup = {(c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]: i for c, i in palette_index.items()}
    unique_keys, inverse = np.unique(keys, return_inverse=True)
    indices = np.array([lookup[int(k)] for k in unique_keys], dtype=np.uint8)[inverse].reshape(keys.shape)
    image = Image.fromarray(indices, mode="P")
    image.putpalette([int(v) for c in colours for v in c[:3]])
    image.save(OUTPUT_DIR / "precipitation.png", optimize=True, transparency=bytes(int(c[3]) for c in colours))
    return {
        "file": "precipitation.png",
        "validTime": iso(time),
        "source": "NASA GPM IMERG half-hourly precipitation rate (early run), via NASA GIBS",
    }


def bake_night_lights(offline: bool) -> dict:
    data = fetch(wms_url(GIBS_WMS, NIGHT_LIGHTS_LAYER, "jpeg", NIGHT_LIGHTS_TIME), "black_marble_2016.jpg", offline=offline)
    Image.open(io.BytesIO(data)).convert("RGB").save(OUTPUT_DIR / "night-lights.jpg", quality=84, optimize=True)
    return {
        "file": "night-lights.jpg",
        "year": 2016,
        "source": "NASA Earth Observatory Black Marble 2016 (Suomi NPP VIIRS day/night band), via NASA GIBS",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--offline", action="store_true", help="use only what is already in the cache")
    parser.add_argument("--now", help="ISO 8601 UTC instant to treat as now (with --offline, to rebuild an old snapshot)")
    args = parser.parse_args()
    now = parse_time(args.now) if args.now else datetime.now(timezone.utc)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "generated": iso(now),
        "clouds": bake_clouds(now, args.offline),
        "precipitation": bake_precipitation(now, args.offline),
        "gfs": bake_gfs(now, args.offline),
        "nightLights": bake_night_lights(args.offline),
    }
    (OUTPUT_DIR / "snapshot.json").write_text(json.dumps(snapshot, indent=1) + "\n", encoding="utf-8")
    for path in sorted(OUTPUT_DIR.iterdir()):
        print(f"wrote {path.relative_to(REPO_ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
