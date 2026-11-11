/**
 * The SKS splitting stations (app/public/geo/sks-splitting.json, from
 * tools/pipeline/generate_sks_splitting.py) and the bars that draw them,
 * free of three.js's scene so the test can hold the geometry.
 *
 * Each station with splitting is a bar through it along the fast direction,
 * its length the delay: the longer, the more anisotropic rock the wave
 * crossed. A station whose waves all arrived unsplit is a small ring.
 */

import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { rampColor, type RampStop } from '../weather/ramps';

export interface SksFile {
  readonly source: string;
  readonly fields: number;
  /** lon*100, lat*100, phi (deg east of north), dt*100 (s), split rows, null rows, R*100; per station. */
  readonly stations: readonly number[];
}

export interface SksStation {
  readonly lon: number;
  readonly lat: number;
  /** Fast direction, degrees east of north, 0..180. */
  readonly phi: number;
  /** Mean delay, s; 0 where every wave arrived unsplit. */
  readonly dt: number;
  readonly split: number;
  readonly nulls: number;
  /** How well one direction describes the station's measurements, 0..1. */
  readonly r: number;
}

/** Half a bar per second of delay: a 1 s station's bar is 90 km long. */
export const HALF_BAR_KM_PER_S = 45;
/** No bar shorter than this delay's: a 0.1 s bar would be a dot. */
export const MIN_BAR_S = 0.25;
export const NULL_RING_KM = 18;
const NULL_RING_STEPS = 10;

/** Colour by delay: cyan short, green about a second, yellow long. */
export const SKS_RAMP: readonly RampStop[] = [
  [0.3, 0x6ee7ff],
  [1.0, 0x8dff8a],
  [2.0, 0xf6ff6a],
];
export const NULL_COLOR = 0xb0b8c4;

export function decodeStations(file: SksFile): SksStation[] {
  const out: SksStation[] = [];
  const s = file.stations;
  for (let i = 0; i + file.fields <= s.length; i += file.fields) {
    out.push({ lon: s[i] / 100, lat: s[i + 1] / 100, phi: s[i + 2], dt: s[i + 3] / 100, split: s[i + 4], nulls: s[i + 5], r: s[i + 6] / 100 });
  }
  return out;
}

/** Unit vectors up, north and east at a place. */
function frame(lonDeg: number, latDeg: number): [number[], number[], number[]] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  return [up, north, east];
}

export interface SksGeometry {
  /** Segment endpoints, ECEF metres, six numbers a segment. */
  readonly positions: Float32Array;
  /** Display colour 0..1 at each endpoint. */
  readonly colors: Float32Array;
}

/** The bars of the stations with splitting: through the station, along phi, dimmed where the directions scatter. */
export function barGeometry(stations: readonly SksStation[], radiusM: number = EARTH_RADIUS_M): SksGeometry {
  const split = stations.filter((s) => s.split > 0);
  const positions = new Float32Array(split.length * 6);
  const colors = new Float32Array(split.length * 6);
  split.forEach((s, k) => {
    const [up, north, east] = frame(s.lon, s.lat);
    const phi = (s.phi * Math.PI) / 180;
    const arc = (Math.max(s.dt, MIN_BAR_S) * HALF_BAR_KM_PER_S * 1000) / radiusM;
    const along = Math.cos(arc) * radiusM;
    const across = Math.sin(arc) * radiusM;
    const [r, g, b] = rampColor(SKS_RAMP, s.dt);
    const strength = (0.45 + 0.55 * s.r) / 255;
    for (let end = 0; end < 2; end++) {
      const sign = end === 0 ? -1 : 1;
      for (let axis = 0; axis < 3; axis++) {
        const direction = north[axis] * Math.cos(phi) + east[axis] * Math.sin(phi);
        positions[k * 6 + end * 3 + axis] = up[axis] * along + sign * direction * across;
      }
      colors.set([r * strength, g * strength, b * strength], k * 6 + end * 3);
    }
  });
  return { positions, colors };
}

/** Rings at the stations where every wave arrived unsplit. */
export function nullRingPositions(stations: readonly SksStation[], radiusM: number = EARTH_RADIUS_M): Float32Array {
  const only = stations.filter((s) => s.split === 0);
  const out = new Float32Array(only.length * NULL_RING_STEPS * 6);
  const arc = (NULL_RING_KM * 1000) / radiusM;
  let w = 0;
  for (const s of only) {
    const [up, north, east] = frame(s.lon, s.lat);
    const point = (i: number): number[] => {
      const angle = (i / NULL_RING_STEPS) * 2 * Math.PI;
      return [0, 1, 2].map(
        (a) => up[a] * Math.cos(arc) * radiusM + (north[a] * Math.cos(angle) + east[a] * Math.sin(angle)) * Math.sin(arc) * radiusM
      );
    };
    for (let i = 0; i < NULL_RING_STEPS; i++) {
      out.set(point(i), w);
      out.set(point(i + 1), w + 3);
      w += 6;
    }
  }
  return out;
}
