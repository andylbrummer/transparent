"""Reader for app/public/geo/slabs.bin (written by generate_slabs.py), for the
pipeline's data checks. Standard library only, and independent of the
writer: it follows the layout in generate_slabs.py's docstring, as the
app's src/layers/slabs/mesh.ts does."""

import json
import math
import struct
from pathlib import Path


class SlabFile:
    def __init__(self, path: Path):
        self.data = path.read_bytes()
        self.magic = self.data[:4]
        self.header_length = struct.unpack_from("<I", self.data, 4)[0]
        self.header = json.loads(self.data[8:8 + self.header_length])
        self.payload = self.data[8 + self.header_length:]
        self.slabs: dict[str, dict] = {entry["code"]: entry for entry in self.header["slabs"]}
        # Per slab: {(row, column): (depth km, thickness km, edge cells)}; empty if its runs do not add up.
        self.nodes: dict[str, dict[tuple[int, int], tuple[float, float, float]]] = {
            code: self._load(entry) for code, entry in self.slabs.items()}

    def _load(self, entry: dict) -> dict:
        at = entry["offset"]
        runs = struct.unpack_from(f"<{entry['runCount'] * 3}H", self.payload, at)
        at += entry["runCount"] * 6
        count = entry["vertexCount"]
        depths = struct.unpack_from(f"<{count}H", self.payload, at)
        thicknesses = struct.unpack_from(f"<{count}B", self.payload, at + count * 2)
        edges = struct.unpack_from(f"<{count}b", self.payload, at + count * 3)
        nodes = {}
        n = 0
        for row, first, length in zip(runs[0::3], runs[1::3], runs[2::3]):
            for column in range(first, first + length):
                nodes[(row, column)] = (depths[n] * self.header["depthUnitKm"],
                                        thicknesses[n] * self.header["thicknessUnitKm"],
                                        edges[n] * self.header["edgeUnitCells"])
                n += 1
        return nodes if n == count else {}

    def node_at(self, code: str, lon: float, lat: float) -> tuple[float, float, float] | None:
        """The node at a position (longitude 0-360), if the slab's grid has one there."""
        entry = self.slabs[code]
        column = (lon - entry["lon0"]) / entry["stepDeg"]
        row = (lat - entry["lat0"]) / entry["stepDeg"]
        if abs(column - round(column)) > 1e-6 or abs(row - round(row)) > 1e-6:
            return None
        return self.nodes[code].get((round(row), round(column)))

    def surface_depth(self, code: str, lon: float, lat: float) -> float | None:
        """Depth of a slab's top at any position inside it, on the triangles the
        app draws (each cell split from its south-west corner to its north-east
        one). None where the slab has no cell, or the cell is cut by the outline."""
        entry = self.slabs[code]
        x = (lon % 360 - entry["lon0"]) / entry["stepDeg"]
        y = (lat - entry["lat0"]) / entry["stepDeg"]
        column, row = math.floor(x), math.floor(y)
        fx, fy = x - column, y - row
        corners = [self.nodes[code].get((row + dr, column + dc)) for dr, dc in ((0, 0), (0, 1), (1, 0), (1, 1))]
        if any(corner is None or corner[2] <= 0 for corner in corners):
            return None
        a, b, c, d = (corner[0] for corner in corners)
        return a + fx * (b - a) + fy * (d - b) if fx >= fy else a + fx * (d - c) + fy * (c - a)

    def shallowest_depth(self, lon: float, lat: float) -> float | None:
        """Depth of the shallowest slab at a position, None where there is none."""
        depths = [d for d in (self.surface_depth(code, lon, lat) for code in self.slabs) if d is not None]
        return min(depths) if depths else None
