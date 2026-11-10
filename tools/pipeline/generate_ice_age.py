#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: the Earth at the last glacial maximum.

Writes
    app/public/geo/ice-age-mask.png   4096x2048 equirectangular coverage mask (lon -180..180, north up):
                                      red   = Northern Hemisphere ice sheets at the Last Glacial Maximum
                                      green = sea floor that is shallower than SHORE_DEPTH_M today and
                                              not under that ice: land a sea that much lower uncovers
    app/public/geo/ice-age.json       areas of both, the depth used, and names with hand-placed positions

Sources
    Ice: Batchelor, C.L., Margold, M., Krapp, M., Murton, D.K., Dalton, A.S., Gibbard, P.L., Stokes, C.R.,
        Murton, J.B. & Manica, A. (2019), The configuration of Northern Hemisphere ice sheets through the
        Quaternary, Nature Communications 10, 3713, doi:10.1038/s41467-019-11601-2 (open access, CC BY 4.0).
        Its "LGM best estimate" shapefile from the paper's repository, https://osf.io/7jen3/ - which states
        no licence of its own. The authors derive the LGM outline mainly from Ehlers, Gibbard & Hughes (2011)
        and say the maps are for the general extent, not local-scale study.
    Depths: ETOPO1 1 arc-minute global relief model, ice surface (Amante & Eakins 2009, NOAA Technical
        Memorandum NESDIS NGDC-24), every STRIDE-th point, from NOAA CoastWatch ERDDAP:
        https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180 - "may be used and redistributed for free".

What is and is not claimed
    * The ice is the published reconstruction, rasterised. It covers ice sheets over 50,000 km2 in the
      Northern Hemisphere only: Antarctica's larger ice and the Patagonian ice sheet are NOT in it.
    * The green is today's sea floor between 0 and SHORE_DEPTH_M down and joined to the open ocean (so not
      the Caspian's, nor dry basins below sea level), nothing more. Global sea level at
      the glacial maximum stood about 120-135 m below today's (134 m: Lambeck et al. 2014, PNAS 111:15296),
      so this is roughly the land that emerged - but only roughly: near the ice the crust was pushed down
      and beyond it bulged up, and 20,000 years of sediment have since been laid on the shelves. The paper's
      own maps make the same simplification ("our maps ... show the sea level and topography of the
      present day").
    * NAMES are the usual names of the ice sheets and of the drowned lands; their label positions are
      placed by hand inside the mapped areas (test_ice_age.py checks they are inside). "Doggerland" is
      not among them: in this reconstruction the Dogger Bank is under the ice at the glacial maximum,
      and was dry land only later, as the ice withdrew and before the sea rose. The dry plain south of
      the ice is named plainly instead.

Usage (needs numpy, scipy, pillow: tools/pipeline/.cache/venv):
    python3 tools/pipeline/generate_ice_age.py

Raw downloads are cached in tools/pipeline/.cache/ice-age/.
"""

import json
import math
import struct
from pathlib import Path

import numpy as np
import scipy.io
import scipy.ndimage
from PIL import Image, ImageDraw

from fetch_cache import cached_fetch

LGM_SHP_URL = "https://osf.io/download/9yhdv/"
STRIDE = 4
ETOPO_URL = f"https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.mat?altitude%5B(-90):{STRIDE}:(90)%5D%5B(-180):{STRIDE}:(180)%5D"
SHORE_DEPTH_M = 125
WIDTH, HEIGHT = 4096, 2048
EARTH_RADIUS_KM = 6371.0

# The usual names; positions by hand, inside the area each names.
NAMES = [
    {"name": "Laurentide Ice Sheet", "kind": "ice", "lon": -85.0, "lat": 57.0},
    {"name": "Cordilleran Ice Sheet", "kind": "ice", "lon": -126.0, "lat": 56.0},
    {"name": "Innuitian Ice Sheet", "kind": "ice", "lon": -92.0, "lat": 78.5},
    {"name": "Greenland Ice Sheet", "kind": "ice", "lon": -41.0, "lat": 73.0},
    {"name": "Scandinavian Ice Sheet", "kind": "ice", "lon": 20.0, "lat": 64.0},
    {"name": "British-Irish Ice Sheet", "kind": "ice", "lon": -4.5, "lat": 55.5},
    {"name": "Barents-Kara Ice Sheet", "kind": "ice", "lon": 45.0, "lat": 76.0},
    {"name": "Beringia", "kind": "land", "lon": -170.0, "lat": 62.5},
    {"name": "Southern North Sea plain", "kind": "land", "lon": 3.0, "lat": 52.8},
    {"name": "Sunda Shelf (Sundaland)", "kind": "land", "lon": 107.5, "lat": 3.0},
    {"name": "Sahul Shelf", "kind": "land", "lon": 136.0, "lat": -10.0},
]

REPO_ROOT = Path(__file__).resolve().parents[2]
MASK = REPO_ROOT / "app" / "public" / "geo" / "ice-age-mask.png"
META = REPO_ROOT / "app" / "public" / "geo" / "ice-age.json"


def read_polygons(path: Path) -> list[list[list[tuple[float, float]]]]:
    """An ESRI shapefile's polygons: per record, its rings of (lon, lat). Outer rings run clockwise, holes the other way."""
    data = path.read_bytes()
    assert struct.unpack(">i", data[:4])[0] == 9994, "not a shapefile"
    assert struct.unpack("<i", data[32:36])[0] == 5, "not polygons"
    records = []
    position = 100
    while position < len(data):
        _, words = struct.unpack(">2i", data[position : position + 8])
        record = data[position + 8 : position + 8 + words * 2]
        position += 8 + words * 2
        if struct.unpack("<i", record[:4])[0] != 5:
            continue
        parts, points = struct.unpack("<2i", record[36:44])
        starts = list(struct.unpack(f"<{parts}i", record[44 : 44 + 4 * parts])) + [points]
        xy = np.frombuffer(record, dtype="<f8", count=points * 2, offset=44 + 4 * parts).reshape(points, 2)
        records.append([[(float(x), float(y)) for x, y in xy[starts[i] : starts[i + 1]]] for i in range(parts)])
    return records


def signed_area(ring: list[tuple[float, float]]) -> float:
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))


def rasterise(records: list[list[list[tuple[float, float]]]]) -> np.ndarray:
    """Coverage 0..255, drawn at twice the size and averaged down for a soft edge."""
    scale = 2
    image = Image.new("L", (WIDTH * scale, HEIGHT * scale), 0)
    draw = ImageDraw.Draw(image)

    def pixels(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
        return [((lon + 180) / 360 * WIDTH * scale, (90 - lat) / 180 * HEIGHT * scale) for lon, lat in ring]

    for rings in records:
        # Clockwise rings (negative area with y up) are ice, the others holes in it.
        for ring in rings:
            if signed_area(ring) < 0:
                draw.polygon(pixels(ring), fill=255)
        for ring in rings:
            if signed_area(ring) >= 0:
                draw.polygon(pixels(ring), fill=0)
    return np.asarray(image.resize((WIDTH, HEIGHT), Image.BOX))


def world_ocean(altitude: np.ndarray) -> np.ndarray:
    """
    Cells below sea level that are joined to the open ocean. Below sea level is not enough: the Caspian's
    floor, the Dead Sea's and Death Valley's are too, and no lowering of the ocean would drain or uncover
    them. The ocean is the largest joined-up body of such cells, the date line being no edge.
    """
    below = altitude < 0
    labels, _ = scipy.ndimage.label(below)
    # Join what the map's left and right edges cut in two.
    parent = {}

    def find(label: int) -> int:
        while parent.get(label, label) != label:
            label = parent[label]
        return label

    for left, right in zip(labels[:, 0], labels[:, -1]):
        if left and right and find(int(left)) != find(int(right)):
            parent[find(int(left))] = find(int(right))
    roots = np.array([find(label) for label in range(labels.max() + 1)])
    joined = roots[labels]
    sizes = np.bincount(joined[below])
    return joined == int(np.argmax(sizes))


def cell_areas_km2() -> np.ndarray:
    """Area of one mask pixel in each row."""
    edges = np.radians(90 - np.arange(HEIGHT + 1) * 180 / HEIGHT)
    return EARTH_RADIUS_KM**2 * (2 * math.pi / WIDTH) * (np.sin(edges[:-1]) - np.sin(edges[1:]))


def main() -> None:
    ice = rasterise(read_polygons(cached_fetch(LGM_SHP_URL, "ice-age/LGM_best_estimate.shp")))

    etopo = scipy.io.loadmat(cached_fetch(ETOPO_URL, f"ice-age/etopo1-stride{STRIDE}.mat", timeout=900))["etopo180"]
    altitude = etopo["altitude"][0, 0].astype(np.int16)
    latitude = etopo["latitude"][0, 0].ravel()
    longitude = etopo["longitude"][0, 0].ravel()
    assert latitude[0] == -90 and latitude[-1] == 90 and longitude[0] == -180 and longitude[-1] == 180, "unexpected ETOPO grid"
    # The grid point nearest each mask pixel's centre.
    rows = np.rint(((90 - (np.arange(HEIGHT) + 0.5) * 180 / HEIGHT) + 90) / 180 * (len(latitude) - 1)).astype(int)
    cols = np.rint(((np.arange(WIDTH) + 0.5) * 360 / WIDTH) / 360 * (len(longitude) - 1)).astype(int)
    depth = altitude[rows][:, cols]
    ocean = world_ocean(altitude)[rows][:, cols]
    emerged = (ocean & (depth >= -SHORE_DEPTH_M) & (ice < 128)).astype(np.uint8) * 255

    mask = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    mask[:, :, 0] = ice
    mask[:, :, 1] = emerged
    MASK.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(mask, "RGB").save(MASK, optimize=True)

    areas = cell_areas_km2()[:, None]
    meta = {
        "shoreDepthM": SHORE_DEPTH_M,
        "iceAreaKm2": round(float((ice / 255 * areas).sum()), -4),
        "emergedAreaKm2": round(float((emerged / 255 * areas).sum()), -4),
        "names": NAMES,
    }
    META.write_text(json.dumps(meta, indent=1) + "\n")
    print(
        f"wrote {MASK.relative_to(REPO_ROOT)} ({MASK.stat().st_size / 1024:.0f} KB): "
        f"ice {meta['iceAreaKm2'] / 1e6:.1f} million km2, emerged {meta['emergedAreaKm2'] / 1e6:.1f} million km2"
    )


if __name__ == "__main__":
    main()
