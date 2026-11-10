#!/usr/bin/env python3
"""
Data checks for the baked Sun snapshot - and, through it, for the image
geometry in app/src/layers/sun/products.ts, which nothing else can check:
how many arcseconds a pixel of each product spans, where the Sun's centre
is in the frame, and which way is up.

Nothing here trusts a product's documentation. The frames are measured:

- Coronagraphs (LASCO C3, CCOR-1) record the stars behind the Sun. The
  stars of app/public/sky/stars.json are matched to the frame's star
  images and a plate solution (scale, roll, centre) is fitted. The Sun's
  place among the stars and the position angle of its axis at the frame's
  time come from JPL Horizons.
- The disc imager (HMI) is measured by fitting its limb, and its
  orientation by looking for sunspots where NOAA's active-region list
  (heliographic coordinates, turned to pixels with Horizons' B0, L0) says
  the big groups are.
- LASCO's drawn limb circle is fitted for the Sun's centre and size.

The constants below repeat products.ts: change both together.

Usage:
    python3 tools/pipeline/test_sun_snapshot.py
Needs numpy and pillow.
"""

import json
import math
import urllib.parse

import numpy as np
from PIL import Image, ImageFilter

from fetch_cache import cached_fetch
from generate_sun_snapshot import OUTPUT_DIR, PRODUCTS, REPO_ROOT, parse_time
from geo_test_support import check, finish

HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
STARS = REPO_ROOT / "app" / "public" / "sky" / "stars.json"

# products.ts: centre (px at reference width), reference width, arcsec per px, distance factor.
GEOMETRY = {
    "hmi": {"centre": (255.5, 255.4), "width": 512, "scale": 4.075, "factor": 1.0},
    "lasco-c2": {"centre": (256.0, 259.1), "width": 512, "scale": 23.8, "factor": 0.99},
    "lasco-c3": {"centre": (258.5, 246.2), "width": 512, "scale": 112.58, "factor": 0.99},
    "ccor1": {"centre": (593.3, 593.5), "width": 1204, "scale": 39.97, "factor": 1.0},
}
# The J2000 ecliptic's north pole, equatorial coordinates.
OBLIQUITY = math.radians(23.4392911)


def horizons_sun(times: list[str]) -> list[dict[str, float]]:
    """Geocentric astrometric RA/Dec, angular diameter, B0, L0 and P of the Sun at each ISO time."""
    def jd(iso: str) -> float:
        return parse_time(iso).timestamp() / 86400 + 2440587.5

    params = {
        "format": "text",
        "COMMAND": "'10'",
        "CENTER": "'500@399'",
        "EPHEM_TYPE": "'OBSERVER'",
        "TLIST": " ".join(f"'{jd(t):.6f}'" for t in times),
        "QUANTITIES": "'1,13,14,17'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "OBJ_DATA": "'NO'",
    }
    name = "horizons/sun-snapshot-" + "-".join(t.replace(":", "") for t in times) + ".txt"
    lines = cached_fetch(f"{HORIZONS}?{urllib.parse.urlencode(params)}", name).read_text().splitlines()
    start, end = lines.index("$$SOE"), lines.index("$$EOE")
    header = [cell.strip() for cell in lines[start - 2].split(",")]
    rows = []
    for line in lines[start + 1 : end]:
        cells = dict(zip(header, (cell.strip() for cell in line.split(","))))
        rows.append(
            {
                "ra": float(cells["R.A._(ICRF)"]),
                "dec": float(cells["DEC_(ICRF)"]),
                "radius": float(cells["Ang-diam"]) / 2,
                "b0": float(cells["ObsSub-LAT"]),
                "l0": float(cells["ObsSub-LON"]),
                "p": float(cells["NP.ang"]),
            }
        )
    return rows


def fit_circle(xs: np.ndarray, ys: np.ndarray) -> tuple[float, float, float]:
    a = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]
    cx, cy, c = np.linalg.lstsq(a, xs**2 + ys**2, rcond=None)[0]
    return float(cx), float(cy), float(math.sqrt(c + cx * cx + cy * cy))


def drawn_circle(image: Image.Image, near: tuple[float, float], within: float) -> tuple[float, float, float]:
    """The white limb circle the LASCO products draw inside the occulter."""
    rgb = np.asarray(image).astype(int)
    ys, xs = np.nonzero(rgb.min(axis=2) > 190)
    keep = np.hypot(xs - near[0], ys - near[1]) < within
    return fit_circle(xs[keep].astype(float), ys[keep].astype(float))


def limb(image: Image.Image, guess: tuple[float, float], radius: float, max_y: float) -> tuple[float, float, float]:
    """Centre and radius of a bright disc: the steepest fall of brightness along 720 rays."""
    grey = np.asarray(image.convert("L")).astype(float)
    rr = np.arange(radius * 0.9, radius * 1.1, 0.25)
    points = []
    for angle in np.linspace(0, 2 * np.pi, 720, endpoint=False):
        x = guess[0] + rr * np.cos(angle)
        y = guess[1] + rr * np.sin(angle)
        # The timestamp is written across the bottom of the frame.
        if y.max() > max_y or x.min() < 0 or y.min() < 0 or x.max() >= grey.shape[1] - 1:
            continue
        x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
        fx, fy = x - x0, y - y0
        profile = (
            grey[y0, x0] * (1 - fx) * (1 - fy)
            + grey[y0, x0 + 1] * fx * (1 - fy)
            + grey[y0 + 1, x0] * (1 - fx) * fy
            + grey[y0 + 1, x0 + 1] * fx * fy
        )
        # The limb is the steepest fall. (Half the inner level would land inside it: the disc darkens to its edge.)
        smooth = np.convolve(profile, np.ones(4) / 4, mode="valid")
        slope = np.diff(smooth)
        j = int(np.argmin(slope))
        if j == 0 or j == len(slope) - 1:
            continue
        # Parabola through the three slopes about the minimum, for a fraction of a step.
        denominator = slope[j - 1] - 2 * slope[j] + slope[j + 1]
        shift = 0.5 * (slope[j - 1] - slope[j + 1]) / denominator if denominator != 0 else 0.0
        # slope[j] lies between smooth[j] and smooth[j+1], each the mean of four samples from that index.
        r_edge = rr[0] + (j + shift + 2.0) * 0.25
        points.append((guess[0] + r_edge * np.cos(angle), guess[1] + r_edge * np.sin(angle)))
    p = np.array(points)
    cx, cy, r = fit_circle(p[:, 0], p[:, 1])
    good = np.abs(np.hypot(p[:, 0] - cx, p[:, 1] - cy) - r) < 1.5
    return fit_circle(p[good, 0], p[good, 1])


def star_peaks(image: Image.Image, centre: tuple[float, float], r_min: float, r_max: float) -> np.ndarray:
    """Centroids of the point-like peaks in an annulus about `centre`."""
    grey_image = image.convert("L")
    grey = np.asarray(grey_image).astype(float)
    high = grey - np.asarray(grey_image.filter(ImageFilter.GaussianBlur(5))).astype(float)
    ys, xs = np.mgrid[0 : grey.shape[0], 0 : grey.shape[1]]
    r = np.hypot(xs - centre[0], ys - centre[1])
    high[(r < r_min) | (r > r_max)] = 0
    work = high.copy()
    wy, wx = np.mgrid[-2:3, -2:3]
    peaks = []
    for _ in range(400):
        y, x = divmod(int(np.argmax(work)), grey.shape[1])
        if work[y, x] < 25:
            break
        window = high[y - 2 : y + 3, x - 2 : x + 3].clip(0)
        if window.shape == (5, 5) and window.sum() > 0:
            peaks.append((x + (window * wx).sum() / window.sum(), y + (window * wy).sum() / window.sum()))
        work[max(0, y - 5) : y + 6, max(0, x - 5) : x + 6] = 0
    return np.array(peaks)


def catalogue_offsets(sun: dict[str, float]) -> np.ndarray:
    """Catalogue stars within 12 degrees of the Sun: arcseconds east and north of it, along the SOLAR axis."""
    stars = json.loads(STARS.read_text())
    q = stars["quantumPerDegree"]
    ra0, dec0, p = math.radians(sun["ra"]), math.radians(sun["dec"]), math.radians(sun["p"])
    out = []
    for ra_q, dec_q in zip(stars["ra"], stars["dec"]):
        ra, dec = math.radians(ra_q / q), math.radians(dec_q / q)
        cos_c = math.sin(dec0) * math.sin(dec) + math.cos(dec0) * math.cos(dec) * math.cos(ra - ra0)
        if cos_c < math.cos(math.radians(12)):
            continue
        xi = math.degrees(math.cos(dec) * math.sin(ra - ra0) / cos_c) * 3600
        eta = math.degrees((math.cos(dec0) * math.sin(dec) - math.sin(dec0) * math.cos(dec) * math.cos(ra - ra0)) / cos_c) * 3600
        out.append((-eta * math.sin(p) + xi * math.cos(p), eta * math.cos(p) + xi * math.sin(p)))
    return np.array(out)


def plate_solution(peaks: np.ndarray, cat: np.ndarray, centre: tuple[float, float], scale: float, roll: float) -> dict:
    """
    Fit x = ox - (e cos a - n sin a)/s, y = oy - (n cos a + e sin a)/s to matched stars:
    s arcsec per pixel, a the roll of the frame's top from solar north toward east, (ox, oy) where the
    geocentric Sun falls among the frame's stars.
    """
    ox, oy = centre
    matches = 0
    rms = math.inf
    for iteration in range(6):
        a = math.radians(roll)
        px = ox - (cat[:, 0] * math.cos(a) - cat[:, 1] * math.sin(a)) / scale
        py = oy - (cat[:, 1] * math.cos(a) + cat[:, 0] * math.sin(a)) / scale
        tolerance = 6 if iteration < 2 else 2.5
        pairs = []
        for i in range(len(cat)):
            d = np.hypot(peaks[:, 0] - px[i], peaks[:, 1] - py[i])
            j = int(np.argmin(d))
            if d[j] < tolerance:
                pairs.append((i, j))
        if len(pairs) < 6:
            break
        rows, rhs = [], []
        for i, j in pairs:
            e, n = cat[i]
            rows += [[-e, n, 1, 0], [-n, -e, 0, 1]]
            rhs += [peaks[j, 0], peaks[j, 1]]
        ca, sa, ox, oy = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)[0]
        scale = 1 / math.hypot(ca, sa)
        roll = math.degrees(math.atan2(sa, ca))
        residuals = [math.hypot(ox - ca * cat[i, 0] + sa * cat[i, 1] - peaks[j, 0], oy - ca * cat[i, 1] - sa * cat[i, 0] - peaks[j, 1]) for i, j in pairs]
        matches, rms = len(pairs), float(np.sqrt(np.mean(np.square(residuals))))
    return {"scale": scale, "roll": roll, "centre": (ox, oy), "matches": matches, "rms": rms}


def ecliptic_roll(sun: dict[str, float]) -> float:
    """Position angle of ecliptic north at the Sun, minus that of the Sun's own north: the roll of a frame flown ecliptic-north-up."""
    ra, dec = math.radians(sun["ra"]), math.radians(sun["dec"])
    pole = (0.0, -math.sin(OBLIQUITY), math.cos(OBLIQUITY))
    east = (-math.sin(ra), math.cos(ra), 0.0)
    north = (-math.sin(dec) * math.cos(ra), -math.sin(dec) * math.sin(ra), math.cos(dec))
    angle = math.degrees(math.atan2(sum(p * e for p, e in zip(pole, east)), sum(p * n for p, n in zip(pole, north))))
    return (angle - sun["p"] + 180) % 360 - 180


def main() -> None:
    manifest = json.loads((OUTPUT_DIR / "snapshot.json").read_text())
    check(set(manifest["frames"]) == set(PRODUCTS), "a frame for every product")
    total = sum(path.stat().st_size for path in OUTPUT_DIR.iterdir())
    check(total < 500 * 1024, f"snapshot is {total / 1024:.0f} KB, under 500 KB")
    order = ["hmi", "lasco-c2", "lasco-c3", "ccor1"]
    suns = dict(zip(order, horizons_sun([manifest["frames"][product]["time"] for product in order])))
    images = {product: Image.open(OUTPUT_DIR / f"{product}.jpg").convert("RGB") for product in PRODUCTS}

    def radius_px(product: str) -> float:
        g = GEOMETRY[product]
        return suns[product]["radius"] / g["factor"] / g["scale"]

    # HMI: the limb.
    g = GEOMETRY["hmi"]
    cx, cy, r = limb(images["hmi"], g["centre"], radius_px("hmi"), 480)
    check(abs(r - radius_px("hmi")) < 1.0, f"HMI limb radius {r:.2f} px, {radius_px('hmi'):.2f} expected from {g['scale']} arcsec/px")
    check(math.hypot(cx - g["centre"][0], cy - g["centre"][1]) < 1.5, f"HMI disc centre {cx:.1f}, {cy:.1f}")

    # HMI: orientation and the active-region placement, by the spots themselves.
    sun = suns["hmi"]
    grey = np.asarray(images["hmi"].convert("L")).astype(float)
    smooth = np.asarray(images["hmi"].convert("L").filter(ImageFilter.GaussianBlur(12))).astype(float)
    b0, p_hmi = math.radians(sun["b0"]), 0.0
    spotted = [row for row in manifest["regions"] if (row.get("area") or 0) >= 100]
    check(len(spotted) >= 1, f"{len(spotted)} active region(s) with spots of 100 millionths or more to test with")
    # Regions are reported for the end of their UT day; the frame is minutes from it, so no rotation is applied.
    def spot_depth(lat_deg: float, lon_deg: float) -> tuple[float, float, float]:
        lat, dlon = math.radians(lat_deg), math.radians(lon_deg - sun["l0"])
        west = math.cos(lat) * math.sin(dlon)
        north = math.sin(lat) * math.cos(b0) - math.cos(lat) * math.cos(dlon) * math.sin(b0)
        x = g["centre"][0] + (west * math.cos(p_hmi) - north * math.sin(p_hmi)) * r
        y = g["centre"][1] - (north * math.cos(p_hmi) + west * math.sin(p_hmi)) * r
        half = max(6, round(r * math.sin(math.radians(3))))
        xi, yi = round(x), round(y)
        patch = (grey - smooth)[yi - half : yi + half + 1, xi - half : xi + half + 1]
        return float(patch.min()), x, y

    for row in spotted:
        depth, x, y = spot_depth(row["latitude"], row["carrington_longitude"])
        check(depth < -25, f"AR {row['region']} ({row['location']}, area {row['area']}): a dark spot at its place {x:.0f}, {y:.0f} (darkest {depth:.0f})")
        mirrored, _, _ = spot_depth(row["latitude"], 2 * sun["l0"] - row["carrington_longitude"])
        flipped, _, _ = spot_depth(-row["latitude"], row["carrington_longitude"])
        check(mirrored > -25 or flipped > -25, f"AR {row['region']}: and not at its east-west or north-south mirror ({mirrored:.0f}, {flipped:.0f})")

    # LASCO: the drawn limb circles.
    for product, within in (("lasco-c2", 60), ("lasco-c3", 14)):
        g = GEOMETRY[product]
        cx, cy, r = drawn_circle(images[product], g["centre"], within)
        check(math.hypot(cx - g["centre"][0], cy - g["centre"][1]) < 1.0, f"{product}: limb circle centred {cx:.1f}, {cy:.1f}")
        check(abs(r - radius_px(product)) < 0.6, f"{product}: limb circle radius {r:.2f} px, {radius_px(product):.2f} expected")

    # Coronagraphs: plate solutions against the stars.
    for product, r_min, r_max, up in (("lasco-c3", 40, 245, "ecliptic"), ("ccor1", 110, 520, "solar")):
        g = GEOMETRY[product]
        sun = suns[product]
        expected_roll = ecliptic_roll(sun) if up == "ecliptic" else 0.0
        fit = plate_solution(star_peaks(images[product], g["centre"], r_min, r_max), catalogue_offsets(sun), g["centre"], g["scale"], expected_roll)
        check(fit["matches"] >= 12 and fit["rms"] < 1.5, f"{product}: {fit['matches']} catalogue stars matched, residual {fit['rms']:.2f} px")
        check(abs(fit["scale"] / g["scale"] - 1) < 0.01, f"{product}: {fit['scale']:.2f} arcsec/px by the stars ({g['scale']} in products.ts)")
        check(
            abs(fit["roll"] - expected_roll) < 0.5,
            f"{product}: top of frame {fit['roll']:+.2f} deg from solar north; {up} north up predicts {expected_roll:+.2f}",
        )
        # Where the geocentric Sun falls among the frame's stars, against the centre in use. They differ by the
        # spacecraft's parallax: under 2 px for GOES, up to 9 px for SOHO on its halo orbit about L1.
        offset = math.hypot(fit["centre"][0] - g["centre"][0], fit["centre"][1] - g["centre"][1])
        limit = 2.5 if product == "ccor1" else 9.5
        check(offset < limit, f"{product}: Sun among the stars at {fit['centre'][0]:.1f}, {fit['centre'][1]:.1f}, {offset:.1f} px from the centre in use")

    # SUVI: the bright disc fills the expected circle (its EUV limb is too ragged to fit closely).
    for product in ("suvi-171", "suvi-195", "suvi-304"):
        image = images[product].convert("L")
        grey = np.asarray(image).astype(float)
        size = grey.shape[1]
        radius = suns["ccor1"]["radius"] / 2.5 * size / 1280
        ys, xs = np.mgrid[0:size, 0:size]
        rr = np.hypot(xs - size / 2, ys - size / 2)
        inside = grey[rr < radius * 0.9].mean()
        outside = grey[(rr > radius * 1.25) & (rr < radius * 1.45)].mean()
        check(inside > 3 * outside + 10, f"{product}: disc (mean {inside:.0f}) inside the 2.5 arcsec/px circle, sky ({outside:.0f}) outside")

    weather = manifest["spaceWeather"]
    check(isinstance(weather["xrayClass"], str) and weather["xrayClass"][0] in "ABCMX", f"X-ray class {weather['xrayClass']}")
    check(50 < weather["f107"] < 400, f"10.7 cm flux {weather['f107']} sfu")
    check(200 < weather["windKmS"] < 1200, f"solar wind {weather['windKmS']} km/s")
    check(0 <= weather["sunspotNumber"] < 500, f"sunspot number {weather['sunspotNumber']} ({weather['sunspotDate']})")

    finish()


if __name__ == "__main__":
    main()
