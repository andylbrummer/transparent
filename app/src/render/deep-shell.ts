/**
 * A map draped on a sphere inside the Earth: a depth slice of the mantle.
 *
 * The camera stands on the surface, outside such a sphere, so a view ray
 * that meets it at all meets it twice: once on the side under the user's
 * feet and once on the far side, seen from within. Both are drawn - the
 * shell is a glass ball, like everything else down there - the far side
 * first and the near side over it. Like SurfaceShell it is a fullscreen
 * pass that intersects each ray with the sphere analytically, so it costs
 * no geometry and sits exactly at its depth.
 *
 * The texture is equirectangular, longitude −180..180 left to right,
 * north up. `shadeGlsl` turns a texel into a colour and an alpha; where
 * it returns no alpha the shell is clear, which is what keeps two
 * overlapping sides readable.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from './order';
import {
  FULLSCREEN_VERTEX_SHADER,
  VIEW_RAY_GLSL,
  createFullscreenQuad,
  createViewRayUniforms,
  updateViewRayUniforms,
} from './view-ray';

export interface DeepShellOptions {
  readonly name: string;
  /** Radius of the sphere, metres from the Earth's centre. */
  readonly radiusM: number;
  /** GLSL body of `vec4 shade(vec4 texel, vec3 n, vec2 uv)`: straight colour and alpha. */
  readonly shadeGlsl: string;
  readonly declarationsGlsl?: string;
  readonly uniforms?: Record<string, THREE.IUniform>;
  /**
   * Strength of the side under the user and of the far side. Defaults 0.55
   * and 0.9: the far side is the one the surface names and lines beyond it
   * belong to, so it leads, and the near side reads as a veil over it.
   */
  readonly nearOpacity?: number;
  readonly farOpacity?: number;
  /** Colour and strength of the line round the sphere's limb: it is what makes the slice read as a ball. */
  readonly rimColor?: number;
  readonly rimOpacity?: number;
  readonly renderOrder?: number;
}

/**
 * Where a ray from `origin` along unit `direction` meets a sphere of
 * `radius` about the centre: [near, far] distances, or null if it misses.
 * A negative distance is behind the origin. The shader does the same sum.
 */
export function raySphere(origin: THREE.Vector3, direction: THREE.Vector3, radius: number): [number, number] | null {
  const b = origin.dot(direction);
  const disc = b * b - (origin.lengthSq() - radius * radius);
  if (disc <= 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

function fragmentShader(options: DeepShellOptions): string {
  return `
    precision highp float;
    #define PI 3.141592653589793
    ${VIEW_RAY_GLSL}
    uniform vec3 uCameraPos;
    // |camera|^2 - r^2, from the CPU in double precision (see globe.ts).
    uniform float uShellC;
    uniform float uRadius;
    uniform sampler2D uMap;
    uniform float uNearOpacity;
    uniform float uFarOpacity;
    uniform vec4 uRim;
    ${options.declarationsGlsl ?? ''}

    vec4 shade(vec4 texel, vec3 n, vec2 uv) {
      ${options.shadeGlsl}
    }

    vec4 sideAt(vec3 point) {
      vec3 n = normalize(point);
      vec2 uv = vec2(atan(n.y, n.x) / (2.0 * PI) + 0.5, asin(clamp(n.z, -1.0, 1.0)) / PI + 0.5);
      return shade(texture2D(uMap, uv), n, uv);
    }

    void main() {
      vec3 rd = viewRay();
      float b = dot(uCameraPos, rd);
      float disc = b * b - uShellC;
      if (disc <= 0.0 || b >= 0.0) discard;
      float s = sqrt(disc);
      vec4 far = sideAt(uCameraPos + rd * (-b + s));
      far.a *= uFarOpacity;
      vec4 near = sideAt(uCameraPos + rd * (-b - s));
      near.a *= uNearOpacity;
      float alpha = near.a + far.a * (1.0 - near.a);
      vec3 color = alpha > 0.0 ? (near.rgb * near.a + far.rgb * far.a * (1.0 - near.a)) / alpha : vec3(0.0);
      // The limb: s / r is the sine of the angle between the ray and the surface it grazes.
      float grazing = s / uRadius;
      float rim = uRim.a * (1.0 - smoothstep(0.0, 0.16, grazing));
      float edge = smoothstep(0.0, 0.012, grazing);
      color = mix(color, uRim.rgb, rim / max(rim + alpha, 1.0e-4));
      alpha = (alpha + rim * (1.0 - alpha)) * edge;
      if (alpha <= 0.003) discard;
      gl_FragColor = vec4(color, alpha);
    }
  `;
}

export class DeepShell {
  readonly object: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(options: DeepShellOptions) {
    const viewRay = createViewRayUniforms();
    const rimHex = options.rimColor ?? 0xffffff;
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: fragmentShader(options),
      uniforms: {
        ...viewRay,
        uCameraPos: { value: new THREE.Vector3() },
        uShellC: { value: 0 },
        uRadius: { value: options.radiusM },
        uMap: { value: null as THREE.Texture | null },
        uNearOpacity: { value: options.nearOpacity ?? 0.55 },
        uFarOpacity: { value: options.farOpacity ?? 0.9 },
        // Display values, written as they are: no colour-space conversion in this pass.
        uRim: {
          value: new THREE.Vector4(
            ((rimHex >> 16) & 255) / 255,
            ((rimHex >> 8) & 255) / 255,
            (rimHex & 255) / 255,
            options.rimOpacity ?? 0.35
          ),
        },
        ...options.uniforms,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    // Over the far-side surface and its lines, under what is drawn in the mantle.
    this.object = createFullscreenQuad(this.material, options.name, options.renderOrder ?? RENDER_ORDER.outlines + 0.5);
    this.material.visible = false;
    this.object.onBeforeRender = (_renderer, _scene, camera) => {
      updateViewRayUniforms(viewRay, camera);
      const e = camera.matrixWorld.elements;
      this.material.uniforms.uCameraPos.value.set(e[12], e[13], e[14]);
      this.material.uniforms.uShellC.value =
        e[12] * e[12] + e[13] * e[13] + e[14] * e[14] - options.radiusM * options.radiusM;
    };
  }

  /** The equirectangular image to drape; no mipmaps and no colour-space tag: it holds values, not colours. */
  setTexture(texture: THREE.Texture): void {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    this.material.uniforms.uMap.value = texture;
    this.material.visible = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    this.material.dispose();
  }
}
