/**
 * One picture of the Sun or its corona, laid on the sky at its true size
 * and turned the way the Sun is: a flat panel standing on the celestial
 * sphere at the Sun's place.
 *
 * The panel's light is premultiplied: the photosphere covers what is
 * behind it (stars, corona, an EUV image covers the photosphere), while
 * coronal light is simply added. Below the horizon everything is dimmed by
 * the shared uBelowHorizon, like the rest of the sky.
 */

import * as THREE from 'three';
import type { SkyUniforms } from '../types';
import { solarRadiusPx, type ProductGeometry, type ProductTone } from './products';
import { imageAxes, productPole, type SunState } from './solar-frame';

const TONE_INDEX: Readonly<Record<ProductTone, number>> = { disc: 0, emission: 1, table: 2 };

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldDir;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uCentre;
  uniform vec2 uRadiusUv;
  uniform float uExtent;
  uniform float uInner;
  uniform float uOuter;
  uniform int uTone;
  uniform vec3 uTint;
  uniform float uGain;
  uniform float uFloor;
  uniform float uOpacity;
  uniform vec3 uObserverUp;
  uniform float uBelowHorizon;
  varying vec2 vUv;
  varying vec3 vWorldDir;
  void main() {
    // Position on the panel in solar radii: x to celestial west, y to the image's north.
    vec2 q = (vUv * 2.0 - 1.0) * uExtent;
    float r = length(q);
    // Image rows run downward from the top; texture v runs upward.
    vec2 uv = vec2(uCentre.x + q.x * uRadiusUv.x, 1.0 - uCentre.y + q.y * uRadiusUv.y);
    vec3 c = texture2D(uMap, uv).rgb;
    float soft = max(fwidth(r), 1e-4);
    vec3 light;
    float cover = 0.0;
    if (uTone == 0) {
      // Photosphere: opaque inside the limb.
      cover = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, r);
      light = min(c * uTint * uGain, 1.0) * cover;
    } else {
      float band = smoothstep(uInner, uInner * 1.04 + soft, r) * (1.0 - smoothstep(uOuter * 0.94, uOuter, r));
      if (uInner <= 0.0) band = 1.0 - smoothstep(uOuter * 0.94, uOuter, r);
      if (uTone == 1) {
        light = c * uTint;
        // An image that includes the disc hides the white-light Sun beneath it.
        if (uInner <= 0.0) cover = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, r);
      } else {
        // A false-colour table: the mean of the channels is the brightness it encodes.
        float v = (c.r + c.g + c.b) / 3.0;
        light = uTint * smoothstep(uFloor, 1.0, v);
      }
      light *= uGain * band;
    }
    float horizon = mix(uBelowHorizon, 1.0, smoothstep(-0.005, 0.005, dot(normalize(vWorldDir), uObserverUp)));
    float k = horizon * uOpacity;
    gl_FragColor = vec4(light * k, cover * k);
  }
`;

export interface SunImageOptions {
  readonly name: string;
  readonly renderOrder: number;
  /** Multiplies the light of a coronal image. Default 1. */
  readonly gain?: number;
  /** Colour the image's light is multiplied by. Default white. */
  readonly tint?: THREE.ColorRepresentation;
}

export class SunImageQuad {
  readonly object: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private aspect = 1;

  constructor(
    private readonly product: ProductGeometry,
    uniforms: SkyUniforms,
    options: SunImageOptions
  ) {
    // A little beyond the outer mask, so its soft edge is not cut by the panel's.
    const extent = product.outerRadii * 1.02;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uMap: { value: null as THREE.Texture | null },
        uCentre: { value: new THREE.Vector2(product.centre[0], product.centre[1]) },
        uRadiusUv: { value: new THREE.Vector2(0.1, 0.1) },
        uExtent: { value: extent },
        uInner: { value: product.innerRadii },
        uOuter: { value: product.outerRadii },
        uTone: { value: TONE_INDEX[product.tone] },
        uTint: { value: new THREE.Color(options.tint ?? 0xffffff) },
        uGain: { value: options.gain ?? 1 },
        uFloor: { value: product.tableFloor ?? 0 },
        uOpacity: { value: 1 },
        uObserverUp: uniforms.uObserverUp,
        uBelowHorizon: uniforms.uBelowHorizon,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Premultiplied "over": cover hides what is behind, light with no cover is added.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.object.name = options.name;
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder;
    this.object.matrixAutoUpdate = false;
    // Nothing to draw until a frame arrives.
    this.material.visible = false;
  }

  /** Show `texture`; the previous one is released. */
  setTexture(texture: THREE.Texture): void {
    const old = this.material.uniforms.uMap.value as THREE.Texture | null;
    if (old && old !== texture) old.dispose();
    // The frames hold display values; the shader uses them as they are.
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    const image = texture.image as { width: number; height: number };
    this.aspect = image.width / image.height;
    this.material.uniforms.uMap.value = texture;
    this.material.visible = true;
  }

  /** Stand the panel at the Sun: centred on it, sized by its radius, turned to the product's north. */
  place(sun: SunState): void {
    const product = this.product;
    const radiusPx = solarRadiusPx(product, sun.radiusArcsec);
    // One solar radius in texture coordinates; frames may be served or baked at any size.
    (this.material.uniforms.uRadiusUv.value as THREE.Vector2).set(radiusPx / product.widthPx, (radiusPx / product.widthPx) * this.aspect);
    const axes = imageAxes(sun.direction, productPole(sun, product.up));
    // A flat panel shows the tangent of the angle from its centre; sized so its edge is exact.
    const half = Math.tan((this.material.uniforms.uExtent.value as number) * sun.angularRadius);
    this.right.set(axes.right[0], axes.right[1], axes.right[2]).multiplyScalar(half);
    this.up.set(axes.up[0], axes.up[1], axes.up[2]).multiplyScalar(half);
    this.centre.set(sun.direction[0], sun.direction[1], sun.direction[2]);
    this.object.matrix.makeBasis(this.right, this.up, this.centre).setPosition(this.centre);
    this.object.matrixWorldNeedsUpdate = true;
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
