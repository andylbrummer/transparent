/**
 * The structure of the solar system as a cloud of points: some 36,000
 * minor planets, each moved along its own orbit in the vertex shader, so
 * the main belt lies along the ecliptic, Jupiter's Trojans gather 60°
 * ahead of and behind the planet, and the Kuiper belt thins out beyond.
 *
 * Elements: app/public/sky/small-bodies-cloud.bin with its header .json
 * (tools/pipeline/generate_small_bodies.py, from the JPL Small-Body
 * Database). Two-body motion from one epoch, as in kepler.ts, but in
 * single precision and without light-time: good to arcminutes, which is
 * all a cloud needs - no point here carries a name.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';
import { GAUSS_K, earthAt, jdDateText, orbitBasis, outsideWindowStatus, withinWindow, type ValidityWindow } from './kepler';
import { CLOUD_CLASS_COLORS } from './layer';

export interface CloudClass {
  readonly key: string;
  readonly label: string;
  readonly start: number;
  readonly count: number;
  readonly faintestH: number;
}

/** The shape of app/public/sky/small-bodies-cloud.json. */
export interface CloudHeader extends ValidityWindow {
  readonly count: number;
  readonly aMinAu: number;
  readonly aMaxAu: number;
  readonly classes: readonly CloudClass[];
}

export interface CloudElements {
  /** Semi-major axis, au. */
  readonly a: Float32Array;
  readonly e: Float32Array;
  /** Inclination, node, argument of perihelion, mean anomaly at the epoch: degrees. */
  readonly i: Float32Array;
  readonly om: Float32Array;
  readonly w: Float32Array;
  readonly ma: Float32Array;
  /** Absolute magnitude. */
  readonly h: Float32Array;
}

/** Unpack the six uint16 columns and the uint8 column of the .bin. */
export function decodeCloud(buffer: ArrayBuffer, header: CloudHeader): CloudElements {
  const n = header.count;
  if (buffer.byteLength !== n * 13) throw new Error(`small-body cloud: ${buffer.byteLength} bytes for ${n} bodies`);
  const view = new DataView(buffer);
  const column = (index: number, scale: (code: number) => number): Float32Array => {
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = scale(view.getUint16((index * n + k) * 2, true));
    return out;
  };
  const logSpan = Math.log(header.aMaxAu / header.aMinAu);
  const h = new Float32Array(n);
  for (let k = 0; k < n; k++) h[k] = view.getUint8(12 * n + k) / 5 - 2;
  return {
    a: column(0, (code) => header.aMinAu * Math.exp((code / 65535) * logSpan)),
    e: column(1, (code) => code / 65535),
    i: column(2, (code) => (code / 65535) * 180),
    om: column(3, (code) => (code / 65535) * 360),
    w: column(4, (code) => (code / 65535) * 360),
    ma: column(5, (code) => (code / 65535) * 360),
    h,
  };
}

export interface CloudBuffers {
  /** Toward perihelion, scaled by a: au, ICRS. */
  readonly major: Float32Array;
  /** A quarter turn on, scaled by a√(1−e²). */
  readonly minor: Float32Array;
  /** e, mean anomaly at the epoch (radians), mean motion (radians per day). */
  readonly kepler: Float32Array;
  /** r, g, b, and the absolute magnitude H less the class's lift. */
  readonly style: Float32Array;
}

export function buildCloudBuffers(elements: CloudElements, header: CloudHeader): CloudBuffers {
  const n = header.count;
  const major = new Float32Array(n * 3);
  const minor = new Float32Array(n * 3);
  const kepler = new Float32Array(n * 3);
  const style = new Float32Array(n * 4);
  const basis: number[] = [];
  for (const cls of header.classes) {
    const color = CLOUD_CLASS_COLORS[cls.key] ?? CLOUD_CLASS_COLORS['main-belt'];
    const lift = CLASS_LIFT_MAG[cls.key] ?? 0;
    for (let k = cls.start; k < cls.start + cls.count; k++) {
      const a = elements.a[k];
      const e = elements.e[k];
      orbitBasis(elements.i[k], elements.om[k], elements.w[k], basis);
      const b = a * Math.sqrt(1 - e * e);
      for (let axis = 0; axis < 3; axis++) {
        major[k * 3 + axis] = basis[axis] * a;
        minor[k * 3 + axis] = basis[3 + axis] * b;
      }
      kepler[k * 3] = e;
      kepler[k * 3 + 1] = (elements.ma[k] * Math.PI) / 180;
      kepler[k * 3 + 2] = GAUSS_K * a ** -1.5;
      style.set([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, elements.h[k] - lift], k * 4);
    }
  }
  return { major, minor, kepler, style };
}

/**
 * Magnitudes by which a class is drawn brighter than its true brightness
 * beside the main belt's: on one scale the Trojans, five times as far, and
 * the Kuiper belt, forty times, would not show at all. Within a class the
 * bigger and the nearer still show brighter - a drawing choice, said in
 * the caption.
 */
export const CLASS_LIFT_MAG: Readonly<Record<string, number>> = { hilda: 2.5, trojan: 4.5, centaur: 6, tno: 9 };

/**
 * The shader's arithmetic, on the CPU, for the tests: heliocentric
 * position (au, ICRS) of body `k`, `days` after the epoch.
 */
export function cloudPosition(buffers: CloudBuffers, k: number, days: number, out: number[] = []): number[] {
  const e = buffers.kepler[k * 3];
  let mean = buffers.kepler[k * 3 + 1] + buffers.kepler[k * 3 + 2] * days;
  mean -= 2 * Math.PI * Math.round(mean / (2 * Math.PI));
  let ecc = mean + e * Math.sin(mean) * (1 + e * Math.cos(mean));
  for (let pass = 0; pass < KEPLER_PASSES; pass++) ecc -= (ecc - e * Math.sin(ecc) - mean) / (1 - e * Math.cos(ecc));
  const x = Math.cos(ecc) - e;
  const y = Math.sin(ecc);
  for (let axis = 0; axis < 3; axis++) out[axis] = buffers.major[k * 3 + axis] * x + buffers.minor[k * 3 + axis] * y;
  return out;
}

const KEPLER_PASSES = 6;

const VERTEX_SHADER = `
  attribute vec3 aMinor;
  attribute vec3 aKepler;
  attribute vec4 aStyle;
  uniform float uDays;
  uniform vec3 uEarth;
  uniform float uPixelRatio;
  uniform vec3 uObserverUp;
  uniform float uBelowHorizon;
  varying vec3 vColor;
  varying float vAlpha;
  const float TWO_PI = 6.283185307179586;
  void main() {
    float e = aKepler.x;
    float mean = aKepler.y + aKepler.z * uDays;
    mean -= TWO_PI * floor(mean / TWO_PI + 0.5);
    // Kepler's equation by Newton's method from a second-order start.
    float ecc = mean + e * sin(mean) * (1.0 + e * cos(mean));
    for (int pass = 0; pass < ${KEPLER_PASSES}; pass++) {
      ecc -= (ecc - e * sin(ecc) - mean) / (1.0 - e * cos(ecc));
    }
    vec3 fromSun = position * (cos(ecc) - e) + aMinor * sin(ecc);
    vec3 fromEarth = fromSun - uEarth;
    float distance = length(fromEarth);
    vec3 direction = fromEarth / distance;
    // Magnitude at full phase from H: the near and the large show brighter, as they do in a telescope.
    float magnitude = aStyle.w + 5.0 * log(length(fromSun) * distance) / log(10.0);
    float brightness = clamp((21.0 - magnitude) / 7.0, 0.0, 1.0);
    vColor = aStyle.rgb;
    vec3 worldDirection = normalize(mat3(modelMatrix) * direction);
    float above = step(0.0, dot(worldDirection, uObserverUp));
    vAlpha = mix(0.22, 0.8, brightness) * mix(uBelowHorizon, 1.0, above);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(direction, 1.0);
    gl_PointSize = mix(1.4, 2.6, brightness) * uPixelRatio;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.5, 1.0, r)) * vAlpha;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export async function createCloudLayer(context: LayerContext): Promise<LayerInstance> {
  const header = await context.fetchJson<CloudHeader>(context.assetUrl('sky/small-bodies-cloud.json'));
  const response = await fetch(context.assetUrl('sky/small-bodies-cloud.bin'));
  if (!response.ok) throw new Error(`small-body cloud: HTTP ${response.status}`);
  const buffers = buildCloudBuffers(decodeCloud(await response.arrayBuffer(), header), header);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.major, 3));
  geometry.setAttribute('aMinor', new THREE.BufferAttribute(buffers.minor, 3));
  geometry.setAttribute('aKepler', new THREE.BufferAttribute(buffers.kepler, 3));
  geometry.setAttribute('aStyle', new THREE.BufferAttribute(buffers.style, 4));
  const uniforms = {
    uDays: { value: 0 },
    uEarth: { value: new THREE.Vector3(1, 0, 0) },
    uPixelRatio: context.skyUniforms.uPixelRatio,
    uObserverUp: context.skyUniforms.uObserverUp,
    uBelowHorizon: context.skyUniforms.uBelowHorizon,
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'small-body-cloud';
  points.frustumCulled = false;
  // Under the stars' names and symbols, over the sky maps.
  points.renderOrder = RENDER_ORDER.sky - 0.01;
  context.skyRoot.add(points);

  let visible = false;
  let inside = true;
  let statusDay = NaN;

  return {
    setVisible(next) {
      visible = next;
      points.visible = visible && inside;
    },
    update(frame) {
      const { jd, earth } = earthAt(frame.date);
      inside = withinWindow(header, jd);
      points.visible = visible && inside;
      uniforms.uDays.value = jd - header.epochJd;
      uniforms.uEarth.value.set(earth[0], earth[1], earth[2]);
      const day = inside ? Math.floor(jd) : -1;
      if (day === statusDay) return;
      statusDay = day;
      if (inside) context.setStatus(`${header.count.toLocaleString('en-US')} bodies · orbits of ${jdDateText(header.epochJd)}`, 'info');
      else context.setStatus(outsideWindowStatus(header), 'error');
    },
    dispose() {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
