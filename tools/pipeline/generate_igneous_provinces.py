#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: large igneous and other volcanic provinces.

Writes
    app/public/geo/igneous-provinces.png   2048x1024 RGB (see province_raster.py): R the age the source gives,
                                           1 + age / 300 Ma * 254, 255 for 300 Ma and older; G 0 (the app
                                           finds edges from R and B);
                                           B coverage. Younger provinces are drawn over older ones.
    app/public/geo/igneous-provinces.json  counts, the age scale, and names for the best-known provinces

Source
    Johansson, L., Zahirovic, S. & Müller, R.D. (2018), The interplay between the eruption and weathering
    of Large Igneous Provinces and the deep-time carbon cycle, Geophysical Research Letters 45,
    doi:10.1029/2017GL076691; volcanic provinces v2 as distributed with the GPlates 2.3 sample data by
    the EarthByte Group (IgneousProvinces.zip), licensed CC BY 3.0 ("Data by the EarthByte Group is
    licensed under a Creative Commons Attribution 3.0 Unported License").

Why this file and not the smaller one beside it
    The same zip holds Whittaker et al. (2015)'s 80 plume-related LIPs. They are the strict set, but
    they stop at 200 Ma (the Central Atlantic Magmatic Province) and are all from the plume and ridge
    study: no Siberian Traps, Emeishan or Wrangellia. Johansson's 2,526 polygons hold those, and the
    README says what else they hold: "a range of emplacement modes, essentially any significant
    magmatism that is distinct from typical seafloor spreading-related magmatism ... age-progressive
    and non age-progressive volcanics" - flood basalts, oceanic plateaus, dyke swarms, and seamount
    chains outlined along depth contours. The layer is named for that.

Ages
    FROMAGE, the age at which each polygon appears in the plate model, in Ma. For most it is the
    eruption age the authors compiled; for a seamount chain it varies along the chain. The few oldest
    (600 and 650 Ma) are given as they are in the file; they sit at the end of the scale, "300 Ma and older".

Usage (needs numpy, scipy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_igneous_provinces.py

Raw downloads are cached in tools/pipeline/.cache/igneous-provinces/.
"""

import json
import zipfile
from collections import defaultdict

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR
from province_raster import HEIGHT, WIDTH, area_centroid, bake, cell_areas, read_dbf, read_polygon_records, save_png

ZIP_URL = "https://www.earthbyte.org/webdav/ftp/earthbyte/GPlates/GPlates2.3_GeoData/Individual/IgneousProvinces.zip"
STEM = "IgneousProvinces/Johansson_2018/SHP/Johansson_etal_2018_VolcanicProvinces_v2"
OLDEST_MA = 300

# Names shown in the app, each for the polygons whose NAME in the file starts with one of these.
# Only provinces the file names; the display name tidies the file's capitals and notes.
NAMED = {
    "Siberian Traps": ["SIBERIAN TRAPS, EXTRUSIVE", "SIBERIAN TRAP, INTRUSIVE"],
    "Emeishan": ["EMEISHAN VOLCANICS", "EMEISHAN DYKES"],
    "Central Atlantic Magmatic Province": ["Central Atlantic Magmatic Province"],
    "Deccan Traps": ["DECCAN TRAPS"],
    "Karoo": ["KAROO BASALTS"],
    "Paraná": ["PARANA FLOOD BASALTS"],
    "Etendeka": ["ETENDEKA BASALTS"],
    "Ontong Java Plateau": ["ONTONG PLATEAU"],
    "Manihiki Plateau": ["MANIHIKI"],
    "Hikurangi Plateau": ["HIKURANGI PLATEAU"],
    "Kerguelen Plateau": ["CENTRAL KERGUELEN", "SOUTHERN KERGUELEN", "NORTHERN KERGUELEN", "ELAN BANK, KERGUELEN"],
    "Shatsky Rise": ["5000 METERS SHATSKY RISE"],
    "Columbia River Basalts": ["COLUMBIA RIVER BASALTS"],
    "Ethiopian Traps": ["ETHIOPIAN FLOOD BASALTS"],
    "Wrangellia": ["WRANGELLIA"],
    "Chon Aike": ["Chon Aike"],
    "Kalkarindji": ["Kalkarindji"],
    "Midcontinent Rift": ["MIDCONTINENT RIFT", "DULUTH GABBRO"],
    "Rajmahal Traps": ["RAJMAHAL TRAPS"],
    "Ninetyeast Ridge": ["90 Ridge", "3000 METERS NINETYEAST RIDGE"],
    "Hawaiian–Emperor chain": ["Hawaii PACIFIC", "4000 METERS HAWAIIAN EMPEROR", "HAWAIIAN EMPEROR"],
}


def age_value(age_ma: float) -> int:
    return 255 if age_ma >= OLDEST_MA else 1 + round(age_ma / OLDEST_MA * 254)


def main() -> None:
    archive = cached_fetch(ZIP_URL, "igneous-provinces/IgneousProvinces.zip")
    folder = CACHE_DIR / "igneous-provinces"
    with zipfile.ZipFile(archive) as z:
        for suffix in (".shp", ".dbf"):
            (folder / f"provinces{suffix}").write_bytes(z.read(STEM + suffix))
    rows = read_dbf(folder / "provinces.dbf")
    shapes = read_polygon_records(folder / "provinces.shp")
    assert len(rows) == len(shapes), f"{len(rows)} rows, {len(shapes)} shapes"
    items = [(row, rings, float(row["FROMAGE"])) for row, rings in zip(rows, shapes) if rings]
    # Oldest first, so the younger lie on top, as they do in the rock.
    items.sort(key=lambda item: -item[2])
    picture = bake([(rings, age_value(age)) for _, rings, age in items], outlines=False)
    save_png(picture, OUTPUT_DIR / "igneous-provinces.png")

    groups: dict[str, list] = defaultdict(list)
    for row, rings, age in items:
        for display, prefixes in NAMED.items():
            if any(row["NAME"].startswith(prefix) for prefix in prefixes):
                groups[display].append((rings, age))
    missing = set(NAMED) - set(groups)
    assert not missing, f"named provinces not in the file: {missing}"
    labels = []
    for display, members in groups.items():
        _, _, km2 = area_centroid([rings for rings, _ in members])
        # The name goes on the largest piece: the middle of a scattered province (CAMP spans four
        # continents) can be open ocean.
        lon, lat, _ = max((area_centroid([rings]) for rings, _ in members), key=lambda c: c[2])
        ages = sorted({age for _, age in members})
        labels.append({"name": display, "lon": round(lon, 2), "lat": round(lat, 2), "km2": round(km2, -3), "ageMa": [ages[0], ages[-1]], "polygons": len(members)})
    labels.sort(key=lambda label: -label["km2"])

    ages = [age for _, _, age in items]
    data = {
        "source": "Johansson, Zahirovic & Müller (2018), GRL, doi:10.1029/2017GL076691; volcanic provinces v2, EarthByte GPlates 2.3 data (CC BY 3.0)",
        "file": "geo/igneous-provinces.png",
        "width": WIDTH,
        "height": HEIGHT,
        "polygons": len(items),
        "oldestMa": OLDEST_MA,
        "ageRangeMa": [min(ages), max(ages)],
        "share": round(float(cell_areas()[picture[..., 2] >= 128].sum()), 4),
        "labels": labels,
    }
    (OUTPUT_DIR / "igneous-provinces.json").write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"igneous provinces: {len(items)} polygons, {len(labels)} names, {(OUTPUT_DIR / 'igneous-provinces.png').stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
