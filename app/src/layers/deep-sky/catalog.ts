/**
 * Catalogued objects of the faint and invisible sky, from the files under
 * app/public/sky/deep/ (tools/pipeline/generate_deepsky.py): markers by
 * class, true-size outlines where the catalogue gives a size, and names.
 */

import * as THREE from 'three';
import { raDecToUnit } from '@transparent-earth/core';
import { SkyLines, SkyPoints, type SkyPointShape } from '../../render/sky-points';
import type { GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import type { CatalogSpec, CloudSpec, DeepSkySpec } from './specs';

/** The shape of a catalogue file: columns, plus labels and outlines by row. */
export interface CatalogData {
  readonly quantumPerDegree: number;
  readonly classes: readonly string[];
  readonly ra: readonly number[];
  readonly dec: readonly number[];
  /** Index into `classes`. */
  readonly cls: readonly number[];
  readonly val: readonly number[];
  /** [row, text, priority], most important first. */
  readonly labels: readonly (readonly [number, string, number])[];
  /** [row, major axis arcmin, minor axis arcmin, position angle east of north or −1]. */
  readonly ellipses?: readonly (readonly [number, number, number, number])[];
}

/** The header of a packed point cloud; the points are in `file` beside it. */
export interface CloudMeta {
  readonly count: number;
  readonly file: string;
}

type Vec = readonly [number, number, number];

const DEG = Math.PI / 180;
const ARCMIN = DEG / 60;
/** Segments in an outline: enough that the largest (the Magellanic Clouds) stay round. */
const OUTLINE_SEGMENTS_LARGE = 64;
const OUTLINE_SEGMENTS_SMALL = 24;
const LARGE_OUTLINE_ARCMIN = 60;
const OUTLINE_OPACITY = 0.75;
const LABEL_FONT_PX = 10;
const LABEL_OFFSET_PX = 11;
/** Bytes per point of a packed cloud: uint16 ra, int16 dec, uint16 value. */
const CLOUD_RECORD_BYTES = 6;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * The outline of an ellipse on the sky as line segments (six numbers each):
 * axes are full angular diameters in arcminutes, the position angle is the
 * major axis's, from celestial north through east. A negative angle means
 * the orientation is not known; the caller then passes equal axes.
 */
export function ellipseSegments(
  center: Vec,
  majorArcmin: number,
  minorArcmin: number,
  positionAngleDeg: number,
  out: number[]
): void {
  // Tangent basis at the centre: north, and east (the direction of increasing right ascension).
  const eastLength = Math.hypot(center[0], center[1]);
  // At a celestial pole every direction is south (or north); any basis will do there.
  const east: Vec = eastLength < 1e-9 ? [0, 1, 0] : [-center[1] / eastLength, center[0] / eastLength, 0];
  const north: Vec = [
    center[1] * east[2] - center[2] * east[1],
    center[2] * east[0] - center[0] * east[2],
    center[0] * east[1] - center[1] * east[0],
  ];
  const pa = Math.max(0, positionAngleDeg) * DEG;
  const a = Math.tan((majorArcmin / 2) * ARCMIN);
  const b = Math.tan((minorArcmin / 2) * ARCMIN);
  const segments = majorArcmin >= LARGE_OUTLINE_ARCMIN ? OUTLINE_SEGMENTS_LARGE : OUTLINE_SEGMENTS_SMALL;
  let previous: [number, number, number] | null = null;
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * 2 * Math.PI;
    // Along the major axis, then across it.
    const u = a * Math.cos(t);
    const v = b * Math.sin(t);
    const n = u * Math.cos(pa) - v * Math.sin(pa);
    const e = u * Math.sin(pa) + v * Math.cos(pa);
    const x = center[0] + n * north[0] + e * east[0];
    const y = center[1] + n * north[1] + e * east[1];
    const z = center[2] + n * north[2] + e * east[2];
    const length = Math.hypot(x, y, z);
    const point: [number, number, number] = [x / length, y / length, z / length];
    if (previous) out.push(previous[0], previous[1], previous[2], point[0], point[1], point[2]);
    previous = point;
  }
}

export interface MarkerBatch {
  readonly shape: SkyPointShape;
  readonly directions: Float32Array;
  readonly sizes: Float32Array;
  readonly colors: Float32Array;
  readonly alphas: Float32Array;
}

function direction(data: CatalogData, row: number): [number, number, number] {
  return raDecToUnit(data.ra[row] / data.quantumPerDegree, data.dec[row] / data.quantumPerDegree);
}

/** The catalogue's markers, one batch per marker shape (a shape is a material). */
export function buildMarkers(data: CatalogData, spec: CatalogSpec): MarkerBatch[] {
  const rowsByShape = new Map<SkyPointShape, number[]>();
  for (let row = 0; row < data.ra.length; row++) {
    const style = spec.classes[data.classes[data.cls[row]]];
    if (!style) continue;
    const rows = rowsByShape.get(style.shape);
    if (rows) rows.push(row);
    else rowsByShape.set(style.shape, [row]);
  }
  const batches: MarkerBatch[] = [];
  for (const [shape, rows] of rowsByShape) {
    const directions = new Float32Array(rows.length * 3);
    const sizes = new Float32Array(rows.length);
    const colors = new Float32Array(rows.length * 3);
    const alphas = new Float32Array(rows.length);
    rows.forEach((row, i) => {
      const className = data.classes[data.cls[row]];
      directions.set(direction(data, row), i * 3);
      sizes[i] = spec.sizePx(data.val[row], className);
      colors.set(hexToRgb(spec.classes[className].color), i * 3);
      alphas[i] = spec.alpha?.(data.val[row], className) ?? 1;
    });
    batches.push({ shape, directions, sizes, colors, alphas });
  }
  return batches;
}

/** Outline segments grouped by colour (a colour is a material). */
export function buildOutlines(data: CatalogData, spec: CatalogSpec): Map<string, Float32Array> {
  const byColor = new Map<string, number[]>();
  for (const [row, major, minor, angle] of data.ellipses ?? []) {
    const style = spec.classes[data.classes[data.cls[row]]];
    if (!style) continue;
    let segments = byColor.get(style.color);
    if (!segments) {
      segments = [];
      byColor.set(style.color, segments);
    }
    ellipseSegments(direction(data, row), major, minor, angle, segments);
  }
  return new Map([...byColor].map(([color, segments]) => [color, new Float32Array(segments)]));
}

/**
 * A name as a label shows it. A survey designation that spells the
 * position out to a fraction of an arcsecond ("2MASS J12073346-3932539")
 * is cut to the minutes, as such names are commonly quoted ("2MASS
 * J1207-3932"): the same name, at a length a label can carry. Anything
 * after the designation (" · 1 planet") is kept.
 */
export function displayName(text: string): string {
  return text.replace(/\bJ(\d{4})\d{2,}(?:\.\d+)?([+-]\d{4})\d{2,}(?:\.\d+)?/, 'J$1$2');
}

export function catalogLabels(data: CatalogData): GroupLabel[] {
  return data.labels.map(([row, text, priority]) => {
    const [x, y, z] = direction(data, row);
    return { text: displayName(text), priority, position: new THREE.Vector3(x, y, z) };
  });
}

/** The names in their declutter groups: the spec's featured few at their own rank, the rest at the catalogue's. */
export function splitFeatured(
  labels: readonly GroupLabel[],
  spec: Pick<CatalogSpec, 'labelRank' | 'featured'>
): { rank: number; labels: GroupLabel[] }[] {
  const featured = spec.featured;
  if (!featured) return [{ rank: spec.labelRank, labels: [...labels] }];
  return [
    { rank: featured.rank, labels: labels.filter((label) => label.priority <= featured.maxPriority) },
    { rank: spec.labelRank, labels: labels.filter((label) => label.priority > featured.maxPriority) },
  ];
}

/** Colour at `value` on a ramp of ascending [value, #rrggbb] stops, clamped at its ends. */
export function rampColor(ramp: CloudSpec['ramp'], value: number): [number, number, number] {
  let lower = ramp[0];
  for (const stop of ramp) {
    if (value < stop[0]) {
      if (stop === lower) break;
      const t = (value - lower[0]) / (stop[0] - lower[0]);
      const a = hexToRgb(lower[1]);
      const b = hexToRgb(stop[1]);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    lower = stop;
  }
  return hexToRgb(lower[1]);
}

/** Unpack a point cloud: see write_cloud in tools/pipeline/generate_deepsky.py. */
export function buildCloud(buffer: ArrayBuffer, spec: CloudSpec): Omit<MarkerBatch, 'shape' | 'alphas'> {
  const count = Math.floor(buffer.byteLength / CLOUD_RECORD_BYTES);
  const view = new DataView(buffer);
  const directions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const offset = i * CLOUD_RECORD_BYTES;
    const ra = (view.getUint16(offset, true) / 65536) * 360;
    const dec = (view.getInt16(offset + 2, true) / 32767) * 90;
    const value = view.getUint16(offset + 4, true);
    directions.set(raDecToUnit(ra, dec), i * 3);
    sizes[i] = spec.sizePx(value);
    colors.set(rampColor(spec.ramp, value), i * 3);
  }
  return { directions, sizes, colors };
}

async function createCatalogLayer(context: LayerContext, spec: CatalogSpec): Promise<LayerInstance> {
  const data = await context.fetchJson<CatalogData>(context.assetUrl(spec.file));
  const points = buildMarkers(data, spec).map(
    (batch) =>
      new SkyPoints(
        batch.directions,
        batch.sizes,
        batch.colors,
        context.skyUniforms,
        { name: `${spec.id}-${batch.shape}`, shape: batch.shape },
        batch.alphas
      )
  );
  const outlines = [...buildOutlines(data, spec)].map(
    ([color, segments]) => new SkyLines(segments, parseInt(color.slice(1), 16), OUTLINE_OPACITY, context.skyUniforms, `${spec.id}-outlines`)
  );
  for (const drawn of [...outlines, ...points]) context.skyRoot.add(drawn.object);
  const style = {
    fontPx: LABEL_FONT_PX,
    color: spec.labelColor,
    offsetYPx: spec.labelAbove ? -LABEL_OFFSET_PX : LABEL_OFFSET_PX,
  };
  const labels = splitFeatured(catalogLabels(data), spec).map(({ rank, labels: group }) =>
    context.addLabels({ rank, style, frame: 'sky', labels: group })
  );
  return {
    setVisible(visible) {
      for (const drawn of [...outlines, ...points]) drawn.object.visible = visible;
      for (const group of labels) group.setVisible(visible);
    },
    dispose() {
      for (const drawn of [...outlines, ...points]) drawn.dispose();
      for (const group of labels) group.remove();
    },
  };
}

async function createCloudLayer(context: LayerContext, spec: CloudSpec): Promise<LayerInstance> {
  const meta = await context.fetchJson<CloudMeta>(context.assetUrl(spec.file));
  const directory = spec.file.slice(0, spec.file.lastIndexOf('/') + 1);
  const response = await fetch(context.assetUrl(directory + meta.file));
  if (!response.ok) throw new Error(`${meta.file}: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== meta.count * CLOUD_RECORD_BYTES) throw new Error(`${meta.file}: expected ${meta.count} points`);
  const cloud = buildCloud(buffer, spec);
  const points = new SkyPoints(cloud.directions, cloud.sizes, cloud.colors, context.skyUniforms, {
    name: spec.id,
    shape: 'disc',
    opacity: spec.opacity,
  });
  context.skyRoot.add(points.object);
  return {
    setVisible(visible) {
      points.object.visible = visible;
    },
    dispose() {
      points.dispose();
    },
  };
}

export function createDeepSkyLayer(context: LayerContext, spec: DeepSkySpec): Promise<LayerInstance> {
  return spec.kind === 'cloud' ? createCloudLayer(context, spec) : createCatalogLayer(context, spec);
}
