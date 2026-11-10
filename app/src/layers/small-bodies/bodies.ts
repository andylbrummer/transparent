/**
 * Dwarf planets, the brightest asteroids and the comets within reach of a
 * small telescope, each where it stands among the stars at the app's time.
 *
 * Elements come from app/public/sky/small-bodies.json
 * (tools/pipeline/generate_small_bodies.py: JPL Horizons osculating
 * elements at one epoch; H, G, M1, K1 from the JPL Small-Body Database);
 * places are worked out here (kepler.ts). The file says for which period
 * the orbits hold; outside it the layers show nothing and say so.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../../render/order';
import type { GroupLabel, LabelGroup } from '../../render/labels';
import { SkyLines, SkyPoints, type SkyPointShape } from '../../render/sky-points';
import type { LayerContext, LayerInstance } from '../types';
import {
  asteroidMagnitude,
  cometMagnitude,
  earthAt,
  emptyView,
  jdDateText,
  outsideWindowStatus,
  viewFromEarth,
  withinWindow,
  type BodyView,
  type OrbitElements,
  type ValidityWindow,
} from './kepler';
import { COMET_MAG_LIMIT } from './layer';

export type BodyGroup = 'dwarf' | 'tno' | 'notable' | 'asteroid';

export interface NamedBody extends OrbitElements {
  readonly name: string;
  /** JPL primary designation. */
  readonly des: string;
  readonly group: BodyGroup;
  /** Absolute magnitude and slope parameter (IAU H,G). */
  readonly h: number;
  readonly g: number;
  /** True where JPL lists no G and the conventional 0.15 stands in. */
  readonly gAssumed: boolean;
  readonly diameterKm?: number;
  /** Largest distance from JPL Horizons' place over the validity window, measured when baked. */
  readonly errorArcsec: number;
}

export interface Comet extends OrbitElements {
  readonly name: string;
  readonly des: string;
  /** JPL's total-magnitude parameters. */
  readonly m1: number;
  readonly k1: number;
  readonly class: string;
  readonly errorArcsec: number;
}

/** The shape of app/public/sky/small-bodies.json. */
export interface SmallBodyData extends ValidityWindow {
  readonly cometMagLimit: number;
  readonly bodies: readonly NamedBody[];
  readonly comets: readonly Comet[];
}

const loads = new Map<string, Promise<SmallBodyData>>();

/** The two layers share one file, fetched once. */
function loadData(context: LayerContext): Promise<SmallBodyData> {
  const url = context.assetUrl('sky/small-bodies.json');
  let load = loads.get(url);
  if (!load) {
    load = context.fetchJson<SmallBodyData>(url);
    loads.set(url, load);
    load.catch(() => loads.delete(url));
  }
  return load;
}

/** Places change by under an arcminute a minute even for the fastest body here; once a second is plenty. */
const UPDATE_INTERVAL_MS = 1000;

/** "8.9" to magnitude 10, whole magnitudes fainter: nobody needs tenths of magnitude 17. */
export function magnitudeText(mag: number): string {
  return mag < 9.95 ? mag.toFixed(1) : mag.toFixed(0);
}

/** Marker size, CSS px: 12 at magnitude 6 and brighter, 6 from magnitude 16 on. */
export function bodySizePx(mag: number): number {
  return 6 + 6 * Math.min(1, Math.max(0, (16 - mag) / 10));
}

/** Marker opacity: full to magnitude 10, then fading to 0.55 at 18 - every one is named, so none may vanish. */
export function bodyAlpha(mag: number): number {
  return 1 - 0.45 * Math.min(1, Math.max(0, (mag - 10) / 8));
}

/** "Ceres 8.9"; the dwarf planets and big trans-Neptunian objects ahead of the asteroids, each lot brightest first. */
export function bodyLabel(body: NamedBody, mag: number, position: THREE.Vector3): GroupLabel {
  const tier = body.group === 'dwarf' ? 0 : body.group === 'tno' ? 1 : 2;
  return { text: `${body.name} ${magnitudeText(mag)}`, priority: tier * 100 + mag, position };
}

/** "☄ 10P/Tempel 2 ~12.4": the tilde because the magnitude is a prediction. */
export function cometLabel(comet: Comet, mag: number, position: THREE.Vector3): GroupLabel {
  return { text: `☄ ${comet.name} ~${magnitudeText(mag)}`, priority: mag, position };
}

export function bodyMagnitude(body: NamedBody, view: BodyView): number {
  return asteroidMagnitude(body.h, body.g, view.sunDistanceAu, view.distanceAu, view.phaseAngle);
}

interface MarkerSet {
  readonly points: SkyPoints;
  readonly indices: readonly number[];
}

function markerSet(
  context: LayerContext,
  name: string,
  shape: SkyPointShape,
  color: readonly [number, number, number],
  indices: readonly number[],
  additive = false
): MarkerSet {
  const count = indices.length;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(color, i * 3);
  const points = new SkyPoints(
    new Float32Array(count * 3).fill(1),
    new Float32Array(count),
    colors,
    context.skyUniforms,
    // Over the stars and the planets: these are the fainter things one is looking for.
    { name, shape, renderOrder: RENDER_ORDER.sky + 0.012, additive },
    new Float32Array(count).fill(1)
  );
  context.skyRoot.add(points.object);
  return { points, indices };
}

const attribute = (points: SkyPoints, name: string): THREE.BufferAttribute => points.object.geometry.getAttribute(name) as THREE.BufferAttribute;

/** Label groups are rebuilt only when a text changes: magnitudes move by a tenth in days. */
class ChangingLabels {
  private group: LabelGroup | null = null;
  private shown = '';
  private visible = false;

  constructor(
    private readonly context: LayerContext,
    private readonly rank: number,
    private readonly color: string
  ) {}

  set(labels: GroupLabel[]): void {
    const joined = labels.map((label) => label.text).join('|');
    if (joined === this.shown && this.group) return;
    this.shown = joined;
    this.group?.remove();
    this.group = this.context.addLabels({ rank: this.rank, style: { fontPx: 10, color: this.color, offsetYPx: 12 }, frame: 'sky', labels });
    this.group.setVisible(this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group?.setVisible(visible);
  }

  remove(): void {
    this.group?.remove();
    this.group = null;
  }
}

/** Dwarf planets and big trans-Neptunian objects are rings, asteroids diamonds. */
const RING_GROUPS: ReadonlySet<BodyGroup> = new Set(['dwarf', 'tno']);
export const DWARF_COLOR: readonly [number, number, number] = [0.62, 0.9, 1.0];
export const ASTEROID_COLOR: readonly [number, number, number] = [0.96, 0.8, 0.56];

export async function createNamedBodiesLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await loadData(context);
  const bodies = data.bodies;
  const all = bodies.map((_, i) => i);
  const sets = [
    markerSet(context, 'dwarf-planets', 'ring', DWARF_COLOR, all.filter((i) => RING_GROUPS.has(bodies[i].group))),
    markerSet(context, 'asteroids', 'diamond', ASTEROID_COLOR, all.filter((i) => !RING_GROUPS.has(bodies[i].group))),
  ];
  const positions = bodies.map(() => new THREE.Vector3(1, 0, 0));
  const labels = new ChangingLabels(context, 6.352, '#f3dcb4');
  const view = emptyView();
  let lastMs = NaN;
  let shown = true;

  return {
    setVisible(visible) {
      for (const set of sets) set.points.object.visible = visible && shown;
      labels.setVisible(visible);
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (Math.abs(ms - lastMs) < UPDATE_INTERVAL_MS) return;
      lastMs = ms;
      const { jd, earth } = earthAt(frame.date);
      const inside = withinWindow(data, jd);
      if (inside !== shown) {
        shown = inside;
        for (const set of sets) set.points.object.visible = inside;
      }
      if (!inside) {
        // Outside the period the orbits were fitted for, a place would be a guess: none is shown.
        labels.set([]);
        context.setStatus(outsideWindowStatus(data), 'error');
        return;
      }
      const named: GroupLabel[] = [];
      for (const set of sets) {
        const size = attribute(set.points, 'aSize');
        const alpha = attribute(set.points, 'aAlpha');
        set.indices.forEach((bodyIndex, i) => {
          const body = bodies[bodyIndex];
          viewFromEarth(body, jd, earth, view);
          const mag = bodyMagnitude(body, view);
          positions[bodyIndex].set(view.direction[0], view.direction[1], view.direction[2]);
          set.points.positions.setXYZ(i, view.direction[0], view.direction[1], view.direction[2]);
          size.setX(i, bodySizePx(mag));
          alpha.setX(i, bodyAlpha(mag));
          named.push(bodyLabel(body, mag, positions[bodyIndex]));
        });
        set.points.positions.needsUpdate = true;
        size.needsUpdate = true;
        alpha.needsUpdate = true;
      }
      labels.set(named);
      context.setStatus(`orbits of ${jdDateText(data.epochJd)}`, 'info');
    },
    dispose() {
      for (const set of sets) set.points.dispose();
      labels.remove();
    },
  };
}

/** Length of the mark that shows which way a comet's tail points, degrees: a symbol, not the tail's size. */
const TAIL_MARK_DEG = 2.2;
export const COMET_COLOR: readonly [number, number, number] = [0.55, 1.0, 0.85];

/**
 * Unit vector `TAIL_MARK_DEG` from `comet` along the great circle leading
 * away from `sun` (both unit vectors from the Earth): the way a tail,
 * pushed out by sunlight and the solar wind, appears to point.
 */
export function tailMarkEnd(comet: readonly number[], sun: readonly number[], out: number[]): number[] {
  const dot = comet[0] * sun[0] + comet[1] * sun[1] + comet[2] * sun[2];
  // The part of the Sun's direction square to the comet's, reversed.
  let x = -(sun[0] - dot * comet[0]);
  let y = -(sun[1] - dot * comet[1]);
  let z = -(sun[2] - dot * comet[2]);
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) {
    out[0] = comet[0];
    out[1] = comet[1];
    out[2] = comet[2];
    return out;
  }
  x /= length;
  y /= length;
  z /= length;
  const angle = (TAIL_MARK_DEG * Math.PI) / 180;
  out[0] = comet[0] * Math.cos(angle) + x * Math.sin(angle);
  out[1] = comet[1] * Math.cos(angle) + y * Math.sin(angle);
  out[2] = comet[2] * Math.cos(angle) + z * Math.sin(angle);
  return out;
}

/** Coma size, CSS px: 22 at magnitude 5 and brighter, 11 at the limit. */
export function cometSizePx(mag: number): number {
  return 11 + 11 * Math.min(1, Math.max(0, (COMET_MAG_LIMIT - mag) / (COMET_MAG_LIMIT - 5)));
}

export async function createCometsLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await loadData(context);
  const comets = data.comets;
  const count = comets.length;
  // A soft glow, like a coma, where the asteroids are hard-edged symbols.
  const set = markerSet(context, 'comets', 'star', COMET_COLOR, comets.map((_, i) => i), true);
  const size = attribute(set.points, 'aSize');
  const tails = new SkyLines(new Float32Array(count * 6), 0x8cffd9, 0.75, context.skyUniforms, 'comet-tails');
  tails.object.renderOrder = RENDER_ORDER.sky + 0.011;
  context.skyRoot.add(tails.object);
  const tailPositions = tails.object.geometry.getAttribute('position') as THREE.BufferAttribute;
  const positions = comets.map(() => new THREE.Vector3(1, 0, 0));
  const labels = new ChangingLabels(context, 6.351, '#a8ffe0');
  const view = emptyView();
  const end: number[] = [];
  let lastMs = NaN;
  let visible = false;

  return {
    setVisible(next) {
      visible = next;
      set.points.object.visible = next;
      tails.object.visible = next;
      labels.setVisible(next);
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (Math.abs(ms - lastMs) < UPDATE_INTERVAL_MS) return;
      lastMs = ms;
      const { jd, earth } = earthAt(frame.date);
      const inside = withinWindow(data, jd);
      const earthSun = Math.hypot(earth[0], earth[1], earth[2]);
      const sun = [-earth[0] / earthSun, -earth[1] / earthSun, -earth[2] / earthSun];
      const named: GroupLabel[] = [];
      comets.forEach((comet, i) => {
        let mag = Infinity;
        if (inside) {
          viewFromEarth(comet, jd, earth, view);
          mag = cometMagnitude(comet.m1, comet.k1, view.sunDistanceAu, view.distanceAu);
        }
        if (mag > COMET_MAG_LIMIT) {
          // Too faint by the prediction, or outside the orbits' period: not drawn.
          size.setX(i, 0);
          tailPositions.setXYZ(i * 2, 0, 0, 0);
          tailPositions.setXYZ(i * 2 + 1, 0, 0, 0);
          return;
        }
        const d = view.direction;
        positions[i].set(d[0], d[1], d[2]);
        set.points.positions.setXYZ(i, d[0], d[1], d[2]);
        size.setX(i, cometSizePx(mag));
        tailMarkEnd(d, sun, end);
        tailPositions.setXYZ(i * 2, d[0], d[1], d[2]);
        tailPositions.setXYZ(i * 2 + 1, end[0], end[1], end[2]);
        named.push(cometLabel(comet, mag, positions[i]));
      });
      set.points.positions.needsUpdate = true;
      size.needsUpdate = true;
      tailPositions.needsUpdate = true;
      labels.set(named);
      labels.setVisible(visible);
      if (!inside) context.setStatus(outsideWindowStatus(data), 'error');
      else context.setStatus(`${named.length} of ${count} at magnitude ${COMET_MAG_LIMIT} or brighter (predicted)`, 'info');
    },
    dispose() {
      set.points.dispose();
      tails.dispose();
      labels.remove();
    },
  };
}
