#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: where Webb and Euclid have looked.

Writes app/public/sky/closeups.json: the patches of sky covered by ESA's
picture surveys (HiPS) of JWST NIRCam images and of Euclid's deep fields,
as HEALPix cells at one order. The app uses them twice: to mark on the sky
where there is a close-up to zoom into, and to ask the tile server only
for tiles that touch one - between them they cover under 0.5% of the
41,253 square degrees there are, and every other tile is a wasted request.

Source: each survey's own coverage map (its Multi-Order Coverage map,
Moc.fits, IVOA MOC 1.1: a FITS binary table of NUNIQ cells), from the
ESASky HiPS node at ESAC. The cells are coarsened here: a cell at the
output order is kept when any finer cell inside it is covered, so the
output covers a little more sky than the surveys do, never less.

  Webb: JWST NIRCam imaging since the Early Release Observations,
    European JWST Archive (eJWST) at ESA/ESAC -
    https://skies.esac.esa.int/JWST/NIRCam_Imaging/
  Euclid: colour (VIS + NISP) mosaics of the three Quick Release 1 deep
    fields (South, Fornax, North; March 2025) and the 2026 outreach field
    on the Galactic bulge, ESA Euclid Science Archive at ESAC -
    https://cdn.skies.esac.esa.int/Q1-EDFS-R4-PNG-RGB_HIPS/ and siblings,
    https://esdchips.esac.esa.int/EuclidOutreach/Q2-EGBS-PNG-RGB_HIPS/

ESA's Hubble ACS survey is left out: its tiles are negatives (white sky)
crossed by satellite trails and chip gaps, which drawn as added light
would wash the sky out.

Usage:
    python3 tools/pipeline/generate_closeup_coverage.py

Raw downloads are cached in tools/pipeline/.cache/. Needs numpy (the venv).
"""

import json
import math
from datetime import date
from pathlib import Path

import numpy as np

from fetch_cache import cached_fetch

SURVEYS = {
    "jwst": "https://skies.esac.esa.int/JWST/NIRCam_Imaging",
    "euclid-edfs": "https://cdn.skies.esac.esa.int/Q1-EDFS-R4-PNG-RGB_HIPS",
    "euclid-edff": "https://cdn.skies.esac.esa.int/Q1-EDFF-R4-PNG-RGB_HIPS",
    "euclid-edfn": "https://cdn.skies.esac.esa.int/Q1-EDFN-R4-PNG-RGB_HIPS",
    "euclid-egbs": "https://esdchips.esac.esa.int/EuclidOutreach/Q2-EGBS-PNG-RGB_HIPS",
}
# Order 8 cells are 13.7' across: fine enough that a tile request outside every
# patch can be skipped, coarse enough that the file stays small.
ORDER = 8

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "app" / "public" / "sky" / "closeups.json"

FITS_BLOCK = 2880


def read_header(data: bytes, start: int) -> tuple[dict[str, str], int]:
    """One FITS header from `start`: its keywords, and where the data after it begins."""
    cards: dict[str, str] = {}
    position = start
    while True:
        block = data[position : position + FITS_BLOCK]
        assert len(block) == FITS_BLOCK, "FITS file ends inside a header"
        position += FITS_BLOCK
        for i in range(0, FITS_BLOCK, 80):
            card = block[i : i + 80].decode("ascii")
            keyword = card[:8].strip()
            if keyword == "END":
                return cards, position
            if card[8:10] == "= ":
                cards[keyword] = card[10:].split("/")[0].strip().strip("'").strip()


def read_moc(data: bytes) -> tuple[np.ndarray, np.ndarray, dict[str, str]]:
    """The cells of a MOC FITS file as (order, nested pixel) arrays, and its table header."""
    primary, position = read_header(data, 0)
    assert primary.get("SIMPLE") == "T", "not a FITS file"
    table, position = read_header(data, position)
    assert table.get("XTENSION") == "BINTABLE", table.get("XTENSION")
    assert table.get("ORDERING") == "NUNIQ", table.get("ORDERING")
    assert table.get("COORDSYS", "C") == "C", f"MOC in frame {table.get('COORDSYS')}, not ICRS"
    rows = int(table["NAXIS2"])
    dtype = {"1K": ">i8", "1J": ">i4"}[table["TFORM1"]]
    uniq = np.frombuffer(data[position : position + rows * np.dtype(dtype).itemsize], dtype=dtype).astype(np.int64)
    # NUNIQ = 4 * 4^order + pixel.
    order = (np.floor(np.log2(uniq // 4) / 2)).astype(np.int64)
    pixel = uniq - 4 * 4**order
    assert np.all((pixel >= 0) & (pixel < 12 * 4**order)), "NUNIQ value out of range"
    return order, pixel, table


def coarsen(order: np.ndarray, pixel: np.ndarray, to: int) -> list[int]:
    """Every cell of order `to` that holds any of the cells, sorted."""
    cells: set[int] = set()
    for o, p in zip(order.tolist(), pixel.tolist()):
        if o >= to:
            cells.add(p >> (2 * (o - to)))
        else:
            first = p << (2 * (to - o))
            cells.update(range(first, first + 4 ** (to - o)))
    return sorted(cells)


def area_deg2(order: np.ndarray) -> float:
    sky = 4 * math.pi * (180 / math.pi) ** 2
    return float(sum(sky / (12 * 4.0**o) for o in order.tolist()))


def main() -> None:
    surveys = {}
    for name, base in SURVEYS.items():
        moc = cached_fetch(f"{base}/Moc.fits", f"closeup-{name}-moc.fits")
        order, pixel, table = read_moc(moc.read_bytes())
        cells = coarsen(order, pixel, ORDER)
        # Sorted cells as differences from the one before: small numbers, a small file.
        deltas = [cells[0]] + [b - a for a, b in zip(cells, cells[1:])]
        surveys[name] = {
            "hips": base,
            "mocOrder": int(table.get("MOCORDER", order.max())),
            "areaDeg2": round(area_deg2(order), 3),
            "cells": len(cells),
            "deltas": deltas,
        }
        print(f"{name}: {len(order)} MOC cells, {surveys[name]['areaDeg2']} deg², {len(cells)} cells at order {ORDER}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps({"generated": date.today().isoformat(), "order": ORDER, "frame": "icrs", "surveys": surveys}, separators=(",", ":"))
    )
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
