#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the naked-eye stars.

Writes app/public/sky/stars.json from the Hipparcos main catalogue
(ESA 1997, CDS I/239): every star of V <= 7.0 with its position, visual
magnitude and B-V colour, plus the proper names approved by the IAU
Working Group on Star Names.

Positions are ICRS. Hipparcos gives them at epoch J1991.25; each star is
carried along its proper motion to EPOCH_YEAR, so fast movers (Arcturus:
2.3 arcsec/yr) sit where they are now. Parallax and radial velocity are
ignored: the largest neglected term is under an arcsecond.

Seven stars of V <= 7 are in the main catalogue with a magnitude but no
astrometry: close visual binaries the satellite could not solve as one
star, among them xi Ursae Majoris (V 3.8, the Great Bear's hind foot) and
xi Scorpii (V 4.2). Their J2000 positions and proper motions are taken
from SIMBAD (CDS) instead, and carried to EPOCH_YEAR the same way;
magnitude and colour stay Hipparcos's.

Columns, one entry per star, sorted brightest first:
    ra    right ascension, millidegrees [0, 360000)
    dec   declination, millidegrees
    mag   V magnitude x 100
    bv    B-V colour x 100 (BV_MISSING where Hipparcos has none)
and `names`: [index into the columns, IAU name] for the named stars.

Usage:
    python3 tools/pipeline/generate_stars.py

Raw downloads are cached in tools/pipeline/.cache/. Standard library only.
"""

import json
import math
import urllib.parse
from pathlib import Path

from fetch_cache import cached_fetch

MAG_LIMIT = 7.0
EPOCH_YEAR = 2026.0
HIPPARCOS_EPOCH = 1991.25
BV_MISSING = -999

VIZIER_QUERY = (
    "/viz-bin/asu-tsv?-source=I/239/hip_main&-out=HIP,Vmag,RAICRS,DEICRS,pmRA,pmDE,B-V"
    f"&Vmag=%3C{MAG_LIMIT + 0.005}&-out.max=unlimited"
)
# The CDS original and its CfA mirror serve the same catalogue.
HIPPARCOS_URLS = [
    "https://vizier.cfa.harvard.edu" + VIZIER_QUERY,
    "https://vizier.cds.unistra.fr" + VIZIER_QUERY,
]
IAU_NAMES_URL = "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt"
# SIMBAD's TAP service, on the CfA mirror first for the same reason.
SIMBAD_TAP_URLS = [
    "https://simbad.cfa.harvard.edu/simbad/sim-tap/sync",
    "https://simbad.cds.unistra.fr/simbad/sim-tap/sync",
]
SIMBAD_EPOCH = 2000.0

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "stars.json"


def parse_hipparcos(text: str) -> list[dict]:
    """Rows of the VizieR TSV: skips comments, the header, units and dashes lines."""
    stars = []
    header: list[str] | None = None
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        fields = [f.strip() for f in line.split("\t")]
        if header is None:
            header = fields
            continue
        if len(fields) != len(header) or not fields[0].isdigit():
            continue
        row = dict(zip(header, fields))
        if not row["Vmag"]:
            continue
        located = bool(row["RAICRS"] and row["DEICRS"])
        stars.append(
            {
                "hip": int(row["HIP"]),
                "mag": float(row["Vmag"]),
                # None: Hipparcos has no astrometric solution for this entry (see fill_from_simbad).
                "ra": float(row["RAICRS"]) if located else None,
                "dec": float(row["DEICRS"]) if located else None,
                "pm_ra": float(row["pmRA"]) if row["pmRA"] else 0.0,
                "pm_dec": float(row["pmDE"]) if row["pmDE"] else 0.0,
                "epoch": HIPPARCOS_EPOCH,
                "bv": float(row["B-V"]) if row["B-V"] else None,
            }
        )
    return stars


def parse_simbad(text: str) -> dict[int, tuple[float, float, float, float]]:
    """HIP number -> (ra, dec in degrees at J2000, pmRA*cos(dec), pmDec in mas/yr) from a SIMBAD TAP TSV answer."""
    found: dict[int, tuple[float, float, float, float]] = {}
    for line in text.splitlines()[1:]:
        fields = [field.strip().strip('"') for field in line.split("\t")]
        if len(fields) < 5 or not fields[0].startswith("HIP "):
            continue
        ra, dec = float(fields[1]), float(fields[2])
        pm_ra = float(fields[3]) if fields[3] else 0.0
        pm_dec = float(fields[4]) if fields[4] else 0.0
        found[int(fields[0][4:])] = (ra, dec, pm_ra, pm_dec)
    return found


def fill_from_simbad(stars: list[dict]) -> list[int]:
    """Give the stars Hipparcos could not place their SIMBAD position; returns their HIP numbers."""
    missing = [star for star in stars if star["ra"] is None]
    if not missing:
        return []
    names = ",".join(f"'HIP {star['hip']}'" for star in sorted(missing, key=lambda s: s["hip"]))
    query = f"select id,ra,dec,pmra,pmdec from basic join ident on oidref=oid where id in ({names})"
    params = urllib.parse.urlencode({"request": "doQuery", "lang": "adql", "format": "tsv", "query": query})
    path = cached_fetch([f"{url}?{params}" for url in SIMBAD_TAP_URLS], "simbad_hip_without_astrometry.tsv")
    found = parse_simbad(path.read_text(encoding="utf-8"))
    for star in missing:
        if star["hip"] not in found:
            raise ValueError(f"SIMBAD has no position for HIP {star['hip']}")
        star["ra"], star["dec"], star["pm_ra"], star["pm_dec"] = found[star["hip"]]
        star["epoch"] = SIMBAD_EPOCH
    return [star["hip"] for star in missing]


def apply_proper_motion(star: dict, years: float) -> tuple[float, float]:
    """(ra, dec) in degrees after `years`; pmRA is mu_alpha*cos(dec), both in mas/yr."""
    dec = star["dec"] + star["pm_dec"] * years / 3.6e6
    cos_dec = math.cos(math.radians(star["dec"]))
    ra = star["ra"] + (star["pm_ra"] * years / 3.6e6) / cos_dec if cos_dec > 1e-6 else star["ra"]
    return ra % 360.0, max(-90.0, min(90.0, dec))


def parse_iau_names(text: str) -> dict[int, str]:
    """HIP number -> approved proper name, from the fixed-width IAU-CSN table."""
    names: dict[int, str] = {}
    for line in text.splitlines():
        if not line or line[0] in "#$":
            continue
        # Column 2, the name with diacritics, is fixed-width. The designation
        # may hold a space ("HR 897"), so HIP is counted from the right:
        # ... HIP HD RA Dec Date, then "*" on rows that carry a note.
        fields = line.split()
        name = line[18:36].strip()
        hip = fields[-6] if fields[-1] == "*" else fields[-5]
        if hip.isdigit():
            names[int(hip)] = name
    return names


def build() -> dict:
    hip_text = cached_fetch(HIPPARCOS_URLS, "hipparcos_v7.tsv").read_text(encoding="utf-8")
    names_text = cached_fetch(IAU_NAMES_URL, "IAU-CSN.txt").read_text(encoding="utf-8")
    stars = [s for s in parse_hipparcos(hip_text) if s["mag"] <= MAG_LIMIT]
    filled = fill_from_simbad(stars)
    stars.sort(key=lambda s: (s["mag"], s["hip"]))
    proper = parse_iau_names(names_text)

    ra, dec, mag, bv, names = [], [], [], [], []
    for index, star in enumerate(stars):
        r, d = apply_proper_motion(star, EPOCH_YEAR - star["epoch"])
        ra.append(round(r * 1000) % 360000)
        dec.append(round(d * 1000))
        mag.append(round(star["mag"] * 100))
        bv.append(BV_MISSING if star["bv"] is None else round(star["bv"] * 100))
        if star["hip"] in proper:
            names.append([index, proper[star["hip"]]])
    return {
        "source": "Hipparcos main catalogue (ESA 1997), CDS I/239; names: IAU WGSN Catalog of Star Names; "
        f"positions of {len(filled)} binaries without Hipparcos astrometry: SIMBAD (CDS)",
        "epochYear": EPOCH_YEAR,
        "frame": "ICRS",
        "quantumPerDegree": 1000,
        "bvMissing": BV_MISSING,
        "ra": ra,
        "dec": dec,
        "mag": mag,
        "bv": bv,
        "names": names,
    }


def main() -> None:
    data = build()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes): {len(data['ra'])} stars, {len(data['names'])} named")


if __name__ == "__main__":
    main()
