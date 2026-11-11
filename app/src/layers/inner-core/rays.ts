/**
 * Rays through the inner core (app/public/geo/inner-core.json, from
 * tools/pipeline/generate_inner_core.py; Frost et al. 2021): decoding,
 * colour and the segments drawn. Free of the scene, so it is tested alone.
 *
 * Each ray is drawn as two straight legs, from where it enters the inner
 * core down to where it turns and up to where it leaves: inside the inner
 * core a ray bends so little that a straight chord turns within 12 km of
 * it (the bake's check). Its colour is its residual: blue arrived early
 * (faster than the model), red late, the convention of the mantle slices.
 */

import type { RampStop } from '../weather/ramps';
import { rampColor } from '../weather/ramps';

export interface InnerCoreData {
  readonly source: string;
  readonly innerCoreRadiusKm: number;
  readonly quantumPerDegree: number;
  readonly residualQuantumS: number;
  /** Names of the integers per ray in `rays`. */
  readonly fields: readonly string[];
  readonly studies: readonly string[];
  readonly rays: readonly number[];
}

export interface InnerCoreRay {
  readonly entryLon: number;
  readonly entryLat: number;
  readonly exitLon: number;
  readonly exitLat: number;
  readonly turnDepthKm: number;
  /** Seconds; positive: the wave through the inner core arrived early. */
  readonly residualS: number;
  /** Measured against PKP(BC) rather than PKP(AB). */
  readonly bcDf: boolean;
  readonly study: string;
}

const FIELDS = ['entryLon', 'entryLat', 'exitLon', 'exitLat', 'turnDepthKm', 'residual', 'bcDf', 'study'];

export function decodeRays(data: InnerCoreData): InnerCoreRay[] {
  if (data.fields.join() !== FIELDS.join()) throw new Error(`inner-core.json fields changed: ${data.fields.join()}`);
  const n = FIELDS.length;
  const q = data.quantumPerDegree;
  const rays: InnerCoreRay[] = [];
  for (let i = 0; i + n <= data.rays.length; i += n) {
    const r = data.rays;
    rays.push({
      entryLon: r[i] / q,
      entryLat: r[i + 1] / q,
      exitLon: r[i + 2] / q,
      exitLat: r[i + 3] / q,
      turnDepthKm: r[i + 4],
      residualS: r[i + 5] * data.residualQuantumS,
      bcDf: r[i + 6] === 1,
      study: data.studies[r[i + 7]],
    });
  }
  return rays;
}

const DEG = Math.PI / 180;

type Vec = [number, number, number];

function unit(lonDeg: number, latDeg: number): Vec {
  const c = Math.cos(latDeg * DEG);
  return [c * Math.cos(lonDeg * DEG), c * Math.sin(lonDeg * DEG), Math.sin(latDeg * DEG)];
}

/** The ray's angle to the Earth's axis, 0-90 degrees: the angle of its chord, as the file's xi. */
export function axisAngleDeg(ray: InnerCoreRay): number {
  const a = unit(ray.entryLon, ray.entryLat);
  const b = unit(ray.exitLon, ray.exitLat);
  const d: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  return Math.acos(Math.min(1, Math.abs(d[2]) / length)) / DEG;
}

/**
 * Late (slow) red, early (fast) blue; seconds. Nothing is a dim grey, not
 * pale: most rays are near nothing, and drawn pale they wash the ball white
 * over the few that are not.
 */
export const RESIDUAL_RAMP: readonly RampStop[] = [
  [-3, 0xff5a3c],
  [-1, 0xa8553f],
  [0, 0x454a55],
  [1.5, 0x3f7fb8],
  [4, 0x7cc4ff],
];

/** Grey of the Earth's axis drawn through the ball, so the angle to it can be read. */
const AXIS_COLOR = 0xb9c2cc;

export interface RaySegments {
  /** x0,y0,z0, x1,y1,z1 per segment, ECEF metres. */
  readonly positions: Float32Array;
  /** r,g,b per vertex, 0..1. */
  readonly colors: Float32Array;
}

/**
 * Two legs per ray (entry - turning point - exit), the turning point under
 * the middle of the chord at the file's depth; then the axis, pole to pole
 * of the inner core.
 */
export function raySegments(rays: readonly InnerCoreRay[], innerCoreRadiusKm: number, earthRadiusKm: number): RaySegments {
  const positions = new Float32Array((rays.length * 2 + 1) * 6);
  const colors = new Float32Array(positions.length);
  const r = innerCoreRadiusKm * 1000;
  let p = 0;
  const put = (v: Vec, scale: number, rgb: Vec): void => {
    positions[p] = v[0] * scale;
    positions[p + 1] = v[1] * scale;
    positions[p + 2] = v[2] * scale;
    colors[p] = rgb[0];
    colors[p + 1] = rgb[1];
    colors[p + 2] = rgb[2];
    p += 3;
  };
  // The strongest last, on top.
  const ordered = [...rays].sort((x, y) => Math.abs(x.residualS) - Math.abs(y.residualS));
  for (const ray of ordered) {
    const a = unit(ray.entryLon, ray.entryLat);
    const b = unit(ray.exitLon, ray.exitLat);
    const m: Vec = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const ml = Math.hypot(m[0], m[1], m[2]);
    const mid: Vec = [m[0] / ml, m[1] / ml, m[2] / ml];
    const turnM = (earthRadiusKm - ray.turnDepthKm) * 1000;
    const [cr, cg, cb] = rampColor(RESIDUAL_RAMP, ray.residualS);
    const rgb: Vec = [cr / 255, cg / 255, cb / 255];
    put(a, r, rgb);
    put(mid, turnM, rgb);
    put(mid, turnM, rgb);
    put(b, r, rgb);
  }
  const grey: Vec = [((AXIS_COLOR >> 16) & 255) / 255, ((AXIS_COLOR >> 8) & 255) / 255, (AXIS_COLOR & 255) / 255];
  put([0, 0, 1], r, grey);
  put([0, 0, -1], r, grey);
  return { positions, colors };
}

/** Median residual of the rays within [loDeg, hiDeg) of the axis, seconds; NaN if none. */
export function medianResidual(rays: readonly InnerCoreRay[], loDeg: number, hiDeg: number): number {
  const values = rays
    .filter((ray) => {
      const xi = axisAngleDeg(ray);
      return xi >= loDeg && xi < hiDeg;
    })
    .map((ray) => ray.residualS)
    .sort((x, y) => x - y);
  if (values.length === 0) return NaN;
  const h = values.length >> 1;
  return values.length % 2 ? values[h] : (values[h - 1] + values[h]) / 2;
}
