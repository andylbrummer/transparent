/**
 * An image draped on a sphere at or above the surface, seen from inside:
 * clouds, rain, night lights, an alternative map of the far side.
 *
 * Drawn like the globe itself - a fullscreen pass that intersects each
 * view ray with the sphere analytically - so it lines up with the globe's
 * own surface exactly and needs no mesh fine enough to hold a 10 km
 * altitude. The texture is equirectangular: longitude −180..180 left to
 * right, north up, the same as the globe's surface imagery.
 *
 * The ground near the user is left clear, as on the globe: within a few
 * hundred km one texel would smear over the whole downward view.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import type { SkyUniforms } from '../layers/types';
import { RENDER_ORDER } from './order';
import {
  FULLSCREEN_VERTEX_SHADER,
  VIEW_RAY_GLSL,
  createFullscreenQuad,
  createViewRayUniforms,
  updateViewRayUniforms,
} from './view-ray';

export interface SurfaceShellOptions {
  readonly name: string;
  /** Height of the shell above the surface, metres. Default 0. */
  readonly altitudeM?: number;
  /** Default 1. */
  readonly opacity?: number;
  /** Default NormalBlending (the texture's alpha covers what is behind). */
  readonly blending?: THREE.Blending;
  readonly renderOrder?: number;
  /**
   * GLSL body of `vec4 shade(vec4 texel, vec3 n, vec2 uv)`, returning
   * straight (unpremultiplied) colour and alpha; `n` is the unit ECEF
   * direction of the point, `uv` its texture coordinate, and uTime (s) is
   * in scope. Default: the texel as it is.
   */
  readonly shadeGlsl?: string;
  /** Extra uniforms for `shadeGlsl`; declare them in `declarationsGlsl`. */
  readonly uniforms?: Record<string, THREE.IUniform>;
  readonly declarationsGlsl?: string;
  /** Clear zone around the user, degrees of arc: fully clear inside the first, fully drawn past the second. Default [2, 5]. */
  readonly nearFadeDeg?: readonly [number, number];
}

function fragmentShader(options: SurfaceShellOptions): string {
  return `
    precision highp float;
    #define PI 3.141592653589793
    ${VIEW_RAY_GLSL}
    uniform vec3 uCameraPos;
    // |camera|^2 - r^2, from the CPU in double precision (see globe.ts).
    uniform float uShellC;
    uniform sampler2D uMap;
    uniform float uOpacity;
    uniform float uTime;
    uniform vec3 uObserverUp;
    uniform vec2 uNearFadeCos;
    ${options.declarationsGlsl ?? ''}

    vec4 shade(vec4 texel, vec3 n, vec2 uv) {
      ${options.shadeGlsl ?? 'return texel;'}
    }

    void main() {
      vec3 rd = viewRay();
      float b = dot(uCameraPos, rd);
      float disc = b * b - uShellC;
      if (disc <= 0.0) discard;
      // The far root: where the ray leaves the sphere.
      float s = sqrt(disc);
      float t = b < 0.0 ? -b + s : uShellC / (-b - s);
      if (t <= 0.0) discard;
      vec3 n = normalize(uCameraPos + rd * t);
      vec2 uv = vec2(atan(n.y, n.x) / (2.0 * PI) + 0.5, asin(clamp(n.z, -1.0, 1.0)) / PI + 0.5);
      vec4 color = shade(texture2D(uMap, uv), n, uv);
      float near = 1.0 - smoothstep(uNearFadeCos.y, uNearFadeCos.x, dot(n, uObserverUp));
      float alpha = color.a * uOpacity * near;
      if (alpha <= 0.003) discard;
      gl_FragColor = vec4(color.rgb, alpha);
    }
  `;
}

export class SurfaceShell {
  readonly object: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly radiusM: number;

  constructor(uniforms: SkyUniforms, options: SurfaceShellOptions) {
    this.radiusM = EARTH_RADIUS_M + (options.altitudeM ?? 0);
    const [clearDeg, fullDeg] = options.nearFadeDeg ?? [2, 5];
    const viewRay = createViewRayUniforms();
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: fragmentShader(options),
      uniforms: {
        ...viewRay,
        uCameraPos: { value: new THREE.Vector3() },
        uShellC: { value: 0 },
        uMap: { value: null as THREE.Texture | null },
        uOpacity: { value: options.opacity ?? 1 },
        uTime: { value: 0 },
        uObserverUp: uniforms.uObserverUp,
        uNearFadeCos: {
          value: new THREE.Vector2(Math.cos((clearDeg * Math.PI) / 180), Math.cos((fullDeg * Math.PI) / 180)),
        },
        ...options.uniforms,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: options.blending ?? THREE.NormalBlending,
    });
    this.object = createFullscreenQuad(this.material, options.name, options.renderOrder ?? RENDER_ORDER.surfaceShell);
    // Nothing to draw until a texture arrives.
    this.material.visible = false;
    const started = performance.now();
    this.object.onBeforeRender = (_renderer, _scene, camera) => {
      updateViewRayUniforms(viewRay, camera);
      // World position, in doubles on the CPU: the shader must not subtract two ~4e13 floats.
      const e = camera.matrixWorld.elements;
      this.material.uniforms.uCameraPos.value.set(e[12], e[13], e[14]);
      this.material.uniforms.uShellC.value = e[12] * e[12] + e[13] * e[13] + e[14] * e[14] - this.radiusM * this.radiusM;
      this.material.uniforms.uTime.value = (performance.now() - started) / 1000;
    };
  }

  /**
   * The equirectangular image to drape. No mipmaps and no colour-space tag,
   * for the reasons given at GlobeRenderer.setSurfaceImagery.
   */
  setTexture(texture: THREE.Texture): void {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    this.material.uniforms.uMap.value = texture;
    this.material.visible = true;
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    this.material.dispose();
  }
}
