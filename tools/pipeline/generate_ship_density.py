#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: where the world's ships go.

Writes app/public/geo/ship-density.jpg (2048x1024, 8-bit grey,
equirectangular, longitude -180..180 left to right, north up) from

    Cerdeiro, Komaromi, Liu and Saeed (2020), World Seaborne Trade in Real
    Time: A Proof of Concept for Building AIS-based Nowcasts from Scratch,
    IMF Working Paper 20/57 - the "Global Shipping Traffic Density" raster
    published in the World Bank Data Catalog (dataset 0037580), CC BY 4.0:
    https://datacatalog.worldbank.org/search/dataset/0037580

The catalogue describes the values as "the total number of AIS positions
that have been reported by ships in each grid cell" of 0.005° (about
500 m), from "hourly AIS positions received between Jan-2015 and
Feb-2021", between 85°N and 85°S. It is one 9.8 GB uncompressed GeoTIFF
inside a 535 MB zip. Its own overviews are nearest-neighbour samples,
which lose a lane one cell wide, so this reads the full grid and SUMS it
into the output's 0.176° cells, then divides by each cell's area: the
value is the source's count per square kilometre over the whole period.

The counts are large - 6.6e14 in all, up to 65 million in one cell - more
than hourly reports of the world's fleet would add up to, so the source's
"positions" are evidently weighted or interpolated in a way its summary
does not spell out. The app therefore shows the scale as relative
(each step of the legend a factor of ten), not as a number of ships.

Code, 0..255:  0 where the density is below DENSITY_FLOOR,
               else 1 + 254 * log10(density / DENSITY_FLOOR) / DECADES, clamped.

The app reads the same two constants (app/src/layers/human-world/styles.ts)
and test_ship_density.py holds them together.

Needs tifffile, to read the TIFF's tile table:
    python3 -m venv tools/pipeline/.cache/venv
    tools/pipeline/.cache/venv/bin/pip install numpy pillow tifffile

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_ship_density.py
"""

import sys
import zipfile

import numpy as np
from PIL import Image

from fetch_cache import CACHE_DIR, cached_fetch
from generate_geo import OUTPUT_DIR, REPO_ROOT

SOURCE_URL = "https://datacatalogfiles.worldbank.org/ddh-published/0037580/DR0045406/shipdensity_global.zip"
TIFF_NAME = "shipdensity_global.tif"
WIDTH, HEIGHT = 2048, 1024
# The source's count per km² over the 74 months. Half the sea's cells lie above 1e5 and the busiest straits near 3e8:
# the floor leaves out the faintest quarter, where single tracks would otherwise speckle the empty ocean.
DENSITY_FLOOR = 3000.0
DECADES = 5.0
# A lossless PNG of this is 730 kB; at this quality the codes move by a few of 255 - a twentieth of a decade.
JPEG_QUALITY = 82
EARTH_RADIUS_KM = 6371.0
OUTPUT = OUTPUT_DIR / "ship-density.jpg"


def source_tiff():
    """Path of the extracted GeoTIFF, downloading and unzipping on first use."""
    path = CACHE_DIR / "human" / TIFF_NAME
    if not path.exists():
        archive = cached_fetch(SOURCE_URL, "human/shipdensity_global.zip", timeout=3600)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extract(TIFF_NAME, path.parent)
    return path


def sum_to_grid(path) -> np.ndarray:
    """AIS positions summed into the output grid, float64 (HEIGHT, WIDTH)."""
    import tifffile

    with tifffile.TiffFile(path) as tiff:
        page = tiff.pages[0]
        assert page.compression == 1 and page.is_tiled and page.dtype == np.int32, "expected uncompressed int32 tiles"
        tile_w, tile_h = page.tilewidth, page.tilelength
        cols, rows = page.imagewidth, page.imagelength
        offsets = page.dataoffsets
        scale = page.tags["ModelPixelScaleTag"].value
        tie = page.tags["ModelTiepointTag"].value
        nodata = int(page.tags["GDAL_NODATA"].value)
    # The tie point is the outer corner of the first cell.
    west, north, step = tie[3], tie[4], scale[0]
    tiles_across = -(-cols // tile_w)
    tiles_down = -(-rows // tile_h)
    lon = west + (np.arange(tiles_across * tile_w) + 0.5) * step
    column_bin = np.floor(((lon + 180.0) % 360.0) / 360.0 * WIDTH).astype(np.int64)
    column_valid = np.arange(tiles_across * tile_w) < cols
    lat = north - (np.arange(tiles_down * tile_h) + 0.5) * step
    row_bin = np.clip(np.floor((90.0 - lat) / 180.0 * HEIGHT).astype(np.int64), 0, HEIGHT - 1)

    data = np.memmap(path, dtype=np.uint8, mode="r")
    grid = np.zeros((HEIGHT, WIDTH), dtype=np.float64)
    strip = np.empty((tile_h, tiles_across * tile_w), dtype=np.float64)
    for tile_row in range(tiles_down):
        for tile_col in range(tiles_across):
            offset = offsets[tile_row * tiles_across + tile_col]
            tile = np.frombuffer(data, dtype="<i4", count=tile_w * tile_h, offset=offset).reshape(tile_h, tile_w)
            strip[:, tile_col * tile_w:(tile_col + 1) * tile_w] = tile
        strip[(strip == nodata) | (strip < 0)] = 0
        strip[:, ~column_valid] = 0
        first = tile_row * tile_h
        for local in range(min(tile_h, rows - first)):
            grid[row_bin[first + local]] += np.bincount(column_bin, weights=strip[local], minlength=WIDTH)
        if tile_row % 40 == 0:
            print(f"  row {first} of {rows}", file=sys.stderr)
    return grid


def density_per_km2(counts: np.ndarray) -> np.ndarray:
    lat_edges = np.radians(90.0 - np.arange(HEIGHT + 1) * 180.0 / HEIGHT)
    cell_km2 = EARTH_RADIUS_KM**2 * (2 * np.pi / WIDTH) * (np.sin(lat_edges[:-1]) - np.sin(lat_edges[1:]))
    return counts / cell_km2[:, None]


def encode(density: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore"):
        code = 1 + 254 * np.log10(density / DENSITY_FLOOR) / DECADES
    return np.where(density < DENSITY_FLOOR, 0, np.clip(np.round(code), 1, 255)).astype(np.uint8)


def decode(code: np.ndarray) -> np.ndarray:
    """Density at a code's centre; 0 for code 0."""
    return np.where(code == 0, 0.0, DENSITY_FLOOR * 10 ** ((code.astype(np.float64) - 1) / 254 * DECADES))


def main() -> None:
    counts_cache = CACHE_DIR / "human" / f"ship-counts-{WIDTH}x{HEIGHT}.npy"
    if counts_cache.exists():
        counts = np.load(counts_cache)
    else:
        counts = sum_to_grid(source_tiff())
        np.save(counts_cache, counts)
    density = density_per_km2(counts)
    seen = density[density > 0]
    print(
        f"{counts.sum():.4g} counted; cells with any: {seen.size / density.size:.1%}; "
        f"density percentiles of those 50/90/99/99.9/max: "
        + ", ".join(f"{np.percentile(seen, q):.3g}" for q in (50, 90, 99, 99.9, 100)),
        file=sys.stderr,
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(encode(density), mode="L").save(OUTPUT, quality=JPEG_QUALITY)
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
