/**
 * Ocean surface currents as flowing trails: the wind layer's particles
 * (../weather/wind-field.ts, wind.ts) set adrift on the mean circulation
 * of the ocean instead of the air.
 *
 * The field (app/public/geo/ocean-currents.bin, from
 * tools/pipeline/generate_ocean_currents.py) is the mean of three years
 * of OSCAR's satellite-derived currents on the same 1° grid the GFS wind
 * uses, zero on land. It shows the standing pattern - gyres, western
 * boundary currents, the equatorial currents, the Antarctic Circumpolar
 * Current - and the layer says it is a mean, not the sea today.
 */

import * as THREE from 'three';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { GFS_NI, GFS_NJ } from '../weather/gfs';
import { particleBudget, WindTrails, type WindStyle } from '../weather/wind';
import { LoadGovernor, WindParticles, type WindField } from '../weather/wind-field';
import { CURRENT_DEGREES_PER_SECOND_AT_1_MS, CURRENT_RAMP } from './layer';

/** The shape of app/public/geo/ocean-currents.json. */
export interface OceanCurrentMeta {
  /** First and last composite averaged, ISO days. */
  readonly period: readonly [string, string];
  /** m/s per unit of the int8 grids. */
  readonly scale: number;
  readonly grid: { readonly ni: number; readonly nj: number; readonly latFirst: number; readonly latStep: number; readonly lonFirst: number; readonly lonStep: number };
  readonly names: readonly { readonly name: string; readonly lon: number; readonly lat: number }[];
}

export const CURRENT_STYLE: WindStyle = {
  ramp: CURRENT_RAMP,
  altitudeM: 0,
  degreesPerSecondAt10Ms: 10 * CURRENT_DEGREES_PER_SECOND_AT_1_MS,
  widthPx: 2.2,
  // The trails are short - most of the ocean moves a few cm/s - so more of them cost no more pixels than the wind's.
  particleShare: 1.3,
};

/** A cell slower than this is land, ice or a gap in the analysis: no particle starts or stays there, m/s. */
export const STILL_WATER_MS = 0.006;
const SLOTS = 12;
const SLOT_SECONDS = 0.16;
const SETS = 4;

/** The two int8 grids of ocean-currents.bin, eastward then northward, as m/s on the GFS grid. */
export function decodeCurrentField(bytes: ArrayBuffer, meta: Pick<OceanCurrentMeta, 'scale' | 'grid'>): WindField {
  const { ni, nj, latFirst, latStep, lonFirst, lonStep } = meta.grid;
  if (ni !== GFS_NI || nj !== GFS_NJ || latFirst !== 90 || latStep !== -1 || lonFirst !== 0 || lonStep !== 1) {
    throw new Error(`ocean currents are not on the 1° grid: ${ni}×${nj} from ${latFirst}°, ${lonFirst}°`);
  }
  const size = ni * nj;
  if (bytes.byteLength !== 2 * size) throw new Error(`ocean-currents.bin is ${bytes.byteLength} bytes, not ${2 * size}`);
  const raw = new Int8Array(bytes);
  const u = new Float32Array(size);
  const v = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    u[i] = raw[i] * meta.scale;
    v[i] = raw[size + i] * meta.scale;
  }
  return { u, v };
}

/** "Dec 2011 – Sep 2014". */
export function periodText(period: readonly [string, string]): string {
  const month = (iso: string): string =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${month(period[0])} – ${month(period[1])}`;
}

export function currentLabels(meta: Pick<OceanCurrentMeta, 'names'>): GroupLabel[] {
  return meta.names.map((current, priority) => ({
    text: current.name,
    priority,
    position: ecefAtAltitude(current.lon, current.lat, 0, new THREE.Vector3()),
  }));
}

export async function createOceanCurrentLayer(context: LayerContext): Promise<LayerInstance> {
  const [meta, bytes] = await Promise.all([
    context.fetchJson<OceanCurrentMeta>(context.assetUrl('geo/ocean-currents.json')),
    fetch(context.assetUrl('geo/ocean-currents.bin')).then((response) => {
      if (!response.ok) throw new Error(`ocean-currents.bin: HTTP ${response.status}`);
      return response.arrayBuffer();
    }),
  ]);
  const field = decodeCurrentField(bytes, meta);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const count = Math.round((particleBudget(coarse) * CURRENT_STYLE.particleShare) / SETS);
  const sets = Array.from({ length: SETS }, (_unused, i) => {
    const particles = new WindParticles(field, {
      count,
      slots: SLOTS,
      slotSeconds: SLOT_SECONDS,
      radiansPerMsPerSecond: ((CURRENT_STYLE.degreesPerSecondAt10Ms / 10) * Math.PI) / 180,
      lifeSeconds: [4, 9],
      minSpeed: STILL_WATER_MS,
    });
    const trails = new WindTrails(particles, CURRENT_STYLE, context.skyUniforms.uObserverUp, `ocean-currents-${i}`, context.skyUniforms.uPixelRatio.value);
    context.earthRoot.add(trails.object);
    return trails;
  });
  const labels = context.addLabels({
    rank: LABEL_KIND_ORDER.indexOf('country') - 0.35,
    style: { fontPx: 11, color: '#bff5e8', italic: true, bold: true },
    frame: 'earth',
    labels: currentLabels(meta),
  });
  context.setStatus(`mean · ${periodText(meta.period)}`, 'info');

  const governor = new LoadGovernor(undefined, undefined, 1 / SETS, 1 / SETS);
  let visible = false;
  let drawn = SETS;
  const show = (): void => sets.forEach((trails, i) => (trails.object.visible = visible && i < drawn));
  return {
    setVisible(next) {
      visible = next;
      labels.setVisible(next);
      show();
    },
    update(frame) {
      const keep = Math.round(governor.sample(frame.deltaMs) * SETS);
      if (keep !== drawn) {
        drawn = keep;
        show();
      }
      for (let i = 0; i < drawn; i++) sets[i].update(frame.deltaMs / 1000);
    },
    setResolution(widthCss, heightCss) {
      for (const trails of sets) trails.setResolution(widthCss, heightCss);
    },
    dispose() {
      labels.remove();
      for (const trails of sets) trails.dispose();
    },
  };
}
