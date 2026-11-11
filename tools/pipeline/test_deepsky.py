#!/usr/bin/env python3
"""
Data checks for generate_deepsky.py's output: known objects at known places.

Reference positions are the usual J2000 (ICRS) ones of each object, as
SIMBAD gives them - independent of the catalogues baked here, most of
which are X-ray, gamma-ray or radio positions of the same objects.

Usage:
    python3 tools/pipeline/test_deepsky.py
"""

import json
import math
import struct

from generate_deepsky import BUILDERS, FAMOUS_CLUSTERS, FAMOUS_PULSARS, OUTPUT_DIR
from geo_test_support import check, finish
from sky_catalog_support import b1950_to_j2000, heasarc_rows, icrs_to_galactic, separation_deg

# name: (ra, dec) degrees, J2000
M31 = (10.6847, 41.2687)
CRAB = (83.633, 22.014)
SCO_X1 = (244.979, -15.640)
CYG_X1 = (299.590, 35.202)
SGR_A = (266.417, -29.008)
QSO_3C273 = (187.278, 2.052)
VELA_PULSAR = (128.836, -45.176)
COMA = (194.95, 27.98)
M87 = (187.706, 12.391)
# Supergalactic north pole (de Vaucouleurs et al. 1991): galactic l = 47.37, b = +6.32, i.e. J2000:
SUPERGALACTIC_POLE = (283.7542, 15.7089)
KEPLER_FIELD = (290.67, 44.5)


def load(name: str) -> dict:
    return json.loads((OUTPUT_DIR / f"{name}.json").read_text(encoding="utf-8"))


def position(data: dict, index: int) -> tuple[float, float]:
    q = data["quantumPerDegree"]
    return data["ra"][index] / q, data["dec"][index] / q


def find(data: dict, text: str) -> int | None:
    """Index of the object whose label starts with `text`."""
    for index, label, _ in data["labels"]:
        if label.startswith(text):
            return index
    return None


def check_at(data: dict, what: str, text: str, ref: tuple[float, float], tolerance_deg: float) -> int | None:
    index = find(data, text)
    check(index is not None, f"{what}: '{text}' is labelled")
    if index is None:
        return None
    sep = separation_deg(*position(data, index), *ref)
    check(sep < tolerance_deg, f"{what}: {text} within {tolerance_deg} deg of its place ({sep * 60:.2f} arcmin)")
    return index


def nearest(data: dict, ref: tuple[float, float]) -> tuple[int, float]:
    best = min(range(len(data["ra"])), key=lambda i: separation_deg(*position(data, i), *ref))
    return best, separation_deg(*position(data, best), *ref)


def read_cloud(name: str) -> tuple[dict, list[tuple[float, float, int]]]:
    meta = load(name)
    raw = (OUTPUT_DIR / meta["file"]).read_bytes()
    points = [(ra / 65536 * 360, dec / 32767 * 90, val) for ra, dec, val in struct.iter_unpack("<HhH", raw)]
    return meta, points


def structure_checks() -> None:
    for name in BUILDERS:
        data = load(name)
        if "file" in data:
            size = (OUTPUT_DIR / data["file"]).stat().st_size
            check(size == data["count"] * 6, f"{name}: packed file holds {data['count']} six-byte records")
            continue
        count = len(data["ra"])
        check(all(len(data[k]) == count for k in ("dec", "cls", "val")), f"{name}: columns are the same length ({count})")
        check(
            all(0 <= r < 360000 for r in data["ra"]) and all(-90000 <= d <= 90000 for d in data["dec"]),
            f"{name}: coordinates in range",
        )
        check(all(0 <= c < len(data["classes"]) for c in data["cls"]), f"{name}: classes in range")
        check(all(0 <= label[0] < count for label in data["labels"]), f"{name}: label indices in range")
        check(len(data["labels"]) <= 500, f"{name}: {len(data['labels'])} labels (at most 500)")
        priorities = [label[2] for label in data["labels"]]
        check(priorities == sorted(priorities), f"{name}: labels sorted by priority")
        check(all(0 <= e[0] < count and e[1] >= e[2] > 0 for e in data.get("ellipses", [])), f"{name}: outlines sane")


def dso_checks() -> None:
    dso = load("dso")
    index = check_at(dso, "dso", "M31 Andromeda Galaxy", M31, 0.01)
    outline = next((e for e in dso.get("ellipses", []) if e[0] == index), None)
    check(outline is not None, "dso: M31 has its true outline")
    if outline:
        # RC3: 190' x 60' at position angle 35; OpenNGC (from HyperLEDA): 178' x 70'.
        check(150 < outline[1] < 200 and 55 < outline[2] < 75 and outline[3] == 35, f"dso: M31 outline {outline[1:]} ~ 3 deg x 1 deg at 35 deg")
    check_at(dso, "dso", "M1 Crab Nebula", CRAB, 0.02)
    check_at(dso, "dso", "M87", M87, 0.01)
    check_at(dso, "dso", "M42 Orion Nebula", (83.82, -5.39), 0.05)
    check_at(dso, "dso", "M45 Pleiades", (56.87, 24.11), 0.1)
    check_at(dso, "dso", "M13", (250.423, 36.461), 0.01)
    check_at(dso, "dso", "M57 Ring Nebula", (283.396, 33.029), 0.01)
    check_at(dso, "dso", "M104 Sombrero Galaxy", (189.998, -11.623), 0.01)
    check_at(dso, "dso", "Large Magellanic Cloud", (80.894, -69.756), 0.3)
    check_at(dso, "dso", "Small Magellanic Cloud", (13.187, -72.829), 0.3)
    check_at(dso, "dso", "Omega Centauri", (201.697, -47.480), 0.02)
    check_at(dso, "dso", "Carina Nebula", (161.27, -59.87), 0.3)
    messier = {int(label[1][1:].split()[0]) for label in dso["labels"] if label[1][0] == "M" and label[1][1:2].isdigit()}
    # OpenNGC takes M102 for a second observation of M101.
    check(messier == set(range(1, 111)) - {102}, f"dso: Messier 1-110 all labelled but M102 ({len(messier)} found)")
    kinds = [dso["classes"][c] for c in dso["cls"]]
    check(kinds[find(dso, "M31")] == "galaxy" and kinds[find(dso, "M13")] == "globular", "dso: M31 a galaxy, M13 a globular")
    check(kinds[find(dso, "M57")] == "planetary" and kinds[find(dso, "M45")] == "open", "dso: M57 a planetary nebula, M45 an open cluster")
    check(1000 < len(dso["ra"]) < 2500, f"dso: {len(dso['ra'])} objects")


def xray_checks() -> None:
    hard = load("xray-hard")
    check_at(hard, "xray-hard", "Sco X-1", SCO_X1, 0.02)
    check_at(hard, "xray-hard", "Cyg X-1", CYG_X1, 0.02)
    crab = check_at(hard, "xray-hard", "Crab", CRAB, 0.02)
    check(crab is not None and hard["val"][crab] == max(hard["val"]), "xray-hard: the Crab is the brightest hard X-ray source")
    kinds = [hard["classes"][c] for c in hard["cls"]]
    for text, ref, kind in (
        ("Cen A", (201.365, -43.019), "beamed-agn"),
        ("NGC 4151", (182.636, 39.406), "agn"),
        ("3C 273", QSO_3C273, "beamed-agn"),
        ("Her X-1", (254.458, 35.342), "xrb"),
        ("Vela X-1", (135.529, -40.555), "xrb"),
        ("NGC 1275", (49.951, 41.512), "beamed-agn"),
        ("Coma Cluster", COMA, "cluster"),
        ("Oph Cluster", (258.108, -23.376), "cluster"),
    ):
        index = check_at(hard, "xray-hard", text, ref, 0.1)
        if index is not None:
            check(kinds[index] == kind, f"xray-hard: {text} is classed {kinds[index]} (expected {kind})")

    uhuru = load("xray-uhuru")
    # Uhuru's error boxes are fractions of a degree; HEASARC precessed them from B1950.
    sco = check_at(uhuru, "xray-uhuru", "Sco X-1 (4U 1617-15)", SCO_X1, 0.05)
    check(sco is not None and uhuru["val"][sco] == max(uhuru["val"]), "xray-uhuru: Sco X-1 is the brightest")
    check_at(uhuru, "xray-uhuru", "Cyg X-1 (4U 1956+35)", CYG_X1, 0.05)
    check_at(uhuru, "xray-uhuru", "Tau X-1 (4U 0531+21)", CRAB, 0.05)
    check(len(uhuru["ra"]) == 339, "xray-uhuru: all 339 sources of the 4U catalogue")

    binaries = load("xray-binaries")
    check_at(binaries, "xray-binaries", "Sco X-1", SCO_X1, 0.01)
    check_at(binaries, "xray-binaries", "Cyg X-1", CYG_X1, 0.01)
    check_at(binaries, "xray-binaries", "Cen X-3", (170.313, -60.623), 0.01)
    kinds = [binaries["classes"][c] for c in binaries["cls"]]
    check(kinds[find(binaries, "Sco X-1")] == "lmxb" and kinds[find(binaries, "Cyg X-1")] == "hmxb", "xray-binaries: Sco X-1 low-mass, Cyg X-1 high-mass")
    lats = [abs(icrs_to_galactic(*position(binaries, i))[1]) for i in range(len(binaries["ra"]))]
    check(sum(1 for b in lats if b < 10) > 0.6 * len(lats), "xray-binaries: most lie within 10 deg of the galactic plane")

    meta, rosat = read_cloud("xray-rosat")
    check(18000 < len(rosat) < 19500, f"xray-rosat: {len(rosat)} sources (the catalogue has 18,811)")
    # Sorted brightest first. Sco X-1 itself is too bright for the survey's detector and is not in the catalogue.
    check(min(separation_deg(p[0], p[1], *CRAB) for p in rosat[:5]) < 0.05, "xray-rosat: the Crab is among the 5 brightest")
    check(min(separation_deg(p[0], p[1], 326.172, 38.322) for p in rosat[:5]) < 0.05, "xray-rosat: Cyg X-2 is among the 5 brightest")
    check(min(separation_deg(p[0], p[1], 201.365, -43.019) for p in rosat) < 0.05, "xray-rosat: Centaurus A is there")


def gamma_checks() -> None:
    gamma = load("gamma")
    vela = check_at(gamma, "gamma", "Vela pulsar", VELA_PULSAR, 0.02)
    check(vela is not None and gamma["val"][vela] == max(gamma["val"]), "gamma: the Vela pulsar is the brightest gamma-ray source")
    check_at(gamma, "gamma", "Geminga", (98.476, 17.770), 0.02)
    check_at(gamma, "gamma", "Crab pulsar", CRAB, 0.02)
    check_at(gamma, "gamma", "3C 454.3", (343.491, 16.148), 0.02)
    kinds = [gamma["classes"][c] for c in gamma["cls"]]
    check(kinds[vela] == "pulsar" and kinds[find(gamma, "3C 454.3")] == "blazar", "gamma: Vela a pulsar, 3C 454.3 a blazar")
    check(len(gamma["ra"]) == 7195, "gamma: all 7,195 sources of 4FGL-DR4")
    index, sep = nearest(gamma, QSO_3C273)
    check(sep < 0.05 and kinds[index] == "blazar", "gamma: 3C 273 is there, a blazar")


def pulsar_checks() -> None:
    pulsars = load("pulsars")
    check_at(pulsars, "pulsars", "Crab pulsar", CRAB, 0.005)
    check_at(pulsars, "pulsars", "Vela pulsar", VELA_PULSAR, 0.005)
    check_at(pulsars, "pulsars", "Geminga", (98.476, 17.770), 0.005)
    check_at(pulsars, "pulsars", "PSR B1919+21", (290.437, 21.884), 0.005)
    check_at(pulsars, "pulsars", "Hulse–Taylor pulsar", (288.867, 16.108), 0.005)
    check_at(pulsars, "pulsars", "Double pulsar", (114.463, -30.661), 0.005)
    check_at(pulsars, "pulsars", "SGR 1806−20", (272.164, -20.411), 0.01)
    texts = " | ".join(label[1] for label in pulsars["labels"])
    check(all(name in texts for name in FAMOUS_PULSARS.values()), "pulsars: every famous pulsar was found in the catalogue")
    check("J1748-2446ad · fastest known, 716 Hz" in texts, "pulsars: the fastest is PSR J1748-2446ad at 716 Hz")
    kinds = [pulsars["classes"][c] for c in pulsars["cls"]]
    crab = find(pulsars, "Crab pulsar")
    # The Crab turns every 33.4 ms: log10(33.4) x 100 = 152.
    check(abs(pulsars["val"][crab] - 152) <= 1 and kinds[crab] == "normal", "pulsars: the Crab's period is 33 ms, a young pulsar")
    check(kinds[find(pulsars, "PSR B1937+21")] == "millisecond" and kinds[find(pulsars, "SGR 1806−20")] == "magnetar", "pulsars: B1937+21 millisecond, SGR 1806-20 a magnetar")
    check(len(pulsars["ra"]) > 3500, f"pulsars: {len(pulsars['ra'])} pulsars")


def exoplanet_checks() -> None:
    hosts = load("exoplanets")
    check_at(hosts, "exoplanets", "51 Peg", (344.3666, 20.7688), 0.01)
    trappist = check_at(hosts, "exoplanets", "TRAPPIST-1", (346.622, -5.041), 0.02)
    check(trappist is not None and hosts["val"][trappist] == 7, "exoplanets: TRAPPIST-1 has 7 planets")
    check_at(hosts, "exoplanets", "Proxima Cen", (217.429, -62.680), 0.05)
    check_at(hosts, "exoplanets", "Kepler-186", (298.653, 43.955), 0.01)
    check_at(hosts, "exoplanets", "HD 209458", (330.795, 18.884), 0.01)
    check_at(hosts, "exoplanets", "τ Cet", (26.017, -15.937), 0.02)
    check_at(hosts, "exoplanets", "55 Cnc", (133.149, 28.331), 0.02)
    kepler = find(hosts, "Kepler-90")
    check(kepler is not None and hosts["val"][kepler] == 8, "exoplanets: Kepler-90 has 8 planets")
    count = len(hosts["ra"])
    in_field = sum(1 for i in range(count) if separation_deg(*position(hosts, i), *KEPLER_FIELD) < 8)
    # Kepler stared at 0.25% of the sky (a circle of 8 deg is 0.5%) and found a third of all hosts there.
    check(in_field > 0.25 * count, f"exoplanets: the Kepler field holds {in_field} of {count} hosts")
    check(4000 < count < 8000, f"exoplanets: {count} host stars")


def ecliptic_latitude_deg(ra: float, dec: float) -> float:
    obliquity = math.radians(23.4393)
    ra_r, dec_r = math.radians(ra), math.radians(dec)
    return math.degrees(math.asin(math.sin(dec_r) * math.cos(obliquity) - math.cos(dec_r) * math.sin(obliquity) * math.sin(ra_r)))


def candidate_checks() -> None:
    """Where each mission looked is known independently of the archive: the check is that its candidates are there."""
    data = load("exoplanet-candidates")
    count = len(data["ra"])
    by_class = {name: [i for i in range(count) if data["cls"][i] == k] for k, name in enumerate(data["classes"])}
    check(sorted(by_class) == ["k2", "kepler", "tess"], "candidates: one class per mission")
    planets = {name: sum(data["val"][i] for i in idx) for name, idx in by_class.items()}
    # The archive's counts on 2026-11-11: TOIs PC 4,813 + APC 494, Kepler CANDIDATE 1,977, K2 CANDIDATE 975.
    check(4500 < planets["tess"] < 6500, f"candidates: {planets['tess']} TESS candidates")
    check(1500 < planets["kepler"] < 2500, f"candidates: {planets['kepler']} Kepler candidates")
    check(700 < planets["k2"] < 1300, f"candidates: {planets['k2']} K2 candidates")
    check(all(v >= 1 for v in data["val"]), "candidates: every marker holds at least one")
    # Kepler stared at one patch of Cygnus and Lyra for four years: a circle of 8 deg about its centre holds it all.
    kepler_out = [i for i in by_class["kepler"] if separation_deg(*position(data, i), *KEPLER_FIELD) > 8]
    check(not kepler_out, f"candidates: every Kepler candidate in the Kepler field ({len(kepler_out)} outside)")
    # K2 pointed along the ecliptic, its reaction wheels' only stable direction.
    k2_lat = [abs(ecliptic_latitude_deg(*position(data, i))) for i in by_class["k2"]]
    check(max(k2_lat) < 15, f"candidates: every K2 candidate within 15 deg of the ecliptic (max {max(k2_lat):.1f})")
    # TESS covers nearly the whole sky, north and south.
    north = sum(1 for i in by_class["tess"] if position(data, i)[1] > 0)
    check(0.3 < north / len(by_class["tess"]) < 0.7, f"candidates: TESS candidates in both hemispheres ({north} of {len(by_class['tess'])} north)")


def nearby_checks() -> None:
    nearby = load("nearby")
    proxima = check_at(nearby, "nearby", "Proxima Cen", (217.39, -62.67), 0.02)
    check(proxima == 0 and abs(nearby["val"][0] - 425) <= 1, "nearby: Proxima is the nearest, at 4.25 light-years")
    check(find(nearby, "α Cen A · 4.4 ly") is not None, "nearby: α Centauri A at 4.4 light-years")
    # SIMBAD: J2000 (269.452075, +4.693391), moving (-802.8, +10362.5) mas/yr -> 2026.0 (269.44626, +4.76823).
    check_at(nearby, "nearby", "Barnard's Star · 6.0 ly", (269.44626, 4.76823), 0.001)
    # SIMBAD: J2000 (101.287155, -16.716116), moving (-546.01, -1223.07) mas/yr -> 2026.0 (101.28304, -16.72495).
    check_at(nearby, "nearby", "Sirius A · 8.6 ly", (101.28304, -16.72495), 0.001)
    check(find(nearby, "Lalande 21185 · 8.3 ly") is not None, "nearby: Lalande 21185 at 8.3 light-years")
    check(find(nearby, "Wolf 359 · 7.9 ly") is not None, "nearby: Wolf 359 at 7.9 light-years")
    check(find(nearby, "τ Cet · 11.9 ly") is not None, "nearby: τ Ceti at 11.9 light-years")
    check(find(nearby, "Vega · 25.0 ly") is not None, "nearby: Vega at 25 light-years")
    inside = sum(1 for v in nearby["val"] if v <= 3262)
    check(inside > 0.95 * len(nearby["val"]) and max(nearby["val"]) < 4000, "nearby: all within 10 parsecs (32.6 light-years) or a parallax error of it")
    check(400 < len(nearby["ra"]) < 600, f"nearby: {len(nearby['ra'])} stars and brown dwarfs")


def galaxy_checks() -> None:
    galaxies = load("galaxies")
    m31 = check_at(galaxies, "galaxies", "M31 · ", M31, 0.01)
    check(m31 is not None and 70 <= galaxies["val"][m31] <= 82, "galaxies: M31 at 0.7-0.8 Mpc")
    check_at(galaxies, "galaxies", "LMC", (80.894, -69.756), 0.3)
    check_at(galaxies, "galaxies", "M33", (23.462, 30.660), 0.01)
    m81 = check_at(galaxies, "galaxies", "M81", (148.888, 69.065), 0.01)
    check(m81 is not None and 340 <= galaxies["val"][m81] <= 380, "galaxies: M81 at 3.6 Mpc")
    check_at(galaxies, "galaxies", "NGC 5128", (201.365, -43.019), 0.01)
    kinds = [galaxies["classes"][c] for c in galaxies["cls"]]
    check(kinds[m31] == "local-group" and kinds[m81] == "nearby", "galaxies: M31 in the Local Group, M81 beyond it")

    clusters = load("clusters")
    coma = check_at(clusters, "clusters", "Coma cluster", COMA, 0.02)
    check(coma is not None and clusters["classes"][clusters["cls"][coma]] == "rich-2", "clusters: Coma is richness class 2")
    check_at(clusters, "clusters", "Perseus cluster", (49.951, 41.512), 0.3)
    check_at(clusters, "clusters", "Hercules cluster", (241.149, 17.722), 0.3)
    check_at(clusters, "clusters", "Fornax cluster", (54.62, -35.45), 0.5)
    check_at(clusters, "clusters", "Virgo cluster", M87, 1.0)
    texts = " | ".join(label[1] for label in clusters["labels"])
    check(all(name in texts for name in FAMOUS_CLUSTERS.values()), "clusters: every named cluster was found in the catalogue")
    # The catalogue was published in B1950. Precessing its own B1950 columns must give HEASARC's J2000 ones.
    rows = heasarc_rows("abell", ["name", "ra", "dec", "ra_1950", "dec_1950", "rich", "dist", "redshift"])
    # FK4 B1950 -> FK5 J2000 as astropy 7 computes it (SkyCoord(..., frame=FK4(equinox="B1950")).transform_to(FK5)).
    for b1950, j2000 in (
        ((194.35, 28.25), (194.95304984615575, 27.980699176014404)),
        ((82.875007, -29.016666), (83.36236149390271, -28.98328786789269)),
    ):
        sep = separation_deg(*b1950_to_j2000(*b1950), *j2000) * 3600
        check(sep < 0.01, f"clusters: B1950 {b1950} precesses to J2000 as in astropy ({sep:.5f} arcsec)")
    # HEASARC's own J2000 columns are Abell's printed ones: right ascension rounded to 0.1 min, declination cut
    # (not rounded) to the arcminute. So the two agree in right ascension on average, and within a rounding step each.
    d_ra, worst = 0.0, 0.0
    for r in rows:
        ra, dec = b1950_to_j2000(float(r["ra_1950"]), float(r["dec_1950"]))
        d_ra += ((ra - float(r["ra"]) + 180) % 360 - 180) * math.cos(math.radians(dec)) * 3600 / len(rows)
        worst = max(worst, separation_deg(ra, dec, float(r["ra"]), float(r["dec"])) * 3600)
    check(
        abs(d_ra) < 2 and worst < 100,
        f"clusters: precessed B1950 agrees with HEASARC's J2000 over {len(rows)} clusters "
        f"(mean in right ascension {d_ra:+.2f} arcsec; worst {worst:.0f} arcsec, the printed rounding)",
    )
    lats = [abs(icrs_to_galactic(*position(clusters, i))[1]) for i in range(len(clusters["ra"]))]
    check(sum(1 for b in lats if b < 15) < 0.03 * len(lats), "clusters: almost none within 15 deg of the galactic plane (hidden by dust)")

    quasars = load("quasars")
    check_at(quasars, "quasars", "3C 273 · z 0.158", QSO_3C273, 0.01)
    check_at(quasars, "quasars", "M87", M87, 0.01)
    check_at(quasars, "quasars", "BL Lacertae", (330.680, 42.278), 0.01)
    check_at(quasars, "quasars", "Markarian 421", (166.114, 38.209), 0.01)
    check_at(quasars, "quasars", "Cygnus A", (299.868, 40.734), 0.01)
    check(200 < len(quasars["ra"]) < 1500, f"quasars: {len(quasars['ra'])} objects")


def lss_checks() -> None:
    meta, points = read_cloud("lss")
    check(42000 < len(points) < 45000, f"lss: {len(points)} galaxies with redshifts (2MRS has 43,533)")
    lats = [abs(icrs_to_galactic(ra, dec)[1]) for ra, dec, _ in points]
    # |b| < 5 deg is 8.7% of the sky; the survey leaves it out.
    check(sum(1 for b in lats if b < 5) < 0.002 * len(points), "lss: the Zone of Avoidance along the Milky Way is empty")
    near = [(ra, dec) for ra, dec, cz in points if cz < 3000]
    in_plane = sum(1 for ra, dec in near if abs(90 - separation_deg(ra, dec, *SUPERGALACTIC_POLE)) < 20)
    # A band of +-20 deg is 34% of the sky.
    check(in_plane > 0.45 * len(near), f"lss: nearby galaxies hug the supergalactic plane ({in_plane / len(near):.0%} within 20 deg)")
    virgo = sum(1 for ra, dec in near if separation_deg(ra, dec, *M87) < 6)
    opposite = sum(1 for ra, dec in near if separation_deg(ra, dec, (M87[0] + 180) % 360, -M87[1]) < 6)
    check(virgo > 150 and virgo > 10 * max(opposite, 1), f"lss: the Virgo cluster stands out ({virgo} galaxies within 6 deg, {opposite} opposite)")
    coma = sum(1 for ra, dec, cz in points if 6000 < cz < 8000 and separation_deg(ra, dec, *COMA) < 3)
    check(coma > 50, f"lss: the Coma cluster at cz 7,000 km/s ({coma} galaxies within 3 deg)")
    pisces = sum(1 for ra, dec, cz in points if 4000 < cz < 6500 and separation_deg(ra, dec, 49.95, 41.51) < 4)
    check(pisces > 60, f"lss: the Perseus cluster in the Perseus-Pisces chain ({pisces} galaxies within 4 deg)")


def cluster_remnant_checks() -> None:
    globulars = load("globulars")
    check_at(globulars, "globulars", "ω Centauri", (201.697, -47.480), 0.01)
    check_at(globulars, "globulars", "47 Tuc", (6.024, -72.081), 0.01)
    check_at(globulars, "globulars", "M13", (250.423, 36.461), 0.01)
    check(len(globulars["ra"]) == 157, "globulars: all 157 clusters of the 2010 edition")
    near_centre = sum(1 for i in range(157) if separation_deg(*position(globulars, i), *SGR_A) < 30)
    # A cap of 30 deg is 6.7% of the sky.
    check(near_centre > 70, f"globulars: {near_centre} of 157 within 30 deg of the Galactic centre (Shapley's argument)")

    snr = load("snr")
    cas_a = check_at(snr, "snr", "Cassiopeia A", (350.85, 58.815), 0.05)
    check(cas_a is not None and snr["val"][cas_a] == max(snr["val"]), "snr: Cassiopeia A is the brightest at 1 GHz")
    check_at(snr, "snr", "Crab Nebula", CRAB, 0.05)
    check_at(snr, "snr", "Tycho", (6.33, 64.14), 0.05)
    vela = check_at(snr, "snr", "Vela", (128.5, -45.83), 0.05)
    outline = next((e for e in snr["ellipses"] if e[0] == vela), None)
    check(outline is not None and outline[1] == 255, "snr: the Vela remnant is 255 arcmin across")
    lats = [abs(icrs_to_galactic(*position(snr, i))[1]) for i in range(len(snr["ra"]))]
    check(sum(1 for b in lats if b < 5) > 0.9 * len(lats), "snr: nine in ten lie within 5 deg of the galactic plane")


def landmark_checks() -> None:
    marks = load("landmarks")
    check_at(marks, "landmarks", "Sgr A*", SGR_A, 0.002)
    check_at(marks, "landmarks", "M87*", M87, 0.002)
    check_at(marks, "landmarks", "Cygnus X-1", CYG_X1, 0.002)
    check_at(marks, "landmarks", "SN 1987A", (83.867, -69.270), 0.005)
    check_at(marks, "landmarks", "TXS 0506+056", (77.358, 5.693), 0.005)
    # (l, b) = (264.02, +48.25) is in Crater, near the Leo border: J2000 11h12m, -7.0 deg.
    dipole = check_at(marks, "landmarks", "CMB dipole · we move", (167.99, -6.94), 0.2)
    if dipole is not None:
        lon, lat = icrs_to_galactic(*position(marks, dipole))
        check(abs(lon - 264.021) < 0.01 and abs(lat - 48.253) < 0.01, f"landmarks: CMB dipole at galactic ({lon:.2f}, {lat:.2f})")
    apex = find(marks, "Solar apex")
    lon, lat = icrs_to_galactic(*position(marks, apex))
    # atan2(12.24, 11.1) = 47.8 deg; atan2(7.25, hypot(11.1, 12.24)) = 23.7 deg.
    check(abs(lon - 47.8) < 0.1 and abs(lat - 23.7) < 0.1, f"landmarks: solar apex at galactic ({lon:.1f}, {lat:.1f})")
    check(separation_deg(*position(marks, apex), 279.23, 38.78) < 25, "landmarks: the solar apex is in the Hercules-Lyra region, not far from Vega")
    # Voyager 1 left the planets northward, toward Ophiuchus; Voyager 2 southward, toward Pavo/Telescopium.
    check_at(marks, "landmarks", "Voyager 1", (258.0, 12.0), 5.0)
    check_at(marks, "landmarks", "Voyager 2", (301.0, -59.0), 6.0)


def main() -> None:
    structure_checks()
    dso_checks()
    xray_checks()
    gamma_checks()
    pulsar_checks()
    exoplanet_checks()
    candidate_checks()
    nearby_checks()
    galaxy_checks()
    lss_checks()
    cluster_remnant_checks()
    landmark_checks()
    total = sum(path.stat().st_size for path in OUTPUT_DIR.iterdir())
    check(total < 1.5e6, f"all catalogues together: {total / 1e6:.2f} MB")
    finish()


if __name__ == "__main__":
    main()
