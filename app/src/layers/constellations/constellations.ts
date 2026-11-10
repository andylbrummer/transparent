/**
 * Constellation figures, names and boundaries, from
 * app/public/sky/constellations.json (tools/pipeline/generate_constellations.py).
 */

import * as THREE from 'three';
import { raDecToUnit } from '@transparent-earth/core';
import { SkyLines, greatCircleSegments } from '../../render/sky-points';
import type { GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';

export interface ConstellationFigure {
  /** IAU abbreviation; Serpens's two halves share one. */
  readonly id: string;
  /** Latin name. */
  readonly name: string;
  /** 1 (prominent) to 3. */
  readonly rank: number;
  /** Where the name goes: [ra, dec]. */
  readonly at: readonly [number, number];
  /** Polylines, flattened [ra, dec, ra, dec, ...]. */
  readonly lines: readonly (readonly number[])[];
}

/** The shape of app/public/sky/constellations.json. Coordinates are ICRS, in 1/quantumPerDegree degree. */
export interface ConstellationData {
  readonly quantumPerDegree: number;
  readonly figures: readonly ConstellationFigure[];
  /** Boundary edges as polylines, already stepped finely enough to draw straight. */
  readonly boundaries: readonly (readonly number[])[];
}

/** Figure lines run star to star, up to tens of degrees: bend them along the great circle in steps this long. */
const FIGURE_STEP_DEG = 2;

/** Segment endpoints (six numbers each) for the stick figures. */
export function figureSegments(data: ConstellationData): Float32Array {
  const out: number[] = [];
  const q = data.quantumPerDegree;
  for (const figure of data.figures) {
    for (const line of figure.lines) {
      for (let i = 0; i + 3 < line.length; i += 2) {
        greatCircleSegments(
          raDecToUnit(line[i] / q, line[i + 1] / q),
          raDecToUnit(line[i + 2] / q, line[i + 3] / q),
          FIGURE_STEP_DEG,
          out
        );
      }
    }
  }
  return new Float32Array(out);
}

/** Segment endpoints for the boundaries: each polyline's points joined by chords. */
export function boundarySegments(data: ConstellationData): Float32Array {
  const out: number[] = [];
  const q = data.quantumPerDegree;
  for (const line of data.boundaries) {
    let previous = raDecToUnit(line[0] / q, line[1] / q);
    for (let i = 2; i + 1 < line.length; i += 2) {
      const next = raDecToUnit(line[i] / q, line[i + 1] / q);
      out.push(previous[0], previous[1], previous[2], next[0], next[1], next[2]);
      previous = next;
    }
  }
  return new Float32Array(out);
}

/** One name per figure, the prominent constellations ranked first. */
export function figureLabels(data: ConstellationData): GroupLabel[] {
  const q = data.quantumPerDegree;
  return data.figures.map((figure) => {
    const [x, y, z] = raDecToUnit(figure.at[0] / q, figure.at[1] / q);
    return { text: figure.name, priority: figure.rank, position: new THREE.Vector3(x, y, z) };
  });
}

// Both switches read one file: fetch it once.
let dataPromise: Promise<ConstellationData> | null = null;

function loadData(context: LayerContext): Promise<ConstellationData> {
  dataPromise ??= context.fetchJson<ConstellationData>(context.assetUrl('sky/constellations.json')).catch((error: unknown) => {
    // A failed fetch must not be remembered: switching the layer on again retries.
    dataPromise = null;
    throw error;
  });
  return dataPromise;
}

export async function createFiguresLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await loadData(context);
  const lines = new SkyLines(figureSegments(data), 0x7fa0e8, 0.5, context.skyUniforms, 'constellation-figures');
  context.skyRoot.add(lines.object);
  // Ahead of the star names (6.4): a view can show only so many names, the ground's come first, and
  // someone who switched the constellations on wants theirs before the fortieth star's.
  const labels = context.addLabels({
    rank: 6.36,
    style: { fontPx: 10, color: '#8fb0f0', wide: true },
    frame: 'sky',
    labels: figureLabels(data),
  });
  return {
    setVisible(visible) {
      lines.object.visible = visible;
      labels.setVisible(visible);
    },
    dispose() {
      lines.dispose();
      labels.remove();
    },
  };
}

export async function createBoundariesLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await loadData(context);
  const lines = new SkyLines(boundarySegments(data), 0xb08fd8, 0.32, context.skyUniforms, 'constellation-boundaries');
  context.skyRoot.add(lines.object);
  return {
    setVisible(visible) {
      lines.object.visible = visible;
    },
    dispose() {
      lines.dispose();
    },
  };
}
