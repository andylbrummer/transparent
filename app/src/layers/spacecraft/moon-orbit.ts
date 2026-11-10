/**
 * The Moon's orbit, and the five Lagrange points of the Earth-Moon pair,
 * at their true places around the Earth: the path the Moon takes through
 * one sidereal month centred on now, and the points of balance that turn
 * with it - L1 and L2 on the line through the Moon, L3 opposite it, L4
 * and L5 sixty degrees ahead and behind.
 *
 * The orbit is the real one from the lunar ephemeris, an ellipse that
 * does not quite close. The Lagrange points are those of the circular
 * restricted three-body problem scaled to the Moon's distance at the
 * moment - the usual convention; on the real, eccentric and Sun-perturbed
 * orbit they are places to orbit around, not fixed points.
 */

import * as THREE from 'three';
import { moonGeocentricKm } from '@transparent-earth/core';
import type { LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SpaceLines, SpaceMarkers, skyDirectionOf } from '../../render/space-lines';
import type { LayerContext, LayerInstance } from '../types';
import { MU_EARTH_MOON, collinearLagrange } from './ephemeris-table';

/** Sidereal month, days: one turn of the Moon against the stars. */
export const SIDEREAL_MONTH_DAYS = 27.321661;
const SEGMENTS = 240;
const DAY_MS = 86400000;
/** The path is redrawn when the clock has moved this far: it is centred on now and fades to both ends. */
const REDRAW_MS = 3 * 3600 * 1000;
const POINT_INTERVAL_MS = 2000;
const ORBIT_COLOR = [0.78, 0.8, 0.9] as const;
const POINT_COLOR = [0.7, 0.85, 1] as const;

/**
 * The five points for a Moon at `moon` (any units) moving along
 * `velocity`: positions in the same units, L1 to L5 in order, written to
 * `out` (fifteen numbers).
 */
export function earthMoonPoints(moon: readonly number[], velocity: readonly number[], out: Float32Array | number[]): void {
  const { l1, l2, l3 } = collinearLagrange(MU_EARTH_MOON);
  const along = [1 - l1, 1 + l2, -l3];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) out[i * 3 + k] = moon[k] * along[i];
  }
  // In the orbit's plane, square to the Moon's direction, on the side it is heading for.
  const d = Math.hypot(moon[0], moon[1], moon[2]);
  const dot = (velocity[0] * moon[0] + velocity[1] * moon[1] + velocity[2] * moon[2]) / (d * d);
  const ahead = [velocity[0] - dot * moon[0], velocity[1] - dot * moon[1], velocity[2] - dot * moon[2]];
  const scale = d / Math.hypot(ahead[0], ahead[1], ahead[2]);
  const sin60 = Math.sqrt(3) / 2;
  for (let k = 0; k < 3; k++) {
    out[9 + k] = 0.5 * moon[k] + sin60 * scale * ahead[k];
    out[12 + k] = 0.5 * moon[k] - sin60 * scale * ahead[k];
  }
}

export function createMoonOrbitLayer(context: LayerContext): LayerInstance {
  const positions = new Float32Array(SEGMENTS * 6);
  const colors = new Float32Array(SEGMENTS * 6);
  const alphas = new Float32Array(SEGMENTS * 2);
  for (let v = 0; v < SEGMENTS * 2; v++) {
    colors.set(ORBIT_COLOR, v * 3);
    // Strongest at the Moon, fading toward half a month before and after, where the ends do not quite meet.
    const fromNow = Math.abs(((v + 1) >> 1) / SEGMENTS - 0.5) * 2;
    alphas[v] = 0.75 * (1 - 0.75 * fromNow);
  }
  const orbit = new SpaceLines(positions, colors, alphas, context.skyUniforms, { name: 'moon-orbit', dynamic: true, renderOrder: RENDER_ORDER.sky + 0.05 });
  context.inertialRoot.add(orbit.object);

  const pointPositions = new Float32Array(15);
  const pointColors = new Float32Array(15);
  for (let i = 0; i < 5; i++) pointColors.set(POINT_COLOR, i * 3);
  const points = new SpaceMarkers(pointPositions, pointColors, new Float32Array(5).fill(12), context.skyUniforms, {
    name: 'earth-moon-lagrange',
    shape: 'ring',
    dynamic: true,
    renderOrder: RENDER_ORDER.sky + 0.055,
  });
  context.inertialRoot.add(points.object);
  const sky = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
  const labels: LabelGroup = context.addLabels({
    rank: 6.345,
    style: { fontPx: 10, color: '#c4dcff', italic: true, offsetYPx: 13 },
    frame: 'sky',
    labels: sky.map((position, i) => ({ text: `Earth–Moon L${i + 1}`, priority: i, position })),
  });

  const world = new THREE.Vector3();
  const toInertial = new THREE.Quaternion();
  let drawnMs = NaN;
  let pointsMs = NaN;

  return {
    setVisible(visible) {
      orbit.object.visible = visible;
      points.object.visible = visible;
      labels.setVisible(visible);
    },
    update(frame) {
      const dateMs = frame.date.getTime();
      if (!(Math.abs(dateMs - drawnMs) < REDRAW_MS)) {
        drawnMs = dateMs;
        const span = SIDEREAL_MONTH_DAYS * DAY_MS;
        let previous = moonGeocentricKm(new Date(dateMs - span / 2));
        for (let i = 0; i < SEGMENTS; i++) {
          const next = moonGeocentricKm(new Date(dateMs - span / 2 + ((i + 1) / SEGMENTS) * span));
          for (let k = 0; k < 3; k++) {
            positions[i * 6 + k] = previous[k] * 1000;
            positions[i * 6 + 3 + k] = next[k] * 1000;
          }
          previous = next;
        }
        orbit.positions.needsUpdate = true;
      }
      if (!(Math.abs(dateMs - pointsMs) < POINT_INTERVAL_MS)) {
        pointsMs = dateMs;
        const moon = moonGeocentricKm(frame.date);
        const later = moonGeocentricKm(new Date(dateMs + 60000));
        earthMoonPoints(
          [moon[0] * 1000, moon[1] * 1000, moon[2] * 1000],
          [later[0] - moon[0], later[1] - moon[1], later[2] - moon[2]],
          pointPositions
        );
        points.positions.needsUpdate = true;
      }
      // The points as directions from the eye, for their names.
      toInertial.copy(context.inertialRoot.quaternion).invert();
      for (let i = 0; i < 5; i++) {
        world.set(pointPositions[i * 3], pointPositions[i * 3 + 1], pointPositions[i * 3 + 2]).applyQuaternion(context.inertialRoot.quaternion);
        skyDirectionOf(world, frame.camera, toInertial, sky[i]);
      }
    },
    dispose() {
      orbit.dispose();
      points.dispose();
      labels.remove();
    },
  };
}
