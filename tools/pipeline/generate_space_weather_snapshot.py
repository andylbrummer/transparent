#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: a snapshot of space weather for
offline use.

The aurora and magnetopause layers show live products of NOAA's Space
Weather Prediction Center (https://services.swpc.noaa.gov/, public
domain). When the network does not answer, the app falls back to what
this script baked into app/public/space/, and says so with its date:

    aurora.png          the OVATION Prime aurora nowcast
                        (/json/ovation_aurora_latest.json): probability of
                        aurora in percent as the grey value, 360 x 181,
                        one pixel per degree, 180°W at the left edge and
                        90°N in the top row
    space-weather.json  the nowcast's observation and forecast times, the
                        hemispheric power (/text/aurora-nowcast-hemi-power.txt),
                        the planetary K index (/products/noaa-planetary-k-index.json)
                        and the solar wind at the Earth
                        (/products/geospace/propagated-solar-wind-1-hour.json:
                        the mean of its last ten complete minutes)

SWPC serves only the present, so the snapshot is of whenever the raw files
in tools/pipeline/.cache/space-weather/ were fetched; delete them to take
a new one.

Usage:
    python3 tools/pipeline/generate_space_weather_snapshot.py

Needs pillow.
"""

import json
from pathlib import Path

from PIL import Image

from fetch_cache import cached_fetch

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "space"
SWPC = "https://services.swpc.noaa.gov"
WIDTH, HEIGHT = 360, 181


def fetch(path: str) -> Path:
    return cached_fetch(SWPC + path, "space-weather/" + path.rsplit("/", 1)[1])


def aurora_grid(ovation: dict) -> list[list[int]]:
    """Rows from 90°S to 90°N, columns from 180°W: percent."""
    grid = [[-1] * WIDTH for _ in range(HEIGHT)]
    for lon, lat, value in ovation["coordinates"]:
        grid[lat + 90][(lon + 180) % 360] = min(100, round(value))
    if any(v < 0 for row in grid for v in row):
        raise SystemExit("the OVATION grid has holes")
    return grid


def solar_wind(table: list[list]) -> dict:
    header = table[0]
    speed, density, bz = header.index("speed"), header.index("density"), header.index("bz")
    arrival = header.index("propagated_time_tag")
    rows = [r for r in table[1:] if all(isinstance(r[i], (int, float)) for i in (speed, density, bz)) and r[arrival]]
    last = rows[-10:]
    if not last:
        raise SystemExit("no complete solar wind reading")
    mean = lambda i: sum(r[i] for r in last) / len(last)  # noqa: E731
    return {"time": last[-1][arrival], "speedKmS": round(mean(speed), 1), "densityCm3": round(mean(density), 2), "bzNt": round(mean(bz), 2)}


def hemispheric_power(text: str) -> dict | None:
    lines = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]
    fields = lines[-1].split() if lines else []
    return {"north": int(fields[2]), "south": int(fields[3])} if len(fields) >= 4 else None


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ovation = json.loads(fetch("/json/ovation_aurora_latest.json").read_text())
    grid = aurora_grid(ovation)
    image = Image.new("L", (WIDTH, HEIGHT))
    # The image's top row is the north pole.
    image.putdata([v for row in reversed(grid) for v in row])
    image.save(OUTPUT_DIR / "aurora.png", optimize=True)

    kp_rows = json.loads(fetch("/products/noaa-planetary-k-index.json").read_text())
    kp = next(({"time": r["time_tag"], "kp": float(r["Kp"])} for r in reversed(kp_rows) if isinstance(r, dict) and r.get("Kp") is not None), None)
    snapshot = {
        "source": "NOAA Space Weather Prediction Center (services.swpc.noaa.gov), public domain",
        "aurora": {
            "observed": ovation["Observation Time"],
            "forecast": ovation["Forecast Time"],
            "hemisphericPowerGw": hemispheric_power(fetch("/text/aurora-nowcast-hemi-power.txt").read_text()),
        },
        "kp": kp,
        "solarWind": solar_wind(json.loads(fetch("/products/geospace/propagated-solar-wind-1-hour.json").read_text())),
    }
    (OUTPUT_DIR / "space-weather.json").write_text(json.dumps(snapshot, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(snapshot, indent=1))
    print(f"aurora.png {(OUTPUT_DIR / 'aurora.png').stat().st_size} bytes, peak {max(max(row) for row in grid)} %")


if __name__ == "__main__":
    main()
