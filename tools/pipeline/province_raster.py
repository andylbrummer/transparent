"""Shared by the province bakes: shapefile and dBASE reading, and drawing
polygons of longitude and latitude onto an equirectangular picture.

Pictures are 2048x1024, longitude -180..180 left to right, north up, three
channels the app reads separately:

    R  a class number (or an age), read without filtering; 0 is nothing.
       Every pixel with any coverage in B has a class, taken from the
       nearest filled pixel where its centre fell outside every polygon.
    G  the outlines of every polygon, anti-aliased (or 0, see bake).
    B  coverage, anti-aliased: what is inside a polygon.

Polygons are drawn at twice the size and averaged down for G and B. Rings
are unwrapped across the date line and drawn at -360, 0 and +360 degrees,
so a ring that crosses it needs no cutting; one that circles a pole is
closed along that pole.
"""

import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

WIDTH, HEIGHT = 2048, 1024
SCALE = 2
Ring = list[tuple[float, float]]


def read_dbf(path: Path) -> list[dict[str, str]]:
    """The records of a dBASE III table, every field as stripped text."""
    data = path.read_bytes()
    count, header_length, record_length = struct.unpack("<IHH", data[4:12])
    fields = []
    position = 32
    while data[position] != 0x0D:
        name = data[position : position + 11].split(b"\0")[0].decode("ascii")
        fields.append((name, data[position + 16]))
        position += 32
    rows = []
    for i in range(count):
        record = data[header_length + i * record_length : header_length + (i + 1) * record_length]
        if record[:1] == b"*":
            continue  # deleted
        row, at = {}, 1
        for name, length in fields:
            raw = record[at : at + length]
            try:
                row[name] = raw.decode("utf-8").strip()
            except UnicodeDecodeError:
                # cratons.dbf has no code page file and some names are Latin-1 ("Saõ Francisco Craton").
                row[name] = raw.decode("cp1252").strip()
            at += length
        rows.append(row)
    return rows


def read_polygon_records(path: Path) -> list[list[Ring]]:
    """Every record of a polygon shapefile, in order (null shapes as []), each a list of rings of (lon, lat)."""
    data = path.read_bytes()
    assert struct.unpack(">i", data[:4])[0] == 9994, "not a shapefile"
    assert struct.unpack("<i", data[32:36])[0] in (5, 15), "not polygons"
    records: list[list[Ring]] = []
    position = 100
    while position < len(data):
        _, words = struct.unpack(">2i", data[position : position + 8])
        record = data[position + 8 : position + 8 + words * 2]
        position += 8 + words * 2
        if struct.unpack("<i", record[:4])[0] not in (5, 15):
            records.append([])
            continue
        parts, points = struct.unpack("<2i", record[36:44])
        starts = list(struct.unpack(f"<{parts}i", record[44 : 44 + 4 * parts])) + [points]
        xy = np.frombuffer(record, dtype="<f8", count=points * 2, offset=44 + 4 * parts).reshape(points, 2)
        records.append([[(float(x), float(y)) for x, y in xy[starts[i] : starts[i + 1]]] for i in range(parts)])
    return records


def signed_area(ring: Ring) -> float:
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))


def unwrapped(ring: Ring) -> Ring:
    """Longitudes made continuous; a ring that goes once round the pole is closed along it."""
    out = [ring[0]]
    for lon, lat in ring[1:]:
        previous = out[-1][0]
        lon += 360 * round((previous - lon) / 360)
        out.append((lon, lat))
    # A closed ring ends where it began; once unwrapped, one round a pole ends 360 degrees on.
    if abs(out[-1][0] - out[0][0]) > 180:
        pole = -90.0 if sum(lat for _, lat in out) < 0 else 90.0
        out += [(out[-1][0], pole), (out[0][0], pole)]
    return out


def pixels(ring: Ring, scale: int, offset: float) -> list[tuple[float, float]]:
    return [((lon + offset + 180) / 360 * WIDTH * scale, (90 - lat) / 180 * HEIGHT * scale) for lon, lat in ring]


def fill(draw: ImageDraw.ImageDraw, rings: list[Ring], value: int, scale: int) -> None:
    """Outer rings (clockwise) filled with `value`, then holes cleared to 0."""
    for outer in (True, False):
        for ring in rings:
            if len(ring) < 3 or (signed_area(ring) < 0) != outer:
                continue
            flat = unwrapped(ring)
            for offset in (-360.0, 0.0, 360.0):
                draw.polygon(pixels(flat, scale, offset), fill=value if outer else 0)


def outline(draw: ImageDraw.ImageDraw, rings: list[Ring], scale: int) -> None:
    for ring in rings:
        if len(ring) < 2:
            continue
        flat = unwrapped(ring)
        for offset in (-360.0, 0.0, 360.0):
            draw.line(pixels(flat, scale, offset), fill=255, width=1)


def bake(shapes: list[tuple[list[Ring], int]], outlines: bool = True) -> np.ndarray:
    """RGB picture of `shapes` (rings, value 1..255), drawn in order so later ones lie over earlier ones.

    Without `outlines` G is left 0: thin lines are most of a picture's bytes, and a layer whose
    classes are enough to tell its polygons apart finds the edges in the shader instead.
    """
    value = Image.new("L", (WIDTH, HEIGHT), 0)
    cover = Image.new("L", (WIDTH * SCALE, HEIGHT * SCALE), 0)
    lines = Image.new("L", (WIDTH * SCALE, HEIGHT * SCALE), 0)
    draw_value, draw_cover, draw_lines = ImageDraw.Draw(value), ImageDraw.Draw(cover), ImageDraw.Draw(lines)
    for rings, v in shapes:
        fill(draw_value, rings, v, 1)
        fill(draw_cover, rings, 255, SCALE)
        if outlines:
            outline(draw_lines, rings, SCALE)

    def down(image: Image.Image) -> np.ndarray:
        a = np.asarray(image, dtype=np.float32).reshape(HEIGHT, SCALE, WIDTH, SCALE)
        return a.mean(axis=(1, 3))

    r = np.asarray(value, dtype=np.uint8).copy()
    b = down(cover)
    # A pixel partly covered at the finer size but empty at this one takes its class from the nearest filled pixel.
    empty = r == 0
    if empty.any() and not empty.all():
        _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
        near = r[iy, ix]
        r = np.where(empty & (b > 0), near, r)
    g = down(lines)
    return np.stack([r, np.round(g).astype(np.uint8), np.round(b).astype(np.uint8)], axis=-1)


def cell_areas() -> np.ndarray:
    """Share of the sphere in each pixel row (sums to 1 over the picture)."""
    edges = np.radians(90 - np.arange(HEIGHT + 1) * 180 / HEIGHT)
    rows = (np.sin(edges[:-1]) - np.sin(edges[1:])) / 2 / WIDTH
    return np.repeat(rows[:, None], WIDTH, axis=1)


def save_png(rgb: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(path, optimize=True)


def area_centroid(rings_list: list[list[Ring]]) -> tuple[float, float, float]:
    """(lon, lat, km2) of the area-weighted centre of some polygons, by the mean of their unit vectors."""
    total = np.zeros(3)
    area_km2 = 0.0
    for rings in rings_list:
        for ring in rings:
            if len(ring) < 3:
                continue
            flat = unwrapped(ring)
            a = -signed_area(flat)  # clockwise outer rings are positive here; holes subtract
            lon = np.radians(np.mean([p[0] for p in flat]))
            lat = np.radians(np.mean([p[1] for p in flat]))
            km2 = a * (111.195**2) * np.cos(lat)
            total += km2 * np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
            area_km2 += km2
    x, y, z = total
    return float(np.degrees(np.arctan2(y, x))), float(np.degrees(np.arctan2(z, np.hypot(x, y)))), area_km2
