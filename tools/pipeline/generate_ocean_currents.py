#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: ocean surface currents.

Writes app/public/geo/ocean-currents.bin and ocean-currents.json: the
mean surface current of the world ocean on the 1-degree grid the app's
wind particles already run on (the GFS grid: 360 x 181, from 90 N and
0 E, one degree a step), and the names of the few great currents an open
source places on the map.

Currents:
    OSCAR (Ocean Surface Current Analysis Real-time) third-degree
    velocities, Earth & Space Research: Bonjean, F. & Lagerloef, G.S.E.
    (2002), Diagnostic model and analysis of the surface currents in the
    tropical Pacific Ocean, J. Phys. Oceanogr. 32, 2938-2954. The currents
    of the top 30 m, computed from satellite sea-surface height, wind and
    temperature: a satellite-derived analysis, not drifter measurements.
    Read from NOAA CoastWatch's ERDDAP (dataset jplOscar, "may be used
    and redistributed for free"), which holds the 5-day composites from
    December 2011 to September 2014; every TIME_STRIDE-th of them is
    averaged here, so what is drawn is the mean circulation of those
    three years - the gyres, the western boundary currents, the
    equatorial currents, the Antarctic Circumpolar Current - with the
    eddies averaged away. The app says "mean, 2011-2014", not "now".

    Each 1-degree value is the mean of the nine third-degree nodes round
    it. Land, ice and anything poleward of the product's 80 degrees are 0,
    and the app spawns no particle on a cell that does not move.

Names:
    Wikidata (CC0): items that are an ocean current (P31/P279* Q129558)
    and have a coordinate. Few do - the Gulf Stream, the Agulhas, the
    Oyashio and a handful more - and no position is invented for the
    rest: the Kuroshio and the Humboldt Current are drawn but not named.

Output:
    ocean-currents.bin   two int8 grids, eastward then northward, value x scale = m/s
    ocean-currents.json  {source, period, fields, scale, grid, maxSpeed, names: [{name, lon, lat}]}

Usage:
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install numpy scipy
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_ocean_currents.py
"""

import datetime
import json
import sys
import urllib.parse

import numpy as np
from scipy.io import netcdf_file

from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, write_json

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar.nc"
# 117 composites, 2011-12-06 .. 2014-09-26; every third is a 39-field mean over the same span.
TIME_COUNT, TIME_STRIDE = 117, 3
# Composites per request: keeps each download near 100 MB.
CHUNK = 13
NI, NJ = 360, 181
SCALE = 0.01
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql?format=json&query="
NAMES_QUERY = """
SELECT ?item ?itemLabel ?lat ?lon ?sitelinks WHERE {
  ?item wdt:P31/wdt:P279* wd:Q129558 .
  ?item wikibase:sitelinks ?sitelinks .
  ?item p:P625/psv:P625 ?c . ?c wikibase:geoLatitude ?lat ; wikibase:geoLongitude ?lon .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}"""
# Wikidata's class also holds tidal races and rapids: an ocean current here is one named as such
# and written up in at least this many Wikipedias.
NAME_WORDS = ("Current", "Stream", "Throughflow")
MIN_SITELINKS = 8


def load_mean() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, tuple[float, float]]:
    """(lat, lon, mean u, mean v, (first, last) epoch seconds): third-degree grids, lat descending from 80, lon 20..420."""
    total_u = total_v = count = None
    times: list[float] = []
    indices = list(range(0, TIME_COUNT, TIME_STRIDE))
    for start in range(0, len(indices), CHUNK):
        chunk = indices[start:start + CHUNK]
        span = f"[{chunk[0]}:{TIME_STRIDE}:{chunk[-1]}][0][0:1:480][0:1:1200]"
        path = cached_fetch(f"{ERDDAP}?u{span},v{span}", f"currents/oscar-{chunk[0]:03d}-{chunk[-1]:03d}.nc", timeout=1800)
        with netcdf_file(path, "r", mmap=False) as data:
            lat = data.variables["latitude"][:].copy()
            lon = data.variables["longitude"][:].copy()
            times.extend(float(t) for t in data.variables["time"][:])
            u = np.array(data.variables["u"][:, 0], dtype=np.float64)
            v = np.array(data.variables["v"][:, 0], dtype=np.float64)
        valid = np.isfinite(u) & np.isfinite(v)
        if total_u is None:
            total_u, total_v, count = np.zeros(u.shape[1:]), np.zeros(u.shape[1:]), np.zeros(u.shape[1:])
        total_u += np.where(valid, u, 0).sum(axis=0)
        total_v += np.where(valid, v, 0).sum(axis=0)
        count += valid.sum(axis=0)
    assert total_u is not None and total_v is not None and count is not None
    # A node is ocean if it had a value in most composites (sea ice comes and goes).
    ocean = count >= 0.5 * len(indices)
    with np.errstate(invalid="ignore"):
        mean_u = np.where(ocean, total_u / np.maximum(count, 1), np.nan)
        mean_v = np.where(ocean, total_v / np.maximum(count, 1), np.nan)
    return lat, lon, mean_u, mean_v, (min(times), max(times))


def to_gfs_grid(lat: np.ndarray, lon: np.ndarray, field: np.ndarray) -> np.ndarray:
    """Third-degree field -> [181, 360] on whole degrees, 90 N first, 0 E first: the mean of the 3 x 3 nodes
    centred on each whole degree, NaN where fewer than five of them are ocean."""
    if abs(lat[0] - 80) > 1e-6 or abs(lat[1] - lat[0] + 1 / 3) > 1e-6 or abs(lon[0] - 20) > 1e-6 or abs(lon[3] - 21) > 1e-6:
        raise ValueError("unexpected OSCAR grid")
    out = np.full((NJ, NI), np.nan)
    # Longitude repeats past 360: nodes 0..1079 are 20..379.67 E, one full circle.
    ring = field[:, :1080]
    for row in range(lat.size // 3 + 1):
        centre = row * 3
        rows = slice(max(centre - 1, 0), min(centre + 2, lat.size))
        latitude = int(round(float(lat[centre])))
        for column in range(NI):
            nodes = ring[rows][:, [(column * 3 + k) % 1080 for k in (-1, 0, 1)]]
            if np.isfinite(nodes).sum() >= 5:
                out[90 - latitude, (20 + column) % NI] = np.nanmean(nodes)
    return out


def fetch_names() -> list[dict]:
    path = cached_fetch(WIKIDATA_SPARQL + urllib.parse.quote(NAMES_QUERY), "currents/wikidata-currents.json")
    names: dict[str, dict] = {}
    for row in json.loads(path.read_text())["results"]["bindings"]:
        name = row["itemLabel"]["value"]
        if int(row["sitelinks"]["value"]) < MIN_SITELINKS or not any(word in name for word in NAME_WORDS):
            continue
        names.setdefault(name, {"name": name, "lon": round(float(row["lon"]["value"]), 2), "lat": round(float(row["lat"]["value"]), 2),
                                "wikidata": row["item"]["value"].rsplit("/", 1)[1]})
    return sorted(names.values(), key=lambda n: n["name"])


def main() -> None:
    lat, lon, mean_u, mean_v, (first, last) = load_mean()
    u = to_gfs_grid(lat, lon, mean_u)
    v = to_gfs_grid(lat, lon, mean_v)
    ocean = np.isfinite(u) & np.isfinite(v)
    speed = np.hypot(np.where(ocean, u, 0), np.where(ocean, v, 0))
    grids = np.stack([np.where(ocean, u, 0), np.where(ocean, v, 0)])
    coded = np.clip(np.rint(grids / SCALE), -127, 127).astype(np.int8)
    (OUTPUT_DIR / "ocean-currents.bin").write_bytes(coded.tobytes())
    day = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).date().isoformat()  # noqa: E731
    names = fetch_names()
    write_json(OUTPUT_DIR / "ocean-currents.json", {
        "source": "OSCAR third-degree surface currents (Bonjean & Lagerloef 2002), Earth & Space Research, via NOAA CoastWatch ERDDAP jplOscar",
        "period": [day(first), day(last)],
        "composites": len(range(0, TIME_COUNT, TIME_STRIDE)),
        "fields": ["eastward", "northward"],
        "scale": SCALE,
        "grid": {"ni": NI, "nj": NJ, "latFirst": 90, "latStep": -1, "lonFirst": 0, "lonStep": 1},
        "oceanCells": int(ocean.sum()),
        "maxSpeed": round(float(speed.max()), 3),
        "names": names,
    })
    where = np.unravel_index(np.argmax(speed), speed.shape)
    print(f"mean of {len(range(0, TIME_COUNT, TIME_STRIDE))} composites {day(first)} .. {day(last)}; {int(ocean.sum())} ocean cells; "
          f"fastest {speed.max():.2f} m/s at {90 - where[0]} N, {where[1]} E; "
          f"{float((speed > SCALE * 127).sum())} cells beyond the code; names: {[n['name'] for n in names]}", file=sys.stderr)


if __name__ == "__main__":
    main()
