/**
 * Where the Sun, the Moon and the planets are, and how their discs are turned.
 *
 * Planets and the Sun come from the VSOP87B theory, cut to half an
 * arcsecond (vsop87-data.ts); the Moon from the main terms of ELP-2000/82
 * as tabulated by Meeus, Astronomical Algorithms ch. 47 (lunar-series.ts).
 * Disc orientations follow Meeus ch. 29 (Sun: Carrington's elements) and
 * ch. 53 (Moon: Cassini's laws, i.e. optical libration only), brightness
 * ch. 41.
 *
 * Positions are ASTROMETRIC - corrected for light-time but not for
 * aberration - in ICRS axes, the same footing as a star catalogue, so a
 * planet sits correctly among the stars the app draws. Vectors are
 * [x, y, z] tuples from the Earth's centre unless said otherwise.
 *
 * Measured against JPL Horizons (DE441) over 1900-2100, see
 * ephemeris.test.ts: Sun and planets within 2″, the Moon within 15″.
 */

import { geodeticToEcef } from '../geodesy';
import {
  J2000_JD,
  applyMat3,
  icrsToEcefMatrix,
  julianDate,
  meanObliquity,
  multiplyMat3,
  precessionMatrix,
  transposeMat3,
  type Mat3,
} from './index';
import { LUNAR_LATITUDE_TERMS, LUNAR_LONGITUDE_DISTANCE_TERMS } from './lunar-series';
import { VSOP87, type Vsop87Planet } from './vsop87-data';

export type Vec3Tuple = readonly [number, number, number];
export type PlanetName = Exclude<Vsop87Planet, 'earth'>;

export const PLANET_NAMES: readonly PlanetName[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

const DEG = Math.PI / 180;
/** The astronomical unit, km (IAU 2012, exact). */
export const AU_KM = 149597870.7;
/** Days light takes to cross one au (au / c). */
const LIGHT_DAYS_PER_AU = AU_KM / 299792.458 / 86400;
/** Nominal solar radius, km (IAU 2015 Resolution B3). */
export const SUN_RADIUS_KM = 695700;
/** Mean lunar radius, km (as JPL Horizons uses). */
export const MOON_RADIUS_KM = 1737.4;

const sub = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3Tuple, b: Vec3Tuple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3Tuple): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3Tuple, s: number): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];
const normalize = (a: Vec3Tuple): [number, number, number] => scale(a, 1 / length(a));
const wrap360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Angle between two vectors, degrees. */
export function separationDeg(a: Vec3Tuple, b: Vec3Tuple): number {
  // atan2 of |a×b| and a·b keeps its precision for nearly parallel vectors, where acos loses it.
  return Math.atan2(length(cross(a, b)), dot(a, b)) / DEG;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** [Unix seconds, TAI − UTC] at each leap second (IERS Bulletin C, via IANA leap-seconds.list). */
const LEAP_SECONDS: readonly (readonly [number, number])[] = [
  [63072000, 10], // 1972-01-01
  [78796800, 11], // 1972-07-01
  [94694400, 12], // 1973-01-01
  [126230400, 13], // 1974-01-01
  [157766400, 14], // 1975-01-01
  [189302400, 15], // 1976-01-01
  [220924800, 16], // 1977-01-01
  [252460800, 17], // 1978-01-01
  [283996800, 18], // 1979-01-01
  [315532800, 19], // 1980-01-01
  [362793600, 20], // 1981-07-01
  [394329600, 21], // 1982-07-01
  [425865600, 22], // 1983-07-01
  [489024000, 23], // 1985-07-01
  [567993600, 24], // 1988-01-01
  [631152000, 25], // 1990-01-01
  [662688000, 26], // 1991-01-01
  [709948800, 27], // 1992-07-01
  [741484800, 28], // 1993-07-01
  [773020800, 29], // 1994-07-01
  [820454400, 30], // 1996-01-01
  [867715200, 31], // 1997-07-01
  [915148800, 32], // 1999-01-01
  [1136073600, 33], // 2006-01-01
  [1230768000, 34], // 2009-01-01
  [1341100800, 35], // 2012-07-01
  [1435708800, 36], // 2015-07-01
  [1483228800, 37], // 2017-01-01
];
/** TT − TAI, seconds (exact). */
const TT_MINUS_TAI = 32.184;

/**
 * ΔT = TT − UT in seconds before UTC had leap seconds: the polynomial
 * fits of Espenak & Meeus (NASA Five Millennium Canon of Solar Eclipses,
 * eclipse.gsfc.nasa.gov/SEcat5/deltatpoly.html) for 1860-1986.
 */
function deltaTBefore1972(year: number): number {
  if (year < 1900) {
    const t = Math.max(year, 1860) - 1860;
    return 7.62 + t * (0.5737 + t * (-0.251754 + t * (0.01680668 + t * (-0.0004473624 + t / 233174))));
  }
  if (year < 1920) {
    const t = year - 1900;
    return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - t * 0.000197)));
  }
  if (year < 1941) {
    const t = year - 1920;
    return 21.2 + t * (0.84493 + t * (-0.0761 + t * 0.0020936));
  }
  if (year < 1961) {
    const t = year - 1950;
    return 29.07 + t * (0.407 + t * (-1 / 233 + t / 2547));
  }
  const t = year - 1975;
  return 45.45 + t * (1.067 + t * (-1 / 260 - t / 718));
}

/**
 * Terrestrial Time minus the instant's UTC, seconds: what to add to a
 * clock reading to enter an ephemeris. Exact from 1972 on (leap seconds);
 * before that the Date is taken as UT and ΔT comes from a fit. The future
 * keeps the last leap second, as UTC itself is planned to.
 */
export function ttMinusUtcSeconds(utc: Date): number {
  const seconds = utc.getTime() / 1000;
  if (seconds < LEAP_SECONDS[0][0]) {
    return deltaTBefore1972(2000 + (julianDate(utc) - J2000_JD) / 365.25);
  }
  let taiMinusUtc = LEAP_SECONDS[0][1];
  for (const [start, value] of LEAP_SECONDS) {
    if (seconds >= start) taiMinusUtc = value;
  }
  return TT_MINUS_TAI + taiMinusUtc;
}

/** Julian Ephemeris Date (TT) of a UTC instant. */
export function julianEphemerisDate(utc: Date): number {
  return julianDate(utc) + ttMinusUtcSeconds(utc) / 86400;
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/**
 * VSOP87's dynamical ecliptic and equinox J2000 → FK5 J2000 equator, which
 * is ICRS to 0.02″ (the rotation printed in the theory's vsop87.doc).
 */
const VSOP_ECLIPTIC_TO_ICRS: Mat3 = [
  1.0, 0.00000044036, -0.000000190919,
  -0.000000479966, 0.917482137087, -0.397776982902,
  0.0, 0.397776982902, 0.917482137087,
];

/** The north pole of the J2000 ecliptic, ICRS. */
export const ECLIPTIC_POLE_ICRS: Vec3Tuple = [0, -0.397776982902, 0.917482137087];

/** Active rotation about z, then the same about x: the building blocks of a body's frame. */
function rotationZ(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function rotationX(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** Mean ecliptic and equinox of date → ICRS. */
export function eclipticOfDateToIcrs(utc: Date): Mat3 {
  return multiplyMat3(transposeMat3(precessionMatrix(utc)), rotationX(meanObliquity(utc)));
}

/**
 * A body's own axes → ICRS, for a body whose equator crosses the ecliptic
 * of date at longitude `node`, tilted by `inclination`, and whose prime
 * meridian lies `rotation` along its equator from that node. Radians.
 */
function bodyFrame(utc: Date, node: number, inclination: number, rotation: number): Mat3 {
  return multiplyMat3(
    eclipticOfDateToIcrs(utc),
    multiplyMat3(rotationZ(node), multiplyMat3(rotationX(inclination), rotationZ(rotation)))
  );
}

/**
 * Where an observer stands, metres from the Earth's centre in ICRS axes:
 * what to subtract from a geocentric position to get the topocentric one.
 * Geodetic latitude/longitude on WGS84.
 */
export function observerIcrsM(latDeg: number, lonDeg: number, altM: number, utc: Date): [number, number, number] {
  const ecef = geodeticToEcef({ lat: latDeg, lon: lonDeg, alt: altM });
  return applyMat3(transposeMat3(icrsToEcefMatrix(utc)), [ecef.x, ecef.y, ecef.z]);
}

/**
 * Position angle, degrees in [0, 360), of the direction `toward` seen at
 * the sky position `at`: counter-clockwise (through east) from the
 * direction of `north`, by default the ICRS pole.
 */
export function positionAngleDeg(at: Vec3Tuple, toward: Vec3Tuple, north: Vec3Tuple = [0, 0, 1]): number {
  const d = normalize(at);
  const east = normalize(cross(north, d));
  const up = cross(d, east);
  return wrap360(Math.atan2(dot(toward, east), dot(toward, up)) / DEG);
}

// ---------------------------------------------------------------------------
// Sun and planets
// ---------------------------------------------------------------------------

function sumSeries(powers: readonly (readonly number[])[], t: number): number {
  let total = 0;
  let tPower = 1;
  for (const terms of powers) {
    let sum = 0;
    for (let i = 0; i < terms.length; i += 3) sum += terms[i] * Math.cos(terms[i + 1] + terms[i + 2] * t);
    total += sum * tPower;
    tPower *= t;
  }
  return total;
}

/** Heliocentric position of a planet in au, ICRS axes, at Julian Ephemeris Date `jde`. */
export function heliocentricIcrsAu(planet: Vsop87Planet, jde: number): [number, number, number] {
  const t = (jde - J2000_JD) / 365250;
  const series = VSOP87[planet];
  const lon = sumSeries(series.l, t);
  const lat = sumSeries(series.b, t);
  const radius = sumSeries(series.r, t);
  const cosLat = Math.cos(lat);
  return applyMat3(VSOP_ECLIPTIC_TO_ICRS, [radius * cosLat * Math.cos(lon), radius * cosLat * Math.sin(lon), radius * Math.sin(lat)]);
}

/**
 * The Sun from the Earth's centre, au, ICRS axes. The Sun's own motion
 * about the solar system's barycentre during the 8 light-minutes is under
 * 0.01″ and is left out.
 */
export function sunGeocentricAu(utc: Date): [number, number, number] {
  return scale(heliocentricIcrsAu('earth', julianEphemerisDate(utc)), -1);
}

export interface PlanetEphemeris {
  /** Astrometric position from the Earth's centre, au, ICRS axes. */
  readonly positionAu: Vec3Tuple;
  readonly distanceAu: number;
  /** Planet to Sun, au, when the light left. */
  readonly sunDistanceAu: number;
  /** Sun-planet-Earth angle, degrees: 0 is full. */
  readonly phaseAngleDeg: number;
  /** Lit fraction of the disc, 0..1. */
  readonly illuminatedFraction: number;
  /** Apparent visual magnitude. */
  readonly magnitude: number;
  /** Sun to planet, au, ICRS axes, when the light left. */
  readonly heliocentricAu: Vec3Tuple;
  /** Days the light took to reach the Earth. */
  readonly lightTimeDays: number;
}

/** Ring plane of Saturn on the ecliptic of date: inclination and ascending node, degrees (Meeus 45.1). */
function saturnRingPoleIcrs(utc: Date, jde: number): [number, number, number] {
  const t = (jde - J2000_JD) / 36525;
  const inclination = (28.075216 - 0.012998 * t + 0.000004 * t * t) * DEG;
  const node = (169.50847 + 1.394681 * t + 0.000412 * t * t) * DEG;
  const sinI = Math.sin(inclination);
  return applyMat3(eclipticOfDateToIcrs(utc), [sinI * Math.sin(node), -sinI * Math.cos(node), Math.cos(inclination)]);
}

/**
 * Apparent visual magnitude (Meeus ch. 41, the formulae the Astronomical
 * Almanac adopted in 1984; phase angle i in degrees). Saturn's includes
 * its rings: `ringTiltSin` is |sin B| for the Earth's latitude B above the
 * ring plane, `ringDeltaU` the Sun-Earth difference of longitude in that
 * plane, degrees. Within ~0.3 mag of the modern fits Horizons uses.
 */
function planetMagnitude(
  planet: PlanetName,
  sunDistanceAu: number,
  distanceAu: number,
  phaseDeg: number,
  ringTiltSin: number,
  ringDeltaU: number
): number {
  const base = 5 * Math.log10(sunDistanceAu * distanceAu);
  const i = phaseDeg;
  switch (planet) {
    case 'mercury':
      return -0.42 + base + 0.038 * i - 0.000273 * i * i + 0.000002 * i * i * i;
    case 'venus':
      return -4.4 + base + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i;
    case 'mars':
      return -1.52 + base + 0.016 * i;
    case 'jupiter':
      return -9.4 + base + 0.005 * i;
    case 'saturn':
      return -8.88 + base + 0.044 * ringDeltaU - 2.6 * ringTiltSin + 1.25 * ringTiltSin * ringTiltSin;
    case 'uranus':
      return -7.19 + base;
    case 'neptune':
      return -6.87 + base;
  }
}

/** A planet as seen from the Earth's centre at `utc`. */
export function planetEphemeris(planet: PlanetName, utc: Date): PlanetEphemeris {
  const jde = julianEphemerisDate(utc);
  const earth = heliocentricIcrsAu('earth', jde);
  // The light seen now left the planet a light-time ago: step back to where it was.
  let heliocentric = heliocentricIcrsAu(planet, jde);
  let position = sub(heliocentric, earth);
  for (let pass = 0; pass < 2; pass++) {
    heliocentric = heliocentricIcrsAu(planet, jde - length(position) * LIGHT_DAYS_PER_AU);
    position = sub(heliocentric, earth);
  }
  const distanceAu = length(position);
  const sunDistanceAu = length(heliocentric);
  const toSun = scale(heliocentric, -1);
  const toEarth = scale(position, -1);
  const phaseAngleDeg = separationDeg(toSun, toEarth);
  let ringTiltSin = 0;
  let ringDeltaU = 0;
  if (planet === 'saturn') {
    const pole = saturnRingPoleIcrs(utc, jde);
    ringTiltSin = Math.abs(dot(pole, toEarth)) / distanceAu;
    // Longitudes in the ring plane: project both directions onto it.
    const inPlane = (v: Vec3Tuple): [number, number, number] => sub(v, scale(pole, dot(pole, v)));
    ringDeltaU = separationDeg(inPlane(toSun), inPlane(toEarth));
  }
  return {
    positionAu: position,
    distanceAu,
    sunDistanceAu,
    phaseAngleDeg,
    illuminatedFraction: (1 + Math.cos(phaseAngleDeg * DEG)) / 2,
    magnitude: planetMagnitude(planet, sunDistanceAu, distanceAu, phaseAngleDeg, ringTiltSin, ringDeltaU),
    heliocentricAu: heliocentric,
    lightTimeDays: distanceAu * LIGHT_DAYS_PER_AU,
  };
}

// ---------------------------------------------------------------------------
// The Moon
// ---------------------------------------------------------------------------

/** Mean arguments of the lunar theory, radians (Meeus 47.1-47.5), T in Julian centuries TT. */
function lunarArguments(t: number): { meanLongitude: number; d: number; m: number; mPrime: number; f: number; node: number } {
  const poly = (...c: number[]): number => c.reduceRight((acc, v) => acc * t + v, 0) * DEG;
  return {
    meanLongitude: poly(218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000),
    d: poly(297.8501921, 445267.1114034, -0.0018819, 1 / 545868, -1 / 113065000),
    m: poly(357.5291092, 35999.0502909, -0.0001535, 1 / 24490000),
    mPrime: poly(134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000),
    f: poly(93.272095, 483202.0175233, -0.0036539, -1 / 3526000, 1 / 863310000),
    node: poly(125.0445479, -1934.1362891, 0.0020754, 1 / 467441, -1 / 60616000),
  };
}

/**
 * The Moon's geocentric longitude and latitude (radians, mean ecliptic and
 * equinox of date) and distance (km): Meeus ch. 47. About 10″ in
 * longitude, 4″ in latitude.
 */
export function moonEclipticOfDate(utc: Date): { lon: number; lat: number; distanceKm: number } {
  const t = (julianEphemerisDate(utc) - J2000_JD) / 36525;
  const { meanLongitude, d, m, mPrime, f } = lunarArguments(t);
  const a1 = (119.75 + 131.849 * t) * DEG;
  const a2 = (53.09 + 479264.29 * t) * DEG;
  const a3 = (313.45 + 481266.484 * t) * DEG;
  // Terms in the Sun's anomaly M shrink with the Earth's orbital eccentricity.
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  const eFactor = (mMultiplier: number): number => (mMultiplier === 0 ? 1 : Math.abs(mMultiplier) === 1 ? e : e * e);
  let sumL = 3958 * Math.sin(a1) + 1962 * Math.sin(meanLongitude - f) + 318 * Math.sin(a2);
  let sumR = 0;
  let sumB =
    -2235 * Math.sin(meanLongitude) +
    382 * Math.sin(a3) +
    175 * Math.sin(a1 - f) +
    175 * Math.sin(a1 + f) +
    127 * Math.sin(meanLongitude - mPrime) -
    115 * Math.sin(meanLongitude + mPrime);
  for (const row of LUNAR_LONGITUDE_DISTANCE_TERMS) {
    const argument = d * row[0] + m * row[1] + mPrime * row[2] + f * row[3];
    const factor = eFactor(row[1]);
    sumL += row[4] * factor * Math.sin(argument);
    sumR += row[5] * factor * Math.cos(argument);
  }
  for (const row of LUNAR_LATITUDE_TERMS) {
    sumB += row[4] * eFactor(row[1]) * Math.sin(d * row[0] + m * row[1] + mPrime * row[2] + f * row[3]);
  }
  return {
    lon: meanLongitude + sumL * 1e-6 * DEG,
    lat: sumB * 1e-6 * DEG,
    distanceKm: 385000.56 + sumR * 1e-3,
  };
}

/** The Earth's velocity about the Sun, au per day, ICRS axes. */
function earthVelocityAuPerDay(jde: number): [number, number, number] {
  const step = 0.01;
  return scale(sub(heliocentricIcrsAu('earth', jde + step), heliocentricIcrsAu('earth', jde - step)), 1 / (2 * step));
}

/**
 * The Moon's centre from the Earth's centre, km, ICRS axes - astrometric,
 * like everything else here.
 *
 * The lunar theory gives the Moon where it is relative to the Earth. But
 * the pair moves 38 km round the Sun while the Moon's light crosses to us,
 * so against the catalogue stars - and the astrometric Sun, which matters
 * at an eclipse - the Moon appears that far back along the Earth's path:
 * 20″, the same shift aberration gives a star, with the opposite sign.
 */
export function moonGeocentricKm(utc: Date): [number, number, number] {
  const { lon, lat, distanceKm } = moonEclipticOfDate(utc);
  const cosLat = Math.cos(lat);
  const geometric = applyMat3(eclipticOfDateToIcrs(utc), [
    distanceKm * cosLat * Math.cos(lon),
    distanceKm * cosLat * Math.sin(lon),
    distanceKm * Math.sin(lat),
  ]);
  const lightDays = (distanceKm / AU_KM) * LIGHT_DAYS_PER_AU;
  return sub(geometric, scale(earthVelocityAuPerDay(julianEphemerisDate(utc)), lightDays * AU_KM));
}

/** Inclination of the mean lunar equator to the ecliptic, radians (IAU; Meeus ch. 53). */
const LUNAR_EQUATOR_INCLINATION = 1.54242 * DEG;

/**
 * Selenographic axes → ICRS: x through the mean sub-Earth point
 * (longitude 0), z the north pole, y toward 90° E (Mare Crisium's side).
 *
 * This is the Moon of Cassini's laws: its equator meets the ecliptic at
 * the descending node of the orbit and it turns in step with the mean
 * longitude (Meeus 53.1). The physical librations (≤ 0.04°) are left out.
 */
export function moonBodyToIcrs(utc: Date): Mat3 {
  const t = (julianEphemerisDate(utc) - J2000_JD) / 36525;
  const { f, node } = lunarArguments(t);
  return bodyFrame(utc, node + Math.PI, LUNAR_EQUATOR_INCLINATION, f);
}

/**
 * Heliographic (Carrington) axes → ICRS: z the Sun's north pole, x through
 * Carrington longitude 0 on its equator. Carrington's elements: equator
 * inclined 7.25° to the ecliptic, sidereal rotation 25.38 days (Meeus ch. 29).
 */
export function sunBodyToIcrs(utc: Date): Mat3 {
  const jde = julianEphemerisDate(utc);
  const node = (73.6667 + (1.3958333 * (jde - 2396758)) / 36525) * DEG;
  const rotation = (((jde - 2398220) * 360) / 25.38) * DEG;
  return bodyFrame(utc, node, 7.25 * DEG, rotation % (2 * Math.PI));
}

export interface DiscOrientation {
  /** Longitude of the disc's centre in the body's own frame, degrees in [0, 360), increasing with its rotation. */
  readonly centreLonDeg: number;
  /** Latitude of the disc's centre, degrees: the tilt of the north pole toward the observer. */
  readonly centreLatDeg: number;
  /** Position angle of the body's north pole, degrees counter-clockwise from celestial north. */
  readonly northPoleAngleDeg: number;
}

/**
 * How a disc is presented to an observer. `bodyToIcrs` is the body's
 * frame, `bodyToObserver` the vector from its centre to the eye (ICRS, any
 * unit). For the Sun these are L0, B0 and P; for the Moon the libration
 * in longitude and latitude and the position angle of its axis.
 */
export function discOrientation(bodyToIcrs: Mat3, bodyToObserver: Vec3Tuple, north: Vec3Tuple = [0, 0, 1]): DiscOrientation {
  const inBody = applyMat3(transposeMat3(bodyToIcrs), normalize(bodyToObserver));
  const pole: Vec3Tuple = [bodyToIcrs[2], bodyToIcrs[5], bodyToIcrs[8]];
  return {
    centreLonDeg: wrap360(Math.atan2(inBody[1], inBody[0]) / DEG),
    centreLatDeg: Math.asin(Math.max(-1, Math.min(1, inBody[2]))) / DEG,
    northPoleAngleDeg: positionAngleDeg(scale(bodyToObserver, -1), pole, north),
  };
}

/** The unit vector, in ICRS axes, from a body's centre to the point at `latDeg`, `lonDeg` on its surface. */
export function surfacePointIcrs(bodyToIcrs: Mat3, latDeg: number, lonDeg: number): [number, number, number] {
  const cosLat = Math.cos(latDeg * DEG);
  return applyMat3(bodyToIcrs, [cosLat * Math.cos(lonDeg * DEG), cosLat * Math.sin(lonDeg * DEG), Math.sin(latDeg * DEG)]);
}

export type MoonPhaseName =
  | 'New Moon'
  | 'Waxing crescent'
  | 'First quarter'
  | 'Waxing gibbous'
  | 'Full Moon'
  | 'Waning gibbous'
  | 'Last quarter'
  | 'Waning crescent';

export interface MoonPhase {
  /** Sun-Moon-observer angle, degrees: 0 is full, 180 new. */
  readonly phaseAngleDeg: number;
  /** Lit fraction of the disc, 0..1. */
  readonly illuminatedFraction: number;
  /** Position angle of the middle of the bright limb, degrees from celestial north through east. */
  readonly brightLimbAngleDeg: number;
  /** How far the Moon has run ahead of the Sun along the ecliptic, degrees in [0, 360): 0 new, 180 full. */
  readonly elongationDeg: number;
  readonly name: MoonPhaseName;
}

/** Half-width, degrees of elongation, of the four named instants: about half a day of the Moon's motion. */
const PRINCIPAL_PHASE_HALF_WIDTH_DEG = 6;

export function moonPhaseName(elongationDeg: number): MoonPhaseName {
  const e = wrap360(elongationDeg);
  const near = (target: number): boolean => Math.abs(((e - target + 540) % 360) - 180) <= PRINCIPAL_PHASE_HALF_WIDTH_DEG;
  if (near(0)) return 'New Moon';
  if (near(90)) return 'First quarter';
  if (near(180)) return 'Full Moon';
  if (near(270)) return 'Last quarter';
  if (e < 90) return 'Waxing crescent';
  if (e < 180) return 'Waxing gibbous';
  if (e < 270) return 'Waning gibbous';
  return 'Waning crescent';
}

/**
 * The Moon's phase from where the three bodies actually are. `moon` and
 * `sun` are positions from the observer (or the Earth's centre) in one
 * unit and ICRS axes.
 */
export function moonPhase(moon: Vec3Tuple, sun: Vec3Tuple, north: Vec3Tuple = [0, 0, 1]): MoonPhase {
  const moonToSun = sub(sun, moon);
  const phaseAngleDeg = separationDeg(moonToSun, scale(moon, -1));
  // Ecliptic longitudes, to tell waxing from waning.
  const x: Vec3Tuple = [1, 0, 0];
  const y = cross(ECLIPTIC_POLE_ICRS, x);
  const lon = (v: Vec3Tuple): number => Math.atan2(dot(v, y), dot(v, x)) / DEG;
  const elongationDeg = wrap360(lon(moon) - lon(sun));
  return {
    phaseAngleDeg,
    illuminatedFraction: (1 + Math.cos(phaseAngleDeg * DEG)) / 2,
    brightLimbAngleDeg: positionAngleDeg(moon, moonToSun, north),
    elongationDeg,
    name: moonPhaseName(elongationDeg),
  };
}
