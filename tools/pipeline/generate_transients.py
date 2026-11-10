#!/usr/bin/env python3
"""
Bake the transient and multi-messenger sky: things that happened once, at a
known time, somewhere on the celestial sphere.

Outputs, under app/public/sky/transients/ (one per layer of
app/src/layers/transients/):

    grb.json           gamma-ray bursts        Fermi GBM burst catalogue (HEASARC fermigbrst) + Swift GRB table
    frb.json           fast radio bursts       CHIME/FRB Catalog 1 (VizieR J/ApJS/257/59) + FRB 20200428
    supernovae.json    bright supernovae       Asiago SN catalogue (HEASARC asiagosn) + ASAS-SN bright SN catalogues
    neutrinos.json     IceCube alert tracks    IceCat-1 (Harvard Dataverse, doi:10.7910/DVN/SCRUCD)
    gw.json            gravitational waves     GWOSC event catalogues + LIGO/Virgo/KAGRA sky maps (GraceDB, DCC)
    interstellar.json  interstellar directions JPL SBDB orbits of 1I, 2I, 3I; IBEX interstellar-helium flow

Every file has the same columns, sorted by time, so the app can hide what
has not happened yet at its clock:

    t     days since 2000-01-01T00:00Z (two decimals) at which the event was seen
    ra, dec   ICRS, in 1/1000 degree
    cls   index into `classes`
    val   per file, see `value`
    labels  [row, text, priority], most important first

plus, where a catalogue publishes an uncertainty worth drawing:

    boxes    [row, ra-, ra+, dec-, dec+] degrees        (neutrinos: the 90% rectangle)
    regions  {row, ra[], dec[]} in 1/1000 degree         (gravitational waves: pixels of the 90% region)

Nothing here is typed in from memory: positions, dates, fluences,
magnitudes and energies are the catalogues' own; the two numbers quoted
from papers (the interstellar helium flow, the magnetar burst) are read out
of the abstracts fetched from arXiv and the run fails if they are not there.

Usage:
    python3 -m venv tools/pipeline/.cache/venv-transients
    tools/pipeline/.cache/venv-transients/bin/pip install numpy astropy astropy-healpix
    tools/pipeline/.cache/venv-transients/bin/python tools/pipeline/generate_transients.py [name ...]

astropy and astropy-healpix are needed only for gw.json (FITS sky maps on
HEALPix grids); the other files build with the standard library.
"""

import csv
import datetime
import html
import io
import json
import math
import re
import sys
import tarfile
import time
import urllib.parse
from pathlib import Path

from fetch_cache import CACHE_DIR, cached_fetch
from sky_catalog_support import (
    HEASARC_TAP,
    VIZIER_HOSTS,
    separation_deg,
    sexagesimal_dec,
    sexagesimal_ra,
    simbad_position,
)

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "app" / "public" / "sky" / "transients"
CACHE = "transients"
QUANTUM = 1000
MJD_2000 = 51544.0
GPS_EPOCH_MJD = 44244.0
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Already marked and named by the Sky landmarks layer (generate_deepsky.py, build_landmarks).
IN_LANDMARKS = {"SN 1987A", "SN 1885A"}


def mjd_of(year: int, month: int, day: float) -> float:
    whole = int(day)
    return datetime.date(year, month, whole).toordinal() - datetime.date(1858, 11, 17).toordinal() + (day - whole)


def date_text(mjd: float) -> str:
    d = datetime.date.fromordinal(int(math.floor(mjd)) + datetime.date(1858, 11, 17).toordinal())
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


class Events:
    """One baked file: rows kept as dicts until written, then sorted by time."""

    def __init__(self, source: str, classes: list[str], value: str):
        self.source = source
        self.classes = classes
        self.value = value
        self.rows: list[dict] = []

    def add(self, mjd: float, ra: float, dec: float, cls: str, val: float, **extra) -> dict:
        row = {"mjd": mjd, "ra": ra, "dec": dec, "cls": self.classes.index(cls), "val": val, **extra}
        self.rows.append(row)
        return row

    def to_json(self, **more) -> dict:
        self.rows.sort(key=lambda row: row["mjd"])
        labels = sorted(
            ([i, row["label"], round(row["priority"], 2)] for i, row in enumerate(self.rows) if "label" in row),
            key=lambda entry: entry[2],
        )
        data = {
            "source": self.source,
            "frame": "ICRS",
            "quantumPerDegree": QUANTUM,
            "epoch": "t: days since 2000-01-01T00:00Z",
            "classes": self.classes,
            "value": self.value,
            "t": [round(row["mjd"] - MJD_2000, 2) for row in self.rows],
            "ra": [round(row["ra"] * QUANTUM) % (360 * QUANTUM) for row in self.rows],
            "dec": [round(row["dec"] * QUANTUM) for row in self.rows],
            "cls": [row["cls"] for row in self.rows],
            "val": [row["val"] for row in self.rows],
            "labels": labels,
        }
        boxes = [[i, *row["box"]] for i, row in enumerate(self.rows) if "box" in row]
        if boxes:
            data["boxes"] = boxes
        regions = [
            {"row": i, "ra": [round(a * QUANTUM) % (360 * QUANTUM) for a, _ in row["region"]], "dec": [round(d * QUANTUM) for _, d in row["region"]]}
            for i, row in enumerate(self.rows)
            if "region" in row
        ]
        if regions:
            data["regions"] = regions
        data.update(more)
        return data


def heasarc(table: str, columns: list[str], where: str | None = None) -> list[dict[str, str | None]]:
    """Like sky_catalog_support.heasarc_rows, cached under this script's own folder."""
    query = f"select {','.join(columns)} from {table}" + (f" where {where}" if where else "")
    url = HEASARC_TAP + "?" + urllib.parse.urlencode(
        {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "text", "MAXREC": "1000000", "QUERY": query}
    )
    lines = cached_fetch(url, f"{CACHE}/heasarc_{table}.txt").read_text(encoding="utf-8").splitlines()
    if not lines or "|" not in lines[0]:
        raise ValueError(f"HEASARC answered no table for {table}")
    header = [name.strip() for name in lines[0].split("|")]
    rows = []
    for line in lines[1:]:
        if not line.strip() or line.startswith("Number of"):
            continue
        if line.startswith("----"):
            break
        fields = [field.strip() for field in line.split("|")]
        if len(fields) != len(header):
            raise ValueError(f"{table}: unexpected row {line!r}")
        rows.append({key: (None if value in ("null", "") else value) for key, value in zip(header, fields)})
    return rows


def vizier(source: str, columns: str) -> list[dict[str, str]]:
    query = f"/viz-bin/asu-tsv?-source={urllib.parse.quote(source, safe='/')}&-out.max=unlimited&-out={columns}"
    name = f"{CACHE}/vizier_{re.sub('[^A-Za-z0-9]', '_', source)}.tsv"
    text = cached_fetch([host + query for host in VIZIER_HOSTS], name).read_text(encoding="utf-8")
    rows: list[dict[str, str]] = []
    header: list[str] | None = None
    skip = 0
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            if header is not None and rows and not line.strip():
                break
            continue
        fields = [field.strip() for field in line.split("\t")]
        if header is None:
            header, skip = fields, 2
        elif skip:
            skip -= 1
        elif len(fields) == len(header):
            rows.append(dict(zip(header, fields)))
    if header is None:
        raise ValueError(f"VizieR answered no table for {source}")
    return rows


def arxiv_abstract(identifier: str) -> str:
    path = cached_fetch(f"https://export.arxiv.org/api/query?id_list={identifier}", f"{CACHE}/arxiv_{identifier}.xml")
    match = re.search(r"<summary>(.*?)</summary>", path.read_text(encoding="utf-8"), re.S)
    if not match:
        raise ValueError(f"arXiv:{identifier}: no abstract")
    return " ".join(html.unescape(match.group(1)).split())


# --------------------------------------------------------------------------- gamma-ray bursts

SWIFT_TABLE = (
    "https://swift.gsfc.nasa.gov/archive/grb_table/table.php?obs=Swift&year=All+Years&restrict=none"
    "&grb_time=1&bat_ra=1&bat_dec=1&bat_t90=1&bat_fluence=1&xrt_ra=1&xrt_dec=1&redshift=1"
)
#: The usual dividing line between the two families of bursts (Kouveliotou et al. 1993), seconds of T90.
SHORT_GRB_S = 2.0
GRB_LABELS_BY_FLUENCE = 10
GRB_LABELS_BY_REDSHIFT = 3


def first_number(text: str | None) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text or "")
    return float(match.group(0)) if match else None


def swift_bursts() -> list[dict]:
    """The Swift team's own table: name, trigger time, best position, T90, BAT fluence, redshift."""
    page = cached_fetch(SWIFT_TABLE, f"{CACHE}/swift_grb_table.html").read_text(encoding="latin-1")
    bursts = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [html.unescape(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) != 9:
            continue
        name = re.sub(r"<[^>]+>", "", cells[0]).strip()
        match = re.fullmatch(r"(\d\d)(\d\d)(\d\d)[A-Z]?", name)
        clock = re.fullmatch(r"(\d+):(\d+):(\d+(?:\.\d+)?)", cells[1].strip())
        if not match or not clock:
            continue
        year, month, day = (int(g) for g in match.groups())
        fraction = (int(clock.group(1)) + int(clock.group(2)) / 60 + float(clock.group(3)) / 3600) / 24
        mjd = mjd_of(2000 + year, month, day) + fraction
        try:
            # The X-ray telescope's position (arcseconds) where there is one, else the BAT's (arcminutes).
            ra, dec, precise = sexagesimal_ra(cells[6].strip()), sexagesimal_dec(cells[7].strip()), True
        except ValueError:
            bat_ra, bat_dec = first_number(cells[2].split("<br>")[0]), first_number(cells[3].split("<br>")[0])
            if bat_ra is None or bat_dec is None:
                continue
            ra, dec, precise = bat_ra, bat_dec, False
        fluence = first_number(cells[5])
        t90 = None if cells[4].strip().startswith((">", "<", "~")) else first_number(cells[4])
        redshift_text = re.sub(r"<[^>]+>", " ", cells[8]).strip()
        # A plain spectroscopic or photometric value; limits and ranges ("<3.5", "~8.1") are not a redshift to quote.
        redshift = first_number(redshift_text) if re.match(r"\d", redshift_text) else None
        bursts.append(
            {
                "name": name,
                "mjd": mjd,
                "ra": ra,
                "dec": dec,
                "precise": precise,
                "t90": t90,
                # Table unit is 1e-7 erg/cm² in 15-150 keV.
                "fluence": fluence * 1e-7 if fluence else None,
                "redshift": redshift,
            }
        )
    return bursts


def gbm_bursts() -> list[dict]:
    rows = heasarc("fermigbrst", ["name", "ra", "dec", "trigger_time", "t90", "fluence", "error_radius"])
    bursts = []
    for row in rows:
        if row["ra"] is None or row["dec"] is None or row["trigger_time"] is None:
            continue
        bursts.append(
            {
                "name": row["name"],
                "mjd": float(row["trigger_time"]),
                "ra": float(row["ra"]),
                "dec": float(row["dec"]),
                "t90": float(row["t90"]) if row["t90"] else None,
                # erg/cm², 10-1000 keV.
                "fluence": float(row["fluence"]) if row["fluence"] else None,
                "error": float(row["error_radius"]) if row["error_radius"] else None,
            }
        )
    return bursts


def match_swift(gbm: dict, swift: list[dict]) -> dict | None:
    """The Swift burst that is the same event: seen together, or the same day at the same place."""
    for other in swift:
        dt = abs(other["mjd"] - gbm["mjd"])
        if dt > 1.0:
            continue
        sep = separation_deg(gbm["ra"], gbm["dec"], other["ra"], other["dec"])
        if (dt < 150 / 86400 and sep < 25) or sep < 0.3:
            return other
    return None


def grb_value(fluence: float | None) -> int:
    """log10 of the fluence in erg/cm², ×100, offset so that 1e-9 is 0; −1 where none is given."""
    return -1 if not fluence or fluence <= 0 else max(0, round((math.log10(fluence) + 9) * 100))


def superscript_power(fluence: float) -> str:
    exponent = math.floor(math.log10(fluence))
    digits = str(abs(exponent)).translate(str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹"))
    return f"{fluence / 10**exponent:.1f}×10{'⁻' if exponent < 0 else ''}{digits} erg/cm²"


def build_grb() -> dict:
    swift = swift_bursts()
    gbm = gbm_bursts()
    by_day: dict[int, list[dict]] = {}
    for burst in swift:
        for day in (int(burst["mjd"]) - 1, int(burst["mjd"]), int(burst["mjd"]) + 1):
            by_day.setdefault(day, []).append(burst)
    events = Events(
        "Fermi GBM Burst Catalog (HEASARC fermigbrst; von Kienlin et al. 2020) and the Swift GRB table (NASA GSFC)",
        ["long", "short", "unknown"],
        "log10(fluence / 1e-9 erg cm^-2) x 100, -1 if none: Fermi GBM 10-1000 keV, or Swift BAT 15-150 keV for bursts Fermi did not record",
    )

    def family(t90: float | None) -> str:
        return "unknown" if t90 is None else "short" if t90 < SHORT_GRB_S else "long"

    matched: set[str] = set()
    rows = []
    for burst in gbm:
        other = match_swift(burst, by_day.get(int(burst["mjd"]), []))
        name = f"GRB {burst['name'][3:9]}"
        ra, dec = burst["ra"], burst["dec"]
        redshift = None
        if other:
            matched.add(other["name"])
            name = f"GRB {other['name']}"
            redshift = other["redshift"]
            if other["precise"]:
                ra, dec = other["ra"], other["dec"]
        row = events.add(burst["mjd"], ra, dec, family(burst["t90"]), grb_value(burst["fluence"]))
        row.update(name=name, fluence=burst["fluence"], gbm=burst["name"], redshift=redshift, swift=bool(other))
        rows.append(row)
    for burst in swift:
        if burst["name"] in matched:
            continue
        row = events.add(burst["mjd"], burst["ra"], burst["dec"], family(burst["t90"]), grb_value(burst["fluence"]))
        row.update(name=f"GRB {burst['name']}", bat_fluence=burst["fluence"], redshift=burst["redshift"], swift=True)
        rows.append(row)

    by_fluence = sorted((r for r in rows if r.get("fluence")), key=lambda r: -r["fluence"])
    for rank, row in enumerate(by_fluence[:GRB_LABELS_BY_FLUENCE]):
        note = " · brightest of the Fermi catalogue" if rank == 0 else ""
        row["label"] = f"{row['name']} · {date_text(row['mjd'])} · {superscript_power(row['fluence'])}{note}"
        row["priority"] = rank
    by_redshift = sorted((r for r in rows if r.get("redshift")), key=lambda r: -r["redshift"])
    for rank, row in enumerate(by_redshift[:GRB_LABELS_BY_REDSHIFT]):
        if "label" not in row:
            row["label"] = f"{row['name']} · redshift {row['redshift']:g}"
            row["priority"] = GRB_LABELS_BY_FLUENCE + rank
    # The brightest Swift saw before Fermi flew or without it.
    swift_only = sorted((r for r in rows if r.get("bat_fluence")), key=lambda r: -r["bat_fluence"])
    for rank, row in enumerate(swift_only[:3]):
        if "label" not in row:
            row["label"] = f"{row['name']} · {date_text(row['mjd'])} · {superscript_power(row['bat_fluence'])} (Swift)"
            row["priority"] = GRB_LABELS_BY_FLUENCE + 3 + rank
    # The burst that came with the neutron-star merger: found by its time, not by name.
    merger = gw_event_mjd("GW170817")
    for row in rows:
        if 0 <= row["mjd"] - merger < 5 / 86400:
            row["label"] = f"GRB 170817A · Fermi triggered {(row['mjd'] - merger) * 86400:.0f} s after GW170817"
            row["priority"] = 2.5
    return events.to_json(
        counts={"fermi": len(gbm), "swift": len(swift), "both": len(matched)},
        latest=date_text(max(r["mjd"] for r in rows)),
    )


# --------------------------------------------------------------------------- fast radio bursts

FRB_MAGNETAR_ARXIV = "2005.10324"
#: SIMBAD files the magnetar SGR 1935+2154 under its pulsar name.
FRB_MAGNETAR = "PSR J1935+2154"


def build_frb() -> dict:
    rows = vizier("J/ApJS/257/59/table2", "Name,RpName,RAJ2000,DEJ2000,DMfitb,MJD400,Fluence,Nsb")
    sources: dict[str, dict] = {}
    for row in rows:
        # Sub-bursts of one burst repeat its row.
        if row["Nsb"] not in ("0", ""):
            continue
        repeater = row["RpName"] if row["RpName"] and not row["RpName"].startswith("-9999") else None
        key = repeater or row["Name"]
        mjd = float(row["MJD400"])
        entry = sources.setdefault(
            key, {"mjd": mjd, "ra": float(row["RAJ2000"]), "dec": float(row["DEJ2000"]), "dm": float(row["DMfitb"]), "bursts": 0, "repeater": repeater is not None}
        )
        entry["bursts"] += 1
        entry["mjd"] = min(entry["mjd"], mjd)
    events = Events(
        "CHIME/FRB Collaboration (2021), The First CHIME/FRB Fast Radio Burst Catalog, ApJS 257, 59 (VizieR J/ApJS/257/59); "
        "FRB 20200428: CHIME/FRB Collaboration (2020), Nature 587, 54, at SIMBAD's position of SGR 1935+2154",
        ["one-off", "repeater", "galactic"],
        "dispersion measure, pc/cm3 (0: not in the catalogue)",
    )
    display = lambda name: f"FRB {name[3:]}"  # noqa: E731
    for name, entry in sources.items():
        row = events.add(entry["mjd"], entry["ra"], entry["dec"], "repeater" if entry["repeater"] else "one-off", round(entry["dm"]))
        row.update(name=name, bursts=entry["bursts"], dm=entry["dm"])
        if entry["repeater"]:
            row["label"] = f"{display(name)} · repeater · DM {entry['dm']:.0f}"
            row["priority"] = 1 - entry["bursts"] / 100
    one_offs = [r for r in events.rows if r["cls"] == 0]
    farthest = max(one_offs, key=lambda r: r["dm"])
    farthest["label"] = f"{display(farthest['name'])} · DM {farthest['dm']:.0f}, the catalogue's highest"
    farthest["priority"] = 1.5
    nearest = min(one_offs, key=lambda r: r["dm"])
    nearest["label"] = f"{display(nearest['name'])} · DM {nearest['dm']:.0f}, the catalogue's lowest"
    nearest["priority"] = 1.6

    abstract = arxiv_abstract(FRB_MAGNETAR_ARXIV)
    if "Galactic magnetar SGR 1935+2154" not in abstract or "CHIME" not in abstract:
        raise ValueError("arXiv:2005.10324 no longer reads as the detection of a burst from SGR 1935+2154")
    ra, dec = simbad_position(FRB_MAGNETAR)
    # The burst is named for its date, 28 April 2020 (UTC).
    row = events.add(mjd_of(2020, 4, 28), ra, dec, "galactic", 0)
    row.update(name="FRB20200428", label="FRB 20200428 · from the magnetar SGR 1935+2154, in our Galaxy", priority=0)
    return events.to_json(counts={"sources": len(sources), "repeaters": sum(1 for s in sources.values() if s["repeater"])})


# --------------------------------------------------------------------------- supernovae

SN_LIMIT_MAG = 14.0
SN_LABELS = 30
#: (VizieR table, name column, IAU name column, date column, peak magnitude columns, type column, host column)
ASASSN_TABLES = [
    ("J/MNRAS/471/4966/table1", "SNName", "IAUName", "DiscDate", ["PeakMag"], "Type", "HostName"),
    ("J/MNRAS/471/4966/table2", "SNName", "IAUName", "DiscDate", ["PeakMag"], "Type", "HostName"),
    ("J/MNRAS/484/1899/table1", "Name", "OName", "Date", ["Vpeakmag", "gpeakmag"], "Type", "Host"),
    ("J/MNRAS/484/1899/table2", "Name", "OName", "Date", ["mpeakmag", "Vpeakmag", "gpeakmag"], "Type", "Host"),
    ("J/MNRAS/520/4356/table1", "SNName", "IAUName", "DiscDate", ["PeakVmag", "Peakgmag"], "Type", "Galaxy"),
    ("J/MNRAS/520/4356/table2", "SNName", "IAUName", "DiscDate", ["Peakmag", "PeakVmag", "Peakgmag"], "Type", "Galaxy"),
]
#: Shown whatever the catalogues say of their brightness. The Asiago catalogue has SN 2011fe only at its discovery
#: magnitude; no keyless catalogue reaches SN 2023ixf, whose position is SIMBAD's.
SN_BY_NAME = ["SN 2011fe", "SN 2023ixf"]


def sn_class(sn_type: str | None) -> str:
    text = (sn_type or "").strip()
    if text.startswith("Ia"):
        return "Ia"
    if text.startswith("II"):
        return "II"
    if text.startswith(("Ib", "Ic")):
        return "Ib/c"
    return "other"


def host_name(text: str | None) -> str | None:
    """'NGC3034' -> 'NGC 3034'; anonymous hosts ('A113232+2741', 2MASX strings) are not names worth showing."""
    text = " ".join((text or "").split())
    match = re.fullmatch(r"(NGC|IC|UGC|M|ESO|MCG)\s*([-+\d].*)", text)
    if match:
        return f"{match.group(1)} {match.group(2)}"
    return text if text in ("LMC", "SMC") else None


def build_supernovae() -> dict:
    events = Events(
        "Asiago Supernova Catalogue (Barbon et al. 1999, as served by HEASARC, to 2015); ASAS-SN bright supernova "
        "catalogues for 2016, 2017 and 2018-2020 (Holoien et al. 2017, 2019; Neumann et al. 2023, via VizieR); SIMBAD",
        ["Ia", "II", "Ib/c", "other", "unmeasured"],
        "magnitude at maximum, or at discovery where a catalogue has only that, x 10; 999 where none is usable",
    )
    seen: set[str] = set()
    rows = heasarc(
        "asiagosn",
        ["name", "ra", "dec", "sn_type", "max_epoch", "max_mag", "max_mag_flag", "galaxy_name", "unconfirmed_flag"],
        f"max_mag <= {SN_LIMIT_MAG} or name in ({','.join(repr(n) for n in SN_BY_NAME)})",
    )
    for row in rows:
        name = row["name"]
        if name in IN_LANDMARKS or row["unconfirmed_flag"] or row["ra"] is None:
            continue
        year = int(re.match(r"SN (\d{4})", name).group(1))
        if row["max_epoch"]:
            # Some old ones are dated to the month or the year only.
            parts = [int(part) for part in row["max_epoch"].split("-")] + [1, 1]
            mjd = mjd_of(parts[0], max(parts[1], 1), max(parts[2], 1))
        else:
            mjd = mjd_of(year, 1, 1)
        host = host_name(row["galaxy_name"])
        if float(row["max_mag"]) > SN_LIMIT_MAG:
            # Here by name: the catalogue has only its faint magnitude at discovery, which is not how bright it became.
            entry = events.add(mjd, float(row["ra"]), float(row["dec"]), sn_class(row["sn_type"]), 999)
            entry.update(name=name, mag=None, host=host, label=f"{name}{f' · {host}' if host else ''} · {year}", priority=11.0)
        else:
            entry = events.add(mjd, float(row["ra"]), float(row["dec"]), sn_class(row["sn_type"]), round(float(row["max_mag"]) * 10))
            entry.update(name=name, mag=float(row["max_mag"]), host=host, type=row["sn_type"])
        seen.add(name.replace(" ", ""))
    for table, name_col, iau_col, date_col, mag_cols, type_col, host_col in ASASSN_TABLES:
        for row in vizier(table, ",".join([name_col, iau_col, date_col, "RAJ2000", "DEJ2000", *mag_cols, type_col, host_col])):
            mags = [float(row[c]) for c in mag_cols if re.fullmatch(r"\d+(\.\d+)?", row[c])]
            if not mags or min(mags) > SN_LIMIT_MAG:
                continue
            iau = " ".join(row[iau_col].split())
            if re.fullmatch(r"\d{4}[A-Za-z]+", iau):
                # The 2016 and 2017 tables give the designation bare.
                iau = f"SN {iau}"
            name = iau if iau.startswith(("SN", "AT")) else row[name_col]
            if name.replace(" ", "") in seen:
                continue
            seen.add(name.replace(" ", ""))
            date = re.match(r"(\d{4})-(\d\d)-(\d\d(?:\.\d+)?)", row[date_col])
            if not date:
                continue
            mjd = mjd_of(int(date.group(1)), int(date.group(2)), float(date.group(3)))
            ra, dec = sexagesimal_ra(row["RAJ2000"]), sexagesimal_dec(row["DEJ2000"])
            entry = events.add(mjd, ra, dec, sn_class(row[type_col]), round(min(mags) * 10))
            entry.update(name=name, mag=min(mags), host=host_name(row[host_col]), type=row[type_col])
    for name in SN_BY_NAME:
        if name.replace(" ", "") in seen:
            continue
        ra, dec = simbad_position(name)
        year = int(name.split()[1][:4])
        # Only the year is in the name: the marker appears with the year.
        entry = events.add(mjd_of(year, 1, 1), ra, dec, "unmeasured", 999)
        entry.update(name=name, mag=None, host=None, label=f"{name} · {year}", priority=11.0)

    measured = sorted((r for r in events.rows if r["mag"] is not None), key=lambda r: r["mag"])
    for row in measured[:SN_LABELS]:
        host = f" · {row['host']}" if row["host"] else ""
        row["label"] = f"{row['name']}{host} · mag {row['mag']:.1f}"
        row["priority"] = row["mag"]
    years = [int(date_text(r["mjd"]).split()[-1]) for r in events.rows if r["mag"] is not None]
    return events.to_json(span=[min(years), max(years)])


# --------------------------------------------------------------------------- neutrinos

ICECAT_TABLE = "https://dataverse.harvard.edu/api/access/datafile/7502710?format=original"
NEUTRINO_LABELS = 12


def build_neutrinos() -> dict:
    text = cached_fetch(ICECAT_TABLE, f"{CACHE}/icecat1.csv").read_text(encoding="utf-8")
    events = Events(
        "IceCube Collaboration (2023), IceCat-1: the IceCube Event Catalog of Alert Tracks, Harvard Dataverse, "
        "doi:10.7910/DVN/SCRUCD (Abbasi et al. 2023, ApJS 269, 25)",
        ["gold", "bronze"],
        "most probable neutrino energy, TeV",
    )
    vetoed = 0
    for row in csv.DictReader(io.StringIO(text)):
        if row["CR_VETO"].strip().upper() == "TRUE":
            # A cosmic-ray shower was seen at the surface at the same time: the catalogue flags these as likely background.
            vetoed += 1
            continue
        energy = float(row["ENERGY"])
        signalness = float(row["SIGNAL"])
        entry = events.add(
            float(row["EVENTMJD"]),
            float(row["RA"]),
            float(row["DEC"]),
            "gold" if row["I3TYPE"].endswith("gold") else "bronze",
            round(energy),
        )
        entry.update(
            name=row["NAME"],
            energy=energy,
            signalness=signalness,
            box=[float(row["RA_ERR_MINUS"]), float(row["RA_ERR_PLUS"]), float(row["DEC_ERR_MINUS"]), float(row["DEC_ERR_PLUS"])],
        )
    for rank, row in enumerate(sorted(events.rows, key=lambda r: -r["energy"])[:NEUTRINO_LABELS]):
        energy = f"{row['energy'] / 1000:.1f} PeV" if row["energy"] >= 1000 else f"{row['energy']:.0f} TeV"
        row["label"] = f"{row['name']} · {energy}"
        row["priority"] = rank
    return events.to_json(counts={"vetoed": vetoed}, latest=date_text(max(r["mjd"] for r in events.rows)))


# --------------------------------------------------------------------------- gravitational waves

GWOSC_ALL = "https://gwosc.org/eventapi/json/allevents/"
#: The catalogues of confident detections; an event is taken from its newest version among them.
GW_CATALOGUES = ("GWTC-1-confident", "GWTC-2.1-confident", "GWTC-3-confident", "GWTC-4.0", "GWTC-4.1", "GWTC-5.0")
GWTC1_SKYMAPS = "https://dcc.ligo.org/public/0157/P1800381/007/GWTC-1_skymaps.tar.gz"
GRACEDB = "https://gracedb.ligo.org/api/superevents/{id}/files/"
#: Sky maps in order of preference: the published parameter estimation first, the rapid localisation last.
SKYMAP_PREFERENCE = [
    r".*PublicationSamples\.multiorder\.fits$",
    r".*PublicationSamples.*\.fits(\.gz)?$",
    r"(?i)bilby.*\.multiorder\.fits$",
    r"(?i)bilby.*\.fits(\.gz)?$",
    r"(?i)lalinference.*\.multiorder\.fits$",
    r"(?i)lalinference.*\.fits(\.gz)?$",
    r"(?i)bayestar.*\.multiorder\.fits$",
    r"(?i)bayestar.*\.fits(\.gz)?$",
    r"(?i)cwb.*\.fits(\.gz)?$",
]
#: Events whose 90% region is at most this large are drawn; the rest would smear over a fifth of the sky or more.
GW_DRAWN_MAX_DEG2 = 150.0
GW_FINE_MAX_DEG2 = 30.0
NEUTRON_STAR_MAX_MSUN = 3.0


def gw_events() -> dict[str, dict]:
    data = json.loads(cached_fetch(GWOSC_ALL, f"{CACHE}/gwosc_allevents.json").read_text(encoding="utf-8"))["events"]
    best: dict[str, dict] = {}
    for event in data.values():
        if event["catalog.shortName"] not in GW_CATALOGUES:
            continue
        name = event["commonName"]
        if name not in best or event["version"] > best[name]["version"]:
            best[name] = event
    return best


def gw_event_mjd(name: str) -> float:
    return GPS_EPOCH_MJD + gps_to_utc_seconds(gw_events()[name]["GPS"]) / 86400


def gps_to_utc_seconds(gps: float) -> float:
    """GPS runs ahead of UTC by the leap seconds added since 1980: 17 through 2016, 18 since (none added to 2026)."""
    leap = 18 if gps >= 1167264017 else 17 if gps >= 1119744016 else 16
    return gps - leap


def gw_grace_id(name: str) -> str | None:
    path = cached_fetch(f"https://gwosc.org/api/v2/events/{name}", f"{CACHE}/gwosc_event_{name}.json")
    return json.loads(path.read_text(encoding="utf-8")).get("grace_id")


def gw_skymap_path(name: str, grace_id: str | None) -> Path | None:
    """The best public sky map of an event, downloaded; None if there is none."""
    if grace_id and grace_id.startswith("S"):
        try:
            listing_path = cached_fetch(GRACEDB.format(id=grace_id), f"{CACHE}/gracedb_{grace_id}_files.json")
        except OSError:
            return None
        listing = json.loads(listing_path.read_text(encoding="utf-8"))
        # "name,N" are older versions of "name".
        names = [n for n in listing if "," not in n]
        for pattern in SKYMAP_PREFERENCE:
            chosen = sorted(n for n in names if re.match(pattern, n))
            if chosen:
                suffix = ".multiorder.fits" if chosen[0].endswith(".multiorder.fits") else ".fits.gz" if chosen[0].endswith(".gz") else ".fits"
                time.sleep(0.2)
                return cached_fetch(listing[chosen[0]], f"{CACHE}/skymaps/{grace_id}__{chosen[0].split('.')[0]}{suffix}")
        return None
    tar_path = cached_fetch(GWTC1_SKYMAPS, f"{CACHE}/GWTC-1_skymaps.tar.gz")
    out = CACHE_DIR / CACHE / "skymaps" / f"{name}_gwtc1.fits.gz"
    if not out.exists():
        with tarfile.open(tar_path) as tar:
            member = next((m for m in tar.getmembers() if Path(m.name).name == f"{name}_skymap.fits.gz"), None)
            if member is None:
                return None
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(tar.extractfile(member).read())
    return out


def gw_localisation(path: Path) -> dict:
    """90% area, most probable direction, and (for a small region) its pixels' centres."""
    import numpy as np
    from astropy.io import fits
    from astropy_healpix import healpix_to_lonlat, lonlat_to_healpix
    from astropy import units as u

    with fits.open(path) as hdus:
        table = hdus[1]
        names = table.columns.names
        if "UNIQ" in names:
            uniq = np.asarray(table.data["UNIQ"], dtype=np.int64)
            level = (np.floor(np.log2(uniq / 4)) // 2).astype(np.int64)
            nside = 2**level
            ipix = uniq - 4 * nside * nside
            density = np.asarray(table.data["PROBDENSITY"], dtype=np.float64)
            prob = density * (4 * math.pi / (12 * nside.astype(np.float64) ** 2))
        else:
            prob = np.asarray(table.data[names[0]], dtype=np.float64).ravel()
            n = int(round(math.sqrt(prob.size / 12)))
            ipix = np.arange(prob.size, dtype=np.int64)
            if table.header.get("ORDERING", "RING").strip().upper() != "NESTED":
                lon, lat = healpix_to_lonlat(ipix, n, order="ring")
                nested = lonlat_to_healpix(lon, lat, n, order="nested")
                reordered = np.empty_like(prob)
                reordered[nested] = prob
                prob = reordered
            level = np.full(prob.size, int(round(math.log2(n))), dtype=np.int64)
            nside = 2**level
            density = prob
    prob = prob / prob.sum()
    pixel_deg2 = 41252.96125 / (12 * nside.astype(np.float64) ** 2)
    order = np.argsort(-(prob / pixel_deg2))
    cumulative = np.cumsum(prob[order])
    inside = order[: int(np.searchsorted(cumulative, 0.9)) + 1]
    area = float(pixel_deg2[inside].sum())
    peak = order[0]
    lon, lat = healpix_to_lonlat(ipix[peak], int(nside[peak]), order="nested")
    result = {"area": area, "ra": float(lon.to(u.deg).value), "dec": float(lat.to(u.deg).value)}
    if area <= GW_DRAWN_MAX_DEG2:
        target = 7 if area <= GW_FINE_MAX_DEG2 else 6
        cells: set[int] = set()
        for i in inside:
            shift = 2 * (target - int(level[i]))
            if shift <= 0:
                cells.add(int(ipix[i]) >> -shift)
            else:
                base = int(ipix[i]) << shift
                cells.update(range(base, base + (1 << shift)))
        cell_array = np.array(sorted(cells), dtype=np.int64)
        lon, lat = healpix_to_lonlat(cell_array, 2**target, order="nested")
        result["region"] = list(zip(lon.to(u.deg).value.tolist(), lat.to(u.deg).value.tolist()))
    return result


def gw_class(event: dict) -> str:
    m1, m2 = event.get("mass_1_source"), event.get("mass_2_source")
    if m1 is None or m2 is None:
        return "unclassified"
    if m1 < NEUTRON_STAR_MAX_MSUN:
        return "neutron stars"
    return "neutron star + black hole" if m2 < NEUTRON_STAR_MAX_MSUN else "black holes"


def build_gw() -> dict:
    catalogue = gw_events()
    events = Events(
        "LIGO Scientific, Virgo and KAGRA Collaborations: GWTC-1 to GWTC-5.0 event lists (GWOSC); sky maps from GraceDB "
        "public superevents and the GWTC-1 sky-map release (LIGO-P1800381)",
        ["black holes", "neutron star + black hole", "neutron stars", "unclassified"],
        "area of the 90% credible region, square degrees",
    )
    without_map = 0
    for name in sorted(catalogue):
        event = catalogue[name]
        path = gw_skymap_path(name, gw_grace_id(name))
        if path is None:
            without_map += 1
            continue
        try:
            where = gw_localisation(path)
        except Exception as error:  # noqa: BLE001 - one unreadable map must not stop the bake; it is counted
            print(f"{name}: {path.name}: {error}", file=sys.stderr)
            without_map += 1
            continue
        mjd = GPS_EPOCH_MJD + gps_to_utc_seconds(event["GPS"]) / 86400
        row = events.add(mjd, where["ra"], where["dec"], gw_class(event), round(where["area"]))
        row.update(name=name, area=where["area"], distance=event.get("luminosity_distance"), drawn="region" in where)
        if "region" in where:
            row["region"] = where["region"]
            short = name.split("_")[0] if sum(1 for other in catalogue if other.startswith(name.split("_")[0])) == 1 else name
            area = f"{where['area']:.0f}" if where["area"] >= 10 else f"{where['area']:.1f}"
            distance = f" · {event['luminosity_distance']:,.0f} Mpc" if event.get("luminosity_distance") else ""
            row["label"] = f"{short} · {area} deg²{distance}"
            row["priority"] = where["area"]
    drawn = [r for r in events.rows if r["drawn"]]
    return events.to_json(
        counts={"events": len(catalogue), "withMap": len(events.rows), "drawn": len(drawn), "withoutMap": without_map},
        drawnMaxDeg2=GW_DRAWN_MAX_DEG2,
        latest=date_text(max(r["mjd"] for r in events.rows)),
    )


# --------------------------------------------------------------------------- interstellar directions

SBDB = "https://ssd-api.jpl.nasa.gov/sbdb.api?sstr={id}&full-prec=true"
INTERSTELLAR_OBJECTS = ["1I", "2I", "3I"]
IBEX_ARXIV = "1510.04835"
OBLIQUITY_J2000_DEG = 23.439291111
#: sqrt(GM_sun / 1 au): the speed of a circular orbit at 1 au, km/s.
CIRCULAR_SPEED_1AU_KMS = 29.7847


def ecliptic_to_equatorial(v: tuple[float, float, float]) -> tuple[float, float, float]:
    e = math.radians(OBLIQUITY_J2000_DEG)
    return (v[0], v[1] * math.cos(e) - v[2] * math.sin(e), v[1] * math.sin(e) + v[2] * math.cos(e))


def ra_dec(v: tuple[float, float, float]) -> tuple[float, float]:
    length = math.sqrt(sum(c * c for c in v))
    return math.degrees(math.atan2(v[1], v[0])) % 360, math.degrees(math.asin(v[2] / length))


def hyperbola_asymptotes(e: float, i: float, node: float, peri: float) -> tuple[tuple[float, float], tuple[float, float]]:
    """(RA, Dec) of where a hyperbolic orbit comes from and where it goes, from elements on the J2000 ecliptic.

    Far from the Sun the body sits at true anomaly -/+ arccos(-1/e): the two
    directions of the asymptotes, as seen from the Sun.
    """
    limit = math.acos(-1 / e)
    i, node, peri = (math.radians(x) for x in (i, node, peri))

    def direction(true_anomaly: float) -> tuple[float, float]:
        u = peri + true_anomaly
        v = (
            math.cos(node) * math.cos(u) - math.sin(node) * math.sin(u) * math.cos(i),
            math.sin(node) * math.cos(u) + math.cos(node) * math.sin(u) * math.cos(i),
            math.sin(u) * math.sin(i),
        )
        return ra_dec(ecliptic_to_equatorial(v))

    return direction(-limit), direction(limit)


def sbdb_orbit(identifier: str) -> dict:
    data = json.loads(cached_fetch(SBDB.format(id=identifier), f"{CACHE}/sbdb_{identifier}.json").read_text(encoding="utf-8"))
    elements = {e["name"]: (float(e["value"]) if e["value"] is not None else None) for e in data["orbit"]["elements"]}
    if data["orbit"].get("equinox") != "J2000":
        raise ValueError(f"{identifier}: elements are not on the J2000 ecliptic")
    return {"fullname": " ".join(data["object"]["fullname"].split()), "elements": elements}


def interstellar_name(fullname: str) -> str:
    """'Oumuamua (A/2017 U1)' -> '1I/ʻOumuamua'; 'C/2019 Q4 (Borisov)' -> 'Borisov'."""
    match = re.search(r"\(([A-Za-z' ]+)\)\s*$", fullname)
    return match.group(1) if match else fullname.split("(")[0].strip()


def build_interstellar() -> dict:
    events = Events(
        "JPL Small-Body Database (orbits of 1I, 2I, 3I); Bzowski et al. (2015), ApJS 220, 28 (interstellar helium flow from IBEX)",
        ["arrival", "departure", "wind", "downwind"],
        "speed far from the Sun, km/s x 10",
    )
    objects = []
    for identifier in INTERSTELLAR_OBJECTS:
        orbit = sbdb_orbit(identifier)
        el = orbit["elements"]
        arrive, depart = hyperbola_asymptotes(el["e"], el["i"], el["om"], el["w"])
        speed = CIRCULAR_SPEED_1AU_KMS / math.sqrt(abs(el["a"]))
        perihelion_mjd = el["tp"] - 2400000.5
        name = f"{identifier}/{interstellar_name(orbit['fullname'])}"
        year = date_text(perihelion_mjd).split()[-1]
        row = events.add(perihelion_mjd, *arrive, "arrival", round(speed * 10))
        row.update(label=f"{name} came from here · {speed:.1f} km/s · perihelion {year}", priority=len(objects))
        row = events.add(perihelion_mjd, *depart, "departure", round(speed * 10))
        row.update(label=f"{name} is leaving this way", priority=5 + len(objects))
        objects.append({"id": identifier, "name": name, "arrival": arrive, "departure": depart, "speedKms": round(speed, 2)})

    abstract = arxiv_abstract(IBEX_ARXIV)
    numbers = {
        key: re.search(pattern, abstract)
        for key, pattern in {
            "lon": r"lambda_ISNHe = ([\d.]+)",
            "lat": r"beta_ISNHe = ([\d.]+)",
            "speed": r"v_ISNHe = ([\d.]+)",
            "temperature": r"T_ISNHe = ([\d.]+)",
        }.items()
    }
    if not all(numbers.values()):
        raise ValueError("arXiv:1510.04835: the abstract no longer gives the helium flow's direction")
    lon, lat, speed, temperature = (float(numbers[k].group(1)) for k in ("lon", "lat", "speed", "temperature"))
    upwind = ra_dec(ecliptic_to_equatorial((
        math.cos(math.radians(lat)) * math.cos(math.radians(lon)),
        math.cos(math.radians(lat)) * math.sin(math.radians(lon)),
        math.sin(math.radians(lat)),
    )))
    downwind = ((upwind[0] + 180) % 360, -upwind[1])
    # Dated at the paper's last measurement season, so they show at any clock the app is likely to be set to: 2009 on.
    measured = mjd_of(2009, 1, 1)
    row = events.add(measured, *upwind, "wind", round(speed * 10))
    row.update(label=f"Interstellar wind arrives from here · {speed:g} km/s, {temperature:,.0f} K · nose of the heliosphere", priority=-1)
    row = events.add(measured, *downwind, "downwind", round(speed * 10))
    row.update(label="Downwind · the heliosphere's tail", priority=9)
    return events.to_json(objects=objects, wind={"eclipticLon": lon, "eclipticLat": lat, "speedKms": speed, "temperatureK": temperature})


BUILDERS = {
    "grb": build_grb,
    "frb": build_frb,
    "supernovae": build_supernovae,
    "neutrinos": build_neutrinos,
    "gw": build_gw,
    "interstellar": build_interstellar,
}


def main() -> None:
    names = sys.argv[1:] or list(BUILDERS)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in names:
        data = BUILDERS[name]()
        data["generated"] = datetime.date.today().isoformat()
        path = OUTPUT_DIR / f"{name}.json"
        path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        print(f"{name}: {len(data['t'])} events, {len(data['labels'])} labels, {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
