#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: a snapshot of the Sun for offline use.

The Sun layers show live images and numbers from NOAA's Space Weather
Prediction Center (https://services.swpc.noaa.gov/). When the network does
not answer, the app falls back to what this script baked into
app/public/sky/sun/, and says so with the snapshot's date:

    hmi.jpg        SDO/HMI continuum (the white-light disc, sunspots)
                   Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams
    suvi-171.jpg, suvi-195.jpg, suvi-304.jpg
                   GOES-19 SUVI extreme-ultraviolet composites (NOAA)
    lasco-c2.jpg, lasco-c3.jpg
                   SOHO/LASCO coronagraphs - SOHO (ESA & NASA)
    ccor1.jpg      GOES-19 CCOR-1 coronagraph (NOAA)
    snapshot.json  each frame's observation time and source URL, the active
                   regions of the latest daily report (solar_regions.json
                   rows as given) and the space-weather readings

Each frame is the one nearest SNAPSHOT_TIME in SWPC's rolling one-day
index, so a run within a day of that instant reproduces the committed
files; later, SWPC no longer has those frames and SNAPSHOT_TIME must be
moved on (the script refuses rather than quietly baking another day).
The raw frames are kept in tools/pipeline/.cache/sun/ under their SWPC
names. Frames are re-encoded as JPEG, the 1280 px SUVI PNGs at half size;
app/src/layers/sun/products.ts places frames by fractions of their width,
so size does not matter to the geometry.

Usage:
    python3 tools/pipeline/generate_sun_snapshot.py [--now]

--now takes the present moment instead of SNAPSHOT_TIME (then update the
constant to the time printed, so the bake stays documented).
Needs pillow.
"""

import datetime
import json
import re
import sys
from pathlib import Path

from PIL import Image

from fetch_cache import cached_fetch

SWPC = "https://services.swpc.noaa.gov"
SNAPSHOT_TIME = "2026-11-10T00:00:00Z"
# A frame further than this from the requested time means SWPC's one-day window has moved on.
MAX_OFFSET_HOURS = 6

# product id -> (index path, widest baked size in px, JPEG quality)
PRODUCTS = {
    "hmi": ("/products/animations/sdo-hmii.json", 512, 88),
    "suvi-171": ("/products/animations/suvi-primary-171.json", 640, 80),
    "suvi-195": ("/products/animations/suvi-primary-195.json", 640, 80),
    "suvi-304": ("/products/animations/suvi-primary-304.json", 640, 80),
    "lasco-c2": ("/products/animations/lasco-c2.json", 512, 80),
    "lasco-c3": ("/products/animations/lasco-c3.json", 512, 80),
    "ccor1": ("/products/animations/ccor1/ccor1.json", 1204, 72),
}

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "sky" / "sun"

FRAME_TIME = [
    re.compile(r"_s(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z"),
    re.compile(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})?_"),
]


def frame_time(url: str) -> datetime.datetime | None:
    """When a frame was taken, from its file name (the same three styles products.ts reads)."""
    name = url.rsplit("/", 1)[-1]
    for pattern in FRAME_TIME:
        match = pattern.search(name)
        if match:
            parts = [int(part) if part else 0 for part in match.groups()]
            return datetime.datetime(*parts, tzinfo=datetime.timezone.utc)
    return None


def parse_time(iso: str) -> datetime.datetime:
    moment = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return moment if moment.tzinfo else moment.replace(tzinfo=datetime.timezone.utc)


def iso(moment: datetime.datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_json(path: str, name: str, refresh: bool):
    return json.loads(cached_fetch(SWPC + path, f"sun/{name}", refresh=refresh).read_text())


def main() -> None:
    live = "--now" in sys.argv
    target = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0) if live else parse_time(SNAPSHOT_TIME)
    print(f"snapshot time {iso(target)}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"frames": {}}

    for product, (index_path, max_width, quality) in PRODUCTS.items():
        index = fetch_json(index_path, f"{product}-index.json", refresh=live)
        frames = [(frame_time(entry["url"]), entry["url"]) for entry in index]
        frames = [(when, url) for when, url in frames if when is not None]
        when, url = min(frames, key=lambda frame: abs((frame[0] - target).total_seconds()))
        offset_hours = abs((when - target).total_seconds()) / 3600
        if offset_hours > MAX_OFFSET_HOURS:
            sys.exit(
                f"{product}: nearest frame is {iso(when)}, {offset_hours:.0f} h from the snapshot time. SWPC keeps one day "
                "of frames: delete tools/pipeline/.cache/sun/ and rerun with --now, then update SNAPSHOT_TIME."
            )
        raw = cached_fetch(SWPC + url, f"sun/{url.rsplit('/', 1)[-1]}")
        image = Image.open(raw).convert("RGB")
        if image.width > max_width:
            image = image.resize((max_width, round(image.height * max_width / image.width)), Image.LANCZOS)
        output = OUTPUT_DIR / f"{product}.jpg"
        image.save(output, "JPEG", quality=quality, optimize=True)
        manifest["frames"][product] = {"time": iso(when), "source": SWPC + url}
        print(f"  {product:9s} {iso(when)}  {image.width}x{image.height}  {output.stat().st_size / 1024:.0f} KB")

    regions = fetch_json("/json/solar_regions.json", "solar_regions.json", refresh=live)
    day = max(row["observed_date"] for row in regions if parse_time(row["observed_date"]) <= target)
    manifest["regions"] = [row for row in regions if row["observed_date"] == day]
    print(f"  {len(manifest['regions'])} active regions observed {day}")

    flare = fetch_json("/json/goes/primary/xray-flares-latest.json", "xray-flares-latest.json", refresh=live)[0]
    flux = fetch_json("/products/summary/10cm-flux.json", "10cm-flux.json", refresh=live)[0]
    wind = fetch_json("/products/summary/solar-wind-speed.json", "solar-wind-speed.json", refresh=live)[0]
    indices = cached_fetch(SWPC + "/text/daily-solar-indices.txt", "sun/daily-solar-indices.txt", refresh=live).read_text()
    sunspot_number = sunspot_date = None
    for line in indices.splitlines():
        match = re.match(r"^(\d{4}) (\d{2}) (\d{2})\s+(-?\d+)\s+(-?\d+)\s", line)
        if match and int(match.group(5)) >= 0:
            sunspot_number = int(match.group(5))
            sunspot_date = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    manifest["spaceWeather"] = {
        "xrayClass": flare.get("current_class"),
        "f107": flux.get("flux"),
        "windKmS": wind.get("proton_speed"),
        "sunspotNumber": sunspot_number,
        "sunspotDate": sunspot_date,
        "time": flare.get("time_tag"),
    }
    print(f"  space weather: {manifest['spaceWeather']}")
    (OUTPUT_DIR / "snapshot.json").write_text(json.dumps(manifest, indent=1) + "\n")
    total = sum(path.stat().st_size for path in OUTPUT_DIR.iterdir())
    print(f"wrote {OUTPUT_DIR.relative_to(REPO_ROOT)}/ ({total / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
