/**
 * Earthquake hypocentres as points inside the see-through Earth.
 *
 * Sized by magnitude in screen pixels, the way a sky map sizes stars by
 * brightness, and coloured by depth on DEPTH_RAMP, so dipping slabs show
 * as bands running from red at the trench to violet ~700 km down. The
 * file is sorted by magnitude, so the great quakes draw last, on top.
 */

import * as THREE from 'three';
import type { LabelData } from './labels';
import { depthColor, ecefAtDepth } from './interior';

/** The shape of app/public/geo/quakes.json: columns, one entry per quake. */
export interface QuakeData extends LabelData {
  readonly quantumPerDegree: number;
  readonly lon: readonly number[];
  readonly lat: readonly number[];
  readonly depthKm: readonly number[];
  /** Magnitude times ten. */
  readonly magnitude10: readonly number[];
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
  }
`;

const QUAKE_RENDER_ORDER = 3;

export class QuakeLayer {
  private readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(data: QuakeData) {
    const count = data.lon.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const point = new THREE.Vector3();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      ecefAtDepth(data.lon[i] / data.quantumPerDegree, data.lat[i] / data.quantumPerDegree, data.depthKm[i], point);
      point.toArray(positions, i * 3);
      depthColor(data.depthKm[i], color).toArray(colors, i * 3);
      sizes[i] = quakePointSizePx(data.magnitude10[i] / 10);
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
    this.points.renderOrder = QUAKE_RENDER_ORDER;
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
