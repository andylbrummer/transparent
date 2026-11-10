/**
 * An all-sky image behind everything: the Milky Way, the microwave
 * background, the X-ray sky.
 *
 * The image is a plate carrée in its own frame - ICRS or galactic - laid
 * out the way sky atlases are: longitude 0 at the centre and increasing
 * to the LEFT (east is left when looking up), north at the top. Each pixel's
 * view ray is turned into that frame and looked up, so there is no mesh and
 * no seam. Its light is added over the scene, dimmed below the horizon by
 * the shared uBelowHorizon.
 */

import * as THREE from 'three';
import { ICRS_TO_GALACTIC } from '@transparent-earth/core';
import type { SkyUniforms } from '../layers/types';
import { RENDER_ORDER } from './order';
import {
  FULLSCREEN_VERTEX_SHADER,
  VIEW_RAY_GLSL,
  createFullscreenQuad,
  createViewRayUniforms,
  updateViewRayUniforms,
} from './view-ray';

export type SkyMapFrame = 'icrs' | 'galactic';

export interface SkyMapOptions {
  readonly name: string;
  readonly frame: SkyMapFrame;
  /** Multiplies the image's light. Default 1. */
  readonly gain?: number;
  /**
   * Share of its below-the-horizon light the map keeps, on top of the dimming
   * every sky layer gets there. A diffuse map lights every pixel, and seen
   * through the planet it lies as a wash over the oceans of the far side;
   * points and lines do not. Default 1.
   */
  readonly throughEarth?: number;
  readonly renderOrder?: number;
}

const FRAGMENT_SHADER = `
  precision highp float;
  #define PI 3.141592653589793
  ${VIEW_RAY_GLSL}
  uniform mat3 uWorldToMap;
  uniform sampler2D uMap;
  uniform float uGain;
  uniform vec3 uObserverUp;
  uniform float uBelowHorizon;
  uniform float uThroughEarth;
  void main() {
    vec3 rd = viewRay();
    vec3 m = uWorldToMap * rd;
    vec2 uv = vec2(0.5 - atan(m.y, m.x) / (2.0 * PI), asin(clamp(m.z, -1.0, 1.0)) / PI + 0.5);
    float horizon = mix(uBelowHorizon * uThroughEarth, 1.0, smoothstep(-0.005, 0.005, dot(rd, uObserverUp)));
    gl_FragColor = vec4(texture2D(uMap, uv).rgb * uGain * horizon, 1.0);
  }
`;

export class SkyMap {
  readonly object: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  /** `skyRoot`: the group whose world rotation is ICRS → world; the map follows it. */
  constructor(skyRoot: THREE.Object3D, uniforms: SkyUniforms, options: SkyMapOptions) {
    const viewRay = createViewRayUniforms();
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        ...viewRay,
        uWorldToMap: { value: new THREE.Matrix3() },
        uMap: { value: null as THREE.Texture | null },
        uGain: { value: options.gain ?? 1 },
        uObserverUp: uniforms.uObserverUp,
        uBelowHorizon: uniforms.uBelowHorizon,
        uThroughEarth: { value: options.throughEarth ?? 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = createFullscreenQuad(this.material, options.name, options.renderOrder ?? RENDER_ORDER.skyMap);
    // Nothing to draw until a texture arrives.
    this.material.visible = false;

    const g = ICRS_TO_GALACTIC;
    const icrsToMap =
      options.frame === 'galactic'
        ? new THREE.Matrix3().set(g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7], g[8])
        : new THREE.Matrix3();
    const rotation = new THREE.Matrix4();
    const worldToIcrs = new THREE.Matrix3();
    this.object.onBeforeRender = (_renderer, _scene, camera) => {
      updateViewRayUniforms(viewRay, camera);
      // A rotation's inverse is its transpose.
      worldToIcrs.setFromMatrix4(rotation.extractRotation(skyRoot.matrixWorld)).transpose();
      (this.material.uniforms.uWorldToMap.value as THREE.Matrix3).multiplyMatrices(icrsToMap, worldToIcrs);
    };
  }

  /** The all-sky image. Mipmaps stay off: the atan seam would pick the coarsest level along a visible line. */
  setTexture(texture: THREE.Texture): void {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    this.material.uniforms.uMap.value = texture;
    this.material.visible = true;
  }

  setGain(gain: number): void {
    this.material.uniforms.uGain.value = gain;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    this.material.dispose();
  }
}
