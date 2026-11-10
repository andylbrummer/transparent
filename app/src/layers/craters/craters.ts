/**
 * Impact craters: the Earth's proven impact structures
 * (app/public/geo/craters.json, from tools/pipeline/generate_craters.py;
 * Schmieder & Kring 2020), each marked with a small ring and, where the
 * structure is big enough to see from across the planet, a second ring
 * laid on the ground at its true diameter - Vredefort, Sudbury and
 * Chicxulub are the size of small countries.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { GeoMarkers, ecefAtAltitude, groundCircleSegments, type GeoMarker } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';
import { CRATER_COLOR, TRUE_RING_MIN_KM } from './layer';

export interface Crater {
  readonly name: string;
  readonly country: string;
  readonly lon: number;
  readonly lat: number;
  /** The diameter drawn: of a range, its smaller end. */
  readonly diameterKm: number;
  /** As the paper prints it, e.g. "40–90". */
  readonly diameterText: string;
  /** First number of ageText, millions of years; null if it has none. */
  readonly ageMa: number | null;
  /** The paper's recommended age, e.g. "66.052 ± 0.043", "~453 to 430", "<1880". */
  readonly ageText: string;
}

/** The shape of app/public/geo/craters.json: largest first. */
export interface CraterData {
  readonly craters: readonly Crater[];
}

/** The largest are named ahead of the country names; the rest wait their turn. */
const FEATURED = 24;
const FEATURED_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.42;
const OTHER_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.2;
const RING_STEPS = 64;

/** Marker ring size, CSS px: 7 for the smallest, 13 from 100 km up. */
export function craterMarkerSizePx(diameterKm: number): number {
  const t = Math.min(Math.max(Math.log10(diameterKm / 0.1) / 3, 0), 1);
  return 7 + 6 * t;
}

const NUMBER = '\\d+(?:\\.\\d+)?';
const ONE_AGE = new RegExp(`^([~<>≤≥]?)\\s*(${NUMBER})(?:\\s*±\\s*${NUMBER})?$`);
const AGE_RANGE = new RegExp(`^([~<>≤≥]?)\\s*(${NUMBER})\\s*(?:–|to)\\s*(${NUMBER})$`);

/** Millions of years as "2.02 Ga", "66.1 Ma", "56 ka" or "3,240 yr". */
export function formatAgeMa(ma: number): string {
  const digits = (value: number): string => (value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2));
  const trimmed = (value: number): string => (digits(value).includes('.') ? digits(value).replace(/\.?0+$/, '') : digits(value));
  if (ma >= 1000) return `${trimmed(ma / 1000)} Ga`;
  if (ma >= 1) return `${trimmed(ma)} Ma`;
  if (ma >= 0.001) return `${trimmed(ma * 1000)} ka`;
  return `${Math.round(ma * 1e6).toLocaleString('en-US')} yr`;
}

/**
 * The paper's recommended age, shortened for a label. Where it gives
 * several ("125 ± 1; ~121.8 to 123.8?") the first is taken. One figure
 * loses its error bar ("66.052 ± 0.043" → "66.1 Ma"); a range stays a
 * range ("2005–168" → "2005–168 Ma": all that is known of Woodleigh is
 * that it lies between), and "~", "<" and ">" are kept.
 */
export function craterAgeText(ageText: string): string | null {
  const first = ageText.split(';')[0].replace(/\?/g, '').trim();
  const one = ONE_AGE.exec(first);
  if (one) return `${one[1]}${formatAgeMa(Number(one[2]))}`;
  const range = AGE_RANGE.exec(first);
  if (range) return `${range[1]}${range[2]}–${range[3]} Ma`;
  return first === '' ? null : `${first} Ma`;
}

/** "◯ Chicxulub · 180 km · 66.1 Ma". */
export function craterLabelText(crater: Crater): string {
  const size = crater.diameterKm >= 1 ? `${crater.diameterText} km` : `${Math.round(crater.diameterKm * 1000)} m`;
  const age = craterAgeText(crater.ageText);
  return `◯ ${crater.name} · ${size}${age ? ` · ${age}` : ''}`;
}

export function craterMarkers(data: CraterData): GeoMarker[] {
  // Smallest last, so a small crater inside a big one's marker stays visible.
  return data.craters.map((c) => ({
    lon: c.lon,
    lat: c.lat,
    shape: 'ring',
    color: CRATER_COLOR,
    sizePx: craterMarkerSizePx(c.diameterKm),
  }));
}

/** Segment endpoints of the true-size rings. */
export function craterRingPositions(data: CraterData): Float32Array {
  const out: number[] = [];
  for (const c of data.craters) {
    if (c.diameterKm >= TRUE_RING_MIN_KM) groundCircleSegments(c.lon, c.lat, c.diameterKm / 2, RING_STEPS, out);
  }
  return new Float32Array(out);
}

export async function createCraterLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<CraterData>(context.assetUrl('geo/craters.json'));
  const markers = new GeoMarkers('impact-craters', context.skyUniforms.uPixelRatio);
  markers.setMarkers(craterMarkers(data));

  const ringGeometry = new LineSegmentsGeometry();
  ringGeometry.setPositions(craterRingPositions(data));
  const ringMaterial = new LineMaterial({
    color: CRATER_COLOR,
    linewidth: 1.6,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const rings = new LineSegments2(ringGeometry, ringMaterial);
  rings.name = 'impact-crater-rings';
  rings.frustumCulled = false;
  rings.renderOrder = RENDER_ORDER.outlines + 0.2;

  const group = new THREE.Group();
  group.add(rings, markers.object);
  context.earthRoot.add(group);

  const labelOf = (c: Crater): GroupLabel => ({
    text: craterLabelText(c),
    priority: -c.diameterKm,
    position: ecefAtAltitude(c.lon, c.lat, 0, new THREE.Vector3()),
  });
  const groups = [
    context.addLabels({
      rank: FEATURED_RANK,
      style: { fontPx: 11, color: '#e4f7a3', bold: true, offsetYPx: 14 },
      frame: 'earth',
      labels: data.craters.slice(0, FEATURED).map(labelOf),
    }),
    context.addLabels({
      rank: OTHER_RANK,
      style: { fontPx: 10, color: '#d5eb9a', offsetYPx: 12 },
      frame: 'earth',
      labels: data.craters.slice(FEATURED).map(labelOf),
    }),
  ];

  return {
    setVisible(visible) {
      group.visible = visible;
      for (const labels of groups) labels.setVisible(visible);
    },
    setResolution(widthCss, heightCss) {
      ringMaterial.resolution.set(widthCss, heightCss);
    },
    dispose() {
      for (const labels of groups) labels.remove();
      group.removeFromParent();
      markers.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
    },
  };
}
