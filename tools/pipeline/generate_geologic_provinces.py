#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the world's geologic provinces and its Archean crust.

Writes
    app/public/geo/provinces.png   2048x1024 RGB (see province_raster.py): R the province class (1..11),
                                   G 0 (the app draws edges where the class changes), B coverage
    app/public/geo/provinces.json  the classes: name, the source's province types in each, count, share of the Earth
    app/public/geo/cratons.png     2048x1024 RGB: R 1 craton, 2 shield, 3 other province type, plus 3 where
                                   reworked after the Archean; G outlines, B coverage
    app/public/geo/cratons.json    the classes, and names for the craton groups with their centres and areas

Source
    Hasterok, D., Halpin, J.A., Collins, A.S., Hand, M., Kreemer, C., Gard, M.G. & Glorie, S. (2022),
    New maps of global geological provinces and tectonic plates, Earth-Science Reviews 231, 104069,
    doi:10.1016/j.earscirev.2022.104069. Data: "New maps of global geologic provinces and tectonic
    plates: global tectonics data and QGIS project file", Zenodo doi:10.5281/zenodo.6586972 (version 1,
    the latest), licence CC BY 4.0. The same files are on GitHub (dhasterok/global_tectonics) under
    GPL-3.0; the Zenodo copy is used for its plainer licence.

    The Zenodo record is one 1.17 GB zip. Only four of its members are needed (1.8 MB packed), so the
    zip's central directory is read with HTTP Range requests and just those members are fetched and
    inflated. Zenodo answers ranges with 206.

    global_gprv.shp: 921 provinces covering the whole Earth, each with a province type (15 types),
    crust type (continental, transitional, oceanic) and last orogeny.
    cratons.shp: the repository README: "regions with geochemical samples or that are known to have
    Archean (>2500 Ma) basement; the polygons have largely been extracted from global_gprv.shp aside
    from a few in the western US from Lund et al. (2015) ...; an additional column in the attribute
    table has been added to identify post-Archean reworking".

Classes
    The 15 province types are drawn in 11 colours: the two rift types together, the three kinds of
    basin on continental crust together, and oceanic back-arc basins with oceanic crust. Nothing else
    is merged or renamed.

Usage (needs numpy, scipy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_geologic_provinces.py

Raw downloads are cached in tools/pipeline/.cache/provinces/.
"""

import json
import struct
import urllib.request
import zlib
from collections import defaultdict

import numpy as np

from fetch_cache import CACHE_DIR, USER_AGENT
from generate_geo import OUTPUT_DIR
from province_raster import HEIGHT, WIDTH, area_centroid, bake, cell_areas, read_dbf, read_polygon_records, save_png

ZIP_URL = "https://zenodo.org/records/6586972/files/global_tectonics.zip?download=1"
ZIP_SIZE = 1_172_436_637
MEMBERS = ["global_gprv.shp", "global_gprv.dbf", "cratons.shp", "cratons.dbf"]
MEMBER_DIR = "plates&provinces/"

PROVINCE_CLASSES = [
    ("craton", ["craton"]),
    ("shield", ["shield"]),
    ("orogenic belt", ["orogenic belt"]),
    ("accretionary complex", ["accretionary complex"]),
    ("volcanic arc", ["volcanic arc"]),
    ("magmatic province", ["magmatic province"]),
    ("rift", ["wide rift", "narrow rift"]),
    ("basin", ["basin", "foredeep basin", "continental back-arc basin"]),
    ("passive margin", ["passive margin"]),
    ("ophiolite complex", ["ophiolite complex"]),
    ("oceanic crust", ["oceanic crust", "oceanic back-arc basin"]),
]
CRATON_CLASSES = ["craton", "shield", "other"]
REWORKED = len(CRATON_CLASSES)


def fetch_range(start: int, end: int) -> bytes:
    request = urllib.request.Request(ZIP_URL, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(request, timeout=300) as response:
        assert response.status == 206, f"range not honoured ({response.status})"
        data = response.read()
    assert len(data) == end - start + 1, "short range"
    return data


def zip_members(wanted: list[str]) -> dict[str, bytes]:
    """The named members of the remote zip, inflated, fetched by range and cached."""
    folder = CACHE_DIR / "provinces"
    if all((folder / name).exists() for name in wanted):
        return {name: (folder / name).read_bytes() for name in wanted}
    tail = fetch_range(ZIP_SIZE - 65536, ZIP_SIZE - 1)
    end = tail.rfind(b"PK\x05\x06")
    entries, size, offset = struct.unpack("<HII", tail[end + 10 : end + 20])
    assert offset != 0xFFFFFFFF, "zip64 directory not handled"
    directory = fetch_range(offset, offset + size - 1)
    found: dict[str, tuple[int, int, int, int]] = {}
    at = 0
    for _ in range(entries):
        fields = struct.unpack("<IHHHHHHIIIHHHHHII", directory[at : at + 46])
        method, crc, packed, unpacked = fields[4], fields[7], fields[8], fields[9]
        name_length, extra_length, comment_length, local = fields[10], fields[11], fields[12], fields[16]
        name = directory[at + 46 : at + 46 + name_length].decode("utf-8")
        if name.startswith(MEMBER_DIR) and name[len(MEMBER_DIR) :] in wanted:
            found[name[len(MEMBER_DIR) :]] = (method, packed, local, crc)
        at += 46 + name_length + extra_length + comment_length
    folder.mkdir(parents=True, exist_ok=True)
    out = {}
    for name in wanted:
        method, packed, local, crc = found[name]
        header = fetch_range(local, local + 29)
        name_length, extra_length = struct.unpack("<HH", header[26:30])
        start = local + 30 + name_length + extra_length
        raw = fetch_range(start, start + packed - 1)
        data = zlib.decompress(raw, -15) if method == 8 else raw
        assert zlib.crc32(data) == crc, f"{name}: CRC mismatch"
        (folder / name).write_bytes(data)
        out[name] = data
    return out


def records(stem: str) -> list[tuple[dict[str, str], list]]:
    zip_members(MEMBERS)
    folder = CACHE_DIR / "provinces"
    rows = read_dbf(folder / f"{stem}.dbf")
    shapes = read_polygon_records(folder / f"{stem}.shp")
    assert len(rows) == len(shapes), f"{stem}: {len(rows)} rows, {len(shapes)} shapes"
    return [(row, rings) for row, rings in zip(rows, shapes) if rings]


def share_by_class(picture: np.ndarray, count: int) -> list[float]:
    weights = cell_areas()
    inside = picture[..., 2] >= 128
    return [float(weights[inside & (picture[..., 0] == c)].sum()) for c in range(1, count + 1)]


def bake_provinces() -> None:
    type_class = {t: i + 1 for i, (_, types) in enumerate(PROVINCE_CLASSES) for t in types}
    rows = records("global_gprv")
    unknown = {row["prov_type"] for row, _ in rows} - set(type_class)
    assert not unknown, f"province types not classed: {unknown}"
    # Largest first, so a small province drawn inside a large one stays on top.
    rows.sort(key=lambda item: -float(item[0]["area"] or 0))
    picture = bake([(rings, type_class[row["prov_type"]]) for row, rings in rows], outlines=False)
    save_png(picture, OUTPUT_DIR / "provinces.png")
    counts: dict[int, int] = defaultdict(int)
    crust_km2: dict[str, float] = defaultdict(float)
    for row, _ in rows:
        counts[type_class[row["prov_type"]]] += 1
        crust_km2[row["crust_type"]] += float(row["area"])
    shares = share_by_class(picture, len(PROVINCE_CLASSES))
    data = {
        "source": "Hasterok et al. (2022), Earth-Sci. Rev. 231, 104069; data Zenodo doi:10.5281/zenodo.6586972 (CC BY 4.0)",
        "file": "geo/provinces.png",
        "width": WIDTH,
        "height": HEIGHT,
        "provinces": len(rows),
        "classes": [
            {"id": i + 1, "name": name, "types": types, "count": counts[i + 1], "share": round(shares[i], 4)}
            for i, (name, types) in enumerate(PROVINCE_CLASSES)
        ],
        "crustKm2": {k: round(v) for k, v in sorted(crust_km2.items())},
    }
    (OUTPUT_DIR / "provinces.json").write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"provinces: {len(rows)} polygons, {(OUTPUT_DIR / 'provinces.png').stat().st_size / 1024:.0f} KiB")


def craton_class(row: dict[str, str]) -> int:
    kind = row["prov_type"] if row["prov_type"] in ("craton", "shield") else "other"
    return CRATON_CLASSES.index(kind) + 1 + (REWORKED if row["reworked"] == "yes" else 0)


def bake_cratons() -> None:
    rows = records("cratons")
    assert {row["reworked"] for row, _ in rows} == {"yes", "no"}
    rows.sort(key=lambda item: -float(item[0]["area"] or 0))
    picture = bake([(rings, craton_class(row)) for row, rings in rows])
    save_png(picture, OUTPUT_DIR / "cratons.png")
    # Names: each group the source calls a craton or shield, with the provinces in it; else a craton
    # or shield of its own over 100,000 km2. Groups named otherwise ("Europe", "Ross Orogen") are not named.
    groups: dict[str, list] = defaultdict(list)
    for row, rings in rows:
        group = row["prov_group"]
        if group and any(word in group.lower() for word in ("craton", "shield")):
            groups[group].append((row["prov_name"], rings))
        elif not group and row["prov_type"] in ("craton", "shield") and float(row["area"]) > 100_000:
            groups[row["prov_name"]].append((row["prov_name"], rings))
    labels = []
    for name, members in groups.items():
        lon, lat, km2 = area_centroid([rings for _, rings in members])
        names = sorted({member for member, _ in members if member != name})
        labels.append({"name": name, "lon": round(lon, 2), "lat": round(lat, 2), "km2": round(km2, -3), "members": names})
    labels.sort(key=lambda label: -label["km2"])
    counts: dict[int, int] = defaultdict(int)
    for row, _ in rows:
        counts[craton_class(row)] += 1
    classes = [
        {"id": i + 1 + (REWORKED if reworked else 0), "name": name, "reworked": reworked}
        for reworked in (False, True)
        for i, name in enumerate(CRATON_CLASSES)
    ]
    for c in classes:
        c["count"] = counts[c["id"]]
    data = {
        "source": "Hasterok et al. (2022), Earth-Sci. Rev. 231, 104069; data Zenodo doi:10.5281/zenodo.6586972 (CC BY 4.0)",
        "file": "geo/cratons.png",
        "width": WIDTH,
        "height": HEIGHT,
        "polygons": len(rows),
        "share": round(float(cell_areas()[picture[..., 2] >= 128].sum()), 4),
        "classes": classes,
        "labels": labels,
    }
    (OUTPUT_DIR / "cratons.json").write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"cratons: {len(rows)} polygons, {len(labels)} names, {(OUTPUT_DIR / 'cratons.png').stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    bake_provinces()
    bake_cratons()
