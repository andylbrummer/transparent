/**
 * Magnetic declination from the World Magnetic Model (WMM2025).
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

/**
 * Magnetic declination in degrees, east of true north positive, at a
 * geodetic position (WGS84 degrees, height in km above the ellipsoid) and
 * decimal year. Throws outside the model's validity window rather than
 * extrapolating a stale field.
 */
export function magneticDeclination(latDeg: number, lonDeg: number, heightKm: number, year: number): number {
  if (!(year >= WMM_VALID_FROM && year <= WMM_VALID_UNTIL)) {
    throw new RangeError(`WMM2025 covers ${WMM_VALID_FROM}-${WMM_VALID_UNTIL}; got ${year}`);
  }
  const dt = year - WMM2025_EPOCH;

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
  const t = Math.sin(latC);
  const u = Math.cos(latC);

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

  const lon = lonDeg * DEG;
  for (let m = 0; m <= MAX_DEGREE; m++) {
    COS_M[m] = Math.cos(m * lon);
    SIN_M[m] = Math.sin(m * lon);
  }

  // Field components in the geocentric frame: north, east, down.
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
  east /= u;

  // Back to geodetic: the frames differ by a tilt in the meridian plane.
  const tilt = latC - lat;
  const northGeodetic = north * Math.cos(tilt) - down * Math.sin(tilt);

  return Math.atan2(east, northGeodetic) / DEG;
}
