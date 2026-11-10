/**
 * The tropical-cyclone symbol of weather charts - an eye with two curved
 * arms - as a screen-aligned sprite that turns the way the storm does:
 * counter-clockwise north of the equator, clockwise south of it, as seen
 * from above. This app mostly looks at the far side of the planet from
 * underneath, where the same storm is seen mirrored, so the sense is
 * worked out per sprite from which side of the surface the camera is on.
 *
 * No other layer uses the shape: rings are earthquakes and craters,
 * triangles volcanoes.
 */

import * as THREE from 'three';
import { ecefAtAltitude } from '../../render/geo-markers';
import { RENDER_ORDER } from '../../render/order';

export interface CycloneSymbol {
  readonly lon: number;
  readonly lat: number;
  /** 0xRRGGBB. */
  readonly color: number;
  /** Width of the symbol, CSS px. */
  readonly sizePx: number;
  /** Default 1. */
  readonly alpha?: number;
}

/** Seconds per turn: slow enough to read the shape, quick enough to catch the eye. */
const TURN_PERIOD_S = 7;

const VERTEX_SHADER = `
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uTime;
  varying vec4 vColor;
  varying float vSpin;
  varying float vSizePx;
  void main() {
    vColor = aColor;
    vec4 world = modelMatrix * vec4(position, 1.0);
    // +1 where the camera is outside the sphere looking down on the storm, -1 underneath it.
    float above = sign(dot(normalize(world.xyz), cameraPosition - world.xyz));
    // Counter-clockwise from above in the northern hemisphere.
    vSpin = (world.z >= 0.0 ? 1.0 : -1.0) * (above >= 0.0 ? 1.0 : -1.0);
    vSizePx = aSize * uPixelRatio + 4.0;
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = vSizePx;
  }
`;

/**
 * Coverage of the symbol at p in a box of -1..1, for a storm turning
 * counter-clockwise; \`grow\` fattens every part by that much, for the
 * dark rim. Exported for the test of its shape.
 */
export const CYCLONE_SHAPE_GLSL = `
  float cycloneShape(vec2 p, float grow, float soft) {
    float r = length(p);
    // The eyewall: a ring.
    float wall = 1.0 - smoothstep(0.13 + grow - soft, 0.13 + grow + soft, abs(r - 0.34));
    // Two arms leaving the wall opposite each other and trailing behind the turn.
    float angle = atan(p.y, p.x) + 2.4 * (r - 0.34);
    float across = abs(sin(angle)) * r;
    float along = smoothstep(0.3, 0.42, r) * (1.0 - smoothstep(0.86 + grow - soft, 0.86 + grow + soft, r));
    float width = mix(0.15, 0.03, smoothstep(0.34, 0.9, r)) + grow;
    float arms = along * (1.0 - smoothstep(width - soft, width + soft, across));
    return max(wall, arms);
  }
`;

const FRAGMENT_SHADER = `
  uniform float uTime;
  varying vec4 vColor;
  varying float vSpin;
  varying float vSizePx;
  ${CYCLONE_SHAPE_GLSL}
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    p.y = -p.y;
    // Leave the margin the rim needs.
    p *= vSizePx / (vSizePx - 4.0);
    float turn = vSpin * uTime * ${((2 * Math.PI) / TURN_PERIOD_S).toFixed(5)};
    float c = cos(turn);
    float s = sin(turn);
    p = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
    // The arms trail the other way for a storm turning clockwise.
    p.x *= vSpin;
    float soft = 1.6 / vSizePx;
    float fill = cycloneShape(p, 0.0, soft);
    float rim = 0.7 * cycloneShape(p, 3.0 / vSizePx, soft);
    float alpha = max(fill, rim);
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(vColor.rgb * mix(0.1, 1.0, fill), alpha * vColor.a);
  }
`;

export class CycloneSymbols {
  readonly object: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(name: string, pixelRatio: { value: number }) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { uPixelRatio: pixelRatio, uTime: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.object.name = name;
    this.object.frustumCulled = false;
    // Over the tracks and every other surface marker: a storm under way is the news.
    this.object.renderOrder = RENDER_ORDER.quakes - 0.1;
  }

  setSymbols(symbols: readonly CycloneSymbol[]): void {
    const positions = new Float32Array(symbols.length * 3);
    const colors = new Float32Array(symbols.length * 4);
    const sizes = new Float32Array(symbols.length);
    const point = new THREE.Vector3();
    symbols.forEach((symbol, i) => {
      ecefAtAltitude(symbol.lon, symbol.lat, 0, point).toArray(positions, i * 3);
      colors[i * 4] = ((symbol.color >> 16) & 255) / 255;
      colors[i * 4 + 1] = ((symbol.color >> 8) & 255) / 255;
      colors[i * 4 + 2] = (symbol.color & 255) / 255;
      colors[i * 4 + 3] = symbol.alpha ?? 1;
      sizes[i] = symbol.sizePx;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 4));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.object.geometry.dispose();
    this.object.geometry = geometry;
  }

  /** Turn the symbols: `deltaMs` of wall time since the last frame. */
  advance(deltaMs: number): void {
    this.material.uniforms.uTime.value = (this.material.uniforms.uTime.value + deltaMs / 1000) % (TURN_PERIOD_S * 1000);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/** Symbol width for a wind, CSS px: 18 for a depression, 30 for category 5. */
export function symbolSizePx(windKt: number): number {
  return 18 + 12 * Math.min(Math.max(windKt, 0) / 140, 1);
}
