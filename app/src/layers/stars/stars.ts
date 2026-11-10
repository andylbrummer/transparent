/**
 * The naked-eye stars, from app/public/sky/stars.json
 * (tools/pipeline/generate_stars.py: Hipparcos to V 7.0, IAU names).
 */

import * as THREE from 'three';
import { raDecToUnit } from '@transparent-earth/core';
import { SkyPoints } from '../../render/sky-points';
import { starAlpha, starRgb, starSizePx } from '../../render/star-color';
import type { GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';

/** The shape of app/public/sky/stars.json: columns, brightest first. */
export interface StarData {
  readonly quantumPerDegree: number;
  readonly bvMissing: number;
  readonly ra: readonly number[];
  readonly dec: readonly number[];
  /** V magnitude × 100. */
  readonly mag: readonly number[];
  /** B−V × 100, or bvMissing. */
  readonly bv: readonly number[];
  /** [index, name] for stars with an IAU proper name. */
  readonly names: readonly (readonly [number, string])[];
}

/** Stars this bright or brighter get their name drawn. */
export const NAMED_STAR_MAG_LIMIT = 3.0;
/** B−V assumed where the catalogue has none: a white star. */
const DEFAULT_BV = 0.3;

export interface StarBuffers {
  readonly directions: Float32Array;
  readonly sizes: Float32Array;
  readonly colors: Float32Array;
  readonly alphas: Float32Array;
}

export function buildStarBuffers(data: StarData): StarBuffers {
  const count = data.ra.length;
  const directions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    directions.set(raDecToUnit(data.ra[i] / data.quantumPerDegree, data.dec[i] / data.quantumPerDegree), i * 3);
    const mag = data.mag[i] / 100;
    sizes[i] = starSizePx(mag);
    alphas[i] = starAlpha(mag);
    colors.set(starRgb(data.bv[i] === data.bvMissing ? DEFAULT_BV : data.bv[i] / 100), i * 3);
  }
  return { directions, sizes, colors, alphas };
}

/** Names for the stars of magnitude ≤ NAMED_STAR_MAG_LIMIT, brightest ranked first. */
export function starLabels(data: StarData): GroupLabel[] {
  return data.names
    .filter(([index]) => data.mag[index] <= NAMED_STAR_MAG_LIMIT * 100)
    .map(([index, name]) => {
      const [x, y, z] = raDecToUnit(data.ra[index] / data.quantumPerDegree, data.dec[index] / data.quantumPerDegree);
      return { text: name, priority: data.mag[index], position: new THREE.Vector3(x, y, z) };
    });
}

export async function createStarLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<StarData>(context.assetUrl('sky/stars.json'));
  const buffers = buildStarBuffers(data);
  const points = new SkyPoints(
    buffers.directions,
    buffers.sizes,
    buffers.colors,
    context.skyUniforms,
    { name: 'stars' },
    buffers.alphas
  );
  context.skyRoot.add(points.object);
  const labels = context.addLabels({
    rank: 6.4,
    style: { fontPx: 10, color: '#cfe0ff', offsetYPx: 11 },
    frame: 'sky',
    // The stars are on from the start: looking down, their names would lie all over the Earth.
    belowHorizon: 'zoomed',
    labels: starLabels(data),
  });
  return {
    setVisible(visible) {
      points.object.visible = visible;
      labels.setVisible(visible);
    },
    dispose() {
      points.dispose();
      labels.remove();
    },
  };
}
