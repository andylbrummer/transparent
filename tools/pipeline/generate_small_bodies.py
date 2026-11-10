#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the small bodies of the solar system -
dwarf planets, the brightest asteroids, the comets predicted to be within reach
of a small telescope, and a cloud of some forty thousand minor planets that
draws the main belt, the Hildas, Jupiter's Trojans and the Kuiper belt.

The app works each body's place out for itself, in the browser, from
osculating orbital elements: an unperturbed (two-body) orbit round the Sun
that fits the real one exactly at one epoch and drifts from it afterwards.
So the elements are baked for an epoch in the middle of the period the app
may use them for (EPOCH_JD, VALID_FROM .. VALID_TO) and nothing is shown
outside that period.

Sources (all NASA/JPL Solar System Dynamics, keyless, U.S. Government work):

  JPL Small-Body Database Query API   https://ssd-api.jpl.nasa.gov/sbdb_query.api
      which bodies exist: names, classes, absolute magnitude H and slope G,
      comet total-magnitude parameters M1 and K1, and - for the cloud - the
      orbital elements themselves, each at the epoch SBDB holds it for.
  JPL Horizons API                    https://ssd.jpl.nasa.gov/api/horizons.api
      for every NAMED body: its osculating elements (heliocentric, ecliptic
      and equinox of J2000) at EPOCH_JD, from JPL's own perturbed orbit - SBDB
      holds a comet's elements at whatever epoch its orbit was last fitted,
      often years back, and two-body motion from there is degrees out;
      and, as the check, the geocentric astrometric right ascension and
      declination of every named body on CHECK_OFFSETS_D days across the
      period, with the Earth's own heliocentric position on those days.

What is baked is compared with Horizons here and in test_small_bodies.py: a
named body whose two-body place is further than MAX_ERROR_DEG from Horizons'
on any check date is left out, and said so.

Outputs:
  app/public/sky/small-bodies.json        named bodies and comets
  app/public/sky/small-bodies-cloud.json  header of the cloud
  app/public/sky/small-bodies-cloud.bin   its elements, 13 bytes a body
  app/src/layers/small-bodies/horizons.fixture.json   Horizons places for the app's own test

Usage:
    python3 tools/pipeline/generate_small_bodies.py

Stdlib + numpy. Responses are cached in tools/pipeline/.cache/small-bodies/.
"""

import json
import math
import re
import urllib.parse
from pathlib import Path

import numpy as np

from fetch_cache import cached_fetch

REPO_ROOT = Path(__file__).resolve().parents[2]
SKY_DIR = REPO_ROOT / "app" / "public" / "sky"
BODIES_OUT = SKY_DIR / "small-bodies.json"
CLOUD_JSON_OUT = SKY_DIR / "small-bodies-cloud.json"
CLOUD_BIN_OUT = SKY_DIR / "small-bodies-cloud.bin"
FIXTURE_OUT = REPO_ROOT / "app" / "src" / "layers" / "small-bodies" / "horizons.fixture.json"

SBDB = "https://ssd-api.jpl.nasa.gov/sbdb_query.api"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE = "small-bodies"

#: The epoch of the baked elements, JD (TDB): 2027 Jan 1.0.
EPOCH_JD = 2461406.5
#: The period the elements may be used for: 2026 Jan 1.0 .. 2028 Jan 1.0, a year either side.
VALID_FROM_JD = 2461041.5
VALID_TO_JD = 2461771.5
#: Days from the epoch on which every named body is checked against Horizons (00:00 UTC).
CHECK_OFFSETS_D = [-365, -240, -120, -53, 0, 120, 240, 365]
#: A named body further than this from Horizons on any check date is not shipped.
MAX_ERROR_DEG = 0.25

#: Gaussian gravitational constant, au^1.5/day: the Sun's pull in the units of the elements.
GAUSS_K = 0.01720209895
#: Obliquity of the ecliptic at J2000 (IAU 1976), the one Horizons' ecliptic frame uses.
OBLIQUITY = math.radians(84381.448 / 3600)
#: TDB - UTC over the period, seconds (37 leap seconds + 32.184).
TDB_MINUS_UTC_S = 69.184

#: The five dwarf planets the IAU recognises, by SBDB primary designation.
DWARF_PLANETS = ["1", "134340", "136199", "136108", "136472"]
#: The largest other trans-Neptunian objects, all widely held to be dwarf planets too.
LARGE_TNOS = ["225088", "50000", "90377", "90482"]
#: Bodies worth finding though they are faint: spacecraft targets, a Trojan, a centaur.
NOTABLE = ["433", "99942", "101955", "162173", "65803", "624", "2060"]
#: How many of the main belt's intrinsically brightest (lowest H) are named.
MAIN_BELT_NAMED = 50

#: Comets are kept when their predicted total magnitude reaches this at some time in the period.
COMET_MAG_LIMIT = 15.0
#: ... while at least this far from the Sun in the sky, degrees: nearer, nobody can look.
COMET_MIN_ELONGATION_DEG = 20.0
#: An orbit must have been observed this recently to be trusted to predict anything: a numbered
#: periodic comet, recovered return after return, since the first year; anything else - a new
#: comet, a fragment, an object seen only in SOHO's coronagraphs - since the second.
COMET_LAST_OBS_YEAR_NUMBERED = 2020
COMET_LAST_OBS_YEAR = 2024

#: The cloud: (key, label, SBDB constraint, how many of the lowest H).
CLOUD_CLASSES = [
    ("neo", "near-Earth asteroids", {"sb-group": "neo"}, 800),
    ("mars-crosser", "Mars-crossers", {"sb-class": "MCA"}, 700),
    ("main-belt", "main belt", {"sb-class": "IMB,MBA,OMB"}, 25500),
    ("hilda", "Hildas (3:2 with Jupiter)", {"sb-class": "OMB", "sb-cdata": '{"AND":["a|RG|3.7|4.2","e|LT|0.3"]}'}, 1500),
    ("trojan", "Jupiter Trojans", {"sb-class": "TJN"}, 5000),
    ("centaur", "centaurs", {"sb-class": "CEN"}, 400),
    ("tno", "trans-Neptunian objects", {"sb-class": "TNO"}, 2500),
]
#: Semi-major axes are stored on a log scale between these, au.
A_MIN_AU = 0.5
A_MAX_AU = 2000.0


# ---------------------------------------------------------------- two-body motion


def kepler_position(q: float, e: float, inc: float, node: float, peri: float, tp: float, jd: float) -> np.ndarray:
    """Heliocentric position, au, equatorial J2000 (ICRF), of a body on the orbit at `jd` (TDB).

    Angles in degrees, on the ecliptic and equinox of J2000; `tp` is the time of perihelion.
    """
    dt = jd - tp
    if e < 1:
        a = q / (1 - e)
        mean = GAUSS_K * a**-1.5 * dt
        mean = math.remainder(mean, 2 * math.pi)
        ecc = mean if e < 0.8 else math.copysign(math.pi, mean)
        for _ in range(60):
            step = (ecc - e * math.sin(ecc) - mean) / (1 - e * math.cos(ecc))
            ecc -= step
            if abs(step) < 1e-14:
                break
        x = a * (math.cos(ecc) - e)
        y = a * math.sqrt(1 - e * e) * math.sin(ecc)
    elif e == 1:
        # Barker's equation.
        w = 1.5 * GAUSS_K * dt / math.sqrt(2 * q**3)
        s = math.cbrt(w + math.sqrt(w * w + 1))
        tan_half = s - 1 / s
        x = q * (1 - tan_half * tan_half)
        y = 2 * q * tan_half
    else:
        a = q / (e - 1)
        mean = GAUSS_K * a**-1.5 * dt
        hyp = math.asinh(mean / e)
        for _ in range(60):
            step = (e * math.sinh(hyp) - hyp - mean) / (e * math.cosh(hyp) - 1)
            hyp -= step
            if abs(step) < 1e-14:
                break
        x = a * (e - math.cosh(hyp))
        y = a * math.sqrt(e * e - 1) * math.sinh(hyp)
    return orbit_basis(inc, node, peri) @ np.array([x, y])


def orbit_basis(inc: float, node: float, peri: float) -> np.ndarray:
    """3x2: the unit vectors toward perihelion and 90 degrees on along the orbit, equatorial J2000."""
    i, om, w = math.radians(inc), math.radians(node), math.radians(peri)
    p = [
        math.cos(om) * math.cos(w) - math.sin(om) * math.sin(w) * math.cos(i),
        math.sin(om) * math.cos(w) + math.cos(om) * math.sin(w) * math.cos(i),
        math.sin(w) * math.sin(i),
    ]
    qv = [
        -math.cos(om) * math.sin(w) - math.sin(om) * math.cos(w) * math.cos(i),
        -math.sin(om) * math.sin(w) + math.cos(om) * math.cos(w) * math.cos(i),
        math.cos(w) * math.sin(i),
    ]
    ce, se = math.cos(OBLIQUITY), math.sin(OBLIQUITY)
    rot = np.array([[1, 0, 0], [0, ce, -se], [0, se, ce]])
    return rot @ np.array([p, qv]).T


def astrometric(body: dict, earth: np.ndarray, jd_tdb: float) -> tuple[np.ndarray, float, float]:
    """(unit direction from the Earth, distance from the Earth au, from the Sun au), light-time allowed for."""
    light_days_per_au = 499.004784 / 86400
    delay = 0.0
    for _ in range(3):
        helio = kepler_position(body["q"], body["e"], body["i"], body["om"], body["w"], body["tp"], jd_tdb - delay)
        offset = helio - earth
        delay = float(np.linalg.norm(offset)) * light_days_per_au
    distance = float(np.linalg.norm(offset))
    return offset / distance, distance, float(np.linalg.norm(helio))


def separation_deg(a: np.ndarray, b: np.ndarray) -> float:
    return math.degrees(math.atan2(float(np.linalg.norm(np.cross(a, b))), float(a @ b)))


def unit(ra_deg: float, dec_deg: float) -> np.ndarray:
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    return np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])


def asteroid_magnitude(h: float, g: float, r: float, delta: float, phase: float) -> float:
    """Apparent V magnitude in the IAU H,G system (Bowell et al. 1989); `phase` in radians."""
    t = math.tan(phase / 2)
    phi1 = math.exp(-3.33 * t**0.63)
    phi2 = math.exp(-1.87 * t**1.22)
    return h + 5 * math.log10(r * delta) - 2.5 * math.log10((1 - g) * phi1 + g * phi2)


def comet_magnitude(m1: float, k1: float, r: float, delta: float) -> float:
    """Predicted total magnitude as JPL defines M1 and K1: M1 + 5 log(delta) + K1 log(r)."""
    return m1 + 5 * math.log10(delta) + k1 * math.log10(r)


# ---------------------------------------------------------------- sources


def sbdb(fields: str, name: str, **params: str) -> list[dict]:
    query = {"fields": fields, "full-prec": "true", **params}
    path = cached_fetch(f"{SBDB}?{urllib.parse.urlencode(query)}", f"{CACHE}/sbdb_{name}.json")
    answer = json.loads(path.read_text(encoding="utf-8"))
    return [dict(zip(answer["fields"], row)) for row in answer["data"]]


def horizons(name: str, **params: str) -> str:
    query = {"format": "text", "OBJ_DATA": "NO", "CSV_FORMAT": "YES", **params}
    path = cached_fetch(f"{HORIZONS}?{urllib.parse.urlencode(query)}", f"{CACHE}/{name}.txt")
    text = path.read_text(encoding="utf-8")
    if "$$SOE" not in text:
        path.unlink()
        raise LookupError(text)
    return text


def table_rows(text: str) -> list[list[str]]:
    body = text[text.index("$$SOE") + 5 : text.index("$$EOE")]
    return [[field.strip() for field in line.split(",")] for line in body.strip().splitlines()]


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")


def horizons_command(row: dict) -> str:
    """How Horizons is asked for the body SBDB calls `row`."""
    if "record" in row:
        return row["record"]
    if row["kind"].startswith("c"):
        # The apparition nearest the present, of the many a periodic comet has on file.
        return f"DES={row['pdes']};CAP;"
    return f"DES={row['spkid']};"


def horizons_elements(row: dict) -> dict:
    """Osculating elements at EPOCH_JD: q (au), e, i, om, w (deg, ecliptic J2000), tp (JD TDB)."""
    command = horizons_command(row)
    # Pluto is a planet-class body in Horizons: its small-body record redirects to 999, whose
    # heliocentric elements the API does not serve; the Pluto system's barycentre (9) is 2,000 km away.
    if row["pdes"] == "134340":
        command = "9"
    query = lambda command: horizons(  # noqa: E731
        f"elements_{slug(row['pdes'])}",
        COMMAND=f"'{command}'",
        EPHEM_TYPE="ELEMENTS",
        CENTER="'500@10'",
        REF_PLANE="ECLIPTIC",
        REF_SYSTEM="ICRF",
        OUT_UNITS="'AU-D'",
        # A start and a stop, not a one-entry TLIST: Horizons fails on the list form for bodies with their own SPK file (Pluto, Bennu).
        START_TIME=f"'JD{EPOCH_JD}'",
        STOP_TIME=f"'JD{EPOCH_JD + 1}'",
        STEP_SIZE="'1d'",
    )
    try:
        text = query(command)
    except LookupError as error:
        # Several records answer to the name and "CAP" did not settle it: Horizons lists them
        # ("    90004820    2025    C/2023 R1 ..."); take the latest of the body's own.
        records = re.findall(r"^\s+(9\d{7})\s+(\d{4})\s+(.+?)\s{2,}", str(error), re.M)
        # Only the body itself, not a fragment ("240P-B") listed beside it.
        own = [r for r in records if r[2] in (row["pdes"], f"{row.get('prefix')}/{row['pdes']}")]
        if not own:
            raise
        row["record"] = max(own, key=lambda record: int(record[1]))[0] + ";"
        text = query(row["record"])
    fields = table_rows(text)[0]
    if abs(float(fields[0]) - EPOCH_JD) > 1e-6:
        raise SystemExit(f"{row['pdes']}: elements are for JD {fields[0]}, not the epoch")
    # JDTDB, calendar, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
    e, q, inc, node, peri, tp = (float(v) for v in fields[2:8])
    return {"q": q, "e": e, "i": inc, "om": node, "w": peri, "tp": tp}


def horizons_places(row: dict, jd_utc: list[float]) -> list[tuple[float, float]]:
    """Geocentric astrometric RA and Dec (ICRF), degrees, at each UTC Julian date."""
    command = "999" if row["pdes"] == "134340" else horizons_command(row)
    common = {"COMMAND": f"'{command}'", "EPHEM_TYPE": "OBSERVER", "CENTER": "'500@399'", "QUANTITIES": "'1'", "ANG_FORMAT": "DEG"}
    try:
        rows = table_rows(horizons(f"places_{slug(row['pdes'])}", TLIST="'" + " ".join(f"{jd}" for jd in jd_utc) + "'", **common))
    except LookupError:
        # The same failure of the list form as for the elements: ask date by date.
        rows = [
            table_rows(
                horizons(f"places_{slug(row['pdes'])}_{jd}", START_TIME=f"'JD{jd}'", STOP_TIME=f"'JD{jd + 1}'", STEP_SIZE="'1d'", **common)
            )[0]
            for jd in jd_utc
        ]
    if len(rows) != len(jd_utc):
        raise SystemExit(f"{row['pdes']}: {len(rows)} places for {len(jd_utc)} dates")
    # date, sun flag, moon flag, RA, Dec
    return [(float(f[3]), float(f[4])) for f in rows]


def earth_positions(jd_tdb: list[float], name: str) -> list[np.ndarray]:
    """The Earth's heliocentric position, au, equatorial J2000 (ICRF)."""
    out = []
    # Horizons takes at most a few dozen times in one TLIST.
    for start in range(0, len(jd_tdb), 30):
        chunk = jd_tdb[start : start + 30]
        text = horizons(
            f"earth_{name}_{start}",
            COMMAND="'399'",
            EPHEM_TYPE="VECTORS",
            CENTER="'500@10'",
            REF_PLANE="FRAME",
            VEC_TABLE="1",
            # Horizons' CSV vector tables come back without their numbers; the labelled ones are whole.
            CSV_FORMAT="NO",
            OUT_UNITS="'AU-D'",
            TLIST="'" + " ".join(f"{jd:.6f}" for jd in chunk) + "'",
        )
        found = re.findall(r"X =\s*(\S+)\s+Y =\s*(\S+)\s+Z =\s*(\S+)", text[text.index("$$SOE") : text.index("$$EOE")])
        if len(found) != len(chunk):
            raise SystemExit(f"Horizons gave {len(found)} Earth positions for {len(chunk)} times")
        out += [np.array([float(v) for v in xyz]) for xyz in found]
    return out


# ---------------------------------------------------------------- named bodies

BODY_FIELDS = "spkid,full_name,pdes,name,kind,class,H,G,diameter"


def named_rows() -> list[dict]:
    wanted = DWARF_PLANETS + LARGE_TNOS + NOTABLE
    constraint = json.dumps({"OR": [f"pdes|EQ|{d}" for d in wanted]}, separators=(",", ":"))
    special = {row["pdes"]: row for row in sbdb(BODY_FIELDS, "named", **{"sb-cdata": constraint})}
    missing = [d for d in wanted if d not in special]
    if missing:
        raise SystemExit(f"SBDB did not return {missing}")
    rows = []
    for group, designations in (("dwarf", DWARF_PLANETS), ("tno", LARGE_TNOS), ("notable", NOTABLE)):
        rows += [{**special[d], "group": group} for d in designations]
    belt = sbdb(
        BODY_FIELDS,
        "main_belt_brightest",
        **{"sb-class": "IMB,MBA,OMB", "sb-cdata": '{"AND":["H|DF"]}', "sort": "H", "limit": str(MAIN_BELT_NAMED + 5)},
    )
    seen = {row["pdes"] for row in rows}
    rows += [{**row, "group": "asteroid"} for row in belt if row["pdes"] not in seen][:MAIN_BELT_NAMED]
    return rows


def display_name(row: dict) -> str:
    if row.get("name"):
        return row["name"]
    return row["full_name"].strip()


def comet_name(full_name: str) -> str:
    """'C/2023 A3 (Tsuchinshan-ATLAS)' stays; '    2P/Encke' is trimmed."""
    return re.sub(r"\s+", " ", full_name).strip()


def comet_candidates(grid_jd: list[float], grid_earth: list[np.ndarray]) -> list[dict]:
    """Comets whose SBDB orbit and magnitude law put them within COMET_MAG_LIMIT, clear of the Sun, during the period."""
    rows = sbdb(
        "spkid,full_name,pdes,prefix,kind,class,epoch,e,q,i,om,w,tp,M1,K1,last_obs",
        "comets",
        **{"sb-kind": "c", "sb-cdata": '{"AND":["M1|DF","K1|DF"]}'},
    )
    picked = []
    for row in rows:
        numbered = re.fullmatch(r"\d+P", row["pdes"]) is not None
        since = COMET_LAST_OBS_YEAR_NUMBERED if numbered else COMET_LAST_OBS_YEAR
        if row["prefix"] in ("D", "X") or int((row["last_obs"] or "0")[:4]) < since:
            continue
        body = {k: float(row[k]) for k in ("q", "e", "i", "om", "w", "tp")}
        best = math.inf
        for jd, earth in zip(grid_jd, grid_earth):
            helio = kepler_position(body["q"], body["e"], body["i"], body["om"], body["w"], body["tp"], jd)
            r = float(np.linalg.norm(helio))
            delta = float(np.linalg.norm(helio - earth))
            if separation_deg(helio - earth, -earth) >= COMET_MIN_ELONGATION_DEG:
                best = min(best, comet_magnitude(float(row["M1"]), float(row["K1"]), r, delta))
        if best <= COMET_MAG_LIMIT:
            picked.append({**row, "group": "comet", "bestMag": best})
    return sorted(picked, key=lambda row: row["bestMag"])


def check_body(body: dict, row: dict, check_jd_utc: list[float], check_earth: list[np.ndarray]) -> tuple[float, list]:
    """Largest angle, degrees, between the two-body place and Horizons' over the check dates."""
    places = horizons_places(row, check_jd_utc)
    worst = 0.0
    for jd, earth, (ra, dec) in zip(check_jd_utc, check_earth, places):
        direction, _, _ = astrometric(body, earth, jd + TDB_MINUS_UTC_S / 86400)
        worst = max(worst, separation_deg(direction, unit(ra, dec)))
    return worst, places


def round_elements(body: dict) -> dict:
    return {
        "q": round(body["q"], 8),
        "e": round(body["e"], 8),
        "i": round(body["i"], 6),
        "om": round(body["om"], 6),
        "w": round(body["w"], 6),
        "tp": round(body["tp"], 5),
    }


# ---------------------------------------------------------------- the cloud


def cloud_class(key: str, constraint: dict, limit: int) -> np.ndarray:
    """Rows of a, e, i, om, w, mean anomaly at EPOCH_JD (deg), H - the `limit` lowest H of the class."""
    params = dict(constraint)
    extra = json.loads(params.pop("sb-cdata", '{"AND":[]}'))["AND"]
    params["sb-cdata"] = json.dumps({"AND": ["H|DF", "e|LT|0.98", *extra]}, separators=(",", ":"))
    rows = sbdb("a,e,i,om,w,ma,epoch,H", f"cloud_{key}", sort="H", limit=str(limit), **params)
    out = []
    for row in rows:
        a, e, inc, node, peri, mean, epoch, h = (float(row[k]) for k in ("a", "e", "i", "om", "w", "ma", "epoch", "H"))
        if not (A_MIN_AU < a < A_MAX_AU):
            continue
        # Carried on from SBDB's epoch to ours along the same two-body orbit the app continues with.
        motion = math.degrees(GAUSS_K * a**-1.5)
        out.append([a, e, inc, node, peri, (mean + motion * (EPOCH_JD - epoch)) % 360, h])
    return np.array(out)


def quantise(values: np.ndarray, span: float) -> np.ndarray:
    return np.clip(np.round(values / span * 65535), 0, 65535).astype("<u2")


def bake_cloud() -> None:
    classes = []
    blocks = []
    start = 0
    for key, label, constraint, limit in CLOUD_CLASSES:
        rows = cloud_class(key, constraint, limit)
        if key == "main-belt":
            # The Hildas have their own block.
            rows = rows[~((rows[:, 0] > 3.7) & (rows[:, 0] < 4.2) & (rows[:, 1] < 0.3))]
        classes.append({"key": key, "label": label, "start": start, "count": len(rows), "faintestH": float(rows[:, 6].max())})
        blocks.append(rows)
        start += len(rows)
        print(f"cloud {key:13s} {len(rows):6d} bodies  H <= {rows[:, 6].max():.2f}  a {rows[:, 0].min():.2f} .. {rows[:, 0].max():.1f} au")
    rows = np.concatenate(blocks)
    a_code = quantise(np.log(rows[:, 0] / A_MIN_AU), math.log(A_MAX_AU / A_MIN_AU))
    columns = [a_code, quantise(rows[:, 1], 1.0), quantise(rows[:, 2], 180.0)] + [quantise(rows[:, k] % 360, 360.0) for k in (3, 4, 5)]
    # H in fifths of a magnitude from -2.
    h_code = np.clip(np.round((rows[:, 6] + 2) * 5), 0, 255).astype("u1")
    CLOUD_BIN_OUT.write_bytes(b"".join(c.tobytes() for c in columns) + h_code.tobytes())
    header = {
        "source": "NASA/JPL Small-Body Database (ssd.jpl.nasa.gov): osculating elements, carried to the epoch as two-body orbits",
        "epochJd": EPOCH_JD,
        "validFromJd": VALID_FROM_JD,
        "validToJd": VALID_TO_JD,
        "count": len(rows),
        "aMinAu": A_MIN_AU,
        "aMaxAu": A_MAX_AU,
        "layout": "uint16 little-endian arrays of `count`: log a, e/1, i/180, node/360, peri/360, mean anomaly/360; then uint8 (H+2)*5",
        "classes": classes,
    }
    CLOUD_JSON_OUT.write_text(json.dumps(header, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{CLOUD_BIN_OUT.name}: {CLOUD_BIN_OUT.stat().st_size / 1024:.0f} KB, {len(rows)} bodies")


# ---------------------------------------------------------------- main

#: Bodies whose Horizons places go into the app's own test, by SBDB primary designation.
FIXTURE_BODIES = ["1", "4", "134340", "136199", "624", "433", "2060"]
FIXTURE_COMETS = 3


def main() -> None:
    check_jd_utc = [EPOCH_JD + d for d in CHECK_OFFSETS_D]
    check_earth = earth_positions([jd + TDB_MINUS_UTC_S / 86400 for jd in check_jd_utc], "check")
    # Every five days across the period, for the comets' predicted brightness.
    grid_jd = [VALID_FROM_JD + 5.0 * k for k in range(int((VALID_TO_JD - VALID_FROM_JD) / 5) + 1)]
    grid_earth = earth_positions(grid_jd, "grid")

    bodies = []
    comets = []
    fixture = []
    dropped = []
    for row in named_rows() + comet_candidates(grid_jd, grid_earth):
        name = comet_name(row["full_name"]) if row["group"] == "comet" else display_name(row)
        try:
            elements = horizons_elements(row)
            worst, places = check_body(elements, row, check_jd_utc, check_earth)
        except LookupError as error:
            dropped.append(f"{name}: Horizons would not answer ({str(error).strip()[-80:]!r})")
            continue
        print(f"{row['group']:8s} {name:36s} worst error over the period {worst * 3600:8.1f} arcsec")
        if worst > MAX_ERROR_DEG:
            dropped.append(f"{name}: two-body place up to {worst:.2f} deg from Horizons")
            continue
        entry = {"name": name, "des": row["pdes"], **round_elements(elements), "errorArcsec": round(worst * 3600, 1)}
        if row["group"] == "comet":
            comets.append({**entry, "m1": float(row["M1"]), "k1": float(row["K1"]), "class": row["class"]})
        else:
            entry.update(group=row["group"], h=float(row["H"]), g=float(row["G"]) if row["G"] is not None else 0.15)
            entry["gAssumed"] = row["G"] is None
            if row["diameter"] is not None:
                entry["diameterKm"] = round(float(row["diameter"]), 1)
            bodies.append(entry)
        in_fixture = row["pdes"] in FIXTURE_BODIES or (row["group"] == "comet" and len([f for f in fixture if f["comet"]]) < FIXTURE_COMETS)
        if in_fixture:
            fixture.append(
                {
                    "name": name,
                    "comet": row["group"] == "comet",
                    "places": [{"jdUtc": jd, "ra": ra, "dec": dec} for jd, (ra, dec) in zip(check_jd_utc, places)],
                }
            )
    for line in dropped:
        print("LEFT OUT", line)

    data = {
        "source": "NASA/JPL Horizons osculating elements at the epoch (heliocentric, ecliptic J2000); H, G, M1, K1, names from the JPL Small-Body Database",
        "epochJd": EPOCH_JD,
        "validFromJd": VALID_FROM_JD,
        "validToJd": VALID_TO_JD,
        "cometMagLimit": COMET_MAG_LIMIT,
        "bodies": bodies,
        "comets": comets,
    }
    SKY_DIR.mkdir(parents=True, exist_ok=True)
    BODIES_OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{BODIES_OUT.name}: {BODIES_OUT.stat().st_size / 1024:.0f} KB, {len(bodies)} bodies, {len(comets)} comets")
    FIXTURE_OUT.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_OUT.write_text(json.dumps({"source": "JPL Horizons, geocentric astrometric RA/Dec (ICRF), degrees", "bodies": fixture}, indent=1) + "\n", encoding="utf-8")
    bake_cloud()


if __name__ == "__main__":
    main()
