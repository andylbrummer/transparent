/**
 * From an element set to a place in the app's world.
 *
 * SGP4 answers in TEME - the true equator and mean equinox of date - in
 * kilometres from the Earth's centre. A turn by Greenwich mean sidereal
 * time about the pole makes that Earth-fixed. The app's Earth, though, is
 * a sphere on which geodetic latitude is used as if it were geocentric, so
 * a satellite is put over its true ground point (WGS84) at its true height
 * above the ellipsoid: over the right spot of the map, and within a few
 * hundredths of a degree of its true direction from wherever the user is.
 *
 * That adjustment commutes with turning about the pole, so it is applied
 * in TEME and positions stay inertial: between two SGP4 runs a satellite
 * is carried along its own velocity, and one rotation of the whole frame
 * by sidereal time puts every satellite over the turning Earth.
 */

import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { json2satrec, sgp4, type SatRec } from 'satellite.js';

const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;
/** The Earth's gravitational parameter, m³/s². */
export const EARTH_GM = 3.986004418e14;
/** Tangent of the half-angle of the Earth's umbra cone: (R☉ − R⊕) / 1 au. */
export const UMBRA_TAPER = (695700 - 6371) / 149597870.7;
/** Tangent of the half-angle at which the penumbra widens: (R☉ + R⊕) / 1 au. */
export const PENUMBRA_FLARE = (695700 + 6371) / 149597870.7;

/** One row of CelesTrak GP data: what SGP4 needs, and what to call the object. */
export interface GpRecord {
  readonly name: string;
  readonly norad: number;
  /** Epoch of the element set, ms since 1970 UTC, to the microsecond. */
  readonly epochMs: number;
  readonly epoch: string;
  readonly meanMotion: number;
  readonly eccentricity: number;
  readonly inclination: number;
  readonly raOfAscNode: number;
  readonly argOfPericenter: number;
  readonly meanAnomaly: number;
  readonly bstar: number;
  readonly meanMotionDot: number;
  readonly meanMotionDdot: number;
}

/** The first line of any GP CSV from CelesTrak begins with this. */
export const GP_CSV_FIRST_COLUMN = 'OBJECT_NAME,';

/** "2026-11-09T11:10:18.771456" (UTC) → ms, keeping the microseconds Date.parse drops. */
export function parseEpochMs(epoch: string): number {
  const ms = Date.parse(`${epoch.slice(0, 19)}Z`);
  const fraction = epoch.length > 20 ? Number(`0.${epoch.slice(20).replace(/Z$/, '')}`) : 0;
  return ms + fraction * 1000;
}

/**
 * Parse CelesTrak's FORMAT=csv (or the baked files, which keep a subset
 * of its columns). Throws if the text is not GP data - CelesTrak's
 * refusals arrive as prose with a 200 or 403. Rows that do not parse are
 * dropped, not guessed at.
 */
export function parseGpCsv(text: string): GpRecord[] {
  const lines = text.split(/\r?\n/);
  if (!lines[0].startsWith(GP_CSV_FIRST_COLUMN)) throw new Error(`not GP data: ${text.slice(0, 120)}`);
  const columns = lines[0].split(',');
  const at = (name: string): number => {
    const index = columns.indexOf(name);
    if (index < 0) throw new Error(`GP data lacks the ${name} column`);
    return index;
  };
  const iName = at('OBJECT_NAME');
  const iNorad = at('NORAD_CAT_ID');
  const iEpoch = at('EPOCH');
  const numeric = ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'].map(at);
  const records: GpRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue;
    // No GP field is quoted: names hold no commas.
    const cells = lines[i].split(',');
    const values = numeric.map((index) => Number(cells[index]));
    const epochMs = parseEpochMs(cells[iEpoch] ?? '');
    const norad = Number(cells[iNorad]);
    if (cells.length !== columns.length || values.some((v) => !Number.isFinite(v)) || !Number.isFinite(epochMs) || !Number.isInteger(norad)) continue;
    records.push({
      name: cells[iName].trim(),
      norad,
      epochMs,
      epoch: cells[iEpoch],
      meanMotion: values[0],
      eccentricity: values[1],
      inclination: values[2],
      raOfAscNode: values[3],
      argOfPericenter: values[4],
      meanAnomaly: values[5],
      bstar: values[6],
      meanMotionDot: values[7],
      meanMotionDdot: values[8],
    });
  }
  return records;
}

/** Initialise SGP4 (or SDP4, for periods of 225 minutes and more) for a record. */
export function toSatrec(record: GpRecord): SatRec {
  return json2satrec({
    OBJECT_NAME: record.name,
    OBJECT_ID: '',
    EPOCH: record.epoch,
    MEAN_MOTION: record.meanMotion,
    ECCENTRICITY: record.eccentricity,
    INCLINATION: record.inclination,
    RA_OF_ASC_NODE: record.raOfAscNode,
    ARG_OF_PERICENTER: record.argOfPericenter,
    MEAN_ANOMALY: record.meanAnomaly,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: record.norad,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 0,
    BSTAR: record.bstar,
    MEAN_MOTION_DOT: record.meanMotionDot,
    MEAN_MOTION_DDOT: record.meanMotionDdot,
  });
}

/**
 * TEME position (km) and velocity (km/s) at `dateMs`, written to `out`
 * (six numbers). False when SGP4 gives up: the orbit has decayed, or the
 * elements are too old to mean anything at that date.
 */
export function propagateTeme(satrec: SatRec, epochMs: number, dateMs: number, out: Float64Array | number[]): boolean {
  const state = sgp4(satrec, (dateMs - epochMs) / 60000);
  if (!state) return false;
  const { position, velocity } = state;
  if (!Number.isFinite(position.x + position.y + position.z + velocity.x + velocity.y + velocity.z)) return false;
  out[0] = position.x;
  out[1] = position.y;
  out[2] = position.z;
  out[3] = velocity.x;
  out[4] = velocity.y;
  out[5] = velocity.z;
  return true;
}

/** WGS84 geodetic latitude (radians) and height (km) of a point `rho` km from the axis and `z` km above the equator. */
export function geodeticLatHeight(rho: number, z: number, out: Float64Array | number[]): void {
  let lat = Math.atan2(z, rho * (1 - WGS84_E2));
  let n = WGS84_A_KM;
  // Fixed-point iteration: at satellite heights each pass gains three digits or more.
  for (let i = 0; i < 6; i++) {
    const sin = Math.sin(lat);
    n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sin * sin);
    lat = Math.atan2(z + n * WGS84_E2 * sin, rho);
  }
  const sin = Math.sin(lat);
  n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sin * sin);
  out[0] = lat;
  // Near the poles rho / cos(lat) loses its footing; z / sin(lat) does not.
  out[1] = Math.abs(sin) > 0.7 ? z / sin - n * (1 - WGS84_E2) : rho / Math.cos(lat) - n;
}

const LAT_HEIGHT = [0, 0];

/**
 * A true position (km, TEME or Earth-fixed: the pole is the same) → the
 * app's spherical world (metres, same axes): the same longitude, the true
 * geodetic latitude taken as geocentric, the true height over the
 * app's sphere. Writes three numbers at `offset`.
 */
export function toSphericalWorld(xKm: number, yKm: number, zKm: number, out: Float32Array | Float64Array | number[], offset = 0): void {
  const rho = Math.hypot(xKm, yKm);
  geodeticLatHeight(rho, zKm, LAT_HEIGHT);
  const r = EARTH_RADIUS_M + LAT_HEIGHT[1] * 1000;
  const cos = Math.cos(LAT_HEIGHT[0]);
  // On the axis longitude means nothing and rho is zero.
  const k = rho > 1e-9 ? (r * cos) / rho : 0;
  out[offset] = xKm * k;
  out[offset + 1] = yKm * k;
  out[offset + 2] = r * Math.sin(LAT_HEIGHT[0]);
}

/** TEME → Earth-fixed: a turn by Greenwich mean sidereal time (radians) about the pole. */
export function temeToEcef(x: number, y: number, z: number, gmst: number, out: Float64Array | number[]): void {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  out[0] = c * x + s * y;
  out[1] = -s * x + c * y;
  out[2] = z;
}

/** Where a point of the app's world (Earth-fixed metres) is over the ground. */
export function subPoint(x: number, y: number, z: number): { lat: number; lon: number; heightKm: number } {
  const r = Math.hypot(x, y, z);
  return { lat: Math.asin(z / r) / DEG, lon: Math.atan2(y, x) / DEG, heightKm: (r - EARTH_RADIUS_M) / 1000 };
}

/** Azimuth (clockwise from north), elevation (degrees) and range (km) of a world point from a place on the app's sphere. */
export function lookAngles(x: number, y: number, z: number, latDeg: number, lonDeg: number): { azimuth: number; elevation: number; rangeKm: number } {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const dx = x - EARTH_RADIUS_M * Math.cos(lat) * Math.cos(lon);
  const dy = y - EARTH_RADIUS_M * Math.cos(lat) * Math.sin(lon);
  const dz = z - EARTH_RADIUS_M * Math.sin(lat);
  const east = -Math.sin(lon) * dx + Math.cos(lon) * dy;
  const north = -Math.sin(lat) * Math.cos(lon) * dx - Math.sin(lat) * Math.sin(lon) * dy + Math.cos(lat) * dz;
  const up = Math.cos(lat) * Math.cos(lon) * dx + Math.cos(lat) * Math.sin(lon) * dy + Math.sin(lat) * dz;
  const range = Math.hypot(east, north, up);
  return { azimuth: (Math.atan2(east, north) / DEG + 360) % 360, elevation: Math.asin(up / range) / DEG, rangeKm: range / 1000 };
}

/**
 * How much of the Sun a point (metres from the Earth's centre) sees: 1 in
 * full sunlight, 0 inside the umbra, between across the penumbra. `sun` is
 * the unit vector to the Sun in the same axes. The shader in satellites.ts
 * repeats this arithmetic.
 */
export function sunlitFraction(x: number, y: number, z: number, sun: readonly [number, number, number]): number {
  const along = x * sun[0] + y * sun[1] + z * sun[2];
  if (along >= 0) return 1;
  const perp = Math.hypot(x - along * sun[0], y - along * sun[1], z - along * sun[2]);
  const umbra = EARTH_RADIUS_M + along * UMBRA_TAPER;
  const penumbra = EARTH_RADIUS_M - along * PENUMBRA_FLARE;
  const t = Math.max(0, Math.min(1, (perp - umbra) / (penumbra - umbra)));
  return t * t * (3 - 2 * t);
}

/** Orbital period, minutes, from the mean motion in revolutions per day. */
export function periodMinutes(meanMotionRevPerDay: number): number {
  return 1440 / meanMotionRevPerDay;
}
