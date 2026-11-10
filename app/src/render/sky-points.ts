/**
 * Points on the celestial sphere: stars, and the markers of anything
 * catalogued by position - galaxies, pulsars, X-ray sources.
 *
 * Positions are unit directions in ICRS, for a child of the sky root.
 * Sizes are CSS pixels. Whatever is below the horizon is seen through the
 * planet, dimmed by the shared uBelowHorizon.
 */

import * as THREE from 'three';
import type { SkyUniforms } from '../layers/types';
import { RENDER_ORDER } from './order';

export type SkyPointShape = 'star' | 'disc' | 'ring' | 'diamond' | 'square' | 'cross';

const SHAPE_INDEX: Readonly<Record<SkyPointShape, number>> = { star: 0, disc: 1, ring: 2, diamond: 3, square: 4, cross: 5 };

export interface SkyPointsOptions {
  readonly name: string;
  /** Default 'star': a bright core with a soft halo. */
  readonly shape?: SkyPointShape;
  /** Default 1. */
  readonly opacity?: number;
  /** Add light rather than cover what is behind. Default true. */
  readonly additive?: boolean;
  readonly renderOrder?: number;
}

const VERTEX_SHADER = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform float uPixelRatio;
  uniform vec3 uObserverUp;
  uniform float uBelowHorizon;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vec3 worldDir = normalize(mat3(modelMatrix) * position);
    float above = step(0.0, dot(worldDir, uObserverUp));
    vAlpha = aAlpha * mix(uBelowHorizon, 1.0, above);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const FRAGMENT_SHADER = `
  uniform int uShape;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    float r = length(p);
    float a;
    if (uShape == 0) {
      // Star: solid core, halo falling to nothing at the sprite's edge.
      a = smoothstep(1.0, 0.0, r);
      a = a * a + 0.6 * (1.0 - smoothstep(0.25, 0.5, r));
    } else if (uShape == 1) {
      a = 1.0 - smoothstep(0.8, 1.0, r);
    } else if (uShape == 2) {
      a = smoothstep(0.55, 0.7, r) * (1.0 - smoothstep(0.85, 1.0, r));
    } else if (uShape == 3) {
      float d = abs(p.x) + abs(p.y);
      a = smoothstep(0.6, 0.72, d) * (1.0 - smoothstep(0.88, 1.0, d));
    } else if (uShape == 4) {
      float d = max(abs(p.x), abs(p.y));
      a = smoothstep(0.6, 0.72, d) * (1.0 - smoothstep(0.88, 1.0, d));
    } else {
      float d = min(abs(p.x), abs(p.y));
      a = (1.0 - smoothstep(0.1, 0.22, d)) * (1.0 - smoothstep(0.85, 1.0, r));
    }
    a = min(a, 1.0) * vAlpha * uOpacity;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export class SkyPoints {
  readonly object: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  /**
   * `directions`: xyz per point. `sizesPx`: one per point. `colors`: rgb
   * per point, 0..1. `alphas`: one per point, default all 1.
   */
  constructor(
    directions: Float32Array,
    sizesPx: Float32Array,
    colors: Float32Array,
    uniforms: SkyUniforms,
    options: SkyPointsOptions,
    alphas?: Float32Array
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(directions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizesPx, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas ?? new Float32Array(sizesPx.length).fill(1), 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uPixelRatio: uniforms.uPixelRatio,
        uObserverUp: uniforms.uObserverUp,
        uBelowHorizon: uniforms.uBelowHorizon,
        uShape: { value: SHAPE_INDEX[options.shape ?? 'star'] },
        uOpacity: { value: options.opacity ?? 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.object = new THREE.Points(geometry, this.material);
    this.object.name = options.name;
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder ?? RENDER_ORDER.sky;
  }

  /** The position attribute, for layers whose points move: write, then set needsUpdate. */
  get positions(): THREE.BufferAttribute {
    return this.object.geometry.getAttribute('position') as THREE.BufferAttribute;
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Thin lines on the celestial sphere - constellation figures, grids,
 * boundaries. `segments`: unit ICRS directions, two points (six numbers)
 * per segment. One device pixel wide.
 */
export class SkyLines {
  readonly object: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  constructor(segments: Float32Array, color: number, opacity: number, uniforms: SkyUniforms, name: string) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(segments, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: `
        uniform vec3 uObserverUp;
        uniform float uBelowHorizon;
        varying float vAlpha;
        void main() {
          vec3 worldDir = normalize(mat3(modelMatrix) * position);
          // Fades across the horizon rather than stepping: a segment's ends interpolate.
          vAlpha = mix(uBelowHorizon, 1.0, smoothstep(-0.01, 0.01, dot(worldDir, uObserverUp)));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * vAlpha);
        }
      `,
      uniforms: {
        uObserverUp: uniforms.uObserverUp,
        uBelowHorizon: uniforms.uBelowHorizon,
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(geometry, this.material);
    this.object.name = name;
    this.object.frustumCulled = false;
    this.object.renderOrder = RENDER_ORDER.sky;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Points along the great-circle arc from unit vector a to b, as segment
 * endpoints appended to `out`: a long line drawn straight would cut a chord
 * that bows off the sphere's projection near the screen edge.
 */
export function greatCircleSegments(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  maxStepDeg: number,
  out: number[]
): void {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);
  const steps = Math.max(1, Math.ceil(angle / ((maxStepDeg * Math.PI) / 180)));
  const sin = Math.sin(angle);
  let px = a[0];
  let py = a[1];
  let pz = a[2];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Slerp; for coincident points fall back to the endpoint.
    const wa = sin < 1e-9 ? 1 - t : Math.sin((1 - t) * angle) / sin;
    const wb = sin < 1e-9 ? t : Math.sin(t * angle) / sin;
    const x = wa * a[0] + wb * b[0];
    const y = wa * a[1] + wb * b[1];
    const z = wa * a[2] + wb * b[2];
    out.push(px, py, pz, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
}
