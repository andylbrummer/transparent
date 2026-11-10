/**
 * The transient sky: things that happened once - a burst, an explosion, a
 * merger, one neutrino - each at its place on the celestial sphere and at
 * its time. The files under app/public/sky/transients/ come from
 * tools/pipeline/generate_transients.py, sorted by time.
 *
 * The app clock decides what is shown: an event appears at the moment it
 * was seen and not before, so with ?time= pinned to 2016 the sky holds
 * the three gravitational-wave detections there were. Nothing is
 * extrapolated past a catalogue's end either - the chip names the date of
 * its last event.
 */

import * as THREE from 'three';
import { raDecToUnit } from '@transparent-earth/core';
import { SkyLines, SkyPoints, type SkyPointShape } from '../../render/sky-points';
import type { GroupLabel, LabelGroup } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import type { TransientSpec } from './layer';

/** The shape of a baked file: columns in time order. */
export interface TransientData {
  readonly quantumPerDegree: number;
  readonly classes: readonly string[];
  /** Days since 2000-01-01T00:00Z, ascending. */
  readonly t: readonly number[];
  readonly ra: readonly number[];
  readonly dec: readonly number[];
  /** Index into `classes`. */
  readonly cls: readonly number[];
  readonly val: readonly number[];
  /** [row, text, priority], most important first. */
  readonly labels: readonly (readonly [number, string, number])[];
  /** [row, ra−, ra+, dec−, dec+] degrees: the error rectangle about the row's position. */
  readonly boxes?: readonly (readonly [number, number, number, number, number])[];
  /** Pixel centres of a credible region, in the file's quantum, by row. */
  readonly regions?: readonly { readonly row: number; readonly ra: readonly number[]; readonly dec: readonly number[] }[];
}

const J2000_MS = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Longest step along a box edge, degrees: a side at constant declination is a curve. */
const BOX_STEP_DEG = 1;
const BOX_OPACITY = 0.38;
const LABEL_FONT_PX = 10;
const LABEL_OFFSET_PX = 11;

/** The app clock in the files' time unit. */
export function daysSince2000(date: Date): number {
  return (date.getTime() - J2000_MS) / DAY_MS;
}

/** "9 Oct 2022" (UTC) for a time in days since 2000. */
export function dayText(days: number): string {
  const d = new Date(J2000_MS + days * DAY_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** How many of the ascending `times` are at or before `now`. */
export function countUpTo(times: ArrayLike<number>, now: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= now) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function direction(data: TransientData, row: number): [number, number, number] {
  return raDecToUnit(data.ra[row] / data.quantumPerDegree, data.dec[row] / data.quantumPerDegree);
}

/** Points of one marker shape (a shape is a material), in time order, with each point's time. */
export interface TimedBatch {
  readonly shape: SkyPointShape;
  readonly times: Float64Array;
  readonly directions: Float32Array;
  readonly sizes: Float32Array;
  readonly colors: Float32Array;
  readonly alphas: Float32Array;
}

/** The events' markers. A row whose size comes out zero has no marker (an event too poorly placed to point at). */
export function buildMarkers(data: TransientData, spec: TransientSpec): TimedBatch[] {
  const rowsByShape = new Map<SkyPointShape, number[]>();
  for (let row = 0; row < data.t.length; row++) {
    const className = data.classes[data.cls[row]];
    const style = spec.classes[className];
    if (!style || spec.sizePx(data.val[row], className) <= 0) continue;
    const rows = rowsByShape.get(style.shape);
    if (rows) rows.push(row);
    else rowsByShape.set(style.shape, [row]);
  }
  return [...rowsByShape].map(([shape, rows]) => {
    const batch: TimedBatch = {
      shape,
      times: new Float64Array(rows.length),
      directions: new Float32Array(rows.length * 3),
      sizes: new Float32Array(rows.length),
      colors: new Float32Array(rows.length * 3),
      alphas: new Float32Array(rows.length),
    };
    rows.forEach((row, i) => {
      const className = data.classes[data.cls[row]];
      batch.times[i] = data.t[row];
      batch.directions.set(direction(data, row), i * 3);
      batch.sizes[i] = spec.sizePx(data.val[row], className);
      batch.colors.set(hexToRgb(spec.classes[className].color), i * 3);
      batch.alphas[i] = spec.alpha?.(data.val[row], className) ?? 1;
    });
    return batch;
  });
}

/** Region pixels of every event as one cloud in time order; `times` has one entry per point. */
export function buildRegions(data: TransientData, spec: TransientSpec): Omit<TimedBatch, 'shape'> | null {
  const regions = data.regions;
  if (!regions || !spec.region) return null;
  const count = regions.reduce((sum, region) => sum + region.ra.length, 0);
  const batch = {
    times: new Float64Array(count),
    directions: new Float32Array(count * 3),
    sizes: new Float32Array(count).fill(spec.region.sizePx),
    colors: new Float32Array(count * 3),
    alphas: new Float32Array(count).fill(spec.region.alpha),
  };
  let i = 0;
  for (const region of regions) {
    const style = spec.classes[data.classes[data.cls[region.row]]];
    const color = hexToRgb(style?.color ?? '#ffffff');
    for (let k = 0; k < region.ra.length; k++, i++) {
      batch.times[i] = data.t[region.row];
      batch.directions.set(raDecToUnit(region.ra[k] / data.quantumPerDegree, region.dec[k] / data.quantumPerDegree), i * 3);
      batch.colors.set(color, i * 3);
    }
  }
  return batch;
}

/**
 * Outlines of the error rectangles as line segments (six numbers each), in
 * time order, with the number of segments each box took so a draw range
 * can stop at a time. The catalogue's rectangle is in right ascension and
 * declination, so its sides are followed in those coordinates.
 */
export function buildBoxes(data: TransientData): { segments: Float32Array; times: Float64Array; segmentEnds: Uint32Array } | null {
  const boxes = data.boxes;
  if (!boxes) return null;
  const out: number[] = [];
  const times = new Float64Array(boxes.length);
  const segmentEnds = new Uint32Array(boxes.length);
  boxes.forEach(([row, raMinus, raPlus, decMinus, decPlus], index) => {
    const ra = data.ra[row] / data.quantumPerDegree;
    const dec = data.dec[row] / data.quantumPerDegree;
    const south = Math.max(-90, dec - decMinus);
    const north = Math.min(90, dec + decPlus);
    const corners: [number, number][] = [
      [ra - raMinus, south],
      [ra + raPlus, south],
      [ra + raPlus, north],
      [ra - raMinus, north],
    ];
    for (let side = 0; side < 4; side++) {
      const [ra0, dec0] = corners[side];
      const [ra1, dec1] = corners[(side + 1) % 4];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(ra1 - ra0), Math.abs(dec1 - dec0)) / BOX_STEP_DEG));
      for (let step = 0; step < steps; step++) {
        const a = step / steps;
        const b = (step + 1) / steps;
        out.push(
          ...raDecToUnit(ra0 + (ra1 - ra0) * a, dec0 + (dec1 - dec0) * a),
          ...raDecToUnit(ra0 + (ra1 - ra0) * b, dec0 + (dec1 - dec0) * b)
        );
      }
    }
    times[index] = data.t[row];
    segmentEnds[index] = out.length / 6;
  });
  return { segments: new Float32Array(out), times, segmentEnds };
}

/** The names of events that have happened by `now`, in the file's order of importance. */
export function labelsUpTo(data: TransientData, now: number): GroupLabel[] {
  const labels: GroupLabel[] = [];
  for (const [row, text, priority] of data.labels) {
    if (data.t[row] > now) continue;
    const [x, y, z] = direction(data, row);
    labels.push({ text, priority, position: new THREE.Vector3(x, y, z) });
  }
  return labels;
}

/** The chip: how much of the catalogue the clock has reached, and where the catalogue ends. */
export function transientStatus(data: TransientData, now: number, noun: string, span?: string): string {
  const total = data.t.length;
  const shown = countUpTo(data.t, now);
  const end = total > 0 ? dayText(data.t[total - 1]) : '';
  if (shown === 0) return `none yet at this date · catalogue ${dayText(data.t[0])} – ${end}`;
  if (shown < total) return `${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${noun} by this date`;
  return `${total.toLocaleString('en-US')} ${noun} · ${span ?? `catalogue to ${end}`}`;
}

export async function createTransientLayer(context: LayerContext, spec: TransientSpec): Promise<LayerInstance> {
  const data = await context.fetchJson<TransientData>(context.assetUrl(spec.file));

  const timed: { object: THREE.Object3D; times: Float64Array; perItem: number; ends?: Uint32Array; dispose(): void }[] = [];
  const regions = buildRegions(data, spec);
  if (regions) {
    const points = new SkyPoints(regions.directions, regions.sizes, regions.colors, context.skyUniforms, { name: `${spec.id}-regions`, shape: 'disc' }, regions.alphas);
    timed.push({ object: points.object, times: regions.times, perItem: 1, dispose: () => points.dispose() });
  }
  const boxes = buildBoxes(data);
  if (boxes && spec.boxColor) {
    const lines = new SkyLines(boxes.segments, parseInt(spec.boxColor.slice(1), 16), BOX_OPACITY, context.skyUniforms, `${spec.id}-boxes`);
    timed.push({ object: lines.object, times: boxes.times, perItem: 2, ends: boxes.segmentEnds, dispose: () => lines.dispose() });
  }
  for (const batch of buildMarkers(data, spec)) {
    const points = new SkyPoints(batch.directions, batch.sizes, batch.colors, context.skyUniforms, { name: `${spec.id}-${batch.shape}`, shape: batch.shape }, batch.alphas);
    timed.push({ object: points.object, times: batch.times, perItem: 1, dispose: () => points.dispose() });
  }
  for (const drawn of timed) context.skyRoot.add(drawn.object);

  const labelTimes = Float64Array.from(data.labels.map(([row]) => data.t[row])).sort();
  let labels: LabelGroup | null = null;
  let labelled = -1;
  let shown = -1;
  let visible = false;

  const apply = (date: Date): void => {
    const now = daysSince2000(date);
    const count = countUpTo(data.t, now);
    if (count !== shown) {
      shown = count;
      for (const drawn of timed) {
        const items = countUpTo(drawn.times, now);
        const drawCount = drawn.ends ? (items > 0 ? drawn.ends[items - 1] : 0) * drawn.perItem : items * drawn.perItem;
        (drawn.object as THREE.Points | THREE.LineSegments).geometry.setDrawRange(0, drawCount);
      }
      context.setStatus(transientStatus(data, now, spec.noun, spec.span), 'info');
    }
    const named = countUpTo(labelTimes, now);
    if (named !== labelled) {
      labelled = named;
      labels?.remove();
      labels = context.addLabels({
        rank: spec.labelRank,
        style: { fontPx: LABEL_FONT_PX, color: spec.labelColor, offsetYPx: LABEL_OFFSET_PX },
        frame: 'sky',
        labels: labelsUpTo(data, now),
      });
      labels.setVisible(visible);
    }
  };
  apply(context.now());

  return {
    setVisible(next) {
      visible = next;
      for (const drawn of timed) drawn.object.visible = next;
      labels?.setVisible(next);
    },
    update(frame) {
      apply(frame.date);
    },
    dispose() {
      for (const drawn of timed) drawn.dispose();
      labels?.remove();
    },
  };
}
