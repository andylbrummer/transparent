/**
 * The sky's reference circles: an equatorial grid (ICRS, i.e. J2000 hour
 * circles and parallels) and the three great planes - celestial equator,
 * ecliptic, galactic equator. Pure geometry from the frames in core/astro.
 */

import * as THREE from 'three';
import { ECLIPTIC_POLE_ICRS, ICRS_TO_GALACTIC, applyMat3, raDecToUnit, transposeMat3 } from '@transparent-earth/core';
import { SkyLines } from '../../render/sky-points';
import type { GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';

type Vec = readonly [number, number, number];

const DEG = Math.PI / 180;
/** Arc length of one drawn segment. */
const STEP_DEG = 2;
const HOUR_CIRCLE_STEP_DEG = 30;
const PARALLELS_DEG = [-60, -30, 30, 60];
/** Hour circles stop short of the poles, where twelve of them would knot together. */
const HOUR_CIRCLE_MAX_DEC = 80;

const GALACTIC_TO_ICRS = transposeMat3(ICRS_TO_GALACTIC);

function cross(a: Vec, b: Vec): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: Vec): [number, number, number] {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
}

/**
 * The point at `longitudeDeg` along the great circle whose pole is `pole`,
 * measured from `origin` (projected onto the circle) in the direction of
 * increasing longitude about that pole.
 */
export function pointOnGreatCircle(pole: Vec, origin: Vec, longitudeDeg: number): [number, number, number] {
  const y = normalize(cross(pole, origin));
  const x = cross(y, pole);
  const c = Math.cos(longitudeDeg * DEG);
  const s = Math.sin(longitudeDeg * DEG);
  return [x[0] * c + y[0] * s, x[1] * c + y[1] * s, x[2] * c + y[2] * s];
}

function pushSegment(out: number[], a: Vec, b: Vec): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
}

/** Segments of the full great circle with pole `pole`. */
export function greatCircle(pole: Vec, origin: Vec): Float32Array {
  const out: number[] = [];
  for (let lon = 0; lon < 360; lon += STEP_DEG) {
    pushSegment(out, pointOnGreatCircle(pole, origin, lon), pointOnGreatCircle(pole, origin, lon + STEP_DEG));
  }
  return new Float32Array(out);
}

/** Hour circles every two hours and parallels every 30°, the equator left to its own line. */
export function equatorialGrid(): Float32Array {
  const out: number[] = [];
  for (let ra = 0; ra < 360; ra += HOUR_CIRCLE_STEP_DEG) {
    for (let dec = -HOUR_CIRCLE_MAX_DEC; dec < HOUR_CIRCLE_MAX_DEC; dec += STEP_DEG) {
      pushSegment(out, raDecToUnit(ra, dec), raDecToUnit(ra, dec + STEP_DEG));
    }
  }
  for (const dec of PARALLELS_DEG) {
    for (let ra = 0; ra < 360; ra += STEP_DEG) {
      pushSegment(out, raDecToUnit(ra, dec), raDecToUnit(ra + STEP_DEG, dec));
    }
  }
  return new Float32Array(out);
}

const ICRS_POLE: Vec = [0, 0, 1];
const EQUINOX: Vec = [1, 0, 0];
const GALACTIC_POLE: Vec = applyMat3(GALACTIC_TO_ICRS, [0, 0, 1]);
const GALACTIC_CENTRE: Vec = applyMat3(GALACTIC_TO_ICRS, [1, 0, 0]);

function label(text: string, priority: number, v: Vec): GroupLabel {
  return { text, priority, position: new THREE.Vector3(v[0], v[1], v[2]) };
}

/** Hours along the equator, degrees up two hour circles, and the planes and poles by name. */
export function gridLabels(): GroupLabel[] {
  const labels: GroupLabel[] = [
    label('North celestial pole', 0, ICRS_POLE),
    label('South celestial pole', 0, [0, 0, -1]),
    label('Galactic centre', 0, GALACTIC_CENTRE),
    label('Galactic anticentre', 1, [-GALACTIC_CENTRE[0], -GALACTIC_CENTRE[1], -GALACTIC_CENTRE[2]]),
    label('North galactic pole', 1, GALACTIC_POLE),
    label('South galactic pole', 1, [-GALACTIC_POLE[0], -GALACTIC_POLE[1], -GALACTIC_POLE[2]]),
    label('North ecliptic pole', 1, ECLIPTIC_POLE_ICRS),
    label('South ecliptic pole', 1, [-ECLIPTIC_POLE_ICRS[0], -ECLIPTIC_POLE_ICRS[1], -ECLIPTIC_POLE_ICRS[2]]),
    label('March equinox', 1, EQUINOX),
    label('September equinox', 1, [-1, 0, 0]),
  ];
  // Plane names sit between the hour marks, a quarter-turn apart.
  for (let lon = 45; lon < 360; lon += 90) {
    labels.push(label('Celestial equator', 2, pointOnGreatCircle(ICRS_POLE, EQUINOX, lon)));
    labels.push(label('Ecliptic', 2, pointOnGreatCircle(ECLIPTIC_POLE_ICRS, EQUINOX, lon)));
    labels.push(label('Galactic plane', 2, pointOnGreatCircle(GALACTIC_POLE, GALACTIC_CENTRE, lon)));
  }
  for (let ra = 0; ra < 360; ra += HOUR_CIRCLE_STEP_DEG) {
    if (ra % 180 !== 0) labels.push(label(`${ra / 15}h`, 3, raDecToUnit(ra, 0)));
  }
  for (const dec of PARALLELS_DEG) {
    for (const ra of [0, 180]) {
      labels.push(label(`${dec > 0 ? '+' : '−'}${Math.abs(dec)}°`, 4, raDecToUnit(ra, dec)));
    }
  }
  return labels;
}

export function createGridLayer(context: LayerContext): LayerInstance {
  const uniforms = context.skyUniforms;
  const lines = [
    new SkyLines(equatorialGrid(), 0x5a7088, 0.3, uniforms, 'sky-grid'),
    new SkyLines(greatCircle(ICRS_POLE, EQUINOX), 0x5fb4d8, 0.7, uniforms, 'celestial-equator'),
    new SkyLines(greatCircle(ECLIPTIC_POLE_ICRS, EQUINOX), 0xe0c060, 0.7, uniforms, 'ecliptic'),
    new SkyLines(greatCircle(GALACTIC_POLE, GALACTIC_CENTRE), 0xc878c8, 0.6, uniforms, 'galactic-equator'),
  ];
  for (const line of lines) context.skyRoot.add(line.object);
  // Last among the sky's names: a grid mark gives way to anything real.
  const labels = context.addLabels({
    rank: 6.6,
    style: { fontPx: 10, color: '#9fb4c8', italic: true },
    frame: 'sky',
    labels: gridLabels(),
  });
  return {
    setVisible(visible) {
      for (const line of lines) line.object.visible = visible;
      labels.setVisible(visible);
    },
    dispose() {
      for (const line of lines) line.dispose();
      labels.remove();
    },
  };
}
