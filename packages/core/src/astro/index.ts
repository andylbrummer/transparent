/**
 * Sky reference frames: where the stars are relative to the rotating Earth.
 *
 * Catalogues give directions in ICRS (to the arcsecond, the J2000 mean
 * equator and equinox). The app's world is Earth-fixed ECEF. Between them
 * sit precession from J2000 to the date and the Earth's rotation (GMST).
 * Nutation (≤ 17″) and polar motion (≤ 0.5″) are left out: both are far
 * below a pixel at any zoom the app offers, and UTC stands in for UT1
 * (≤ 0.9 s, 13″).
 *
 * Matrices are 3×3, row-major, as flat arrays of nine numbers.
 */

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;
export const J2000_JD = 2451545.0;

/** Julian Date of a UTC instant. */
export function julianDate(utc: Date): number {
  return utc.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries from J2000.0. */
export function julianCenturies(utc: Date): number {
  return (julianDate(utc) - J2000_JD) / 36525;
}

/** Greenwich mean sidereal time, radians in [0, 2π). IAU 1982 (Meeus 12.4). */
export function greenwichMeanSiderealTime(utc: Date): number {
  const d = julianDate(utc) - J2000_JD;
  const t = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  return (((deg % 360) + 360) % 360) * DEG;
}

export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function applyMat3(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Rotation of the coordinate axes by `angle` about z: a fixed vector's new components. */
function axesAboutZ(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

function axesAboutY(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

/**
 * Precession from the J2000 mean equator and equinox to those of the date
 * (IAU 1976; Meeus 21.2): v_date = P · v_J2000.
 */
export function precessionMatrix(utc: Date): Mat3 {
  const t = julianCenturies(utc);
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * ARCSEC;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * ARCSEC;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * ARCSEC;
  return multiplyMat3(axesAboutZ(-z), multiplyMat3(axesAboutY(theta), axesAboutZ(-zeta)));
}

/**
 * ICRS direction → Earth-fixed (ECEF) direction at `utc`:
 * v_ecef = M · v_icrs. Its transpose goes the other way.
 */
export function icrsToEcefMatrix(utc: Date): Mat3 {
  return multiplyMat3(axesAboutZ(greenwichMeanSiderealTime(utc)), precessionMatrix(utc));
}

/** Unit vector for right ascension and declination in degrees. */
export function raDecToUnit(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/** Right ascension [0, 360) and declination in degrees of a vector (any length). */
export function unitToRaDec(v: readonly [number, number, number]): { raDeg: number; decDeg: number } {
  const ra = Math.atan2(v[1], v[0]) / DEG;
  const dec = Math.atan2(v[2], Math.hypot(v[0], v[1])) / DEG;
  return { raDeg: (ra + 360) % 360, decDeg: dec };
}

/**
 * ICRS → galactic (IAU 1958 system as realised by Hipparcos, ESA SP-1200
 * vol. 1 eq. 1.5.11): v_gal = G · v_icrs. Galactic longitude runs along
 * +x toward the galactic centre, latitude toward +z.
 */
export const ICRS_TO_GALACTIC: Mat3 = [
  -0.0548755604162154, -0.873437090234885, -0.483835015548713,
  0.494109427875584, -0.444829629960011, 0.746982244497219,
  -0.867666149019005, -0.198076373431201, 0.455983776175067,
];

/** Mean obliquity of the ecliptic of date, radians (IAU 1980; Meeus 22.2). */
export function meanObliquity(utc: Date): number {
  const t = julianCenturies(utc);
  return (84381.448 - 46.815 * t - 0.00059 * t * t + 0.001813 * t * t * t) * ARCSEC;
}

/**
 * Azimuth (clockwise from north) and elevation, degrees, of an ICRS
 * direction seen from a geodetic latitude/longitude at `utc`. No refraction.
 */
export function horizontalFromIcrs(
  v: readonly [number, number, number],
  latDeg: number,
  lonDeg: number,
  utc: Date
): { azimuth: number; elevation: number } {
  const e = applyMat3(icrsToEcefMatrix(utc), v);
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const east = -Math.sin(lon) * e[0] + Math.cos(lon) * e[1];
  const north = -Math.sin(lat) * Math.cos(lon) * e[0] - Math.sin(lat) * Math.sin(lon) * e[1] + Math.cos(lat) * e[2];
  const up = Math.cos(lat) * Math.cos(lon) * e[0] + Math.cos(lat) * Math.sin(lon) * e[1] + Math.sin(lat) * e[2];
  const norm = Math.hypot(east, north, up);
  return {
    azimuth: ((Math.atan2(east, north) / DEG) + 360) % 360,
    elevation: Math.asin(up / norm) / DEG,
  };
}
