/**
 * Draws an earthquake's waves: the P and S wavefronts inside the planet,
 * and the rings where fronts meet the surface.
 *
 * A wavefront is a surface of revolution: the baked rays (data.ts) give its
 * curve in the plane through the source and the Earth's centre, and the
 * mesh turns that curve about the source's axis. The mesh never changes on
 * the CPU: each vertex knows its ray and its angle about the axis, and the
 * vertex shader reads where that ray is now from a texture of ray
 * positions, one row per 20 s. Playing, scrubbing and pausing only move
 * one uniform.
 *
 * Nothing in the scene depth-tests, and the fronts are seen from inside,
 * from the surface, through each other. So they are drawn as glass: nearly
 * clear face-on, bright where the line of sight grazes them - the same
 * trick as the globe's own shells - so that a front reads as an expanding
 * bubble by its rim rather than as fog. Each front is one colour, so the
 * order its own folds blend in does not matter.
 *
 * Brightness follows geometric spreading: each ray carries the energy of
 * its share of the take-off sphere, and where the rays have drawn apart
 * the front is fainter (and at a caustic, where they cross, brighter).
 * That is the only amplitude physics here: no attenuation, no radiation
 * pattern, no reflection or transmission losses at the boundaries.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad } from '../../render/view-ray';
import { surfaceRings, surfaceWaveRingDeg, type WaveData, type WaveFamily, type WaveManifest, type WaveSlice } from './data';

/** Steps round the source axis. */
export const AZIMUTH_SEGMENTS = 96;

/** Blue-white P, warmer S (spec/seismic.md); the surface waves in the green between. */
export const WAVE_COLORS = {
  P: 0xa8d4ff,
  S: 0xff9a4d,
  love: 0x8ef0b0,
  rayleigh: 0xf2f07a,
} as const;

/**
 * The fronts are drawn into a buffer this fraction of the screen's size
 * each way and then laid over the view. They are smooth, see-through
 * surfaces, several deep, and from inside the planet they fill the screen:
 * at full size that is the most expensive thing in the scene (4-6 ms a
 * frame on an Intel Iris Xe at a phone's resolution, when the P front
 * crosses the core under the user); at half size, a quarter of it. What it
 * costs is a little softness in the graticule lines.
 */
export const FRONT_BUFFER_SCALE = 0.5;

const COMPOSITE_FRAGMENT_SHADER = `
  uniform sampler2D uFronts;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uFronts, vUv);
  }
`;

/** Amplitude is 1 within this distance of the source and falls as 1 / distance beyond. */
const SPREAD_LENGTH_M = 2.4e6;

export interface FrontBuffers {
  /** Per vertex: ray (column of the ray texture), angle about the axis (rad), 0. */
  readonly positions: Float32Array;
  /** Per vertex: first and last ray of its branch, and the radius (m) below which it is not drawn. */
  readonly branches: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * The mesh of one family's fronts: a grid of rays by angles about the
 * axis. Neighbouring rays are joined only within a branch: where one ray
 * turns in the mantle and the next dives into the core, the front itself
 * tears, and a triangle between them would span the planet.
 */
export function buildFrontBuffers(manifest: WaveManifest, family: WaveFamily, azimuthSegments: number = AZIMUTH_SEGMENTS): FrontBuffers {
  const branches = manifest.branches.filter((branch) => branch.family === family);
  const rayCount = branches.reduce((sum, branch) => sum + branch.count, 0);
  const columns = azimuthSegments + 1;
  const positions = new Float32Array(rayCount * columns * 3);
  const branchInfo = new Float32Array(rayCount * columns * 3);
  const quads = branches.reduce((sum, branch) => sum + (branch.count - 1) * azimuthSegments, 0);
  const indices = new Uint32Array(quads * 6);
  let vertex = 0;
  let index = 0;
  for (const branch of branches) {
    for (let r = 0; r < branch.count; r++) {
      for (let a = 0; a < columns; a++) {
        const at = (vertex + r * columns + a) * 3;
        positions[at] = branch.start + r;
        positions[at + 1] = (a / azimuthSegments) * 2 * Math.PI;
        branchInfo[at] = branch.start;
        branchInfo[at + 1] = branch.start + branch.count - 1;
        branchInfo[at + 2] = branch.minRadiusKm * 1000;
      }
      if (r === branch.count - 1) continue;
      for (let a = 0; a < azimuthSegments; a++) {
        const v00 = vertex + r * columns + a;
        const v10 = v00 + columns;
        indices.set([v00, v10, v00 + 1, v00 + 1, v10, v10 + 1], index);
        index += 6;
      }
    }
    vertex += branch.count * columns;
  }
  return { positions, branches: branchInfo, indices };
}

/**
 * Each ray's share of the take-off sphere, per radian about the axis:
 * sin(i) di, with di half the gap to its neighbours in its branch.
 */
export function rayWeights(manifest: WaveManifest, slice: WaveSlice): Float32Array {
  // Two floats per ray, as the GPU takes them: the weight, and the take-off angle (degrees) for the graticule.
  const weights = new Float32Array(manifest.rays * 2);
  const rad = Math.PI / 180;
  for (const branch of manifest.branches) {
    const last = branch.start + branch.count - 1;
    for (let i = branch.start; i <= last; i++) {
      const angle = slice.takeoffDeg[i];
      if (!(angle === angle)) continue;
      weights[i * 2 + 1] = angle;
      const before = slice.takeoffDeg[Math.max(i - 1, branch.start)];
      const after = slice.takeoffDeg[Math.min(i + 1, last)];
      const span = Math.min(i + 1, last) - Math.max(i - 1, branch.start);
      // A floor, so the ray straight down (sin 0) still carries its neighbours' worth.
      const sine = Math.max(Math.sin(angle * rad), Math.sin((Math.abs(after - before) / Math.max(span, 1)) * rad * 0.5));
      weights[i * 2] = (sine * Math.abs(after - before) * rad) / Math.max(span, 1);
    }
  }
  return weights;
}

/** Unit vectors: the axis from the centre through the epicentre, and two square to it. `towards` sets where angle 0 points. */
export function sourceFrame(
  latDeg: number,
  lonDeg: number,
  towards: THREE.Vector3 | null
): { axis: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3 } {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const axis = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  const e1 = new THREE.Vector3();
  if (towards) e1.copy(towards).addScaledVector(axis, -towards.dot(axis));
  // Towards the observer where that means anything; else towards the north pole, or failing that Greenwich.
  if (e1.lengthSq() < 1e-6 * (towards?.lengthSq() ?? 1)) e1.set(0, 0, 1).addScaledVector(axis, -axis.z);
  if (e1.lengthSq() < 1e-9) e1.set(1, 0, 0).addScaledVector(axis, -axis.x);
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  return { axis, e1, e2 };
}

const FRONT_VERTEX_SHADER = `
  uniform sampler2D uRays;
  uniform sampler2D uWeights;
  uniform float uStep;
  uniform float uLastStep;
  uniform vec3 uAxis;
  uniform vec3 uE1;
  uniform vec3 uE2;
  uniform float uRadiusScale;
  uniform float uDeltaScale;
  uniform float uSpreadLength;
  uniform float uEarthRadius;
  attribute vec3 aBranch;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vRadius;
  varying float vMinRadius;
  varying float vAmplitude;
  varying vec2 vGraticule;

  // One stored sample of a ray, in the plane of the ray: x across the axis, y along it (m).
  vec2 stored(int ray, int row) {
    vec4 t = texelFetch(uRays, ivec2(ray, row), 0) * 255.0;
    float radius = (t.r + t.g * 256.0) / 65535.0 * uRadiusScale;
    float delta = (t.b + t.a * 256.0) / 65535.0 * uDeltaScale;
    return radius * vec2(sin(delta), cos(delta));
  }

  // Where a ray is now: the chord between the two stored samples either side.
  vec2 rayNow(float ray) {
    float at = clamp(uStep, 0.0, uLastStep);
    float row = min(floor(at), uLastStep - 1.0);
    return mix(stored(int(ray), int(row)), stored(int(ray), int(row) + 1), at - row);
  }

  bool isOver(float radius, float minRadius) {
    return radius > uEarthRadius || radius < minRadius;
  }

  void main() {
    float ray = position.x;
    float azimuth = position.y;
    vec2 here = rayNow(ray);
    float before = max(ray - 1.0, aBranch.x);
    float after = min(ray + 1.0, aBranch.y);
    vec2 pointBefore = rayNow(before);
    vec2 pointAfter = rayNow(after);
    vec2 along = pointAfter - pointBefore;

    vec3 outward = cos(azimuth) * uE1 + sin(azimuth) * uE2;
    vec3 around = cos(azimuth) * uE2 - sin(azimuth) * uE1;
    // The mesh is in ECEF metres under an unrotated root: object space is world space.
    vWorld = here.y * uAxis + here.x * outward;
    vec3 meridian = along.y * uAxis + along.x * outward;
    vec3 normal = cross(meridian, around);
    // At the origin time every ray is at the source and the front has no direction yet.
    vNormal = dot(normal, normal) > 1.0e-6 ? normalize(normal) : normalize(vWorld);
    vRadius = length(here);
    vMinRadius = aBranch.z;

    // Energy per unit area: the ray's share of the take-off sphere over the patch of front it has become.
    vec2 perRay = texelFetch(uWeights, ivec2(int(ray), 0), 0).rg;
    float weight = perRay.x;
    // Take-off angle and angle about the axis, both in degrees: the lines drawn on the front.
    vGraticule = vec2(perRay.y, degrees(azimuth));
    float frontArea = max(length(along) / max(after - before, 1.0) * abs(here.x), 1.0);
    // Softer than the physics (energy falls as the square of this) and floored: a front that has
    // crossed the core is a hundredth as strong as when it left, and still has to be seen.
    vAmplitude = clamp(pow(sqrt(weight / frontArea) * uSpreadLength, 0.6), 0.4, 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(vWorld, 1.0);
    // Rays that have ended stay parked where they ended, so most of the mesh is soon a dead shell
    // over the ground the front has already swept - under the observer's feet, filling the view with
    // fragments only to discard them. A vertex whose ray and both neighbours are over is thrown
    // outside the view volume instead; the vertices beside a live ray keep their place, so the
    // front's edge still lands on the boundary.
    if (isOver(vRadius, aBranch.z) && isOver(length(pointBefore), aBranch.z) && isOver(length(pointAfter), aBranch.z)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
  }
`;

const FRONT_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uEarthRadius;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vRadius;
  varying float vMinRadius;
  varying float vAmplitude;
  varying vec2 vGraticule;

  // 1 on a line at every multiple of the interval, a pixel or so wide, fading out where the lines would crowd.
  float gridLine(float x, float interval) {
    float perPixel = max(fwidth(x), 1.0e-6);
    float distancePx = abs(fract(x / interval + 0.5) - 0.5) * interval / perPixel;
    return (1.0 - smoothstep(0.6, 1.6, distancePx)) * smoothstep(3.0, 8.0, interval / perPixel);
  }

  void main() {
    // A ray that has landed is parked above the surface; the S that struck the core, inside it.
    if (vRadius > uEarthRadius || vRadius < vMinRadius) discard;
    vec3 toEye = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), toEye));
    // Glass: a little face-on, most where the view grazes the front.
    float rim = (1.0 - facing) * (1.0 - facing);
    float amplitude = vAmplitude;
    // A graticule of the rays themselves - every 10 degrees of take-off angle, every 15 about the
    // axis - is what lets the eye read a clear surface as a curved one.
    // Not on the part of a front sweeping past the observer, where a line would be a bar across the view.
    float lines = max(gridLine(vGraticule.x, 10.0), gridLine(vGraticule.y, 15.0));
    float away = smoothstep(1.5e5, 1.5e6, distance(cameraPosition, vWorld));
    lines *= away;
    float alpha = uOpacity * amplitude * (0.12 + 0.88 * rim + 0.6 * lines);
    // Where the front comes up to the surface it brightens into the ring drawn there.
    float nearSurface = smoothstep(uEarthRadius - 1.2e5, uEarthRadius, vRadius);
    alpha = min(1.0, alpha * (1.0 + nearSurface));
    // Someone standing inside the bubble, minutes after an earthquake nearby, looks out through its
    // wall at a grazing angle in every direction: close to, the front thins so the planet stays in view.
    alpha *= mix(0.3, 1.0, away);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35 * rim), alpha);
  }
`;

/** Most rings and bands drawn at once: every branch of both families, the surface waves and the shadows. */
export const MAX_RINGS = 32;

/** How a band is filled. */
export const RING_STYLE = {
  /** A body wave reaching the surface: a soft bright line. */
  line: 0,
  /** A wave diffracted round the core: the same, broken into dashes. */
  dashed: 1,
  /** A surface wave: a train of ripples behind its front. */
  ripple: 2,
  /** A shadow zone: a faint flat tint between two edges. */
  zone: 3,
} as const;

const RING_ACROSS_SEGMENTS = 8;
const RING_AZIMUTH_SEGMENTS = 180;

const RING_VERTEX_SHADER = `
  uniform vec3 uAxis;
  uniform vec3 uE1;
  uniform vec3 uE2;
  uniform float uEarthRadius;
  // Centre distance (rad), half width (rad, negative for a wave on its way back), opacity, style.
  attribute vec4 aRing;
  attribute vec3 aColor;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying float vAcross;
  varying float vAzimuth;
  varying float vOpacity;
  varying float vStyle;
  varying float vHalfWidth;

  void main() {
    float azimuth = position.x;
    float delta = clamp(aRing.x + position.y * aRing.y, 0.0, 3.14159265);
    vec3 outward = cos(azimuth) * uE1 + sin(azimuth) * uE2;
    // A few km above the sphere, clear of the surface imagery's own shell.
    vWorld = uEarthRadius * 1.0005 * (cos(delta) * uAxis + sin(delta) * outward);
    vColor = aColor;
    vAcross = position.y;
    vAzimuth = azimuth;
    vOpacity = aRing.z;
    vStyle = aRing.w;
    vHalfWidth = abs(aRing.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vWorld, 1.0);
  }
`;

const RING_FRAGMENT_SHADER = `
  uniform float uNearFade;
  uniform float uEarthRadius;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying float vAcross;
  varying float vAzimuth;
  varying float vOpacity;
  varying float vStyle;
  varying float vHalfWidth;

  void main() {
    float alpha;
    if (vStyle < 0.5) {
      // A sharp crest in a soft skirt: the skirt is what keeps a far ring from breaking up into pixels.
      alpha = 0.75 * exp(-20.0 * vAcross * vAcross) + 0.3 * exp(-3.0 * vAcross * vAcross);
    } else if (vStyle < 1.5) {
      alpha = exp(-5.0 * vAcross * vAcross) * step(0.5, fract(vAzimuth * 36.0 / 6.2831853));
    } else if (vStyle < 2.5) {
      // +1 is the front, -1 the tail: crests every sixth of the band, dying away behind.
      float behind = (1.0 - vAcross) * 0.5;
      float crest = 0.5 + 0.5 * cos(behind * 6.2831853 * 5.0);
      alpha = smoothstep(0.0, 0.06, behind) * exp(-3.2 * behind) * (0.25 + 0.75 * crest * crest);
      alpha *= 1.0 - smoothstep(0.85, 1.0, behind);
    } else {
      // A flat tint, with a line a few km wide along each edge.
      float edgeRad = (1.0 - abs(vAcross)) * vHalfWidth;
      alpha = 0.5 + 2.5 * (1.0 - smoothstep(0.003, 0.009, edgeRad));
    }
    // A ring passing under the observer's feet would fill the view from horizon to horizon:
    // close to, it thins (and with reduced motion, goes: no flash).
    float near = smoothstep(3.0e4, 9.0e5, distance(cameraPosition, vWorld));
    alpha *= vOpacity * mix(uNearFade, 1.0, near);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

/** One band on the surface, as the ring mesh takes it. */
export interface RingSpec {
  /** Distance of its centre from the epicentre, degrees. */
  centreDeg: number;
  /** Negative for a ripple train on its way back from the antipode. */
  halfWidthDeg: number;
  color: number;
  opacity: number;
  style: number;
}

/** Half-width of a body-wave ring, degrees: about 80 km of ground, a few pixels on the far side. */
const BODY_RING_HALF_WIDTH_DEG = 0.75;
/** Length of the surface-wave ripple train, degrees. */
const RIPPLE_TRAIN_DEG = 7;

/** The grid every band is drawn with: angle about the axis by position across the band, shared by both batches. */
function bandGrid(): { positions: THREE.BufferAttribute; indices: THREE.BufferAttribute } {
  const positions = new Float32Array((RING_AZIMUTH_SEGMENTS + 1) * (RING_ACROSS_SEGMENTS + 1) * 3);
  const indices = new Uint16Array(RING_AZIMUTH_SEGMENTS * RING_ACROSS_SEGMENTS * 6);
  const row = RING_ACROSS_SEGMENTS + 1;
  let index = 0;
  for (let a = 0; a <= RING_AZIMUTH_SEGMENTS; a++) {
    for (let c = 0; c <= RING_ACROSS_SEGMENTS; c++) {
      const at = (a * row + c) * 3;
      positions[at] = (a / RING_AZIMUTH_SEGMENTS) * 2 * Math.PI;
      positions[at + 1] = (c / RING_ACROSS_SEGMENTS) * 2 - 1;
    }
    if (a === RING_AZIMUTH_SEGMENTS) continue;
    for (let c = 0; c < RING_ACROSS_SEGMENTS; c++) {
      const v = a * row + c;
      indices.set([v, v + row, v + 1, v + 1, v + row, v + row + 1], index);
      index += 6;
    }
  }
  return { positions: new THREE.BufferAttribute(positions, 3), indices: new THREE.BufferAttribute(indices, 1) };
}

/** A set of bands on the surface drawn in one call, refilled every frame without allocating. */
class BandBatch {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly rings: Float32Array;
  private readonly colors: Float32Array;
  private readonly color = new THREE.Color();
  private count = 0;

  constructor(
    grid: { positions: THREE.BufferAttribute; indices: THREE.BufferAttribute },
    material: THREE.ShaderMaterial,
    private readonly capacity: number,
    name: string
  ) {
    this.rings = new Float32Array(capacity * 4);
    this.colors = new Float32Array(capacity * 3);
    this.geometry.setAttribute('position', grid.positions);
    this.geometry.setIndex(grid.indices);
    this.geometry.setAttribute('aRing', new THREE.InstancedBufferAttribute(this.rings, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
  }

  clear(): void {
    this.count = 0;
  }

  push(centreDeg: number, halfWidthDeg: number, color: number, opacity: number, style: number): void {
    if (this.count >= this.capacity) return;
    const rad = Math.PI / 180;
    const at = this.count * 4;
    this.rings[at] = centreDeg * rad;
    this.rings[at + 1] = halfWidthDeg * rad;
    this.rings[at + 2] = opacity;
    this.rings[at + 3] = style;
    // Raw sRGB, as given: the shader writes no output encoding.
    this.color.setHex(color, THREE.LinearSRGBColorSpace);
    this.colors[this.count * 3] = this.color.r;
    this.colors[this.count * 3 + 1] = this.color.g;
    this.colors[this.count * 3 + 2] = this.color.b;
    this.count++;
  }

  commit(): void {
    this.geometry.instanceCount = this.count;
    this.geometry.getAttribute('aRing').needsUpdate = true;
    this.geometry.getAttribute('aColor').needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export class WaveRenderer {
  readonly object = new THREE.Group();
  private readonly manifest: WaveManifest;
  private readonly rayTexture: THREE.DataTexture;
  private readonly weightTexture: THREE.DataTexture;
  private readonly shared: {
    uRays: { value: THREE.DataTexture };
    uWeights: { value: THREE.DataTexture };
    uAxis: { value: THREE.Vector3 };
    uE1: { value: THREE.Vector3 };
    uE2: { value: THREE.Vector3 };
  };
  private readonly frontMaterials: THREE.ShaderMaterial[] = [];
  private readonly frontGeometries: THREE.BufferGeometry[] = [];
  /** The front meshes live in a scene of their own, drawn into `frontTarget` for each camera. */
  private readonly frontScene = new THREE.Scene();
  private readonly frontTarget: THREE.WebGLRenderTarget;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly viewport = new THREE.Vector4();
  private readonly clearColor = new THREE.Color();
  private readonly ringMaterial: THREE.ShaderMaterial;
  /** The moving rings, sharp, drawn straight to the screen. */
  private readonly rings: BandBatch;
  /** The shadow tints: broad and soft, so they go through the half-size buffer with the fronts. */
  private readonly zones: BandBatch;
  private readonly ringScratch = new Float32Array(MAX_RINGS);
  private slice: WaveSlice;
  private shadows: ShadowZone[] = [];
  private showShadows = true;

  constructor(private readonly data: WaveData) {
    this.manifest = data.manifest;
    this.slice = data.slices[0];
    const { rays, steps } = this.manifest;

    this.rayTexture = new THREE.DataTexture(new Uint8Array(this.slice.texels), rays, steps, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.rayTexture.minFilter = THREE.NearestFilter;
    this.rayTexture.magFilter = THREE.NearestFilter;
    this.rayTexture.generateMipmaps = false;
    this.rayTexture.needsUpdate = true;
    this.weightTexture = new THREE.DataTexture(rayWeights(this.manifest, this.slice), rays, 1, THREE.RGFormat, THREE.FloatType);
    this.weightTexture.minFilter = THREE.NearestFilter;
    this.weightTexture.magFilter = THREE.NearestFilter;
    this.weightTexture.generateMipmaps = false;
    this.weightTexture.needsUpdate = true;

    this.shared = {
      uRays: { value: this.rayTexture },
      uWeights: { value: this.weightTexture },
      uAxis: { value: new THREE.Vector3(0, 0, 1) },
      uE1: { value: new THREE.Vector3(1, 0, 0) },
      uE2: { value: new THREE.Vector3(0, 1, 0) },
    };

    this.object.name = 'seismic-waves';
    // S under P: the faster, fainter front stays legible over the slower one.
    for (const [family, opacity, order] of [
      ['S', 0.9, 0],
      ['P', 0.9, 1],
    ] as const) {
      const buffers = buildFrontBuffers(this.manifest, family);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
      geometry.setAttribute('aBranch', new THREE.BufferAttribute(buffers.branches, 3));
      geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
      this.frontGeometries.push(geometry);
      const material = new THREE.ShaderMaterial({
        vertexShader: FRONT_VERTEX_SHADER,
        fragmentShader: FRONT_FRAGMENT_SHADER,
        uniforms: {
          ...this.shared,
          uStep: { value: 0 },
          uLastStep: { value: steps - 1 },
          uRadiusScale: { value: this.manifest.radiusScaleKm * 1000 },
          uDeltaScale: { value: (this.manifest.deltaScaleDeg * Math.PI) / 180 },
          uSpreadLength: { value: SPREAD_LENGTH_M },
          uEarthRadius: { value: EARTH_RADIUS_M },
          // Raw sRGB, as given: this shader writes no output encoding (like the globe's).
          uColor: { value: new THREE.Color().setHex(WAVE_COLORS[family], THREE.LinearSRGBColorSpace) },
          uOpacity: { value: opacity },
        },
        side: THREE.DoubleSide,
        // Both faces shade alike and nothing depth-tests: one pass, not back faces then front.
        forceSinglePass: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `seismic-front-${family}`;
      // Positions come from the texture: the attribute's bounds say nothing about where the mesh is.
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.frontScene.add(mesh);
      this.frontMaterials.push(material);
    }

    // The fronts reach the screen through a half-size buffer (see FRONT_BUFFER_SCALE).
    this.frontTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: COMPOSITE_FRAGMENT_SHADER,
      uniforms: { uFronts: { value: this.frontTarget.texture } },
      transparent: true,
      // The buffer holds colour already multiplied by its coverage.
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    const composite = createFullscreenQuad(this.compositeMaterial, 'seismic-fronts', RENDER_ORDER.interior + 0.6);
    composite.onBeforeRender = (renderer, _scene, camera) => this.renderFronts(renderer, camera);
    this.object.add(composite);

    this.ringMaterial = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX_SHADER,
      fragmentShader: RING_FRAGMENT_SHADER,
      uniforms: {
        uAxis: this.shared.uAxis,
        uE1: this.shared.uE1,
        uE2: this.shared.uE2,
        uEarthRadius: { value: EARTH_RADIUS_M },
        uNearFade: { value: 0.3 },
      },
      side: THREE.DoubleSide,
      forceSinglePass: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const grid = bandGrid();
    this.rings = new BandBatch(grid, this.ringMaterial, MAX_RINGS, 'seismic-rings');
    // Over the fronts, under the earthquake markers.
    this.rings.mesh.renderOrder = RENDER_ORDER.interior + 0.7;
    this.object.add(this.rings.mesh);
    this.zones = new BandBatch(grid, this.ringMaterial, 4, 'seismic-shadow-zones');
    // Under the fronts, in their buffer.
    this.zones.mesh.renderOrder = -1;
    this.frontScene.add(this.zones.mesh);
  }

  /** The baked depth in use: the nearest to the earthquake's. */
  getSlice(): WaveSlice {
    return this.slice;
  }

  /**
   * Show the waves of an earthquake at (lat, lon), using the rays of
   * `slice`. `towards` (ECEF, any length) is where the observer stands:
   * it only sets where the mesh's seam falls - on the far side from them.
   */
  setSource(latDeg: number, lonDeg: number, slice: WaveSlice, towards: THREE.Vector3 | null): void {
    const frame = sourceFrame(latDeg, lonDeg, towards);
    this.shared.uAxis.value.copy(frame.axis);
    // Angle 0 points away from the observer, so the seam at 0 = 2 pi is behind the planet.
    this.shared.uE1.value.copy(frame.e1).negate();
    this.shared.uE2.value.copy(frame.e2).negate();
    if (slice !== this.slice) {
      this.slice = slice;
      (this.rayTexture.image.data as Uint8Array).set(slice.texels);
      this.rayTexture.needsUpdate = true;
      (this.weightTexture.image.data as Float32Array).set(rayWeights(this.manifest, slice));
      this.weightTexture.needsUpdate = true;
    }
    this.shadows = shadowZones(this.data, slice);
  }

  setShadowsVisible(visible: boolean): void {
    this.showShadows = visible;
  }

  /** With reduced motion a ring sweeping under the observer fades out instead of filling the view. */
  setReducedMotion(reduced: boolean): void {
    this.ringMaterial.uniforms.uNearFade.value = reduced ? 0 : 0.3;
  }

  /** Move everything to `timeS` after the origin. */
  setTime(timeS: number): void {
    const { stepS } = this.manifest;
    for (const material of this.frontMaterials) material.uniforms.uStep.value = timeS / stepS;

    this.zones.clear();
    if (this.showShadows) {
      for (const zone of this.shadows) {
        // Faint until the wave that leaves the shadow has got there to leave it.
        const arrived = Math.min(Math.max((timeS - 0.6 * zone.fromS) / (0.4 * zone.fromS), 0), 1);
        this.zones.push(zone.centreDeg, zone.halfWidthDeg, zone.color, zone.opacity * (0.3 + 0.7 * arrived), zone.style);
      }
    }
    this.zones.commit();

    this.rings.clear();
    for (const family of ['S', 'P'] as const) {
      const count = surfaceRings(this.data, this.slice, family, timeS, this.ringScratch);
      const diffracted = this.slice.diffracted[family];
      for (let i = 0; i < count; i++) {
        const deg = this.ringScratch[i];
        // surfaceRings puts the diffracted ring last, if there is one at this time.
        const isDiffracted = diffracted !== null && i === count - 1 && timeS >= diffracted.fromS && timeS <= diffracted.toS;
        this.rings.push(
          deg,
          BODY_RING_HALF_WIDTH_DEG,
          WAVE_COLORS[family],
          isDiffracted ? 0.5 * diffractedStrength(diffracted, deg) : 0.95,
          isDiffracted ? RING_STYLE.dashed : RING_STYLE.line
        );
      }
    }
    for (const wave of this.manifest.surfaceWaves) {
      if (timeS <= 0) continue;
      const travelledDeg = (((wave.speedKmS * timeS) / this.manifest.earthRadiusKm) * 180) / Math.PI;
      const front = surfaceWaveRingDeg(this.data, wave, timeS);
      const returning = travelledDeg % 360 > 180;
      const train = Math.min(RIPPLE_TRAIN_DEG, travelledDeg);
      // A ring on a sphere spreads to the equator of its source and gathers again at the antipode,
      // and loses a little on every lap.
      const spreading = Math.min(1, 0.42 / Math.sqrt(Math.max(Math.sin((front * Math.PI) / 180), 0.05)));
      const laps = Math.exp(-travelledDeg / 500);
      const half = train / 2;
      this.rings.push(
        returning ? front + half : front - half,
        returning ? -half : half,
        wave.id === 'love' ? WAVE_COLORS.love : WAVE_COLORS.rayleigh,
        Math.max(0.2, spreading) * laps,
        RING_STYLE.ripple
      );
    }
    this.rings.commit();
  }

  /**
   * Draw the fronts, as `camera` sees them, into the half-size buffer the
   * composite quad is about to put on screen. Runs inside the main render
   * (once per eye in stereo), so it puts back every piece of renderer
   * state it touches.
   */
  private renderFronts(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const viewport = renderer.getViewport(this.viewport);
    const scale = renderer.getPixelRatio() * FRONT_BUFFER_SCALE;
    const width = Math.max(1, Math.round(viewport.z * scale));
    const height = Math.max(1, Math.round(viewport.w * scale));
    if (this.frontTarget.width !== width || this.frontTarget.height !== height) this.frontTarget.setSize(width, height);

    const target = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.setRenderTarget(this.frontTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    renderer.render(this.frontScene, camera);
    renderer.autoClear = autoClear;
    renderer.setClearColor(this.clearColor, clearAlpha);
    // Back to the screen: this also restores the viewport and scissor of the eye being drawn.
    renderer.setRenderTarget(target);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.frontTarget.dispose();
    this.compositeMaterial.dispose();
    for (const geometry of this.frontGeometries) geometry.dispose();
    for (const material of this.frontMaterials) material.dispose();
    this.rings.dispose();
    this.zones.dispose();
    this.ringMaterial.dispose();
    this.rayTexture.dispose();
    this.weightTexture.dispose();
  }
}

/** A diffracted wave fades along the core: full where it leaves the direct wave, gone at the end of its range. */
function diffractedStrength(range: { fromDeg: number; toDeg: number } | null, deg: number): number {
  if (!range) return 0;
  return Math.max(0, 1 - (deg - range.fromDeg) / (range.toDeg - range.fromDeg));
}

/** Where the model's shadows fall on the surface for one source depth. */
export interface ShadowEdges {
  /** The last direct P, degrees from the epicentre. */
  readonly pEndDeg: number;
  /** Where P first comes back up, weakly, through the inner core (PKIKP). */
  readonly coreStartDeg: number;
  /** The PKP caustic: where P returns in strength. */
  readonly pkpCausticDeg: number;
  /** The last direct S: beyond it, to the antipode, the core's S shadow. */
  readonly sEndDeg: number;
}

export function shadowEdges(data: WaveData, slice: WaveSlice): ShadowEdges {
  const extreme = (phase: string, pick: (a: number, b: number) => number, start: number): number => {
    const branch = data.manifest.branches.find((b) => b.phase === phase);
    let value = start;
    if (!branch) return value;
    for (let i = branch.start; i < branch.start + branch.count; i++) {
      const deg = slice.arrivalDeg[i];
      if (deg === deg) value = pick(value, deg > 180 ? 360 - deg : deg);
    }
    return value;
  };
  return {
    pEndDeg: extreme('P', Math.max, 0),
    coreStartDeg: extreme('PKIKP', Math.min, 180),
    pkpCausticDeg: extreme('PKP', Math.min, 180),
    sEndDeg: extreme('S', Math.max, 0),
  };
}

export interface ShadowZone extends RingSpec {
  /** When (s) the wave reaches the zone's near edge and fails to enter. */
  readonly fromS: number;
}

/** The shadow zones as bands: P's between its last direct ray and the PKP caustic, S's from its last ray to the antipode. */
export function shadowZones(data: WaveData, slice: WaveSlice): ShadowZone[] {
  const edges = shadowEdges(data, slice);
  const lastArrival = (phase: string): number => {
    const branch = data.manifest.branches.find((b) => b.phase === phase);
    let latest = 1;
    if (branch) for (let i = branch.start; i < branch.start + branch.count; i++) if (slice.arrivalS[i] > latest) latest = slice.arrivalS[i];
    return latest;
  };
  return [
    {
      centreDeg: (edges.sEndDeg + 180) / 2,
      halfWidthDeg: (180 - edges.sEndDeg) / 2,
      color: 0xb0401c,
      opacity: 0.1,
      style: RING_STYLE.zone,
      fromS: lastArrival('S'),
    },
    {
      centreDeg: (edges.pEndDeg + edges.pkpCausticDeg) / 2,
      halfWidthDeg: (edges.pkpCausticDeg - edges.pEndDeg) / 2,
      color: 0x3a6ad0,
      opacity: 0.12,
      style: RING_STYLE.zone,
      fromS: lastArrival('P'),
    },
  ];
}
