#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: which way the mantle's grain runs
under each seismic station.

A shear wave that has crossed the core as a P wave (SKS, SKKS, PKS) leaves
it polarised in a known plane; if it then splits into a fast and a slow
wave on its way up to the station, the rock it crossed is anisotropic -
mostly olivine crystals lined up by the mantle's flow in the top few
hundred kilometres. A splitting measurement gives the fast direction phi
(degrees east of north) and the delay dt (s) between the two waves.

Source: the SKS splitting database of the Université de Montpellier
(SplitLab), Barruol, G., Wüstefeld, A. & Bokelmann, G. (2009),
SKS-Splitting-database, Université de Montpellier, Laboratoire
Géosciences, doi:10.18715/SKS_SPLITTING_DATABASE; described in
Wüstefeld, A., Bokelmann, G., Barruol, G. & Montagner, J.-P. (2009),
Identifying global seismic anisotropy patterns by correlating shear-wave
splitting and surface-wave data, Phys. Earth Planet. Inter. 176, 198-212,
doi:10.1016/j.pepi.2009.05.006. An open-access compilation of published
measurements (splittingDB.txt, one row each, with refID into
splittingDB_ref.txt); no named licence, and the site asks that the works
be cited.

Kept: rows of a core-refracted phase (a phase name with a K in it, or none
given); dropped: direct S and ScS (they split near the earthquake too),
the two-layer models' separate layers, rows without a place. A null - no
splitting seen, phi "null" or dt 0 - is kept as a null: the wave arrived
unsplit, either because the rock below is not anisotropic or because the
wave came in along the fast or slow direction.

Per station (rows at the same place to 0.01 degree): the fast direction is
the axial mean - phi and phi + 180 are the same direction, so the mean is
taken of 2 phi - its strength R (1 when all agree, 0 when they scatter
every way) says whether one direction describes the station; dt is the
mean delay of the split rows. Each row counts once, whether a single
measurement or a published station mean.

Writes app/public/geo/sks-splitting.json:
    {source, stations: [lon*100, lat*100, phi, dt*100, split, nulls, R*100, ...]}
seven integers a station; phi and dt are 0 at a station with only nulls.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_sks_splitting.py
"""

import json
import math
from collections import defaultdict
from pathlib import Path

from fetch_cache import cached_fetch

DB_URL = "http://splitting.gm.univ-montp2.fr/DB/public/splittingDB.txt"
REF_URL = "http://splitting.gm.univ-montp2.fr/DB/public/splittingDB_ref.txt"
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = REPO_ROOT / "app/public/geo/sks-splitting.json"
FIELDS = 7
SOURCE = (
    "SKS splitting database, Université de Montpellier (Barruol, Wüstefeld & Bokelmann 2009, doi:10.18715/SKS_SPLITTING_DATABASE): "
    "core-refracted phases only, averaged per station"
)


def number(text: str) -> float | None:
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def read_rows() -> list[list[str]]:
    text = cached_fetch(DB_URL, "sks/splittingDB.txt").read_text(encoding="latin-1")
    lines = text.splitlines()
    if lines[0].split("|")[:6] != ["id", "Station", "Latitude", "Longitude", "phi", "dt"]:
        raise SystemExit(f"unexpected header: {lines[0]}")
    return [row for row in (line.split("|") for line in lines[1:]) if len(row) == 13]


def measurements(rows: list[list[str]]) -> tuple[list[tuple[float, float, float | None, float | None]], dict[str, int]]:
    """(lon, lat, phi, dt) per kept row, phi None for a null; and why the others were dropped."""
    kept: list[tuple[float, float, float | None, float | None]] = []
    dropped: dict[str, int] = defaultdict(int)
    for row in rows:
        phase = row[7].strip()
        remark = row[12].lower()
        if phase and "K" not in phase.upper():
            dropped["not a core-refracted phase"] += 1
            continue
        if any(word in remark for word in ("upper layer", "lower layer", "top layer")):
            dropped["one layer of a two-layer model"] += 1
            continue
        lat, lon = number(row[2]), number(row[3])
        if lat is None or lon is None or abs(lat) > 90:
            dropped["no place"] += 1
            continue
        lon = (lon + 180) % 360 - 180
        phi, dt = number(row[4]), number(row[5])
        if row[4].strip().lower() == "null" or dt == 0:
            kept.append((lon, lat, None, None))
        elif phi is None or dt is None:
            dropped["no value"] += 1
        else:
            kept.append((lon, lat, phi % 180, dt))
    return kept, dict(dropped)


def axial_mean(phis: list[float]) -> tuple[float, float]:
    """Mean direction (0..180) and its strength R (0..1) of axial data: the mean of 2 phi, halved."""
    c = sum(math.cos(math.radians(2 * p)) for p in phis)
    s = sum(math.sin(math.radians(2 * p)) for p in phis)
    return (math.degrees(math.atan2(s, c)) / 2) % 180, math.hypot(c, s) / len(phis)


def stations(kept: list[tuple[float, float, float | None, float | None]]) -> list[dict]:
    groups: dict[tuple[float, float], list[tuple[float | None, float | None]]] = defaultdict(list)
    for lon, lat, phi, dt in kept:
        groups[(round(lon, 2), round(lat, 2))].append((phi, dt))
    out = []
    for (lon, lat), rows in sorted(groups.items(), key=lambda item: (item[0][1], item[0][0])):
        split = [(phi, dt) for phi, dt in rows if phi is not None and dt is not None]
        nulls = len(rows) - len(split)
        if split:
            phi, strength = axial_mean([p for p, _ in split])
            dt = sum(d for _, d in split) / len(split)
        else:
            phi, strength, dt = 0.0, 0.0, 0.0
        out.append({"lon": lon, "lat": lat, "phi": phi, "dt": dt, "split": len(split), "nulls": nulls, "r": strength})
    return out


def encode(station: dict) -> list[int]:
    return [
        round(station["lon"] * 100),
        round(station["lat"] * 100),
        round(station["phi"]) % 180,
        round(station["dt"] * 100),
        station["split"],
        station["nulls"],
        round(station["r"] * 100),
    ]


def main() -> None:
    kept, dropped = measurements(read_rows())
    cached_fetch(REF_URL, "sks/splittingDB_ref.txt")
    result = stations(kept)
    flat = [value for station in result for value in encode(station)]
    OUT_JSON.write_text(json.dumps({"source": SOURCE, "fields": FIELDS, "stations": flat}, separators=(",", ":")) + "\n")
    print(
        json.dumps(
            {
                "rows": len(kept),
                "nullRows": sum(1 for row in kept if row[2] is None),
                "dropped": dropped,
                "stations": len(result),
                "nullOnly": sum(1 for s in result if s["split"] == 0),
                "bytes": OUT_JSON.stat().st_size,
            }
        )
    )


if __name__ == "__main__":
    main()
