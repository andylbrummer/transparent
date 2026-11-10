#!/usr/bin/env python3
"""
Data checks for the baked cyclone tracks (generate_cyclones.py).

Known storms are pinned to what their agencies' reports say of them:
  Katrina 2005   NHC Tropical Cyclone Report AL122005: peak 150 kt, 902 mb;
                 landfall near Buras, Louisiana (29.3N 89.6W) at 1110 UTC
                 29 August at 110 kt.
  Patricia 2015  NHC Tropical Cyclone Report EP202015: peak 185 kt, 872 mb,
                 the strongest winds ever recorded in a tropical cyclone.
  Haiyan 2013    JTWC best track: 170 kt; landfall at Guiuan, Samar
                 (11.0N 125.7E) at about 2040 UTC 7 November.
  Tip 1979       870 hPa on 12 October, the lowest sea-level pressure ever
                 measured in a tropical cyclone (JTWC 1979 annual report).

Usage: python3 tools/pipeline/test_cyclones.py
"""

import json
import math
import struct
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path

from geo_test_support import check, finish

GEO = Path(__file__).resolve().parents[2] / "app" / "public" / "geo"


def load() -> tuple[dict, list[dict]]:
    meta = json.loads((GEO / "cyclone-tracks.json").read_text(encoding="utf-8"))
    raw = (GEO / "cyclone-tracks.bin").read_bytes()
    n = meta["pointCount"]
    check(len(raw) == 7 * n, f"the binary holds 7 bytes for each of {n} points")
    positions = array("h", raw[: 4 * n])
    minutes = array("H", raw[4 * n : 6 * n])
    winds = array("B", raw[6 * n :])
    if struct.pack("=H", 1) != struct.pack("<H", 1):
        positions.byteswap()
        minutes.byteswap()
    storms = []
    offset = 0
    for entry in meta["storms"]:
        start = datetime.strptime(entry["start"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        points = [
            {
                "lon": positions[2 * i] / 100,
                "lat": positions[2 * i + 1] / 100,
                "time": start + timedelta(minutes=minutes[i]),
                "hours": minutes[i] / 60,
                "wind": winds[i],
            }
            for i in range(offset, offset + entry["points"])
        ]
        offset += entry["points"]
        storms.append({**entry, "track": points})
    check(offset == n, "the storms' points add up to the point count")
    return meta, storms


def distance_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    a = math.radians(lat1)
    b = math.radians(lat2)
    c = math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(math.radians(lon2 - lon1))
    return 6371.0 * math.acos(max(-1.0, min(1.0, c)))


def storm(storms: list[dict], name: str, year: int) -> dict:
    hits = [s for s in storms if s["name"] == name and s["start"].startswith(str(year))]
    check(len(hits) == 1, f"{name} {year} is there once")
    return hits[0]


def nearest(track: list[dict], lon: float, lat: float) -> tuple[float, dict]:
    return min(((distance_km(p["lon"], p["lat"], lon, lat), p) for p in track), key=lambda pair: pair[0])


def nearest_on_path(track: list[dict], lon: float, lat: float) -> float:
    """Distance to the track drawn as a line: storms cover 100 km and more between six-hourly points."""
    best = math.inf
    for a, b in zip(track, track[1:]):
        for step in range(21):
            t = step / 20
            best = min(best, distance_km(a["lon"] + (b["lon"] - a["lon"]) * t, a["lat"] + (b["lat"] - a["lat"]) * t, lon, lat))
    return best


def main() -> None:
    meta, storms = load()

    check(1000 <= len(storms) <= 1400, f"about 1,100 major storms since 1980 ({len(storms)})")
    check(all(s["maxWindKt"] >= meta["majorKt"] for s in storms), "every storm reached category 3 on U.S. winds")
    check(all(max(p["wind"] for p in s["track"]) == s["maxWindKt"] for s in storms), "each storm's peak is on its baked track")
    early = sorted(s["name"] for s in storms if int(s["start"][:4]) < meta["firstSeason"] - 1)
    check(early == ["Camille"], f"before the 1979-80 season only Camille ({early})")
    check(all(-75 <= p["lat"] <= 75 and -180 <= p["lon"] <= 180 for s in storms for p in s["track"]), "positions are on the globe")
    check(
        all(len({p["lat"] > 0 for p in s["track"]}) == 1 for s in storms),
        "no track crosses the equator",
    )
    check(
        all(a["hours"] < b["hours"] for s in storms for a, b in zip(s["track"], s["track"][1:])),
        "each track runs forward in time",
    )
    steps = [
        distance_km(a["lon"], a["lat"], b["lon"], b["lat"]) / (b["hours"] - a["hours"])
        for s in storms
        for a, b in zip(s["track"], s["track"][1:])
    ]
    # The fastest are storms swept into the westerlies as they leave the tropics (Bart 1996: 173 km/h).
    check(max(steps) < 200, f"no storm moves faster than 200 km/h between points ({max(steps):.0f})")
    basins = {b: sum(1 for s in storms if s["basin"] == b) for b in ("NA", "EP", "WP", "NI", "SI", "SP")}
    check(basins["WP"] > basins["EP"] > basins["NA"] > basins["NI"], f"the western Pacific leads, the north Indian trails ({basins})")
    check(sum(1 for s in storms if s["basin"] == "SA") == 0, "no major hurricane in the South Atlantic")
    check(sum(1 for s in storms if s.get("featured")) >= 30, "the well-known storms are flagged")

    katrina = storm(storms, "Katrina", 2005)
    check(katrina["maxWindKt"] == 150 and katrina["minPressureHpa"] == 902, "Katrina peaked at 150 kt and 902 hPa")
    km, point = nearest(katrina["track"], -89.6, 29.3)
    check(km < 15, f"Katrina's track meets the coast at Buras, Louisiana (nearest point {km:.0f} km)")
    check(point["time"] == datetime(2005, 8, 29, 11, 10, tzinfo=timezone.utc), f"at 11:10 UTC on 29 August 2005 ({point['time']})")
    check(point["wind"] == 110, f"at 110 kt ({point['wind']})")
    km, point = nearest(katrina["track"], -90.07, 29.95)
    check(km < 60, f"and passes within 60 km of New Orleans ({km:.0f} km)")

    patricia = storm(storms, "Patricia", 2015)
    check(patricia["maxWindKt"] == 185 and patricia["minPressureHpa"] == 872, "Patricia peaked at 185 kt and 872 hPa")
    check(max(s["maxWindKt"] for s in storms) == 185, "and nothing is stronger")
    km, _ = nearest(patricia["track"], -105.0, 19.4)
    check(km < 40, f"Patricia comes ashore in Jalisco ({km:.0f} km from 19.4N 105.0W)")

    haiyan = storm(storms, "Haiyan", 2013)
    check(haiyan["maxWindKt"] == 170, "Haiyan peaked at 170 kt")
    km = nearest_on_path(haiyan["track"], 125.72, 11.03)
    check(km < 25, f"Haiyan's track crosses Guiuan, Samar ({km:.0f} km)")
    _, point = nearest(haiyan["track"], 125.72, 11.03)
    check(point["time"].date().isoformat() in ("2013-11-07", "2013-11-08") and point["wind"] >= 160, "on 7-8 November 2013 at 160 kt or more")

    tip = storm(storms, "Tip", 1979)
    check(tip["minPressureHpa"] == 870, "Tip reached 870 hPa")
    check(min(s["minPressureHpa"] for s in storms if s["minPressureHpa"]) == 870, "and nothing is deeper")
    peak = max(tip["track"], key=lambda p: p["wind"])
    check(peak["time"].date().isoformat() == "1979-10-12", f"Tip peaked on 12 October 1979 ({peak['time']:%Y-%m-%d})")
    check(120 < peak["lon"] < 145 and 10 < peak["lat"] < 25, "in the Philippine Sea")

    check_snapshot()
    finish()


def check_snapshot() -> None:
    """The live layer's fallback: storms as GDACS gave them when it was baked."""
    snapshot = json.loads((GEO / "cyclone-live-snapshot.json").read_text(encoding="utf-8"))
    generated = datetime.strptime(snapshot["generated"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    generated_ms = generated.timestamp() * 1000
    storms = snapshot["storms"]
    check(all({"id", "episode", "name", "source", "points", "cone"} <= set(s) for s in storms), "snapshot storms have the live layer's fields")
    for s in storms:
        observed = [p for p in s["points"] if not p["forecast"]]
        forecast = [p for p in s["points"] if p["forecast"]]
        label = f"snapshot {s['name']}"
        check(len(observed) >= 1, f"{label}: has advisories")
        check(all(a["timeMs"] < b["timeMs"] for a, b in zip(observed, observed[1:])), f"{label}: advisories in time order")
        check(observed[-1]["timeMs"] <= generated_ms + 3600_000, f"{label}: no advisory later than the snapshot")
        check(generated_ms - observed[-1]["timeMs"] <= 12 * 86400_000, f"{label}: within the ten-day window")
        check(all(p["timeMs"] > observed[-1]["timeMs"] for p in forecast), f"{label}: forecast follows the last advisory")
        check(all(-90 <= p["lat"] <= 90 and -180 <= p["lon"] <= 180 and 0 <= p["windKt"] <= 200 for p in s["points"]), f"{label}: plausible points")
        check(all(abs(p["lat"]) < 60 for p in observed), f"{label}: advisories in cyclone latitudes")
        if s["cone"]:
            last = observed[-1]
            near = min(distance_km(lon, lat, last["lon"], last["lat"]) for ring in s["cone"] for lon, lat in ring)
            check(near < 150, f"{label}: the cone starts at the latest advisory ({near:.0f} km)")


if __name__ == "__main__":
    main()
