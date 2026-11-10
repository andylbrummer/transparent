#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: asteroids passing close to the Earth -
every known approach within 10 lunar distances from PAST_DAYS before the bake
to FUTURE_DAYS after it, each with a short table of where it is around its
closest approach.

Sources (NASA/JPL, keyless, U.S. Government work):

  JPL CNEOS Close-Approach Data API   https://ssd-api.jpl.nasa.gov/cad.api
      which objects come within 10 LD, when (TDB), how near (nominal,
      smallest and largest by the 3-sigma orbit uncertainty), how fast, the
      uncertainty of the time, the absolute magnitude H and, where one has
      been measured, the diameter. The API sends no CORS header, so the app
      cannot ask it directly: the list is baked, and dated.
  JPL Horizons API                    https://ssd.jpl.nasa.gov/api/horizons.api
      each object's position from the Earth's centre (ICRF, km) at even
      steps from WINDOW_DAYS before the approach to WINDOW_DAYS after (finer
      and shorter for the very closest: see sampling()). A two-body
      orbit round the Sun is useless here - the Earth's own pull bends the
      path - so the app interpolates these tables instead, as it does for
      spacecraft, and shows an object only inside its table.

An object whose time of closest approach is uncertain by more than
MAX_TIME_SIGMA_MIN minutes gets no table: its place in the sky on a given
evening is not known, and it is listed without one.

Output: app/public/sky/neo-approaches.json   (and app/src/layers/small-bodies/neo.fixture.json:
        Horizons positions between the baked samples, for the app's interpolation test)

    baked          date of the bake, YYYY-MM-DD: later discoveries are missing
    from, to       the span of approach dates asked for
    approaches[]   des, jd (TDB) and date of closest approach, distLd (nominal),
                   distMinLd / distMaxLd (3-sigma), vRel km/s, h, diameterM
                   (measured, where CNEOS has one), sigmaMin (1-sigma time
                   uncertainty, minutes) and, where a table exists: t0 (JD TDB of
                   the first sample), stepMin, xyz (km from the Earth's centre, ICRF)

Usage:
    python3 tools/pipeline/generate_neo_approaches.py [--bake YYYY-MM-DD]

Stdlib only. Responses are cached in tools/pipeline/.cache/neo/.
"""

import argparse
import datetime
import json
import re
import urllib.parse
from pathlib import Path

from fetch_cache import cached_fetch

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "neo-approaches.json"
FIXTURE_OUT = REPO_ROOT / "app" / "src" / "layers" / "small-bodies" / "neo.fixture.json"
CAD = "https://ssd-api.jpl.nasa.gov/cad.api"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE = "neo"

#: The date of the committed bake: change it (or pass --bake) to refresh.
BAKE_DATE = "2026-11-09"
PAST_DAYS = 60
FUTURE_DAYS = 365
MAX_LD = 10
#: Mean Earth-Moon distance, km, as CNEOS defines its "LD", and the astronomical unit.
LD_KM = 384399.0
AU_KM = 149597870.7
WINDOW_DAYS = 2
MAX_TIME_SIGMA_MIN = 60.0


def sampling(dist_ld: float) -> tuple[float, float]:
    """(spacing in hours, days either side of the approach): finer and shorter for the closest
    passes, which the Earth's pull bends sharply - 2026 TP128 passed 900 km above the surface."""
    if dist_ld < 0.1:
        return 2 / 60, 0.5
    if dist_ld < 0.3:
        return 10 / 60, 1.0
    if dist_ld < 2:
        return 1.0, WINDOW_DAYS
    return 3.0, WINDOW_DAYS


def sigma_minutes(text: str) -> float:
    """'< 00:01', '00:03', '17:54', '2_19:21' (days_hours:minutes) -> minutes."""
    text = text.replace("<", "").strip()
    days = 0
    if "_" in text:
        day_text, text = text.split("_")
        days = int(day_text)
    hours, minutes = text.split(":")
    return days * 1440 + int(hours) * 60 + int(minutes)


def fetch_list(bake: datetime.date) -> list[dict]:
    params = {
        "dist-max": f"{MAX_LD}LD",
        "date-min": (bake - datetime.timedelta(days=PAST_DAYS)).isoformat(),
        "date-max": (bake + datetime.timedelta(days=FUTURE_DAYS)).isoformat(),
        "diameter": "true",
        "fullname": "true",
    }
    path = cached_fetch(f"{CAD}?{urllib.parse.urlencode(params)}", f"{CACHE}/cad_{bake.isoformat()}.json")
    answer = json.loads(path.read_text(encoding="utf-8"))
    if answer["signature"]["source"] != "NASA/JPL SBDB Close Approach Data API":
        raise SystemExit("unexpected answer from the close-approach API")
    return [dict(zip(answer["fields"], row)) for row in answer["data"]]


def horizons_vectors(des: str, start_jd: float, stop_jd: float, step_h: float, tag: str = "") -> list[tuple[float, float, float, float]] | None:
    """(JD TDB, x, y, z km) from the Earth's centre, ICRF; None where Horizons has no such object or span."""
    minutes = round(step_h * 60)
    params = {
        "format": "text",
        "OBJ_DATA": "NO",
        # A number is a record of its own; a provisional designation has to be looked up.
        "COMMAND": f"'{des};'" if des.isdigit() else f"'DES={des};'",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "'500@399'",
        "REF_PLANE": "FRAME",
        "VEC_TABLE": "1",
        "OUT_UNITS": "'KM-S'",
        "START_TIME": f"'JD{start_jd:.6f}'",
        "STOP_TIME": f"'JD{stop_jd:.6f}'",
        "STEP_SIZE": f"'{minutes}m'",
    }
    name = f"{CACHE}/vectors_{re.sub(r'[^A-Za-z0-9]+', '_', des)}_{start_jd:.4f}_{minutes}m{tag}.txt"
    path = cached_fetch(f"{HORIZONS}?{urllib.parse.urlencode(params)}", name)
    text = path.read_text(encoding="utf-8")
    if "$$SOE" not in text:
        path.unlink()
        return None
    body = text[text.index("$$SOE") : text.index("$$EOE")]
    rows = re.findall(r"^(\d+\.\d+) = .*?\n\s*X =\s*(\S+)\s+Y =\s*(\S+)\s+Z =\s*(\S+)", body, re.M)
    return [(float(jd), float(x), float(y), float(z)) for jd, x, y, z in rows]


#: Where the app's default test user stands: Austin, Texas (east longitude, latitude, km above the ellipsoid).
FIXTURE_SITE = (-97.74, 30.27, 0.0)
TDB_MINUS_UTC_S = 69.184


def horizons_topocentric(des: str, jd_tdb: float) -> dict:
    """Astrometric RA and Dec (ICRF, degrees) of the object from FIXTURE_SITE: what the app must show a user there."""
    jd_utc = jd_tdb - TDB_MINUS_UTC_S / 86400
    params = {
        "format": "text",
        "OBJ_DATA": "NO",
        "CSV_FORMAT": "YES",
        "COMMAND": f"'{des};'" if des.isdigit() else f"'DES={des};'",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'coord@399'",
        "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"'{FIXTURE_SITE[0]},{FIXTURE_SITE[1]},{FIXTURE_SITE[2]}'",
        "QUANTITIES": "'1'",
        "ANG_FORMAT": "DEG",
        "START_TIME": f"'JD{jd_utc:.8f}'",
        "STOP_TIME": f"'JD{jd_utc + 1:.8f}'",
        "STEP_SIZE": "'1d'",
    }
    name = f"{CACHE}/topocentric_{re.sub(r'[^A-Za-z0-9]+', '_', des)}_{jd_utc:.5f}.txt"
    text = cached_fetch(f"{HORIZONS}?{urllib.parse.urlencode(params)}", name).read_text(encoding="utf-8")
    if "$$SOE" not in text:
        raise SystemExit(f"{des}: no topocentric place from Horizons")
    fields = [f.strip() for f in text[text.index("$$SOE") + 5 : text.index("$$EOE")].strip().splitlines()[0].split(",")]
    # date, sun flag, moon flag, RA, Dec
    return {"jdUtc": round(jd_utc, 8), "lon": FIXTURE_SITE[0], "lat": FIXTURE_SITE[1], "ra": float(fields[3]), "dec": float(fields[4])}


def write_fixture(approaches: list[dict]) -> None:
    """Horizons positions BETWEEN the baked samples, round closest approach, for the app's interpolation test."""
    tabled = [a for a in approaches if "xyz" in a]
    closest = sorted(tabled, key=lambda a: a["distLd"])
    # The three nearest passes, where the path bends most, and two ordinary ones.
    picked = closest[:3] + [closest[len(closest) // 2], closest[-1]]
    fixture = []
    for a in picked:
        step_days = a["stepMin"] / 1440
        # The grid sample at or before closest approach, then half a step on: six midpoints round the approach.
        k = int((a["jd"] - a["t0"]) / step_days)
        start = a["t0"] + (k - 2.5) * step_days
        rows = horizons_vectors(a["des"], start, start + 5 * step_days + 1e-4, a["stepMin"] / 60, tag="_mid")
        rows = rows[:6] if rows else rows
        if rows is None or len(rows) != 6:
            raise SystemExit(f"{a['des']}: no midpoint samples from Horizons")
        fixture.append(
            {
                "des": a["des"],
                "distLd": a["distLd"],
                "samples": [{"jd": r[0], "km": [round(v, 1) for v in r[1:]]} for r in rows],
                "topocentric": horizons_topocentric(a["des"], a["jd"] + 0.01),
            }
        )
    FIXTURE_OUT.write_text(
        json.dumps({"source": "JPL Horizons, geocentric ICRF positions (km) midway between the baked samples", "approaches": fixture}, indent=1) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bake", default=BAKE_DATE)
    bake = datetime.date.fromisoformat(parser.parse_args().bake)
    approaches = []
    without_table = 0
    for row in fetch_list(bake):
        jd = float(row["jd"])
        dist_ld = float(row["dist"]) * AU_KM / LD_KM
        sigma = sigma_minutes(row["t_sigma_f"])
        entry = {
            "des": row["des"],
            "name": re.sub(r"\s+", " ", row["fullname"]).strip(),
            "jd": round(jd, 5),
            "date": row["cd"],
            "distLd": round(dist_ld, 4),
            "distMinLd": round(float(row["dist_min"]) * AU_KM / LD_KM, 4),
            "distMaxLd": round(float(row["dist_max"]) * AU_KM / LD_KM, 4),
            "vRel": round(float(row["v_rel"]), 2),
            "h": float(row["h"]) if row["h"] is not None else None,
            "sigmaMin": sigma,
        }
        if row.get("diameter") is not None:
            entry["diameterM"] = round(float(row["diameter"]) * 1000)
        if sigma <= MAX_TIME_SIGMA_MIN:
            step, window = sampling(dist_ld)
            rows = horizons_vectors(row["des"], jd - window, jd + window + 1e-5, step)
            expected = round(2 * window * 24 / step) + 1
            if rows is not None and len(rows) == expected:
                entry["t0"] = round(rows[0][0], 6)
                entry["stepMin"] = round(step * 60)
                entry["xyz"] = [round(v) for r in rows for v in r[1:]]
            else:
                print(f"  {row['des']}: no usable Horizons table ({'none' if rows is None else len(rows)} rows)")
        if "xyz" not in entry:
            without_table += 1
        approaches.append(entry)
    write_fixture(approaches)
    data = {
        "source": "NASA/JPL CNEOS close-approach data (ssd-api.jpl.nasa.gov/cad.api); geocentric positions from JPL Horizons",
        "baked": bake.isoformat(),
        "from": (bake - datetime.timedelta(days=PAST_DAYS)).isoformat(),
        "to": (bake + datetime.timedelta(days=FUTURE_DAYS)).isoformat(),
        "maxLd": MAX_LD,
        "ldKm": LD_KM,
        "windowDays": WINDOW_DAYS,
        "approaches": approaches,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUTPUT.name}: {OUTPUT.stat().st_size / 1024:.0f} KB, {len(approaches)} approaches, {without_table} without a table")


if __name__ == "__main__":
    main()
