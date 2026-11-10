/**
 * Thin coloured lines and round markers at real places around the Earth:
 * orbits, magnetic field lines, model surfaces, the points they pass.
 *
 * Positions are metres in whatever frame the parent group is in (Earth-
 * fixed, or inertial). Like everything else nothing depth-tests; what lies
 * below the user's horizon is, from the surface, seen through the planet,
 * and is drawn fainter by `belowHorizon`.
 */

import * as THREE from 'three';
import type { SkyUniforms } from '../layers/types';
import { RENDER_ORDER } from './order';

/** How faint things seen through the Earth are, against the same in the sky. */
export const SEEN_THROUGH_EARTH = 0.62;

export interface SpaceDrawOptions {
  readonly name: string;
  readonly renderOrder?: number;
  /** Default SEEN_THROUGH_EARTH. */
  readonly belowHorizon?: number;
  /** Positions will be rewritten: hint the driver. Default false. */
  readonly dynamic?: boolean;
  /** Add light rather than cover. Default false. */
  readonly additive?: boolean;
}

const LINE_VERTEX = `
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform vec3 uObserverUp;
  uniform float uBelow;
  varying vec4 vColor;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // Faded over 20 km either side of the horizon plane rather than stepped: a segment's ends interpolate.
    float above = smoothstep(-2.0e4, 2.0e4, dot(world.xyz - cameraPosition, uObserverUp));
    vColor = vec4(aColor, aAlpha * mix(uBelow, 1.0, above));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LINE_FRAGMENT = `
  uniform float uOpacity;
  varying vec4 vColor;
  void main() {
    gl_FragColor = vec4(vColor.rgb, vColor.a * uOpacity);
  }
`;

/** Line segments, two points each, with a colour and an opacity per point. One device pixel wide. */
export class SpaceLines {
  readonly object: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  /** `positions`: xyz per point. `colors`: rgb per point. `alphas`: one per point. */
  constructor(positions: Float32Array, colors: Float32Array, alphas: Float32Array, uniforms: SkyUniforms, options: SpaceDrawOptions) {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(positions, 3);
    if (options.dynamic) position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      uniforms: {
        uObserverUp: uniforms.uObserverUp,
        uBelow: { value: options.belowHorizon ?? SEEN_THROUGH_EARTH },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.object = new THREE.LineSegments(geometry, this.material);
    this.object.name = options.name;
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder ?? RENDER_ORDER.nearSpace;
  }

  /** The position attribute, for lines that move: write, add update ranges, set needsUpdate. */
  get positions(): THREE.BufferAttribute {
    return this.object.geometry.getAttribute('position') as THREE.BufferAttribute;
  }

  get alphas(): THREE.BufferAttribute {
    return this.object.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
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

const MARKER_VERTEX = `
  attribute vec3 aColor;
  attribute float aSize;
  uniform vec3 uObserverUp;
  uniform float uBelow;
  uniform float uPixelRatio;
  varying vec4 vColor;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float above = step(0.0, dot(world.xyz - cameraPosition, uObserverUp));
    vColor = vec4(aColor, mix(uBelow, 1.0, above));
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const MARKER_FRAGMENT = `
  uniform float uOpacity;
  uniform float uRing;
  varying vec4 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float disc = 1.0 - smoothstep(0.6, 1.0, r);
    float ring = smoothstep(0.55, 0.7, r) * (1.0 - smoothstep(0.85, 1.0, r)) + (1.0 - smoothstep(0.1, 0.22, r));
    float a = mix(disc, ring, uRing) * vColor.a * uOpacity;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

/** Round markers at points in space, sized in CSS pixels: discs, or rings with a dot at the centre. */
export class SpaceMarkers {
  readonly object: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    positions: Float32Array,
    colors: Float32Array,
    sizesPx: Float32Array,
    uniforms: SkyUniforms,
    options: SpaceDrawOptions & { readonly shape?: 'disc' | 'ring' }
  ) {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(positions, 3);
    if (options.dynamic) position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizesPx, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      uniforms: {
        uObserverUp: uniforms.uObserverUp,
        uPixelRatio: uniforms.uPixelRatio,
        uBelow: { value: options.belowHorizon ?? SEEN_THROUGH_EARTH },
        uOpacity: { value: 1 },
        uRing: { value: options.shape === 'ring' ? 1 : 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new THREE.Points(geometry, this.material);
    this.object.name = options.name;
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder ?? RENDER_ORDER.nearSpace + 0.1;
  }

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
 * The direction from the eye to a point of the world, as a unit vector in
 * ICRS: what a label of frame 'sky' wants. Names of things near the Earth
 * are placed this way because the label layer keeps a separate allowance
 * for names on the sky, which the ground's own names cannot use up.
 * `toInertial` is the inverse of the inertial root's quaternion.
 */
export function skyDirectionOf(world: THREE.Vector3, camera: THREE.Camera, toInertial: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(world).sub(camera.position).normalize().applyQuaternion(toInertial);
}
