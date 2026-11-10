#!/usr/bin/env python3
"""
Bake the tracks of the world's major tropical cyclones for the app.

Source
    IBTrACS v04r01, the International Best Track Archive for Climate
    Stewardship (NOAA NCEI): every agency's best track of every known
    tropical cyclone, merged. Public domain (U.S. Government work).
      Knapp, K. R., M. C. Kruk, D. H. Levinson, H. J. Diamond & C. J. Neumann
      (2010), The International Best Track Archive for Climate Stewardship
      (IBTrACS), Bull. Amer. Meteor. Soc. 91, 363-376, doi:10.1175/2009BAMS2755.1
      Gahtan, J., K. R. Knapp, C. J. Schreck, H. J. Diamond, J. P. Kossin &
      M. C. Kruk (2024), IBTrACS version 4r01, NOAA NCEI, doi:10.25921/82ty-9e16
    https://www.ncei.noaa.gov/products/international-best-track-archive
    File: csv/ibtracs.ALL.list.v04r01.csv (333 MB, rebuilt about twice a week).

What is kept
    Every storm from the 1980 season on whose 1-minute sustained wind, as the
    U.S. agencies (NHC, CPHC, JTWC) give it in USA_WIND, reached 96 kt - a
    major hurricane, Saffir-Simpson category 3 - plus the earlier storms named
    in EARLIER. Only U.S. winds are used because they are the one series on
    one averaging time over every basin; the other agencies report 10-minute
    or 3-minute winds, which cannot be put on the Saffir-Simpson scale without
    a conversion nobody agrees on. The price: a handful of early-1980s
    southern-hemisphere storms that no U.S. agency tracked are absent.

    Of each storm: the main track (no spur tracks), at the six-hourly synoptic
    times plus the records the U.S. agencies mark (landfalls, peaks) and the
    storm's first record at its greatest wind. IBTrACS's three-hourly points
    in between are its own interpolation and add nothing.

Outputs
    app/public/geo/cyclone-tracks.json   one record per storm, oldest first
    app/public/geo/cyclone-tracks.bin    the points of all storms end to end,
        little-endian, in three blocks for N points in all:
          int16[2N]  longitude, latitude in hundredths of a degree
          uint16[N]  minutes since the storm's first point
          uint8[N]   USA_WIND in knots, 0 where no U.S. agency gave one

    app/public/geo/cyclone-live-snapshot.json   (--snapshot only) the storms
        of the past ten days as GDACS gives them now, in the shape the live
        layer keeps them (app/src/layers/cyclones/gdacs.ts: LiveStorm). It is
        what that layer falls back to when GDACS cannot be reached, shown
        with its date. GDACS: https://www.gdacs.org/ (European Commission JRC
        and UN OCHA), from NHC, CPHC, JTWC and WMO regional centre advisories.

Usage
    python3 tools/pipeline/generate_cyclones.py              # the tracks
    python3 tools/pipeline/generate_cyclones.py --snapshot   # only the live snapshot
    python3 tools/pipeline/test_cyclones.py

Standard library only.
"""

import csv
import json
import sys
from array import array
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fetch_cache import USER_AGENT, cached_fetch

IBTRACS_URL = (
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.ALL.list.v04r01.csv"
)
CACHE_NAME = "ibtracs.ALL.list.v04r01.csv"
OUT_DIR = Path(__file__).resolve().parents[2] / "app" / "public" / "geo"

FIRST_SEASON = 1980
#: Saffir-Simpson category 3 starts at 96 kt.
MAJOR_KT = 96
#: Storms before FIRST_SEASON kept all the same: (IBTrACS name, year of first record, basin).
EARLIER = [
    ("TIP", 1979, "WP"),  # lowest pressure ever measured in a tropical cyclone, 870 hPa
    ("CAMILLE", 1969, "NA"),
]
#: Storms the app names first: (IBTrACS name, year of first record, basin).
#: An editorial pick of well-known storms; everything shown about them is IBTrACS's.
NAMED_FIRST = [
    ("KATRINA", 2005, "NA"),
    ("WILMA", 2005, "NA"),
    ("ANDREW", 1992, "NA"),
    ("GILBERT", 1988, "NA"),
    ("MITCH", 1998, "NA"),
    ("SANDY", 2012, "NA"),
    ("IRMA", 2017, "NA"),
    ("MARIA", 2017, "NA"),
    ("HARVEY", 2017, "NA"),
    ("DORIAN", 2019, "NA"),
    ("IAN", 2022, "NA"),
    ("CAMILLE", 1969, "NA"),
    ("PATRICIA", 2015, "EP"),
    ("LINDA", 1997, "EP"),
    ("OTIS", 2023, "EP"),
    ("IOKE", 2006, "EP"),
    ("TIP", 1979, "WP"),
    ("HAIYAN", 2013, "WP"),
    ("MANGKHUT", 2018, "WP"),
    ("MERANTI", 2016, "WP"),
    ("GONI", 2020, "WP"),
    ("HAGIBIS", 2019, "WP"),
    ("NARGIS", 2008, "NI"),
    ("GONU", 2007, "NI"),
    ("AMPHAN", 2020, "NI"),
    ("IDAI", 2019, "SI"),
    ("FREDDY", 2023, "SI"),
    ("GAFILO", 2004, "SI"),
    ("WINSTON", 2016, "SP"),
    ("PAM", 2015, "SP"),
    ("YASI", 2011, "SP"),
    ("MONICA", 2006, "SP"),
    ("ZOE", 2002, "SP"),
]
MAIN_TRACKS = {"main", "PROVISIONAL", "US-PROVISIONAL"}


def parse_time(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def integer(text: str) -> int | None:
    text = text.strip()
    return int(text) if text else None


def read_storms(path: Path) -> dict[str, dict]:
    """Every main-track storm of the seasons that could matter, with all its records."""
    storms: dict[str, dict] = {}
    earliest = min([FIRST_SEASON] + [year for _, year, _ in EARLIER])
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        column = {name: i for i, name in enumerate(next(reader))}
        next(reader)  # units
        for row in reader:
            if int(row[column["SEASON"]]) < earliest or row[column["TRACK_TYPE"]] not in MAIN_TRACKS:
                continue
            storm = storms.setdefault(
                row[column["SID"]],
                {
                    "id": row[column["SID"]],
                    "name": row[column["NAME"]],
                    "season": int(row[column["SEASON"]]),
                    "basin": row[column["BASIN"]],
                    "provisional": row[column["TRACK_TYPE"]] != "main",
                    "records": [],
                },
            )
            lon = float(row[column["LON"]])
            storm["records"].append(
                {
                    "time": parse_time(row[column["ISO_TIME"]]),
                    "lon": (lon + 180.0) % 360.0 - 180.0,
                    "lat": float(row[column["LAT"]]),
                    "wind": integer(row[column["USA_WIND"]]),
                    "pressure": integer(row[column["USA_PRES"]]) or integer(row[column["WMO_PRES"]]),
                    "marked": row[column["USA_RECORD"]].strip() != "",
                }
            )
    return storms


def find(storms: dict[str, dict], name: str, year: int, basin: str) -> dict:
    """The one storm of that name whose track starts in that year and basin."""
    hits = [
        s
        for s in storms.values()
        if name in s["name"].split(":") and s["records"][0]["time"].year == year and s["basin"] == basin
    ]
    if len(hits) != 1:
        raise RuntimeError(f"{name} {year} {basin}: {len(hits)} storms match, expected one")
    return hits[0]


def max_wind(storm: dict) -> int:
    return max((r["wind"] or 0) for r in storm["records"])


def display_name(name: str) -> str:
    """IBTrACS writes names in capitals, and several joined by ':' where agencies differed."""
    if name in ("UNNAMED", "NOT_NAMED", ""):
        return ""
    return "/".join(part.replace("-", " ").title().replace(" ", "-") for part in name.split(":") if part != "UNNAMED")


def select(storms: dict[str, dict]) -> list[dict]:
    chosen = {s["id"]: s for s in storms.values() if s["season"] >= FIRST_SEASON and max_wind(s) >= MAJOR_KT}
    for key in EARLIER:
        storm = find(storms, *key)
        chosen[storm["id"]] = storm
    for key in NAMED_FIRST:
        storm = find(storms, *key)
        if storm["id"] not in chosen:
            raise RuntimeError(f"{key}: named first but not among the storms kept (max {max_wind(storm)} kt)")
        storm["featured"] = True
    return sorted(chosen.values(), key=lambda s: s["records"][0]["time"])


def kept_records(storm: dict) -> list[dict]:
    """Synoptic records, those a U.S. agency marked (landfall, peak), and the first at the storm's greatest wind."""
    peak = max_wind(storm)
    first_peak = next(r for r in storm["records"] if (r["wind"] or 0) == peak)
    return [
        r for r in storm["records"] if r["marked"] or r is first_peak or (r["time"].hour % 6 == 0 and r["time"].minute == 0)
    ]


def bake(storms: list[dict]) -> tuple[dict, bytes]:
    positions = array("h")
    minutes = array("H")
    winds = array("B")
    index = []
    for storm in storms:
        records = kept_records(storm)
        start = records[0]["time"]
        for record in records:
            positions.append(round(record["lon"] * 100))
            positions.append(round(record["lat"] * 100))
            minutes.append(round((record["time"] - start).total_seconds() / 60))
            winds.append(min(record["wind"] or 0, 255) if (record["wind"] or 0) > 0 else 0)
        pressures = [r["pressure"] for r in storm["records"] if r["pressure"]]
        entry = {
            "id": storm["id"],
            "name": display_name(storm["name"]),
            "basin": storm["basin"],
            "start": start.strftime("%Y-%m-%dT%H:%MZ"),
            "points": len(records),
            "maxWindKt": max_wind(storm),
            "minPressureHpa": min(pressures) if pressures else None,
        }
        if storm.get("featured"):
            entry["featured"] = True
        if storm["provisional"]:
            entry["provisional"] = True
        index.append(entry)
    if sys.byteorder == "big":
        positions.byteswap()
        minutes.byteswap()
    data = positions.tobytes() + minutes.tobytes() + winds.tobytes()
    last = max(r["time"] for s in storms for r in s["records"])
    meta = {
        "source": "IBTrACS v04r01 (NOAA NCEI), doi:10.25921/82ty-9e16",
        "firstSeason": FIRST_SEASON,
        "majorKt": MAJOR_KT,
        "lastRecord": last.strftime("%Y-%m-%dT%H:%MZ"),
        "pointCount": len(winds),
        "storms": index,
    }
    return meta, data


GDACS_API = "https://www.gdacs.org/gdacsapi/api"
#: As the live layer: storms whose latest advisory is within this many days.
LOOKBACK_DAYS = 10
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def gdacs(url: str) -> dict:
    """One GDACS answer. Never cached: a snapshot is of this moment."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def utc_ms(moment: datetime) -> int:
    return round(moment.replace(tzinfo=timezone.utc).timestamp() * 1000)


def advisory_ms(text: str) -> int:
    """ "10 Nov 2026 00:00", UTC."""
    day, month, year, clock = text.split()
    hour, minute = clock.split(":")
    return utc_ms(datetime(int(year), MONTHS.index(month) + 1, int(day), int(hour), int(minute)))


def storm_name(event_name: str) -> str:
    """As stormName in gdacs.ts."""
    parts = event_name.strip().split("-")
    if len(parts) > 1 and len(parts[-1]) == 2 and parts[-1].isdigit():
        parts = parts[:-1]
    bare = "-".join(parts)
    if not bare:
        return "Unnamed"
    if bare[0].isdigit():
        return f"TC {bare}"
    return "-".join(part[0] + part[1:].lower() if len(part) > 1 else part for part in parts)


def snapshot_storm(properties: dict, now: datetime) -> dict:
    """One storm as LiveStorm: advisories, forecast and, for a storm still forecast, the cone."""
    event = {"eventid": properties["eventid"], "episodeid": properties["episodeid"]}
    query = f"eventtype=TC&eventid={event['eventid']}&episodeid={event['episodeid']}"
    episode = gdacs(f"{GDACS_API}/events/getepisodedata?{query}")
    timeline_url = next(i["resource"]["timeline"] for i in episode["properties"]["impacts"] if "timeline" in i["resource"])
    points = []
    for item in gdacs(timeline_url)["channel"]["item"]:
        points.append(
            {
                "timeMs": advisory_ms(item["advisory_datetime"]),
                "lon": float(item["longitude"]),
                "lat": float(item["latitude"]),
                "windKt": round(float(item["wind_speed"]) * 3600 / 1852 / 5) * 5,
                "forecast": item["actual"].lower() != "true",
            }
        )
    observed = sorted((p for p in points if not p["forecast"]), key=lambda p: p["timeMs"])
    forecast = sorted((p for p in points if p["forecast"] and p["timeMs"] > observed[-1]["timeMs"]), key=lambda p: p["timeMs"])
    cone = None
    last = datetime.fromisoformat(properties["todate"]).replace(tzinfo=timezone.utc)
    if forecast and abs(now - last) <= timedelta(hours=48):
        for feature in gdacs(f"{GDACS_API}/polygons/getgeometry?{query}")["features"]:
            if feature["properties"].get("Class") == "Poly_Cones":
                geometry = feature["geometry"]
                polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
                cone = [[[round(v[0], 3), round(v[1], 3)] for v in polygon[0]] for polygon in polygons]
    return {
        "id": int(properties["eventid"]),
        "episode": int(properties["episodeid"]),
        "name": storm_name(properties["eventname"]),
        "source": properties["source"],
        "points": observed + forecast,
        "cone": cone,
    }


def bake_snapshot() -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    listing = gdacs(
        f"{GDACS_API}/events/geteventlist/SEARCH?eventlist=TC&fromdate={(now - timedelta(days=LOOKBACK_DAYS)).date()}"
        f"&todate={(now + timedelta(days=1)).date()}&alertlevel=Green;Orange;Red"
    )
    storms = [snapshot_storm(f["properties"], now) for f in listing["features"] if f["properties"]["eventtype"] == "TC"]
    storms.sort(key=lambda s: s["id"])
    snapshot = {
        "source": "GDACS (European Commission JRC, UN OCHA), https://www.gdacs.org/",
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "storms": storms,
    }
    out = OUT_DIR / "cyclone-live-snapshot.json"
    out.write_text(json.dumps(snapshot, separators=(",", ":")), encoding="utf-8")
    print(f"{len(storms)} storms as of {snapshot['generated']}: {', '.join(s['name'] for s in storms)}")
    print(f"cyclone-live-snapshot.json {out.stat().st_size} bytes")


def main() -> None:
    if "--snapshot" in sys.argv[1:]:
        bake_snapshot()
        return
    path = cached_fetch(IBTRACS_URL, CACHE_NAME, timeout=1800)
    storms = select(read_storms(path))
    meta, data = bake(storms)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cyclone-tracks.json").write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / "cyclone-tracks.bin").write_bytes(data)
    print(f"{len(storms)} storms, {meta['pointCount']} points, last record {meta['lastRecord']}")
    print(f"cyclone-tracks.json {(OUT_DIR / 'cyclone-tracks.json').stat().st_size} bytes, cyclone-tracks.bin {len(data)} bytes")


if __name__ == "__main__":
    main()
