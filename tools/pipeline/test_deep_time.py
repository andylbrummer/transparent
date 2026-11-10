#!/usr/bin/env python3
"""
Checks for app/public/geo/deep-time/plates.bin and timescale.json.

The file is read here the way the app reads it - find the continental
piece a present-day point lies in, take its plate, interpolate the stored
key rotations, turn the point - and the result is held against:

  * the GPlates Web Service (https://gws.gplates.org, model MERDITH2021,
    /reconstruct/reconstruct_points), which reconstructs with its own copy
    of the model and assigns plates from the model's static polygons, not
    from the pieces baked here. Its answers of 10 Nov 2026 are pinned below.
    Its Euler poles (/rotation/get_euler_pole_and_angle) are pinned too.
  * the things everyone knows about the last 250 Myr: India far south of
    the equator in the latest Cretaceous and running north after; the South
    Atlantic shut before ~130 Ma; Australia against Antarctica until the
    Late Cretaceous; all of it one continent at 250 Ma.

Needs numpy only (no pygplates):

    python3 tools/pipeline/test_deep_time.py
"""

import json
import math
import struct

import numpy as np

from generate_deep_time import MAX_AGE_MA, OUTPUT_DIR
from geo_test_support import check, finish


def read_plates(path):
    raw = path.read_bytes()
    assert raw[:4] == b"TEDT", "magic"
    version, header_bytes = struct.unpack("<II", raw[4:12])
    header = json.loads(raw[12 : 12 + header_bytes])
    body = raw[12 + header_bytes :]

    def array(name, dtype):
        offset, size = header["arrays"][name]
        return np.frombuffer(body, dtype=dtype, count=size // np.dtype(dtype).itemsize, offset=offset)

    plates = {
        "ids": array("plateIds", "<i4"),
        "counts": array("keyCounts", "<u2"),
        "ages": array("keyAges", "<u2"),
        "quats": array("keyQuats", "<i2").reshape(-1, 4) / 32767,
    }
    plates["starts"] = np.concatenate([[0], np.cumsum(plates["counts"].astype(np.int64))]).astype(np.int64)
    sets = {}
    for name in header["sets"]:
        counts = array(f"{name}.ringCounts", "<u2")
        points = array(f"{name}.points", "<i2").reshape(-1, 2).astype(np.int64)
        rings = []
        position = 0
        for count in counts:
            ring = np.cumsum(points[position : position + count], axis=0) / header["quantumPerDegree"]
            rings.append(ring)
            position += count
        sets[name] = {
            "rings": rings,
            "plate": array(f"{name}.ringPlate", "<u2"),
            "begin": array(f"{name}.ringBegin", "<u2"),
            "end": array(f"{name}.ringEnd", "<u2"),
            "interior": array(f"{name}.interior", "<u2"),
        }
        if f"{name}.triangles" in header["arrays"]:
            sets[name]["triangles"] = array(f"{name}.triangles", "<u2").reshape(-1, 3)
            sets[name]["fillPoints"] = array(f"{name}.fillPoints", "<i2").reshape(-1, 2) / header["quantumPerDegree"]
            sets[name]["fillRing"] = array(f"{name}.fillRing", "<u2")
    return version, header, plates, sets


def unit(lon, lat):
    lon, lat = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def lonlat(v):
    return math.degrees(math.atan2(v[1], v[0])), math.degrees(math.asin(max(-1, min(1, v[2]))))


def slerp(a, b, t):
    dot = float(a @ b)
    if dot < 0:
        b, dot = -b, -dot
    if dot > 0.9999995:
        mixed = a + (b - a) * t
        return mixed / np.linalg.norm(mixed)
    theta = math.acos(dot)
    return (math.sin((1 - t) * theta) * a + math.sin(t * theta) * b) / math.sin(theta)


def plate_quaternion(plates, index, age):
    first, last = plates["starts"][index], plates["starts"][index + 1]
    ages = plates["ages"][first:last]
    k = int(np.searchsorted(ages, age, side="right")) - 1
    if k >= len(ages) - 1:
        q = plates["quats"][first + len(ages) - 1]
        return q / np.linalg.norm(q)
    a, b = plates["quats"][first + k], plates["quats"][first + k + 1]
    return slerp(a / np.linalg.norm(a), b / np.linalg.norm(b), (age - ages[k]) / (ages[k + 1] - ages[k]))


def rotate(q, v):
    u, w = q[:3], q[3]
    return v + 2 * np.cross(u, np.cross(u, v) + w * v)


def winding(ring, lon, lat):
    """Turns the ring makes round the point: ±1 inside, 0 outside."""
    p = unit(lon, lat)
    east = np.cross([0, 0, 1.0], p)
    east /= np.linalg.norm(east)
    north = np.cross(p, east)
    v = unit(ring[:, 0], ring[:, 1])
    # Seen from the antipode a ring also goes once round; no piece is as large as a hemisphere.
    if float(v.mean(axis=0) @ p) <= 0:
        return 0
    azimuth = np.arctan2(v @ east, v @ north)
    step = np.diff(azimuth)
    step = (step + math.pi) % (2 * math.pi) - math.pi
    return round(float(step.sum()) / (2 * math.pi))


def plate_at(sets, lon, lat, age=0):
    """Index of the plate under a present-day point: continental pieces first, then coastlines."""
    for name in ("continents", "coast"):
        data = sets[name]
        best = None
        for i, ring in enumerate(data["rings"]):
            if data["end"][i] > age or data["begin"][i] < age:
                continue
            if abs(ring[:, 1].mean() - lat) > 60:
                continue
            if winding(ring, lon, lat) != 0 and (best is None or data["begin"][i] > data["begin"][best]):
                best = i
        if best is not None:
            return int(data["plate"][best]), int(data["begin"][best])
    return None, None


def reconstruct(plates, sets, lon, lat, age):
    plate, begin = plate_at(sets, lon, lat)
    assert plate is not None, f"no piece holds {lon}, {lat}"
    assert age <= begin, f"{lon}, {lat} does not exist at {age} Ma"
    return lonlat(rotate(plate_quaternion(plates, plate, age), unit(lon, lat)))


def separation_deg(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, float(unit(*a) @ unit(*b))))))


path = OUTPUT_DIR / "plates.bin"
version, header, plates, sets = read_plates(path)
size = path.stat().st_size
check(version == 1, f"file version 1 ({version})")
# A billion years of 1,691 coast rings, their blocks and rotations: over the usual 500 kB, and held to this.
check(size < 1_250_000, f"plates.bin under 1.25 MB ({size:,} bytes)")
check(header["maxAgeMa"] == MAX_AGE_MA == 1000, "the model's 1,000 Ma")
check(header["referenceFrame"] == "palaeomagnetic" and header["licence"] == "CC BY 4.0", "reference frame and licence stated")
check(len(plates["ids"]) == header["plates"] and plates["starts"][-1] == header["keys"], "plate and key counts agree with the header")
check(header["worstRotationErrorDeg"] <= 0.03, f"thinned rotations within 0.03° of the model ({header['worstRotationErrorDeg']}°)")

norms = np.linalg.norm(plates["quats"], axis=1)
check(abs(norms - 1).max() < 1e-4, f"every stored rotation is a unit quaternion (worst {abs(norms - 1).max():.1e})")
first_keys = plates["quats"][plates["starts"][:-1]]
check(np.all(plates["ages"][plates["starts"][:-1]] == 0), "every plate's first key is the present")
check(np.abs(np.abs(first_keys[:, 3]) - 1).max() < 1e-4, "at 0 Ma every plate is where it is today (identity)")
for index in range(len(plates["ids"])):
    ages = plates["ages"][plates["starts"][index] : plates["starts"][index + 1]]
    if not np.all(np.diff(ages.astype(int)) > 0):
        check(False, f"plate {plates['ids'][index]}: key ages ascend")
        break
else:
    check(True, "key ages ascend for every plate")

for name, data in sets.items():
    rings = data["rings"]
    check(len(rings) == header["sets"][name]["rings"], f"{name}: {len(rings)} rings as the header says")
    check(all(np.allclose(r[0], r[-1]) for r in rings), f"{name}: every ring is closed")
    lon = np.concatenate([r[:, 0] for r in rings])
    lat = np.concatenate([r[:, 1] for r in rings])
    check(abs(lat).max() <= 90 and abs(lon).max() <= 540, f"{name}: coordinates in range")
    oldest_key = np.array([plates["ages"][plates["starts"][p + 1] - 1] for p in data["plate"]])
    check(np.all(oldest_key >= data["begin"]), f"{name}: every piece has rotations back to its own first age")
    check(data["begin"].max() == 1000 and np.all(data["begin"] > data["end"]), f"{name}: ages within 0-1000 Ma, begin before end")

continents = sets["continents"]
triangles = continents["triangles"]
points = header["sets"]["continents"]["points"]
fill_lonlat = np.vstack([np.concatenate(continents["rings"]), continents["fillPoints"]])
check(
    len(fill_lonlat) == points + header["sets"]["continents"]["fillPoints"] and triangles.max() < len(fill_lonlat),
    f"fill triangles index the continents' {points} ring points and {len(continents['fillPoints'])} added points ({len(triangles)} triangles)",
)
check(continents["fillRing"].max() < len(continents["rings"]), "every added fill point names its ring")
all_points = unit(*fill_lonlat.T)
a, b, c = (all_points[triangles[:, k]] for k in range(3))
dots = np.minimum(np.minimum(np.einsum("ij,ij->i", a, b), np.einsum("ij,ij->i", b, c)), np.einsum("ij,ij->i", c, a))
longest = float(np.degrees(np.arccos(np.clip(dots, -1, 1))).max())
check(
    longest <= header["maxFillEdgeDeg"] + 0.02,
    f"no fill triangle has an edge over {header['maxFillEdgeDeg']}° ({longest:.2f}°: a sag of {6371 * (1 - math.cos(math.radians(longest / 2))):.1f} km)",
)
steps = max(
    float(np.degrees(np.arccos(np.clip(np.einsum("ij,ij->i", unit(*r[:-1].T), unit(*r[1:].T)), -1, 1))).max())
    for name in sets
    for r in sets[name]["rings"]
)
check(steps <= header["maxSegmentDeg"] + 0.02, f"no outline step is over {header['maxSegmentDeg']}° ({steps:.2f}°)")
# The fill should cover what the rings enclose: compare areas on the sphere.
solid = 2 * np.arctan2(
    np.abs(np.einsum("ij,ij->i", a, np.cross(b, c))),
    1 + np.einsum("ij,ij->i", a, b) + np.einsum("ij,ij->i", b, c) + np.einsum("ij,ij->i", c, a),
)
fill_mkm2 = float(solid.sum()) * 6371.0088**2 / 1e6
check(170 < fill_mkm2 < 260, f"continental fill covers {fill_mkm2:.0f} million km² (continental crust today is ~210, and the model's blocks overlap a little)")

for name, data in sets.items():
    total = sum(len(r) - 1 for r in data["rings"])
    now = float((data["interior"] > 0).sum()) / total
    always = float((data["interior"] == 65535).sum()) / total
    check(len(data["interior"]) == sum(len(r) for r in data["rings"]), f"{name}: one interior age per point")
    # The continental blocks tile the continents, so most of their edges (85 %) are seams between
    # neighbours today; coastline polygons are whole landmasses and have fewer (45 %).
    check(0.2 < now < 0.9 and always < now, f"{name}: {now:.0%} of steps are seams inside a continent today and not drawn; {always:.0%} never are")

# --- 0 Ma is today's map ---
for place, lon, lat, inside in (("Austin", -97.74, 30.27, True), ("Nairobi", 36.82, -1.29, True), ("Delhi", 77.21, 28.61, True), ("Moscow", 37.62, 55.75, True), ("Brasilia", -47.88, -15.79, True), ("the South Pole", 0.0, -90.0, True), ("the mid-Pacific", -140.0, 0.0, False), ("mid-Atlantic", -30.0, 0.0, False)):
    plate, _ = plate_at(sets, lon, lat)
    check((plate is not None) == inside, f"{place} is {'on' if inside else 'off'} the model's continents")
outlines = json.loads((OUTPUT_DIR.parent / "outlines.json").read_text())
coast_vectors = unit(*np.concatenate(sets["coast"]["rings"])[sets["coast"]["interior"] == 0].T)
q = outlines["quantumPerDegree"]
natural = np.concatenate([np.cumsum(np.array(p).reshape(-1, 2), axis=0) / q for p in outlines["layers"]["coastline"]])
sample = unit(*natural[:: max(1, len(natural) // 1500)].T)
nearest = np.degrees(np.arccos(np.clip((sample @ coast_vectors.T).max(axis=1), -1, 1)))
check(np.median(nearest) < 0.15, f"the model's present coastline lies on Natural Earth's: median {np.median(nearest):.3f}° apart")
check(np.percentile(nearest, 90) < 1.0, f"... 90% within {np.percentile(nearest, 90):.2f}° (the model omits small islands and draws terrane edges)")

# --- against the GPlates Web Service, MERDITH2021, fetched 10 Nov 2026 ---
# (present lon, lat): {age: (lon, lat)} as /reconstruct/reconstruct_points returned them.
GWS = {
    "central India": ((78.0, 22.0), {71: (64.1314, -29.6987), 100: (55.4282, -35.8555), 130: (49.1269, -43.8935), 200: (54.0702, -27.1676), 250: (51.0915, -48.0586), 500: (125.3003, -40.3798), 750: (14.6798, 36.5974), 1000: (-34.3713, 5.9556)}),
    "Austin": ((-97.74, 30.27), {71: (-65.0114, 36.046), 100: (-52.8446, 33.4083), 130: (-38.0603, 29.2218), 200: (-29.2842, 4.3937), 250: (-27.9186, 4.6492), 500: (-157.6931, -1.348), 750: (93.8431, -12.7894), 1000: (117.5683, 5.3976)}),
    "north-east Brazil": ((-36.5, -7.0), {71: (-13.7918, -14.0798), 100: (-1.5817, -8.837), 130: (6.395, -7.5882), 140: (6.054, -9.2691), 250: (1.1231, -22.2673), 500: (-160.5449, -69.5619), 1000: (9.6974, -47.2719)}),
    "Cameroon": ((12.0, 4.0), {71: (11.2733, -11.1599), 100: (11.1425, -8.7641), 130: (10.2025, -10.0143), 140: (9.4986, -11.5715), 250: (4.5612, -24.5732), 500: (-171.7972, -69.9781), 1000: (35.5286, -45.3556)}),
    "South Australia": ((135.0, -30.0), {71: (144.6014, -55.6904), 100: (135.4153, -63.415), 200: (94.1325, -49.1673), 250: (116.781, -65.2357), 500: (130.9228, -2.9732), 1000: (125.7442, 32.439)}),
    "Wilkes Land": ((135.0, -68.0), {71: (150.4484, -68.1672), 100: (120.6942, -72.1756), 200: (81.1061, -50.9389), 250: (98.2453, -70.1731), 500: (135.3323, -10.3033), 1000: (115.6339, 33.3951)}),
    "Germany": ((10.0, 50.0), {71: (16.957, 39.4258), 100: (25.5342, 42.2079), 200: (23.2424, 38.3531), 250: (29.8693, 21.8796)}),
    "Siberia": ((100.0, 65.0), {71: (85.497, 63.1849), 130: (100.4771, 68.1245), 250: (43.0204, 67.8004), 500: (-56.748, -12.6486), 1000: (-158.0622, 18.211)}),
}
worst = 0.0
for place, (present, by_age) in GWS.items():
    place_worst = 0.0
    for age, expected in by_age.items():
        place_worst = max(place_worst, separation_deg(reconstruct(plates, sets, *present, age), expected))
    worst = max(worst, place_worst)
    check(place_worst < 0.1, f"{place}: {len(by_age)} ages agree with the web service to {place_worst:.3f}°")
check(worst < 0.1, f"worst disagreement with the web service over {sum(len(b) for _, b in GWS.values())} reconstructions: {worst:.3f}° ({worst * 111.19:.1f} km)")

# Euler poles as /rotation/get_euler_pole_and_angle?times=71,250 gave them: plate: {age: (pole lon, pole lat, angle)}.
# (The service lists its answers oldest age first, whatever order the ages were asked in.)
POLES = {501: {250: (18.53407364, 4.71674555, -88.1886162), 71: (1.7682246, 11.83195885, -56.05001678)}, 701: {250: (-27.13, 0.0, -47.36), 71: (-41.06667992, 0.0, -18.99258946)}, 101: {250: (68.98406795, 59.5920792, 70.26090086), 71: (118.85407388, 53.32799692, 27.86528425)}}
for plate, by_age in POLES.items():
    index = int(np.where(plates["ids"] == plate)[0][0])
    for age, (lon, lat, angle) in by_age.items():
        half = math.radians(angle) / 2
        expected = np.array([*(unit(lon, lat) * math.sin(half)), math.cos(half)])
        off = 2 * math.degrees(math.acos(min(1.0, abs(float(expected @ plate_quaternion(plates, index, age))))))
        check(off < 0.03, f"plate {plate} at {age} Ma: stored rotation is the service's Euler pole ({lon:.2f}°E {lat:.2f}°N, {angle:.2f}°) to {off:.4f}°")

# --- what the last 250 Myr are known for ---
india = {age: reconstruct(plates, sets, 78.0, 22.0, age) for age in (0, 10, 30, 50, 60, 71, 100)}
check(-32 < india[71][1] < -27, f"central India (22°N today) stood at {-india[71][1]:.1f}°S at 71 Ma")
check(all(india[a][1] > india[b][1] for a, b in ((0, 10), (10, 30), (30, 50), (50, 60), (60, 71))), "India only moved north from 71 Ma to today: " + ", ".join(f"{a} Ma {india[a][1]:.0f}°" for a in sorted(india)))
km_per_myr = separation_deg(india[71], india[50]) * 111.19 / 21
check(100 < km_per_myr < 220, f"India's run 71-50 Ma: {km_per_myr:.0f} km/Myr ({km_per_myr / 10:.0f} cm/yr; published rates for the run are 15-20 cm/yr)")

brazil, cameroon = (-36.5, -7.0), (12.0, 4.0)
gap = {age: separation_deg(reconstruct(plates, sets, *brazil, age), reconstruct(plates, sets, *cameroon, age)) for age in (0, 50, 100, 120, 130, 140, 200)}
check(gap[0] > 45 and gap[100] > 2 * gap[130], f"the South Atlantic: Recife to Cameroon {gap[0]:.0f}° today, {gap[100]:.0f}° at 100 Ma, {gap[130]:.1f}° at 130 Ma")
check(abs(gap[140] - gap[200]) < 0.3 and gap[140] < 5, f"... and shut, not moving, before that ({gap[140]:.2f}° at 140 Ma, {gap[200]:.2f}° at 200 Ma)")

australia, antarctica = (135.0, -34.5), (135.0, -66.5)
gap = {age: separation_deg(reconstruct(plates, sets, *australia, age), reconstruct(plates, sets, *antarctica, age)) for age in (0, 30, 45, 85, 100, 150)}
check(gap[0] > 30 and gap[45] < 0.5 * gap[0], f"Australia's south coast to Wilkes Land: {gap[0]:.0f}° today, {gap[30]:.0f}° at 30 Ma, {gap[45]:.0f}° at 45 Ma")
check(gap[100] < 6 and abs(gap[100] - gap[150]) < 1.0, f"... joined before the Late Cretaceous ({gap[85]:.1f}° at 85 Ma, {gap[100]:.1f}° at 100 Ma, {gap[150]:.1f}° at 150 Ma)")

# Pangaea: at 250 Ma the model's continental crust sits together; today it is scattered.
def gathered(age):
    """Length of the mean of the blocks' positions, weighted by size: 1 all at one point, 0 spread evenly."""
    total = np.zeros(3)
    weight = 0.0
    for i, ring in enumerate(sets["continents"]["rings"]):
        if sets["continents"]["begin"][i] < age or sets["continents"]["end"][i] > age:
            continue
        centre = unit(ring[:, 0], ring[:, 1]).mean(axis=0)
        qn = plate_quaternion(plates, int(sets["continents"]["plate"][i]), age)
        total += len(ring) * rotate(qn, centre / np.linalg.norm(centre))
        weight += len(ring)
    return float(np.linalg.norm(total) / weight)


check(gathered(250) > gathered(0) + 0.08, f"the continents are gathered at 250 Ma (Pangaea) and scattered now: {gathered(250):.2f} against {gathered(0):.2f} (1 = all at one point)")

# --- the time scale ---
scale = json.loads((OUTPUT_DIR / "timescale.json").read_text())
units = {(u["rank"], u["name"]): u for u in scale["units"]}
check(scale["version"] == "2024/12", f"ICS chart v2024/12 ({scale['version']})")
for rank, name, begin, end in (("period", "Jurassic", 201.4, 143.1), ("period", "Cretaceous", 143.1, 66.0), ("period", "Cambrian", 538.8, 486.85), ("period", "Tonian", 1000.0, 720.0), ("era", "Mesozoic", 251.902, 66.0), ("epoch", "Eocene", 56.0, 33.9), ("epoch", "Holocene", 0.0117, 0.0)):
    u = units.get((rank, name))
    check(u is not None and u["begin"] == begin and u["end"] == end, f"{name}: {begin}-{end} Ma as on the chart")
periods = sorted((u for u in scale["units"] if u["rank"] == "period"), key=lambda u: u["end"])
check(all(a["begin"] == b["end"] for a, b in zip(periods, periods[1:])), "periods meet end to end with no gap")
check(periods[0]["end"] == 0 and periods[-1]["begin"] == 2500, "periods run from today to 2,500 Ma (the Archean has none)")
check(units[("period", "Jurassic")]["color"] == "#34B2C9", "colours are the chart's (Jurassic #34B2C9)")

finish()
