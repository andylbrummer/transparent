/**
 * The Earth's main magnetic field from the World Magnetic Model (WMM2025):
 * declination for the compass, and the whole field vector at any point
 * outside the core for drawing the field in space.
 *
 * Phone compasses report magnetic north: iOS fills webkitCompassHeading
 * from CLHeading.magneticHeading, and Chrome's absolute orientation comes
 * from Android's rotation-vector sensor, which references magnetic north.
 * Pointing at real places needs true north, so headings are corrected by
 * the declination at the user's GPS fix:
 *
 *     true heading = magnetic heading + declination
 *
 * Declination is east-positive, in degrees. Implements the spherical
 * harmonic synthesis of the WMM2025 technical report (degree 12) in
 * geocentric coordinates, rotated back to the geodetic frame.
 */

import { WMM2025_COEFFICIENTS, WMM2025_EPOCH } from './wmm2025';

/** WMM2025 is valid for five years from its epoch. */
export const WMM_VALID_FROM = WMM2025_EPOCH;
export const WMM_VALID_UNTIL = WMM2025_EPOCH + 5;

const MAX_DEGREE = 12;
/** Geomagnetic reference radius, km. */
const REFERENCE_RADIUS_KM = 6371.2;
/** WGS84 semi-major axis, km, and first eccentricity squared. */
const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;

// Coefficients laid out by n*(MAX_DEGREE+1)+m, so synthesis indexes directly.
const STRIDE = MAX_DEGREE + 1;
const G = new Float64Array(STRIDE * STRIDE);
const H = new Float64Array(STRIDE * STRIDE);
const G_DOT = new Float64Array(STRIDE * STRIDE);
const H_DOT = new Float64Array(STRIDE * STRIDE);
for (const [n, m, g, h, gDot, hDot] of WMM2025_COEFFICIENTS) {
  G[n * STRIDE + m] = g;
  H[n * STRIDE + m] = h;
  G_DOT[n * STRIDE + m] = gDot;
  H_DOT[n * STRIDE + m] = hDot;
}

// Schmidt semi-normalized Legendre recurrence factors, fixed per (n, m).
const SECTORAL = new Float64Array(STRIDE); // P(n,n) from P(n-1,n-1)
const RECUR_A = new Float64Array(STRIDE * STRIDE); // weight on P(n-1,m)
const RECUR_B = new Float64Array(STRIDE * STRIDE); // weight on P(n-2,m)
for (let n = 2; n <= MAX_DEGREE; n++) SECTORAL[n] = Math.sqrt((2 * n - 1) / (2 * n));
for (let n = 1; n <= MAX_DEGREE; n++) {
  for (let m = 0; m < n; m++) {
    const norm = Math.sqrt(n * n - m * m);
    RECUR_A[n * STRIDE + m] = (2 * n - 1) / norm;
    RECUR_B[n * STRIDE + m] = Math.sqrt((n - 1) * (n - 1) - m * m) / norm;
  }
}

// Synthesis scratch: the function runs per GPS fix and never allocates.
const P = new Float64Array(STRIDE * STRIDE);
const DP = new Float64Array(STRIDE * STRIDE);
const COS_M = new Float64Array(STRIDE);
const SIN_M = new Float64Array(STRIDE);

/** Decimal year of a UTC instant, as the model's time argument. */
export function decimalYear(utc: Date): number {
  const year = utc.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return year + (utc.getTime() - start) / (end - start);
}

function checkYear(year: number): number {
  if (!(year >= WMM_VALID_FROM && year <= WMM_VALID_UNTIL)) {
    throw new RangeError(`WMM2025 covers ${WMM_VALID_FROM}-${WMM_VALID_UNTIL}; got ${year}`);
  }
  return year - WMM2025_EPOCH;
}

// Field components in the geocentric frame, written by synthesize(): north, east, down (nT).
const NED = new Float64Array(3);

/**
 * Spherical harmonic synthesis at geocentric radius `r` km, geocentric
 * latitude with sine `t` and cosine `u`, longitude `lon` radians, `dt`
 * years after the epoch. Writes NED.
 */
function synthesize(r: number, t: number, u: number, lon: number, dt: number): void {
  // Legendre functions P(n,m)(cos theta) and their theta derivatives.
  P[0] = 1;
  DP[0] = 0;
  P[STRIDE + 1] = u;
  DP[STRIDE + 1] = t;
  for (let n = 2; n <= MAX_DEGREE; n++) {
    const prev = (n - 1) * STRIDE + (n - 1);
    P[n * STRIDE + n] = SECTORAL[n] * u * P[prev];
    DP[n * STRIDE + n] = SECTORAL[n] * (t * P[prev] + u * DP[prev]);
  }
  for (let n = 1; n <= MAX_DEGREE; n++) {
    for (let m = 0; m < n; m++) {
      const i = n * STRIDE + m;
      const a = RECUR_A[i];
      const b = RECUR_B[i];
      const p1 = P[i - STRIDE];
      const dp1 = DP[i - STRIDE];
      const p2 = n >= 2 ? P[i - 2 * STRIDE] : 0;
      const dp2 = n >= 2 ? DP[i - 2 * STRIDE] : 0;
      P[i] = a * t * p1 - b * p2;
      DP[i] = a * (t * dp1 - u * p1) - b * dp2;
    }
  }

  for (let m = 0; m <= MAX_DEGREE; m++) {
    COS_M[m] = Math.cos(m * lon);
    SIN_M[m] = Math.sin(m * lon);
  }

  let north = 0;
  let east = 0;
  let down = 0;
  const ratio = REFERENCE_RADIUS_KM / r;
  let radial = ratio * ratio;
  for (let n = 1; n <= MAX_DEGREE; n++) {
    radial *= ratio; // (a/r)^(n+2)
    for (let m = 0; m <= n; m++) {
      const i = n * STRIDE + m;
      const g = G[i] + dt * G_DOT[i];
      const h = H[i] + dt * H_DOT[i];
      const cosTerm = g * COS_M[m] + h * SIN_M[m];
      // d/dlatC = -d/dtheta, so north takes +dP/dtheta.
      north += radial * cosTerm * DP[i];
      east += radial * m * (g * SIN_M[m] - h * COS_M[m]) * P[i];
      down -= (n + 1) * radial * cosTerm * P[i];
    }
  }
  NED[0] = north;
  // On the axis itself east has no direction; a hair off it, the limit is finite.
  NED[1] = east / Math.max(u, 1e-9);
  NED[2] = down;
}

/** The field at a geodetic position, in the local geodetic frame. */
export interface MagneticField {
  /** nT, toward true north (X), east (Y) and down (Z). */
  readonly north: number;
  readonly east: number;
  readonly down: number;
  /** Horizontal intensity H and total intensity F, nT. */
  readonly horizontal: number;
  readonly total: number;
  /** Degrees: dip below the horizontal, and east of true north. */
  readonly inclination: number;
  readonly declination: number;
}

/**
 * The field vector at a geodetic position (WGS84 degrees, height in km
 * above the ellipsoid) and decimal year. Throws outside the model's
 * validity window rather than extrapolating a stale field.
 */
export function magneticField(latDeg: number, lonDeg: number, heightKm: number, year: number): MagneticField {
  const dt = checkYear(year);

  // Geodetic -> geocentric spherical.
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const primeVertical = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const p = (primeVertical + heightKm) * cosLat;
  const z = (primeVertical * (1 - WGS84_E2) + heightKm) * sinLat;
  const r = Math.hypot(p, z);
  const latC = Math.asin(z / r);
  // Colatitude terms: t = cos(theta) = sin(latC), u = sin(theta) = cos(latC).
  synthesize(r, Math.sin(latC), Math.cos(latC), lonDeg * DEG, dt);

  // Back to geodetic: the frames differ by a tilt in the meridian plane.
  const tilt = latC - lat;
  const north = NED[0] * Math.cos(tilt) - NED[2] * Math.sin(tilt);
  const down = NED[0] * Math.sin(tilt) + NED[2] * Math.cos(tilt);
  const east = NED[1];
  const horizontal = Math.hypot(north, east);
  return {
    north,
    east,
    down,
    horizontal,
    total: Math.hypot(horizontal, down),
    inclination: Math.atan2(down, horizontal) / DEG,
    declination: Math.atan2(east, north) / DEG,
  };
}

/**
 * Magnetic declination in degrees, east of true north positive, at a
 * geodetic position (WGS84 degrees, height in km above the ellipsoid) and
 * decimal year. Throws outside the model's validity window.
 */
export function magneticDeclination(latDeg: number, lonDeg: number, heightKm: number, year: number): number {
  return magneticField(latDeg, lonDeg, heightKm, year).declination;
}

/**
 * The field vector in Earth-centred Earth-fixed axes at a point given in
 * the same axes, km: writes Bx, By, Bz (nT) into `out`. For tracing field
 * lines, so it allocates nothing.
 *
 * The model is a potential field with its sources in the core: the
 * expansion is valid anywhere outside them, up through the mantle (taken
 * as an insulator) and out into space - where, beyond a few Earth radii,
 * the real field is increasingly the solar wind's doing and this is only
 * the Earth's own part of it.
 */
export function magneticFieldEcef(xKm: number, yKm: number, zKm: number, year: number, out: Float64Array | number[]): void {
  const dt = checkYear(year);
  const rho = Math.hypot(xKm, yKm);
  const r = Math.hypot(rho, zKm);
  const t = zKm / r;
  const u = rho / r;
  const lon = Math.atan2(yKm, xKm);
  synthesize(r, t, u, lon, dt);
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);
  // North is (-t cosLon, -t sinLon, u), east (-sinLon, cosLon, 0), down (-u cosLon, -u sinLon, -t).
  out[0] = -t * cosLon * NED[0] - sinLon * NED[1] - u * cosLon * NED[2];
  out[1] = -t * sinLon * NED[0] + cosLon * NED[1] - u * sinLon * NED[2];
  out[2] = u * NED[0] - t * NED[2];
}

/**
 * The geomagnetic north pole: where the axis of the model's centred dipole
 * (its first three coefficients) comes out of the northern hemisphere.
 * Geocentric latitude and longitude, degrees. The southern one is its antipode.
 */
export function geomagneticNorthPole(year: number): { lat: number; lon: number } {
  const dt = checkYear(year);
  const g10 = G[STRIDE] + dt * G_DOT[STRIDE];
  const g11 = G[STRIDE + 1] + dt * G_DOT[STRIDE + 1];
  const h11 = H[STRIDE + 1] + dt * H_DOT[STRIDE + 1];
  return {
    lat: Math.atan2(-g10, Math.hypot(g11, h11)) / DEG,
    lon: Math.atan2(-h11, -g11) / DEG,
  };
}

/**
 * A magnetic (dip) pole: where the model's field is vertical at the
 * ellipsoid's surface. Geodetic latitude and longitude, degrees. Unlike
 * the geomagnetic poles the two are not antipodes.
 */
export function magneticDipPole(hemisphere: 'north' | 'south', year: number): { lat: number; lon: number } {
  const start = geomagneticNorthPole(year);
  const sign = hemisphere === 'north' ? 1 : -1;
  // Walk as a unit vector, so that crossing a geographic pole is nothing special.
  const lat0 = sign * start.lat * DEG;
  const lon0 = (hemisphere === 'north' ? start.lon : start.lon + 180) * DEG;
  let x = Math.cos(lat0) * Math.cos(lon0);
  let y = Math.cos(lat0) * Math.sin(lon0);
  let z = Math.sin(lat0);
  for (let i = 0; i < 200; i++) {
    const lat = Math.asin(z);
    const lon = Math.atan2(y, x);
    const field = magneticField(lat / DEG, lon / DEG, 0, year);
    if (field.horizontal < 0.01) break;
    // The horizontal field points at the north dip pole and away from the south one. On a
    // dipole tan(dip) = 2 tan(magnetic latitude), which puts the pole atan(2H/|Z|) away;
    // half that converges on the real, lumpier field without overshooting.
    const step = (sign * Math.atan2(2 * field.horizontal, Math.abs(field.down))) / 2;
    const n = (field.north / field.horizontal) * step;
    const e = (field.east / field.horizontal) * step;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    x += -sinLat * cosLon * n - sinLon * e;
    y += -sinLat * sinLon * n + cosLon * e;
    z += cosLat * n;
    const norm = Math.hypot(x, y, z);
    x /= norm;
    y /= norm;
    z /= norm;
  }
  return { lat: Math.asin(z) / DEG, lon: Math.atan2(y, x) / DEG };
}
