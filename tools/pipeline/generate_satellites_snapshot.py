#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: a snapshot of satellite orbits for
offline use.

The satellite layers propagate CelesTrak's GP element sets (what used to be
called TLEs) with SGP4 in the browser. They fetch a group from CelesTrak the
first time its switch goes on; when the network does not answer - or
CelesTrak declines, see below - the app falls back to what this script baked
into app/public/space/gp/, and says so with the element sets' date:

    <group>.csv     the group's GP data as CelesTrak's FORMAT=csv gives it,
                    with the columns SGP4 does not need dropped (KEEP below)
    manifest.json   per group: when it was fetched, how many objects, the
                    range of element-set epochs

Source: CelesTrak (Dr. T.S. Kelso), https://celestrak.org/NORAD/elements/ ,
GP data from the US Space Force 18th/19th Space Defense Squadron.
CSV, not TLE: since 2026 newly catalogued objects have six-digit catalogue
numbers and are not published in the TLE format at all.

CelesTrak's usage policy (https://celestrak.org/NORAD/documentation/gp-data-formats.php,
FAQ addendum updated 2026-03-26): data is checked for updates once every two
hours; download a group at most once per update; an HTTP 403/404 will not
change by repeating the request, and repeating it gets the address
firewalled. So this script downloads each group ONCE into
tools/pipeline/.cache/satellites/ and never again while the file is there,
pauses between groups, and stops at the first refusal. To take a newer
snapshot, delete the cached files (not more often than every two hours) and
run it again.

Usage:
    python3 tools/pipeline/generate_satellites_snapshot.py

Stdlib only. The data checks (test_satellites_snapshot.py) need the sgp4
package: python3 -m venv tools/pipeline/.cache/venv &&
tools/pipeline/.cache/venv/bin/pip install sgp4 numpy
"""

import csv
import datetime
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from fetch_cache import CACHE_DIR, USER_AGENT

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "space" / "gp"
RAW_DIR = CACHE_DIR / "satellites"
GP_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=csv"
PAUSE_S = 3

# Every group a switch can ask for. app/src/layers/satellites/groups.ts repeats the names.
GROUPS = [
    "stations",
    "visual",
    "gps-ops",
    "glo-ops",
    "galileo",
    "beidou",
    "geo",
    "weather",
    "resource",
    "science",
    "iridium-NEXT",
    "oneweb",
    "starlink",
    "cosmos-1408-debris",
    "fengyun-1c-debris",
    "iridium-33-debris",
    "cosmos-2251-debris",
]

HEADER = (
    "OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,"
    "ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,"
    "ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT"
)
# What SGP4 reads, and the name and catalogue number to call the thing by.
KEEP = [
    "OBJECT_NAME",
    "NORAD_CAT_ID",
    "EPOCH",
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
    "BSTAR",
    "MEAN_MOTION_DOT",
    "MEAN_MOTION_DDOT",
]


def fetch_group(group: str) -> Path:
    """The cached raw CSV of a group, downloaded once. Raises on anything but good data."""
    path = RAW_DIR / f"{group}.csv"
    if path.exists() and path.stat().st_size > 0:
        return path
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    url = GP_URL.format(group=group)
    print(f"fetching {url}", file=sys.stderr)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        # CelesTrak's refusals explain themselves in the body; show it and stop - never retry.
        body = error.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"{group}: HTTP {error.code} from CelesTrak, not retrying.\n{body}") from error
    text = data.decode("utf-8")
    if not text.startswith(HEADER):
        raise SystemExit(f"{group}: not GP data, not retrying: {text[:200]!r}")
    path.write_bytes(data)
    time.sleep(PAUSE_S)
    return path


def read_rows(path: Path) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "source": "CelesTrak GP data (celestrak.org), from the US Space Force 18th/19th Space Defense Squadron",
        "groups": {},
    }
    groups: dict[str, object] = {}
    for group in GROUPS:
        raw = fetch_group(group)
        rows = read_rows(raw)
        if not rows:
            raise SystemExit(f"{group}: no objects")
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=KEEP, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        target = OUTPUT_DIR / f"{group}.csv"
        target.write_text(out.getvalue(), encoding="utf-8")
        epochs = sorted(row["EPOCH"] for row in rows)
        fetched = datetime.datetime.fromtimestamp(raw.stat().st_mtime, datetime.timezone.utc)
        groups[group] = {
            "fetched": fetched.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "count": len(rows),
            "epochMin": epochs[0][:19] + "Z",
            "epochMedian": epochs[len(epochs) // 2][:19] + "Z",
            "epochMax": epochs[-1][:19] + "Z",
        }
        print(f"{group:22s} {len(rows):6d} objects  {target.stat().st_size / 1024:8.1f} KB  median epoch {epochs[len(epochs) // 2][:16]}")
    manifest["groups"] = groups
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
