/**
 * Field lines of the Earth's main magnetic field, traced through the
 * World Magnetic Model: curves everywhere tangent to the field vector.
 *
 * Kilometres, Earth-fixed axes. Nothing here draws; magnetic-field.ts does.
 */

import { geomagneticNorthPole, magneticFieldEcef } from '@transparent-earth/core';

/** The geomagnetic reference radius: the model's "surface". */
export const SURFACE_KM = 6371.2;
const DEG = Math.PI / 180;

export interface TracedLine {
  /** xyz per point, km. */
  readonly points: number[];
  /** Field strength at each point, nT. */
  readonly strengths: number[];
  /** Which bound ended the line: 'inner' or 'outer' radius, or 'steps' if it ran out of them. */
  readonly end: 'inner' | 'outer' | 'steps';
}

export interface TraceBounds {
  readonly minRadiusKm: number;
  readonly maxRadiusKm: number;
}

const B = [0, 0, 0];
const K = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Unit field direction at a point, times `sign`, into K at `slot`; returns the strength. */
function direction(x: number, y: number, z: number, year: number, sign: number, slot: number): number {
  magneticFieldEcef(x, y, z, year, B);
  const strength = Math.hypot(B[0], B[1], B[2]);
  const k = sign / strength;
  K[slot] = B[0] * k;
  K[slot + 1] = B[1] * k;
  K[slot + 2] = B[2] * k;
  return strength;
}

/**
 * Follow the field from `start` (km) - along it for sign +1, against it
 * for -1 - until the line leaves the shell between the two radii. The
 * last point is put on the bound it crossed. Fourth-order Runge-Kutta,
 * with steps in proportion to the distance from the centre: the field's
 * own scale.
 */
export function traceFieldLine(start: readonly [number, number, number], sign: 1 | -1, year: number, bounds: TraceBounds): TracedLine {
  const points: number[] = [];
  const strengths: number[] = [];
  let [x, y, z] = start;
  let end: TracedLine['end'] = 'steps';
  for (let step = 0; step < 2000; step++) {
    const r = Math.hypot(x, y, z);
    const h = Math.max(20, Math.min(2500, 0.025 * r));
    const strength = direction(x, y, z, year, sign, 0);
    points.push(x, y, z);
    strengths.push(strength);
    direction(x + (K[0] * h) / 2, y + (K[1] * h) / 2, z + (K[2] * h) / 2, year, sign, 3);
    direction(x + (K[3] * h) / 2, y + (K[4] * h) / 2, z + (K[5] * h) / 2, year, sign, 6);
    direction(x + K[6] * h, y + K[7] * h, z + K[8] * h, year, sign, 9);
    const nx = x + (h / 6) * (K[0] + 2 * K[3] + 2 * K[6] + K[9]);
    const ny = y + (h / 6) * (K[1] + 2 * K[4] + 2 * K[7] + K[10]);
    const nz = z + (h / 6) * (K[2] + 2 * K[5] + 2 * K[8] + K[11]);
    const nr = Math.hypot(nx, ny, nz);
    const crossed = nr < bounds.minRadiusKm ? bounds.minRadiusKm : nr > bounds.maxRadiusKm ? bounds.maxRadiusKm : 0;
    if (crossed > 0) {
      // Land on the bound: a straight cut of the last, short step.
      const t = Math.abs(nr - r) > 1e-9 ? (crossed - r) / (nr - r) : 1;
      const ex = x + (nx - x) * t;
      const ey = y + (ny - y) * t;
      const ez = z + (nz - z) * t;
      magneticFieldEcef(ex, ey, ez, year, B);
      points.push(ex, ey, ez);
      strengths.push(Math.hypot(B[0], B[1], B[2]));
      end = crossed === bounds.minRadiusKm ? 'inner' : 'outer';
      break;
    }
    x = nx;
    y = ny;
    z = nz;
  }
  return { points, strengths, end };
}

/** +1 if the field at a point heads away from the Earth's centre, -1 if toward it. */
export function outwardSign(point: readonly [number, number, number], year: number): 1 | -1 {
  magneticFieldEcef(point[0], point[1], point[2], year, B);
  return B[0] * point[0] + B[1] * point[1] + B[2] * point[2] >= 0 ? 1 : -1;
}

/**
 * Points of the model's surface on a grid of geomagnetic (centred-dipole)
 * latitude and longitude, km: the feet from which a cage of field lines
 * is traced. Longitude 0 is the meridian through the geographic south pole.
 */
export function dipoleFootpoints(latitudesDeg: readonly number[], longitudes: number, year: number, radiusKm = SURFACE_KM): [number, number, number][] {
  const pole = geomagneticNorthPole(year);
  const lat = pole.lat * DEG;
  const lon = pole.lon * DEG;
  // The dipole axis, and two axes square to it.
  const m = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const e1 = [Math.sin(lat) * Math.cos(lon), Math.sin(lat) * Math.sin(lon), -Math.cos(lat)];
  const e2 = [m[1] * e1[2] - m[2] * e1[1], m[2] * e1[0] - m[0] * e1[2], m[0] * e1[1] - m[1] * e1[0]];
  const feet: [number, number, number][] = [];
  for (const latitude of latitudesDeg) {
    for (let i = 0; i < longitudes; i++) {
      const phi = (i / longitudes) * 2 * Math.PI;
      const c = Math.cos(latitude * DEG);
      const s = Math.sin(latitude * DEG);
      feet.push([
        radiusKm * (s * m[0] + c * (Math.cos(phi) * e1[0] + Math.sin(phi) * e2[0])),
        radiusKm * (s * m[1] + c * (Math.cos(phi) * e1[1] + Math.sin(phi) * e2[1])),
        radiusKm * (s * m[2] + c * (Math.cos(phi) * e1[2] + Math.sin(phi) * e2[2])),
      ]);
    }
  }
  return feet;
}

/** Geomagnetic latitude (degrees) of a point, by the centred dipole. */
export function geomagneticLatitude(point: readonly [number, number, number], year: number): number {
  const pole = geomagneticNorthPole(year);
  const lat = pole.lat * DEG;
  const lon = pole.lon * DEG;
  const r = Math.hypot(point[0], point[1], point[2]);
  const dot = (point[0] * Math.cos(lat) * Math.cos(lon) + point[1] * Math.cos(lat) * Math.sin(lon) + point[2] * Math.sin(lat)) / r;
  return Math.asin(Math.max(-1, Math.min(1, dot))) / DEG;
}

/** Colour for a field strength: from deep blue where it is a hundred nanotesla, through cyan, to warm white at the surface's tens of thousands. */
export function strengthColor(nT: number, out: number[] | Float32Array, offset = 0): number {
  const t = Math.max(0, Math.min(1, (Math.log10(Math.max(nT, 1)) - 2) / 2.8));
  const low = [0.3, 0.4, 1.0];
  const mid = [0.3, 0.9, 1.0];
  const high = [1.0, 0.93, 0.6];
  const [a, b, u] = t < 0.5 ? [low, mid, t * 2] : [mid, high, t * 2 - 1];
  for (let i = 0; i < 3; i++) out[offset + i] = a[i] + (b[i] - a[i]) * u;
  return t;
}
