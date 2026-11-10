/**
 * The planets among the stars: points at their true places, sized and
 * dimmed by apparent magnitude on the same scale as the stars, so Venus
 * outshines Sirius and Neptune needs its name to be found.
 */

import * as THREE from 'three';
import { PLANET_NAMES, planetEphemeris, type PlanetName } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { SkyPoints } from '../../render/sky-points';
import { starAlpha, starSizePx } from '../../render/star-color';
import type { GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';

/**
 * How each planet's light looks to the eye - a drawing choice, not a
 * measurement: Mars rust, Jupiter cream, Saturn pale gold, the ice giants
 * blue-green and blue.
 */
export const PLANET_COLORS: Readonly<Record<PlanetName, readonly [number, number, number]>> = {
  mercury: [0.86, 0.82, 0.76],
  venus: [1.0, 0.98, 0.9],
  mars: [1.0, 0.56, 0.36],
  jupiter: [1.0, 0.93, 0.8],
  saturn: [0.98, 0.9, 0.68],
  uranus: [0.7, 0.93, 0.93],
  neptune: [0.55, 0.68, 1.0],
};

/** The fastest, Mercury, moves 2° a day: once a second is far more than enough. */
const EPHEMERIS_INTERVAL_MS = 1000;
/** No planet is drawn smaller than this, CSS px: each is one of seven and should be findable. */
const MIN_SIZE_PX = 3.4;
/** Nor fainter than this. */
const MIN_ALPHA = 0.7;

const displayName = (planet: PlanetName): string => planet[0].toUpperCase() + planet.slice(1);

/** Sprite size (CSS px) and opacity for a planet of apparent magnitude `mag`. */
export function planetAppearance(mag: number): { sizePx: number; alpha: number } {
  return { sizePx: Math.max(MIN_SIZE_PX, starSizePx(mag)), alpha: Math.max(MIN_ALPHA, starAlpha(mag)) };
}

export function createPlanetsLayer(context: LayerContext): LayerInstance {
  const count = PLANET_NAMES.length;
  const sizes = new Float32Array(count).fill(MIN_SIZE_PX);
  const alphas = new Float32Array(count).fill(1);
  const colors = new Float32Array(count * 3);
  PLANET_NAMES.forEach((planet, i) => colors.set(PLANET_COLORS[planet], i * 3));
  const points = new SkyPoints(
    new Float32Array(count * 3),
    sizes,
    colors,
    context.skyUniforms,
    // Just over the stars, so a planet in front of one is not lost in it.
    { name: 'planets', renderOrder: RENDER_ORDER.sky + 0.005 },
    alphas
  );
  context.skyRoot.add(points.object);
  const sizeAttribute = points.object.geometry.getAttribute('aSize') as THREE.BufferAttribute;
  const alphaAttribute = points.object.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;

  const positions = PLANET_NAMES.map(() => new THREE.Vector3());
  const labelSpecs: GroupLabel[] = PLANET_NAMES.map((planet, i) => ({
    text: displayName(planet),
    // The five naked-eye planets before the two telescopic ones.
    priority: planet === 'uranus' || planet === 'neptune' ? 1 : 0,
    position: positions[i],
  }));
  // Between the Moon (6.33) and the star names (6.4).
  const labels = context.addLabels({
    rank: 6.35,
    style: { fontPx: 11, color: '#ffe6c0', offsetYPx: 12 },
    frame: 'sky',
    labels: labelSpecs,
  });
  let lastMs = NaN;

  return {
    setVisible(visible) {
      points.object.visible = visible;
      labels.setVisible(visible);
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (Math.abs(ms - lastMs) < EPHEMERIS_INTERVAL_MS) return;
      lastMs = ms;
      PLANET_NAMES.forEach((planet, i) => {
        const ephemeris = planetEphemeris(planet, frame.date);
        const p = ephemeris.positionAu;
        // Seen from the Earth's centre: from its surface a planet shifts by under 35″ at the very most.
        positions[i].set(p[0], p[1], p[2]).divideScalar(ephemeris.distanceAu);
        points.positions.setXYZ(i, positions[i].x, positions[i].y, positions[i].z);
        const { sizePx, alpha } = planetAppearance(ephemeris.magnitude);
        sizeAttribute.setX(i, sizePx);
        alphaAttribute.setX(i, alpha);
      });
      points.positions.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
      alphaAttribute.needsUpdate = true;
    },
    dispose() {
      points.dispose();
      labels.remove();
    },
  };
}
