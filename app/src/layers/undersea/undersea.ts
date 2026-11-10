/**
 * The ocean floor by name: trenches, fracture zones, ridges, seamount
 * chains, basins and the named deeps, from the GEBCO gazetteer
 * (app/public/geo/undersea.json, tools/pipeline/generate_undersea.py).
 *
 * Most of what the app shows of the ocean is its plate boundaries; this
 * is the rest of its geography - the fracture zones that stripe the
 * Pacific, the Emperor chain running north from Hawaii's bend, the
 * Ninetyeast Ridge - with the lines the gazetteer itself draws, thin and
 * muted under the boundaries, and the names a sea chart would carry.
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { outlineSegmentPositions } from '../../render/outlines';
import type { LayerContext, LayerInstance } from '../types';
import { UNDERSEA_LINE_COLORS } from './layer';

export type UnderseaKind =
  | 'trench'
  | 'deep'
  | 'ridge'
  | 'rise'
  | 'fracture'
  | 'seamounts'
  | 'basin'
  | 'plain'
  | 'plateau'
  | 'trough'
  | 'seamount';

export interface UnderseaFeature {
  /** The gazetteer's name with its generic term: "Mariana Trench". */
  readonly name: string;
  readonly kind: UnderseaKind;
  readonly lon: number;
  readonly lat: number;
  /** Length of the feature's line, or span of its outline; 0 for a point. */
  readonly sizeKm: number;
  readonly maxDepthM?: number;
  readonly reliefM?: number;
}

/** The shape of app/public/geo/undersea.json. */
export interface UnderseaData {
  readonly quantumPerDegree: number;
  /** Most notable first within each generic term. */
  readonly features: readonly UnderseaFeature[];
  readonly lines: Readonly<Record<keyof typeof UNDERSEA_LINE_COLORS, readonly (readonly number[])[]>>;
}

/**
 * How many of each kind are named ahead of the country names. The rest
 * rank with the map's other small print and show as the view empties or
 * closes in.
 */
export const FEATURED_PER_KIND: Readonly<Record<UnderseaKind, number>> = {
  trench: 40,
  deep: 8,
  ridge: 12,
  rise: 4,
  fracture: 8,
  seamounts: 4,
  basin: 10,
  plain: 6,
  plateau: 6,
  trough: 2,
  seamount: 0,
};

const FEATURED_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.3;
const OTHER_RANK = LABEL_KIND_ORDER.indexOf('state') + 0.4;
const DEEP_COLOR = 0xbfe3ff;

/** "Mariana Trench"; a deep or a trench with a recorded depth carries it: "◆ Challenger Deep · 10,920 m". */
export function underseaLabelText(feature: UnderseaFeature): string {
  const depth =
    feature.maxDepthM !== undefined && (feature.kind === 'deep' || feature.kind === 'trench')
      ? ` · ${feature.maxDepthM.toLocaleString('en-US')} m`
      : '';
  return `${feature.kind === 'deep' ? '◆ ' : ''}${feature.name}${depth}`;
}

/** [featured, the rest]: within each, the deepest deeps and the longest features first. */
export function underseaLabels(data: UnderseaData): [GroupLabel[], GroupLabel[]] {
  const featured: GroupLabel[] = [];
  const others: GroupLabel[] = [];
  const seen = new Map<UnderseaKind, number>();
  for (const feature of data.features) {
    const index = seen.get(feature.kind) ?? 0;
    seen.set(feature.kind, index + 1);
    const label: GroupLabel = {
      text: underseaLabelText(feature),
      // Depth in metres and length in kilometres happen to rank well together: Challenger Deep leads, then the great ridges.
      priority: -(feature.kind === 'deep' ? (feature.maxDepthM ?? 0) : feature.sizeKm),
      position: ecefAtAltitude(feature.lon, feature.lat, 0, new THREE.Vector3()),
    };
    (index < FEATURED_PER_KIND[feature.kind] ? featured : others).push(label);
  }
  return [featured, others];
}

export async function createUnderseaLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<UnderseaData>(context.assetUrl('geo/undersea.json'));
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  for (const [name, color] of Object.entries(UNDERSEA_LINE_COLORS) as [keyof typeof UNDERSEA_LINE_COLORS, number][]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(outlineSegmentPositions(data.lines[name], data.quantumPerDegree), 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = `undersea-${name}`;
    lines.frustumCulled = false;
    // Under the coastlines and the plate boundaries.
    lines.renderOrder = RENDER_ORDER.outlines - 0.1;
    group.add(lines);
    disposables.push(geometry, material);
  }
  const deeps = new GeoMarkers('undersea-deeps', context.skyUniforms.uPixelRatio);
  deeps.setMarkers(
    data.features
      .filter((f) => f.kind === 'deep')
      .map((f) => ({ lon: f.lon, lat: f.lat, shape: 'diamond', color: DEEP_COLOR, sizePx: f.maxDepthM && f.maxDepthM >= 8000 ? 9 : 6.5 }))
  );
  group.add(deeps.object);
  context.earthRoot.add(group);

  const [featured, others] = underseaLabels(data);
  const groups = [
    context.addLabels({ rank: FEATURED_RANK, style: { fontPx: 11, color: '#b9defc', italic: true }, frame: 'earth', labels: featured }),
    context.addLabels({ rank: OTHER_RANK, style: { fontPx: 10, color: '#9cc7e8', italic: true }, frame: 'earth', labels: others }),
  ];
  return {
    setVisible(visible) {
      group.visible = visible;
      for (const labels of groups) labels.setVisible(visible);
    },
    dispose() {
      for (const labels of groups) labels.remove();
      group.removeFromParent();
      deeps.dispose();
      for (const item of disposables) item.dispose();
    },
  };
}
