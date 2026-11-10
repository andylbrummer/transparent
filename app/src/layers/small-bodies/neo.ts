/**
 * Asteroids passing within ten lunar distances of the Earth: where each
 * one is in the sky during the days round its closest approach.
 *
 * The list and the positions are baked (app/public/sky/neo-approaches.json,
 * tools/pipeline/generate_neo_approaches.py: JPL CNEOS close-approach data
 * and JPL Horizons vectors; neither service allows a browser to ask it
 * directly). A two-body orbit is no use this close to the Earth, so each
 * object has a table of geocentric positions that is interpolated here,
 * and is shown only inside its table. Seen from the surface rather than
 * the centre: at one lunar distance the two differ by a degree.
 */

import * as THREE from 'three';
import { julianEphemerisDate, observerIcrsM } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import type { GroupLabel, LabelGroup } from '../../render/labels';
import { SkyPoints } from '../../render/sky-points';
import type { LayerContext, LayerInstance, StatusTone } from '../types';

export interface Approach {
  /** JPL designation, e.g. "2026 RH10" or "535844". */
  readonly des: string;
  /** Closest approach: Julian date (TDB) and "2026-Sep-10 06:39". */
  readonly jd: number;
  readonly date: string;
  /** Nominal miss distance, centre to centre, lunar distances; and its 3-sigma range. */
  readonly distLd: number;
  readonly distMinLd: number;
  readonly distMaxLd: number;
  /** Speed relative to the Earth at closest approach, km/s. */
  readonly vRel: number;
  readonly h: number | null;
  /** Measured diameter, metres, for the few that have one. */
  readonly diameterM?: number;
  /** 1-sigma uncertainty of the time of closest approach, minutes. */
  readonly sigmaMin: number;
  /** The position table, absent where the time is too uncertain: first sample (JD TDB), spacing, km from the Earth's centre (ICRF). */
  readonly t0?: number;
  readonly stepMin?: number;
  readonly xyz?: readonly number[];
}

/** The shape of app/public/sky/neo-approaches.json. */
export interface ApproachData {
  /** YYYY-MM-DD: the day the list was fetched; and the span of approach dates it covers. */
  readonly baked: string;
  readonly from: string;
  readonly to: string;
  readonly ldKm: number;
  readonly approaches: readonly Approach[];
}

/**
 * Where the object is at `jd` (TDB): km from the Earth's centre, ICRF,
 * into `out`, by a cubic through the four samples round the date. False
 * outside the table - nothing is extrapolated.
 */
export function approachPositionKm(approach: Approach, jd: number, out: number[]): boolean {
  const { t0, stepMin, xyz } = approach;
  if (t0 === undefined || stepMin === undefined || xyz === undefined) return false;
  const count = xyz.length / 3;
  const steps = ((jd - t0) * 1440) / stepMin;
  if (!(steps >= 0 && steps <= count - 1)) return false;
  // The four samples i0..i0+3 with the date between the middle two, where the table allows.
  const i0 = Math.min(count - 4, Math.max(0, Math.floor(steps) - 1));
  const u = steps - i0;
  // Lagrange weights for nodes 0, 1, 2, 3.
  const w0 = (-(u - 1) * (u - 2) * (u - 3)) / 6;
  const w1 = (u * (u - 2) * (u - 3)) / 2;
  const w2 = (-u * (u - 1) * (u - 3)) / 2;
  const w3 = (u * (u - 1) * (u - 2)) / 6;
  for (let axis = 0; axis < 3; axis++) {
    const k = i0 * 3 + axis;
    out[axis] = w0 * xyz[k] + w1 * xyz[k + 3] + w2 * xyz[k + 6] + w3 * xyz[k + 9];
  }
  return true;
}

const SCRATCH_KM: number[] = [];

/**
 * Unit vector (ICRS) from a user at `lat`, `lon` on the surface toward the
 * object at `date`, into `out`; returns its distance from the Earth's
 * centre in km, or null outside its table. From the surface, not the
 * centre: at one lunar distance the two directions differ by a degree.
 */
export function approachDirection(approach: Approach, date: Date, lat: number, lon: number, out: number[]): number | null {
  const km = SCRATCH_KM;
  if (!approachPositionKm(approach, julianEphemerisDate(date), km)) return null;
  const observer = observerIcrsM(lat, lon, 0, date);
  const x = km[0] - observer[0] / 1000;
  const y = km[1] - observer[1] / 1000;
  const z = km[2] - observer[2] / 1000;
  const range = Math.hypot(x, y, z);
  out[0] = x / range;
  out[1] = y / range;
  out[2] = z / range;
  return Math.hypot(km[0], km[1], km[2]);
}

/**
 * How big, as text. Measured where CNEOS has a diameter; otherwise the
 * range the absolute magnitude H allows for albedos from 0.25 (bright,
 * stony) to 0.05 (dark, carbonaceous) - D = 1329 km × 10^(−H/5) / √albedo,
 * the convention CNEOS's own tables use.
 */
export function sizeText(approach: Approach): string {
  const metres = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m < 10 ? m.toFixed(1) : Math.round(m)} m`);
  if (approach.diameterM !== undefined) return metres(approach.diameterM);
  if (approach.h === null) return 'size unknown';
  const base = 1329000 * 10 ** (-approach.h / 5);
  const small = base / Math.sqrt(0.25);
  const large = base / Math.sqrt(0.05);
  return large >= 1000 ? `~${(small / 1000).toFixed(1)}–${(large / 1000).toFixed(1)} km` : `~${metres(small).replace(' m', '')}–${metres(large)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10 Sep" from CNEOS's "2026-Sep-10 06:39". */
export function shortDate(date: string): string {
  const [, month, day] = /^\d{4}-([A-Za-z]{3})-(\d{2})/.exec(date) ?? [];
  return month ? `${Number(day)} ${month}` : date;
}

const ld = (value: number): string => (value < 1 ? value.toFixed(2) : value.toFixed(1));

/** "2026 RH10 · 3.2 LD, closing to 0.65 on 10 Sep · ~7–16 m" */
export function approachLabel(approach: Approach, distanceNowLd: number, jd: number): string {
  const verb = jd < approach.jd ? 'closing to' : 'passed at';
  return `${approach.des} · ${ld(distanceNowLd)} LD, ${verb} ${ld(approach.distLd)} on ${shortDate(approach.date)} · ${sizeText(approach)}`;
}

/** Marker size, CSS px: 14 inside one lunar distance, 8 at ten. */
export function approachSizePx(distanceNowLd: number): number {
  return 8 + 6 * Math.min(1, Math.max(0, 1 - Math.log10(Math.max(distanceNowLd, 1))));
}

const DAY_MS = 86400000;
const isoDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/**
 * The chip: how many are passing, and the next to come - or, off the ends
 * of the list, that there is nothing to show. A list baked days ago misses
 * what has been found since (small asteroids are mostly found within days
 * of passing), so past the bake date it is marked stale.
 */
export function approachStatus(data: ApproachData, date: Date, jd: number, passing: number): { text: string; tone: StatusTone } {
  const from = Date.parse(`${data.from}T00:00:00Z`);
  const to = Date.parse(`${data.to}T00:00:00Z`) + DAY_MS;
  const ms = date.getTime();
  if (ms < from || ms > to) return { text: `no list for this date · covers ${isoDate(data.from)} – ${isoDate(data.to)}`, tone: 'error' };
  const next = data.approaches.find((a) => a.jd > jd);
  const upcoming = next ? ` · next ${next.des}, ${ld(next.distLd)} LD on ${shortDate(next.date)}` : '';
  const stale = ms > Date.parse(`${data.baked}T00:00:00Z`) + 3 * DAY_MS;
  return {
    text: `${passing} passing${upcoming} · list of ${isoDate(data.baked)}${stale ? ', later finds missing' : ''}`,
    tone: stale ? 'stale' : 'info',
  };
}

const UPDATE_INTERVAL_MS = 1000;
export const APPROACH_COLOR: readonly [number, number, number] = [1.0, 0.5, 0.32];

export async function createApproachLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<ApproachData>(context.assetUrl('sky/neo-approaches.json'));
  const approaches = data.approaches;
  const count = approaches.length;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(APPROACH_COLOR, i * 3);
  const points = new SkyPoints(
    new Float32Array(count * 3).fill(1),
    new Float32Array(count),
    colors,
    context.skyUniforms,
    { name: 'neo-approaches', shape: 'square', renderOrder: RENDER_ORDER.sky + 0.013, additive: false }
  );
  context.skyRoot.add(points.object);
  const size = points.object.geometry.getAttribute('aSize') as THREE.BufferAttribute;
  const positions = approaches.map(() => new THREE.Vector3(1, 0, 0));
  const direction: number[] = [];
  let labels: LabelGroup | null = null;
  let shown = '';
  let visible = false;
  let lastMs = NaN;

  return {
    setVisible(next) {
      visible = next;
      points.object.visible = next;
      labels?.setVisible(next);
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (Math.abs(ms - lastMs) < UPDATE_INTERVAL_MS) return;
      lastMs = ms;
      const jd = julianEphemerisDate(frame.date);
      const named: GroupLabel[] = [];
      approaches.forEach((approach, i) => {
        const geocentricKm = approachDirection(approach, frame.date, frame.position.lat, frame.position.lon, direction);
        if (geocentricKm === null) {
          size.setX(i, 0);
          return;
        }
        const geocentricLd = geocentricKm / data.ldKm;
        positions[i].set(direction[0], direction[1], direction[2]);
        points.positions.setXYZ(i, direction[0], direction[1], direction[2]);
        size.setX(i, approachSizePx(geocentricLd));
        named.push({ text: approachLabel(approach, geocentricLd, jd), priority: geocentricLd, position: positions[i] });
      });
      points.positions.needsUpdate = true;
      size.needsUpdate = true;
      const joined = named.map((label) => label.text).join('|');
      if (joined !== shown || !labels) {
        shown = joined;
        labels?.remove();
        // With the other small bodies' names, just behind the planets'.
        labels = context.addLabels({ rank: 6.353, style: { fontPx: 10, color: '#ffb48f', offsetYPx: 12 }, frame: 'sky', labels: named });
        labels.setVisible(visible);
      }
      const status = approachStatus(data, frame.date, jd, named.length);
      context.setStatus(status.text, status.tone);
    },
    dispose() {
      points.dispose();
      labels?.remove();
    },
  };
}
