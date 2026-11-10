/**
 * What the human-world layers have in common: a set of point symbols with
 * ranked names, and plain lines on the sphere. Loaded lazily with the
 * first of them.
 */

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { GeoMarkers, ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelStyle } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';

/**
 * Declutter ranks. The first few names of a set are what the layer was
 * switched on for, so they go ahead of the countries; the rest give way to state names.
 */
export const FEATURED_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.25;
export const OTHER_RANK = LABEL_KIND_ORDER.indexOf('state') + 0.5;

export interface LabelSet {
  readonly rank: number;
  readonly style: LabelStyle;
  readonly labels: readonly GroupLabel[];
}

export function labelAt(text: string, priority: number, lon: number, lat: number, altitudeM = 0): GroupLabel {
  return { text, priority, position: ecefAtAltitude(lon, lat, altitudeM, new THREE.Vector3()) };
}

/** "8,849" - the same everywhere, whatever the browser's locale. */
export const thousands = (value: number): string => Math.round(value).toLocaleString('en-US');

/** "10 Nov 2026" from an ISO day. */
export function formatDay(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export interface LineOptions {
  readonly color: number;
  readonly opacity: number;
  /** Light adds up where lines cross: for things that glow. */
  readonly additive?: boolean;
  readonly renderOrder?: number;
  /** r, g, b per vertex, multiplied into `color`. */
  readonly vertexColors?: Float32Array;
}

/** One-pixel lines from segment endpoints (x0,y0,z0, x1,y1,z1, ...), ECEF metres. */
export function lineSegments(name: string, positions: Float32Array, options: LineOptions): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (options.vertexColors) geometry.setAttribute('color', new THREE.BufferAttribute(options.vertexColors, 3));
  const material = new THREE.LineBasicMaterial({
    color: options.color,
    transparent: true,
    opacity: options.opacity,
    vertexColors: options.vertexColors !== undefined,
    blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = name;
  lines.frustumCulled = false;
  // Under the coastlines and the plate boundaries unless told otherwise.
  lines.renderOrder = options.renderOrder ?? RENDER_ORDER.outlines - 0.1;
  return lines;
}

export interface WideLineOptions {
  readonly color: number;
  /** CSS px. */
  readonly widthPx: number;
  readonly opacity: number;
  readonly additive?: boolean;
  readonly renderOrder?: number;
}

/** A geometry several wide-line passes can share (a thread and its glow). */
export function wideLineGeometry(positions: Float32Array): LineSegmentsGeometry {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  return geometry;
}

/** Lines of a width in CSS pixels; assembleLayer keeps their materials told of the viewport's size. */
export function wideLines(name: string, geometry: LineSegmentsGeometry, options: WideLineOptions): LineSegments2 {
  const material = new LineMaterial({
    color: options.color,
    linewidth: options.widthPx,
    transparent: true,
    opacity: options.opacity,
    blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new LineSegments2(geometry, material);
  lines.name = name;
  lines.frustumCulled = false;
  lines.renderOrder = options.renderOrder ?? RENDER_ORDER.outlines - 0.1;
  return lines;
}

function disposeObject(object: THREE.Object3D): void {
  const drawn = object as Partial<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>;
  drawn.geometry?.dispose();
  drawn.material?.dispose();
}

/**
 * A layer of markers (drawn in the order given), names and any other
 * objects, all in the Earth's frame.
 */
export function assembleLayer(
  context: LayerContext,
  name: string,
  markers: readonly GeoMarker[],
  labelSets: readonly LabelSet[],
  objects: readonly THREE.Object3D[] = []
): LayerInstance {
  const group = new THREE.Group();
  group.name = name;
  for (const object of objects) group.add(object);
  const symbols = markers.length > 0 ? new GeoMarkers(`${name}-markers`, context.skyUniforms.uPixelRatio) : null;
  if (symbols) {
    symbols.setMarkers(markers);
    group.add(symbols.object);
  }
  context.earthRoot.add(group);
  const labels = labelSets
    .filter((set) => set.labels.length > 0)
    .map((set) => context.addLabels({ rank: set.rank, style: set.style, frame: 'earth', labels: set.labels }));
  return {
    setVisible(visible) {
      group.visible = visible;
      for (const set of labels) set.setVisible(visible);
    },
    setResolution(widthCss, heightCss) {
      group.traverse((object) => {
        const material = (object as Partial<THREE.Mesh>).material;
        if (material instanceof LineMaterial) material.resolution.set(widthCss, heightCss);
      });
    },
    dispose() {
      for (const set of labels) set.remove();
      group.removeFromParent();
      symbols?.dispose();
      for (const object of objects) object.traverse(disposeObject);
    },
  };
}

/** [the first `featured` of a ranked list, the next `others`]. */
export function splitRanked<T>(ranked: readonly T[], featured: number, others: number): [T[], T[]] {
  return [ranked.slice(0, featured), ranked.slice(featured, featured + others)];
}
