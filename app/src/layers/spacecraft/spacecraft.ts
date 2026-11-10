/**
 * Spacecraft beyond Earth orbit, as points on the sky with their distance:
 * the observatories around the Sun-Earth L1 and L2 points, 1.5 million km
 * sunward and anti-sunward, and the probes in deep space.
 *
 * All are beyond the far plane, so they are drawn on the celestial sphere
 * in their true direction; the label carries the distance. Directions
 * come from a baked table of JPL Horizons positions, interpolated to the
 * app clock - and for the L-point craft corrected for where on the Earth
 * the user stands, which shifts them by up to a quarter of a degree.
 * Outside a craft's table nothing is shown for it.
 */

import * as THREE from 'three';
import { AU_KM, sunGeocentricAu } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { SkyPoints } from '../../render/sky-points';
import { MovingLabel } from '../sun/moving-label';
import type { LayerContext, LayerInstance } from '../types';
import { AU_M, MU_SUN_EARTH, collinearLagrange, craftPositionAu, distanceText, lightTimeText, type CraftTable, type SpacecraftData } from './ephemeris-table';

export type SpacecraftGroup = 'lagrange' | 'deep';

const UPDATE_INTERVAL_MS = 1000;
const COLORS = { L1: [1, 0.85, 0.45], L2: [0.5, 0.95, 0.85], deep: [0.8, 0.86, 1] } as const;
const LABEL_COLORS = { L1: '#ffe2a0', L2: '#a8f5e4', deep: '#d4defc' } as const;
/** Short names for the labels; anything not listed keeps the name Horizons gives. */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  'James Webb Space Telescope': 'JWST',
  'Carruthers Geocorona Observatory': 'Carruthers',
  // Horizons keeps the trajectory under the first mission's name; since 2023 the spacecraft is OSIRIS-APEX, bound for Apophis.
  'OSIRIS-REx': 'OSIRIS-APEX',
};
/** The best known first: they win where names collide. */
const FAMOUS = ['JWST', 'SOHO', 'Voyager 1', 'Voyager 2', 'New Horizons', 'Parker Solar Probe', 'DSCOVR', 'Euclid'];

let dataPromise: Promise<SpacecraftData> | null = null;

function loadData(context: LayerContext): Promise<SpacecraftData> {
  dataPromise ??= context.fetchJson<SpacecraftData>(context.assetUrl('space/spacecraft.json')).catch((error: unknown) => {
    dataPromise = null;
    throw error;
  });
  return dataPromise;
}

export const displayName = (craft: CraftTable): string => SHORT_NAMES[craft.name] ?? craft.name;

/** "JWST · 1.70 million km · 5.7 light-seconds". */
export function craftText(name: string, au: number): string {
  return `${name} · ${distanceText(au)} · ${lightTimeText(au)}`;
}

interface Marker {
  readonly name: string;
  readonly craft: CraftTable | null;
  /** For the L points themselves: which side of the Earth, and the distance as a fraction of the Sun's. */
  readonly point: { readonly sign: 1 | -1; readonly fraction: number } | null;
  readonly label: MovingLabel;
  shown: boolean;
}

export async function createSpacecraftLayer(context: LayerContext, group: SpacecraftGroup): Promise<LayerInstance> {
  const data = await loadData(context);
  const startMs = Date.parse(`${data.start}T00:00:00Z`);
  const tables = data.craft.filter((craft) => (group === 'deep' ? craft.where === 'deep' : craft.where !== 'deep'));
  const markers: Marker[] = tables.map((craft) => {
    const name = displayName(craft);
    const famous = FAMOUS.indexOf(name);
    return {
      name,
      craft,
      point: null,
      // After the Moon (6.33), ahead of the star names (6.4).
      label: new MovingLabel(context, 6.35 + (famous < 0 ? 0.004 : famous * 0.0001), { fontPx: 10, color: LABEL_COLORS[craft.where] }),
      shown: false,
    };
  });
  if (group === 'lagrange') {
    const points = collinearLagrange(MU_SUN_EARTH);
    markers.unshift(
      { name: 'Sun–Earth L1', craft: null, point: { sign: 1, fraction: points.l1 }, label: new MovingLabel(context, 6.349, { fontPx: 11, color: LABEL_COLORS.L1, italic: true }), shown: false },
      { name: 'Sun–Earth L2', craft: null, point: { sign: -1, fraction: points.l2 }, label: new MovingLabel(context, 6.3491, { fontPx: 11, color: LABEL_COLORS.L2, italic: true }), shown: false }
    );
  }

  const count = markers.length;
  const directions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  markers.forEach((marker, i) => {
    const where = marker.craft?.where ?? (marker.point!.sign === 1 ? 'L1' : 'L2');
    colors.set(COLORS[where], i * 3);
    sizes[i] = marker.craft ? 9 : 15;
  });
  // Diamonds: the craft, and larger ones for the two empty points of balance they circle.
  const craftPoints = new SkyPoints(directions, sizes, colors, context.skyUniforms, { name: `spacecraft-${group}`, shape: 'diamond', renderOrder: RENDER_ORDER.sky + 0.02 }, alphas);
  context.skyRoot.add(craftPoints.object);
  const alphaAttribute = craftPoints.object.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;

  const position = [0, 0, 0];
  const observer = new THREE.Vector3();
  const toInertial = new THREE.Quaternion();
  const direction = new THREE.Vector3();
  let lastMs = NaN;
  let status = '';

  return {
    setVisible(visible) {
      craftPoints.object.visible = visible;
      for (const marker of markers) marker.label.setVisible(visible);
    },
    update(frame) {
      const dateMs = frame.date.getTime();
      if (Math.abs(dateMs - lastMs) < UPDATE_INTERVAL_MS) return;
      lastMs = dateMs;
      // Where the eye is, from the Earth's centre, in the inertial frame.
      toInertial.copy(context.inertialRoot.quaternion).invert();
      observer.copy(frame.camera.position).applyQuaternion(toInertial);
      const sun = sunGeocentricAu(frame.date);
      let visibleCount = 0;
      markers.forEach((marker, i) => {
        let au = 0;
        let ok = true;
        if (marker.craft) {
          ok = craftPositionAu(marker.craft, startMs, dateMs, position);
        } else {
          const k = marker.point!.sign * marker.point!.fraction;
          position[0] = sun[0] * k;
          position[1] = sun[1] * k;
          position[2] = sun[2] * k;
        }
        if (ok) {
          au = Math.hypot(position[0], position[1], position[2]);
          direction.set(position[0] * AU_M - observer.x, position[1] * AU_M - observer.y, position[2] * AU_M - observer.z).normalize();
          directions[i * 3] = direction.x;
          directions[i * 3 + 1] = direction.y;
          directions[i * 3 + 2] = direction.z;
          marker.label.position.copy(direction);
          marker.label.set(marker.craft ? craftText(marker.name, au) : `${marker.name} · ${distanceText(au)}`, 13);
          if (marker.craft) visibleCount++;
        } else if (marker.shown) {
          marker.label.set('', 13);
        }
        marker.shown = ok;
        alphas[i] = ok ? 0.95 : 0;
      });
      craftPoints.positions.needsUpdate = true;
      alphaAttribute.needsUpdate = true;
      const range = `JPL Horizons table ${data.start.slice(0, 4)} – ${Number(data.stop.slice(0, 4)) - 1}`;
      const next = visibleCount === 0 ? `no trajectory for the shown date · ${range}` : visibleCount < tables.length ? `${visibleCount} of ${tables.length} have a trajectory for this date` : range;
      if (next !== status) {
        status = next;
        context.setStatus(next, visibleCount === 0 ? 'stale' : 'info');
      }
    },
    dispose() {
      craftPoints.dispose();
      for (const marker of markers) marker.label.dispose();
    },
  };
}

/** Distance from the Earth to the Sun-Earth L1 and L2 points for a Sun `sunAu` away, km: for the caption's sake and the tests'. */
export function sunEarthPointsKm(sunAu: number): { l1: number; l2: number } {
  const points = collinearLagrange(MU_SUN_EARTH);
  return { l1: points.l1 * sunAu * AU_KM, l2: points.l2 * sunAu * AU_KM };
}
