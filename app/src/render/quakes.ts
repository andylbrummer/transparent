/**
 * Earthquake hypocentres as points inside the see-through Earth.
 *
 * Sized by magnitude in screen pixels, the way a sky map sizes stars by
 * brightness, and coloured by depth on DEPTH_RAMP, so dipping slabs show
 * as bands running from red at the trench to violet ~700 km down. The
 * file runs oldest first; the layer draws in order of magnitude, so the
 * great quakes come last, on top.
 *
 * Where a point sits: longitude and geodetic latitude as given, on the
 * app's sphere, `depthKm` straight down from it - no exaggeration. The
 * sphere stands in for the WGS84 ellipsoid as it does for the coastlines,
 * so a hypocentre is right against the map above it, and off its true
 * geocentric place by the same 7 to 22 km as the coast is.
 */

import * as THREE from 'three';
import type { LabelData } from './labels';
import { depthColor, ecefAtDepth } from './interior';
import { RENDER_ORDER } from './order';

/** The shape of app/public/geo/quakes.json: columns, one entry per quake, oldest first. */
export interface QuakeData extends LabelData {
  readonly quantumPerDegree: number;
  /**
   * Origin time in whole minutes: the first entry since 1970-01-01T00:00Z,
   * each later entry since the one before it.
   */
  readonly minute: readonly number[];
  readonly lon: readonly number[];
  readonly lat: readonly number[];
  /** Whole kilometres below sea level. */
  readonly depthKm: readonly number[];
  /** Magnitude times ten. */
  readonly magnitude10: readonly number[];
}

/** Origin time of every quake, epoch milliseconds, to the minute. */
export function quakeTimesMs(data: Pick<QuakeData, 'minute'>): Float64Array {
  const times = new Float64Array(data.minute.length);
  let minute = 0;
  for (let i = 0; i < times.length; i++) {
    minute += data.minute[i];
    times[i] = minute * 60000;
  }
  return times;
}

/** Indices in drawing order: by magnitude, the greatest last; equals stay oldest first. */
export function quakeDrawOrder(data: Pick<QuakeData, 'magnitude10'>): Uint32Array {
  const order = new Uint32Array(data.magnitude10.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  return order.sort((a, b) => data.magnitude10[a] - data.magnitude10[b] || a - b);
}

/** Point diameter in CSS px: M5 1.6 px, growing ×1.55 per magnitude (M9 ≈ 9 px). */
export function quakePointSizePx(magnitude: number): number {
  return 1.6 * Math.pow(1.55, magnitude - 5);
}

const VERTEX_SHADER = `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vColor;
  void main() {
    // Round, with a soft edge so 2 px points do not alias into squares.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = 0.8 * (1.0 - smoothstep(0.7, 1.0, r));
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, alpha);
    // THREE.Color holds DEPTH_RAMP in linear light; without this the points
    // come out darker and more saturated than the legend and the slab lines.
    #include <colorspace_fragment>
  }
`;

/** The fragment shader, for the test that it encodes its colours for the screen. */
export const QUAKE_FRAGMENT_SHADER = FRAGMENT_SHADER;

export class QuakeLayer {
  private readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(data: QuakeData) {
    const order = quakeDrawOrder(data);
    const count = order.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const point = new THREE.Vector3();
    const color = new THREE.Color();
    for (let slot = 0; slot < count; slot++) {
      const i = order[slot];
      ecefAtDepth(data.lon[i] / data.quantumPerDegree, data.lat[i] / data.quantumPerDegree, data.depthKm[i], point);
      point.toArray(positions, slot * 3);
      depthColor(data.depthKm[i], color).toArray(colors, slot * 3);
      sizes[slot] = quakePointSizePx(data.magnitude10[i] / 10);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { uPixelRatio: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'quakes';
    this.points.frustumCulled = false;
    this.points.renderOrder = RENDER_ORDER.quakes;
  }

  getObject(): THREE.Object3D {
    return this.points;
  }

  /** Point sizes are CSS pixels; gl_PointSize is device pixels. */
  setPixelRatio(ratio: number): void {
    this.material.uniforms.uPixelRatio.value = ratio;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
