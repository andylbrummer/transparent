#!/usr/bin/env python3
"""
Checks for the slab pipeline: app/public/geo/slabs.bin against Slab2 itself.

Every reference depth and thickness below was read from the source grids
of the data release (Slab2Distribute_Mar2018, files <code>_slab2_dep_*.grd
and <code>_slab2_thk_*.grd) on 2026-11-09, at the node named, not taken
from memory or from a map. The baked file must reproduce them to its
quantum where the node is one it kept, and to the bake's stated error
between nodes.

Reads the file through slab_file.py - standard library alone, written from
the layout's description rather than sharing code with the bake - so it
also pins the layout the app's src/layers/slabs/mesh.ts reads.

Usage:
    tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_slabs.py   # writes app/public/geo/
    python3 tools/pipeline/test_slabs.py
"""

import math

from generate_geo import OUTPUT_DIR
from geo_test_support import check, finish
from slab_file import SlabFile

slab_file = SlabFile(OUTPUT_DIR / "slabs.bin")
header = slab_file.header
slabs = slab_file.slabs
nodes = slab_file.nodes
node_at = slab_file.node_at
surface_depth = slab_file.surface_depth
check(slab_file.magic == b"SLB1", "the file starts with its magic")
check(slab_file.header_length % 4 == 0, "the header is padded to four bytes")
check(len(slab_file.data) < 500_000, f"the file stays under 500 kB ({len(slab_file.data)} bytes)")
check(len(slabs) == 27, f"all 27 slabs of Slab2 ({len(slabs)})")
check(all(nodes.values()), "every slab's runs add up to its node count")
check(slabs["kur"]["name"] == "Kamchatka-Kuril Islands-Japan" and slabs["cas"]["name"] == "Cascadia"
      and slabs["sam"]["name"] == "South America", "slabs carry Slab2's region names")
last = max(header["slabs"], key=lambda e: e["offset"])
check(last["offset"] + last["runCount"] * 6 + last["vertexCount"] * 4 <= len(slab_file.payload) <= last["offset"]
      + last["runCount"] * 6 + last["vertexCount"] * 4 + 1, "the payload ends where the last slab does")

# --- nodes the bake kept: the source's value, to the quantum ------------------
# (slab, lon 0-360, lat, depth km, thickness km, what)
NODES = [
    ("kur", 139.8, 35.6, 68.064, 134.28, "the Pacific slab under Tokyo"),
    ("ryu", 139.8, 35.6, 29.531, 120.42, "the Philippine Sea slab under Tokyo, above the Pacific one"),
    ("kur", 141.0, 38.2, 67.749, 134.35, "the Pacific slab under Sendai"),
    ("kur", 135.0, 43.0, 351.702, 133.54, "the Pacific slab under the Sea of Japan"),
    ("sam", 291.6, -24.0, 88.708, 81.88, "the Nazca slab under the central Andes"),
    ("sam", 288.8, -33.4, 52.584, 71.75, "the Nazca slab under Santiago"),
    ("sam", 296.4, -27.4, 448.053, 79.89, "the Nazca slab under northern Argentina"),
    ("cas", 237.6, 47.6, 50.407, 32.09, "the Juan de Fuca slab under Seattle"),
    ("cas", 235.4, 45.0, 16.092, 34.70, "the Juan de Fuca slab off Oregon"),
    ("ker", 181.0, -20.0, 578.336, 112.96, "the Pacific slab under Fiji's Lau Basin"),
    ("ker", 184.0, -20.0, 154.293, 115.64, "the Pacific slab under Tonga"),
    ("sum", 100.4, -1.0, 78.987, 92.82, "the Indo-Australian slab under Padang"),
    ("alu", 210.2, 61.2, 30.543, 76.48, "the Pacific slab under Anchorage"),
    ("hel", 25.0, 36.0, 76.894, 192.60, "the African slab under Crete"),
]
# Half the depth unit, and half of the last digit the references are written to.
DEPTH_QUANTUM_KM = header["depthUnitKm"] / 2 + 5e-4
for code, lon, lat, depth, thickness, what in NODES:
    node = node_at(code, lon, lat)
    ok = (node is not None and node[2] > 0 and abs(node[0] - depth) <= DEPTH_QUANTUM_KM
          and abs(node[1] - thickness) <= 0.5)
    got = "no node" if node is None else f"{node[0]:.3f} km, {node[1]:.0f} km thick"
    check(ok, f"{what}: {depth} km down, {thickness} km thick in Slab2 ({got})")
check(node_at("kur", 139.8, 35.6)[0] > node_at("ryu", 139.8, 35.6)[0] + 30,
      "under Tokyo the Pacific slab lies below the Philippine Sea slab")

# --- between nodes: the triangles the app draws, to the bake's stated error ---
BETWEEN = [
    ("sam", 291.7, -24.1, 90.834, "under the central Andes"),
    ("kur", 141.3, 38.5, 61.510, "under northeast Japan"),
]
for code, lon, lat, depth, what in BETWEEN:
    got = surface_depth(code, lon, lat)
    limit = slabs[code]["errorKm"]["max"]
    check(got is not None and abs(got - depth) <= limit,
          f"between nodes {what}: within {limit} km of Slab2's {depth} km ({got if got is None else round(got, 2)})")

# --- extent ------------------------------------------------------------------
deepest = max(slabs.values(), key=lambda e: e["maxDepthKm"])
check(deepest["code"] == "ker" and 695 <= deepest["maxDepthKm"] <= 701.2,
      f"the deepest slab is the Kermadec-Tonga one, to Slab2's 701 km ({deepest['maxDepthKm']} km)")
check(all(abs(max(n[0] for n in slab.values() if n[2] > 0) - slabs[code]["maxDepthKm"]) < 0.051 for code, slab in nodes.items()),
      "each header's maxDepthKm is its deepest node inside the slab, to a tenth of a km")
check(slabs["him"]["maxDepthKm"] < 45 and 420 <= slabs["cas"]["maxDepthKm"] <= 437.1,
      "the Himalayan slab stays shallow; Cascadia's reaches Slab2's 437 km under Nevada")
shallow_cascadia = [n[0] for (row, column), n in nodes["cas"].items()
                    if n[2] > 0 and abs(slabs["cas"]["lat0"] + row * slabs["cas"]["stepDeg"] - 47.0) < 1.5]
check(min(shallow_cascadia) < 8, f"Cascadia's slab comes up to within 8 km of the surface off Washington ({min(shallow_cascadia):.1f} km)")


def nearest_node_deg(lon: float, lat: float) -> float:
    best = math.inf
    for code, slab in nodes.items():
        entry = slabs[code]
        for (row, column), node in slab.items():
            if node[2] <= 0:
                continue
            dlon = (entry["lon0"] + column * entry["stepDeg"] - lon + 180) % 360 - 180
            best = min(best, math.hypot(dlon * math.cos(math.radians(lat)), entry["lat0"] + row * entry["stepDeg"] - lat))
    return best


# The nearest is the Cocos slab under central Mexico, ~10 degrees south.
check(nearest_node_deg(-97.74 % 360, 30.27) > 8, "no slab under Austin")
check(nearest_node_deg(139.7, 35.7) < 0.2 and nearest_node_deg(-70.6 % 360, -33.4) < 0.2, "slabs under Tokyo and Santiago")

# --- the outline -------------------------------------------------------------
ring_ok = True
inside_total = 0
for code, slab in nodes.items():
    inside = {key for key, node in slab.items() if node[2] > 0}
    inside_total += len(inside)
    ring_ok = ring_ok and len(inside) == slabs[code]["insideCount"] and all(node[2] != 0 for node in slab.values())
    for (row, column) in slab.keys() - inside:
        ring_ok = ring_ok and any((row + dr, column + dc) in inside for dr in (-1, 0, 1) for dc in (-1, 0, 1))
    for (row, column) in inside:
        ring_ok = ring_ok and all((row + dr, column + dc) in slab for dr in (-1, 0, 1) for dc in (-1, 0, 1)
                                  if 0 <= row + dr < slabs[code]["rows"] and 0 <= column + dc < slabs[code]["columns"])
check(ring_ok, "every slab node is ringed by nodes beyond the edge, and every ring node touches the slab")
check(60_000 < inside_total < 120_000, f"about 80,000 slab nodes ({inside_total})")
check(all(e["stepDeg"] in (0.1, 0.2) for e in slabs.values()), "slabs are sampled every 0.1 or 0.2 degrees")

# --- the error the bake measured ----------------------------------------------
worst_p99 = max(e["errorKm"]["p99"] for e in slabs.values())
worst_max = max(e["errorKm"]["max"] for e in slabs.values())
check(worst_p99 <= 2.5, f"99 % of every slab's source nodes lie within 2.5 km of the baked surface (worst {worst_p99} km)")
check(worst_max <= 7.0, f"no source node lies more than 7 km from it (worst {worst_max} km)")

# --- labels --------------------------------------------------------------------
labels_ok = True
for code, entry in slabs.items():
    node = node_at(code, entry["label"]["lon"], entry["label"]["lat"])
    labels_ok = labels_ok and node is not None and node[2] > 0 and abs(node[0] - entry["label"]["depthKm"]) < 0.06
check(labels_ok, "each slab's name sits on one of its own nodes, at that node's depth")
check(140 < slabs["kur"]["label"]["lon"] < 160 and 40 < slabs["kur"]["label"]["lat"] < 55,
      "the Kamchatka-Kuril-Japan slab is named near the Kurils")

finish()
