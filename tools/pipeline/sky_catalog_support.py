"""Shared helpers for the deep-sky catalogue bakes (generate_deepsky.py).

Three keyless services carry almost everything:

- HEASARC's TAP service (NASA Goddard): one ADQL query per table, answered
  as pipe-separated text. HEASARC serves every table with J2000 positions,
  including the catalogues published in B1950 (4U, Abell); test_deepsky.py
  checks those against independent positions rather than trusting them.
- VizieR's ASU interface on the CfA mirror (the Strasbourg hosts time out
  from some networks), answered as tab-separated text.
- SIMBAD's TAP service on the CfA mirror, for the position of one named
  object.

Standard library only.
"""

import math
import urllib.parse

from fetch_cache import cached_fetch

HEASARC_TAP = "https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync"
VIZIER_HOSTS = ["https://vizier.cfa.harvard.edu", "https://vizier.cds.unistra.fr"]
SIMBAD_HOSTS = ["https://simbad.cfa.harvard.edu", "https://simbad.cds.unistra.fr"]

QUANTUM_PER_DEGREE = 1000


def heasarc_rows(table: str, columns: list[str], where: str | None = None) -> list[dict[str, str | None]]:
    """Rows of a HEASARC table as dicts of strings; SQL null becomes None."""
    query = f"select {','.join(columns)} from {table}" + (f" where {where}" if where else "")
    url = HEASARC_TAP + "?" + urllib.parse.urlencode(
        {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "text", "MAXREC": "1000000", "QUERY": query}
    )
    text = cached_fetch(url, f"deepsky/heasarc_{table}.txt").read_text(encoding="utf-8")
    lines = text.splitlines()
    if "OVERFLOW" in text[-200:]:
        raise ValueError(f"HEASARC cut the answer for {table} short (row limit): narrow the query")
    if not lines or "|" not in lines[0]:
        raise ValueError(f"HEASARC answered no table for {table}: {text[:200]!r}")
    header = [name.strip() for name in lines[0].split("|")]
    rows = []
    for line in lines[1:]:
        if not line.strip() or line.startswith("Number of"):
            continue
        fields = [field.strip() for field in line.split("|")]
        if len(fields) != len(header):
            raise ValueError(f"{table}: unexpected row {line!r}")
        rows.append({key: (None if value == "null" or value == "" else value) for key, value in zip(header, fields)})
    return rows


def vizier_rows(source: str, cache_name: str, extra: str = "-out.all") -> list[dict[str, str]]:
    """Rows of a VizieR table (ASU TSV): skips comments, the units line and the dashes line."""
    query = f"/viz-bin/asu-tsv?-source={urllib.parse.quote(source, safe='/')}&-out.max=unlimited&{extra}"
    text = cached_fetch([host + query for host in VIZIER_HOSTS], f"deepsky/{cache_name}").read_text(encoding="utf-8")
    rows: list[dict[str, str]] = []
    header: list[str] | None = None
    skip = 0
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            # A blank line ends a table; only the first table is read.
            if header is not None and rows and not line.strip():
                break
            continue
        fields = [field.strip() for field in line.split("\t")]
        if header is None:
            header = fields
            skip = 2
            continue
        if skip:
            skip -= 1
            continue
        if len(fields) == len(header):
            rows.append(dict(zip(header, fields)))
    if header is None:
        raise ValueError(f"VizieR answered no table for {source}")
    return rows


def simbad_position(identifier: str) -> tuple[float, float]:
    """ICRS (ra, dec) in degrees of one SIMBAD identifier."""
    query = f"select ra,dec from basic join ident on oidref=oid where id='{identifier}'"
    path = "/simbad/sim-tap/sync?" + urllib.parse.urlencode(
        {"request": "doQuery", "lang": "adql", "format": "tsv", "query": query}
    )
    safe = "".join(c if c.isalnum() else "_" for c in identifier)
    text = cached_fetch([host + path for host in SIMBAD_HOSTS], f"deepsky/simbad_{safe}.tsv").read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        raise ValueError(f"SIMBAD does not know {identifier!r}")
    ra, dec = lines[1].split("\t")[:2]
    return float(ra), float(dec)


def sexagesimal_ra(text: str) -> float:
    """'00 42 44.3' or '00:42:44.3' -> degrees."""
    h, m, s = (float(part) for part in text.replace(":", " ").split())
    return (h + m / 60 + s / 3600) * 15


def sexagesimal_dec(text: str) -> float:
    parts = text.replace(":", " ").split()
    sign = -1 if parts[0].startswith("-") else 1
    d, m = abs(float(parts[0])), float(parts[1])
    s = float(parts[2]) if len(parts) > 2 else 0.0
    return sign * (d + m / 60 + s / 3600)


def separation_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    h = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((a2 - a1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h))))


# ICRS -> galactic rotation (Hipparcos vol. 1, eq. 1.5.11): the same matrix as packages/core/src/astro.
ICRS_TO_GALACTIC = (
    (-0.0548755604162154, -0.8734370902348850, -0.4838350155487132),
    (0.4941094278755837, -0.4448296299600112, 0.7469822444972189),
    (-0.8676661490190047, -0.1980763734312015, 0.4559837761750669),
)


def unit(lon_deg: float, lat_deg: float) -> tuple[float, float, float]:
    lon, lat = math.radians(lon_deg), math.radians(lat_deg)
    return (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))


def lon_lat(v: tuple[float, float, float]) -> tuple[float, float]:
    return math.degrees(math.atan2(v[1], v[0])) % 360.0, math.degrees(math.asin(max(-1.0, min(1.0, v[2]))))


def icrs_to_galactic(ra: float, dec: float) -> tuple[float, float]:
    v = unit(ra, dec)
    return lon_lat(tuple(sum(row[k] * v[k] for k in range(3)) for row in ICRS_TO_GALACTIC))


def galactic_to_icrs(lon: float, lat: float) -> tuple[float, float]:
    v = unit(lon, lat)
    return lon_lat(tuple(sum(ICRS_TO_GALACTIC[k][i] * v[k] for k in range(3)) for i in range(3)))


def b1950_to_j2000(ra: float, dec: float) -> tuple[float, float]:
    """FK4 B1950 -> FK5 J2000 for an object without proper motion in an inertial frame.

    Removes the E-terms of aberration, then applies the Standish (1982) /
    Aoki et al. (1983) matrix with the fictitious proper motion taken at
    epoch B1950 (Explanatory Supplement, 1992, sect. 3.59). Good to a few
    hundredths of an arcsecond for extragalactic objects - far inside what
    a catalogue of X-ray error boxes or cluster centres needs.
    """
    r = unit(ra, dec)
    a = (-1.62557e-6, -0.31919e-6, -0.13843e-6)
    dot = sum(r[k] * a[k] for k in range(3))
    r1 = tuple(r[k] - a[k] + dot * r[k] for k in range(3))
    m = (
        (0.9999256794956877, -0.0111814832204662, -0.0048590038153592),
        (0.0111814832391717, 0.9999374848933135, -0.0000271625947142),
        (0.0048590037723143, -0.0000271702937440, 0.9999881946023742),
    )
    return lon_lat(tuple(sum(m[i][k] * r1[k] for k in range(3)) for i in range(3)))


def number(text: str | None) -> float | None:
    if text is None:
        return None
    text = text.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


class Catalogue:
    """Accumulates one baked catalogue: points in columns, plus labels and outlines by point index."""

    def __init__(self, source: str, classes: list[str], value: str):
        self.source = source
        self.classes = classes
        self.value = value
        self.ra: list[int] = []
        self.dec: list[int] = []
        self.cls: list[int] = []
        self.val: list[int | float] = []
        self.labels: list[list] = []
        self.ellipses: list[list] = []

    def add(self, ra: float, dec: float, cls: str, val: int | float) -> int:
        self.ra.append(round(ra * QUANTUM_PER_DEGREE) % (360 * QUANTUM_PER_DEGREE))
        self.dec.append(round(dec * QUANTUM_PER_DEGREE))
        self.cls.append(self.classes.index(cls))
        self.val.append(val)
        return len(self.ra) - 1

    def label(self, index: int, text: str, priority: float) -> None:
        self.labels.append([index, text, round(priority, 2)])

    def ellipse(self, index: int, major_arcmin: float, minor_arcmin: float, position_angle: float | None) -> None:
        """True outline: axes in arcminutes, position angle of the major axis east of north (-1: not known)."""
        self.ellipses.append(
            [index, round(major_arcmin, 1), round(minor_arcmin, 1), -1 if position_angle is None else round(position_angle)]
        )

    def to_json(self) -> dict:
        self.labels.sort(key=lambda entry: entry[2])
        data = {
            "source": self.source,
            "frame": "ICRS",
            "quantumPerDegree": QUANTUM_PER_DEGREE,
            "classes": self.classes,
            "value": self.value,
            "ra": self.ra,
            "dec": self.dec,
            "cls": self.cls,
            "val": self.val,
            "labels": self.labels,
        }
        if self.ellipses:
            data["ellipses"] = self.ellipses
        return data
