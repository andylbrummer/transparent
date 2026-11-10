/**
 * The planets among the stars: points at their true places, sized and
 * dimmed by apparent magnitude on the same scale as the stars, so Venus
 * outshines Sirius and Neptune needs its name to be found.
 */

import * as THREE from 'three';
import { AU_KM, PLANET_NAMES, SATURN_RINGS, planetDisc, planetEphemeris, planetShape, ringAspect, type PlanetName } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { SkyPoints } from '../../render/sky-points';
import { starAlpha, starSizePx } from '../../render/star-color';
import { MovingLabel, labelDropPx } from '../sun/moving-label';
import { planetDiscState } from './disc-state';
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
/** With the discs drawn (the "Planets close up" layer), a point gives way as its disc grows from the first to the second size, CSS px. */
const POINT_FADE_PX: readonly [number, number] = [12, 28];
/** A disc narrower than this is a speck: the name stays bare, without size and phase, CSS px. */
const DETAIL_MIN_DISC_PX = 12;
const LABEL_MIN_DROP_PX = 12;

const displayName = (planet: PlanetName): string => planet[0].toUpperCase() + planet.slice(1);

/** Sprite size (CSS px) and opacity for a planet of apparent magnitude `mag`. */
export function planetAppearance(mag: number): { sizePx: number; alpha: number } {
  return { sizePx: Math.max(MIN_SIZE_PX, starSizePx(mag)), alpha: Math.max(MIN_ALPHA, starAlpha(mag)) };
}

/** How much of a planet's point is left over a disc `discPx` wide. */
export function pointOpacity(discPx: number): number {
  const t = (discPx - POINT_FADE_PX[0]) / (POINT_FADE_PX[1] - POINT_FADE_PX[0]);
  return 1 - Math.max(0, Math.min(1, t));
}

/**
 * "Jupiter", or beside its disc "Jupiter · 44″ · 99% lit"; Saturn, always
 * all but full, gives its rings' opening instead: "Saturn · 19″ · rings open 8°".
 */
export function planetLabelText(
  planet: PlanetName,
  diameterArcsec: number,
  illuminatedFraction: number,
  withDisc: boolean,
  ringTiltDeg?: number
): string {
  const name = displayName(planet);
  if (!withDisc) return name;
  const size = diameterArcsec >= 10 ? diameterArcsec.toFixed(0) : diameterArcsec.toFixed(1);
  if (ringTiltDeg !== undefined) {
    const tilt = Math.abs(ringTiltDeg);
    return `${name} · ${size}″ · rings ${tilt < 0.5 ? 'edge-on' : `open ${tilt.toFixed(0)}°`}`;
  }
  return `${name} · ${size}″ · ${Math.round(illuminatedFraction * 100)}% lit`;
}

/** How far Saturn's rings reach, in radii of the planet: its name must clear them, not just the disc. */
const SATURN_RING_REACH = Math.max(...SATURN_RINGS.map((band) => band.outerKm)) / planetShape('saturn').equatorialRadiusKm;

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

  // Between the Moon (6.33) and the star names (6.4); the five naked-eye planets before the two telescopic ones.
  const labels = PLANET_NAMES.map(
    (planet) => new MovingLabel(context, 6.35, { fontPx: 11, color: '#ffe6c0' }, planet === 'uranus' || planet === 'neptune' ? 1 : 0)
  );
  /** Per planet: the point's own opacity, the disc's true diameter in radians, its diameter in arcseconds and lit fraction. */
  const baseAlpha = new Float64Array(count).fill(1);
  const diameterRad = new Float64Array(count);
  const diameterArcsec = new Float64Array(count);
  const lit = new Float64Array(count);
  let heightCss = window.innerHeight;
  let saturnRingTiltDeg = 0;
  let lastMs = NaN;

  return {
    setVisible(visible) {
      points.object.visible = visible;
      for (const label of labels) label.setVisible(visible);
    },
    setResolution(_widthCss, height) {
      heightCss = height;
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (!(Math.abs(ms - lastMs) < EPHEMERIS_INTERVAL_MS)) {
        lastMs = ms;
        PLANET_NAMES.forEach((planet, i) => {
          const ephemeris = planetEphemeris(planet, frame.date);
          const p = ephemeris.positionAu;
          // Seen from the Earth's centre: from its surface a planet shifts by under 35″ at the very most.
          const position = labels[i].position.set(p[0], p[1], p[2]).divideScalar(ephemeris.distanceAu);
          points.positions.setXYZ(i, position.x, position.y, position.z);
          const { sizePx, alpha } = planetAppearance(ephemeris.magnitude);
          sizeAttribute.setX(i, sizePx);
          baseAlpha[i] = alpha;
          diameterRad[i] = (2 * planetShape(planet).equatorialRadiusKm) / (ephemeris.distanceAu * AU_KM);
          diameterArcsec[i] = (diameterRad[i] * 648000) / Math.PI;
          lit[i] = ephemeris.illuminatedFraction;
          if (planet === 'saturn') saturnRingTiltDeg = ringAspect(planetDisc(planet, frame.date)).tiltDeg;
        });
        points.positions.needsUpdate = true;
        sizeAttribute.needsUpdate = true;
      }
      // With the discs drawn the point fades over its growing disc and the name steps clear of it.
      const magnification = planetDiscState.magnification;
      const pxPerRad = heightCss / ((frame.camera.fov * Math.PI) / 180);
      PLANET_NAMES.forEach((planet, i) => {
        const discPx = diameterRad[i] * magnification * pxPerRad;
        alphaAttribute.setX(i, baseAlpha[i] * pointOpacity(discPx));
        const saturn = planet === 'saturn';
        labels[i].set(
          planetLabelText(planet, diameterArcsec[i], lit[i], discPx >= DETAIL_MIN_DISC_PX, saturn ? saturnRingTiltDeg : undefined),
          labelDropPx(saturn ? discPx * SATURN_RING_REACH : discPx, LABEL_MIN_DROP_PX)
        );
      });
      alphaAttribute.needsUpdate = true;
    },
    dispose() {
      points.dispose();
      for (const label of labels) label.dispose();
    },
  };
}
