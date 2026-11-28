/**
 * One earthquake's simulated shaking over the whole surface (tools/pipeline/generate_quake_sim.py): where the ground
 * is moving at each moment of the playback, lopsided as the fault radiates, dark in the core's shadow, flashing again
 * as reflections arrive and brightest where the surface waves pass and gather at the antipode.
 *
 * The bake holds a few thousand points spread evenly over the globe and the triangles between them; each point's
 * loudness every few seconds is a byte (log10 of the vertical ground velocity's envelope over a range of decades).
 * The mesh never changes: each vertex knows its point, and the vertex shader reads that point's loudness at the
 * playback time from a texture, between the two frames either side; the GPU spreads it over the triangles. Playing
 * and scrubbing move one uniform.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';

export interface SimLayoutEntry {
  readonly offset: number;
  readonly length: number;
  readonly type: string;
}

export interface SimManifest {
  readonly formatVersion: 1;
  readonly key: string;
  readonly comcatId: string;
  readonly gcmtId: string;
  readonly source: { readonly time: string; readonly lat: number; readonly lon: number; readonly depthKm: number };
  readonly model: string;
  readonly points: number;
  readonly triangles: number;
  readonly frames: number;
  readonly frameS: number;
  readonly log10FloorMs: number;
  readonly log10TopMs: number;
  readonly layout: {
    readonly lat: SimLayoutEntry;
    readonly lon: SimLayoutEntry;
    readonly triangles: SimLayoutEntry;
    readonly frames: SimLayoutEntry;
  };
}

export interface SurfaceSim {
  readonly manifest: SimManifest;
  readonly lat: Float32Array;
  readonly lon: Float32Array;
  readonly triangles: Uint16Array;
  /** Frame-major: frame f's loudness for every point, a byte each. */
  readonly frames: Uint8Array;
}

/** The earthquakes that have a simulation baked, by playback key. */
export const SIMULATED_QUAKES: readonly string[] = ['tohoku2011'];

export function parseSurfaceSim(manifest: SimManifest, buffer: ArrayBuffer): SurfaceSim {
  if (manifest.formatVersion !== 1) throw new Error(`quake simulation: format ${String(manifest.formatVersion)}`);
  const { lat, lon, triangles, frames } = manifest.layout;
  const sim: SurfaceSim = {
    manifest,
    lat: new Float32Array(buffer, lat.offset, lat.length),
    lon: new Float32Array(buffer, lon.offset, lon.length),
    triangles: new Uint16Array(buffer, triangles.offset, triangles.length),
    frames: new Uint8Array(buffer, frames.offset, frames.length),
  };
  if (sim.lat.length !== manifest.points || sim.frames.length !== manifest.points * manifest.frames) {
    throw new Error('quake simulation: the layout does not match the counts');
  }
  return sim;
}

/** Loudness 0..1 of point `index` at `timeS`, as the shader works it out: for tests and readouts. */
export function loudnessAt(sim: SurfaceSim, index: number, timeS: number): number {
  const { frames, frameS, points } = sim.manifest;
  const at = timeS / frameS;
  if (at < 0 || at > frames - 1) return 0;
  const f = Math.floor(at);
  const a = sim.frames[f * points + index];
  const b = sim.frames[Math.min(f + 1, frames - 1) * points + index];
  return (a + (b - a) * (at - f)) / 255;
}

/** Texture rows are this wide, under every GPU's limit; a frame takes as many rows as its points need. */
export const SIM_TEXTURE_WIDTH = 2048;

/** The frames as a texture: frame f, point i at column i mod width, row f·rowsPerFrame + floor(i / width). */
export function simTextureData(sim: SurfaceSim): { data: Uint8Array; width: number; height: number; rowsPerFrame: number } {
  const { points, frames } = sim.manifest;
  const rowsPerFrame = Math.ceil(points / SIM_TEXTURE_WIDTH);
  const stride = rowsPerFrame * SIM_TEXTURE_WIDTH;
  const data = new Uint8Array(stride * frames);
  for (let f = 0; f < frames; f++) data.set(sim.frames.subarray(f * points, (f + 1) * points), f * stride);
  return { data, width: SIM_TEXTURE_WIDTH, height: rowsPerFrame * frames, rowsPerFrame };
}

const VERTEX_SHADER = `
  uniform sampler2D uFrames;
  uniform vec2 uSize;
  uniform float uRowsPerFrame;
  uniform float uFrame;
  uniform float uLastFrame;
  attribute float aPoint;
  varying float vLoud;
  varying vec3 vWorld;

  float loudness(float frame) {
    float row = frame * uRowsPerFrame + floor(aPoint / uSize.x);
    float column = mod(aPoint, uSize.x);
    return texture2D(uFrames, vec2((column + 0.5) / uSize.x, (row + 0.5) / uSize.y)).r;
  }

  void main() {
    float f = clamp(uFrame, 0.0, uLastFrame);
    float f0 = floor(f);
    vLoud = mix(loudness(f0), loudness(min(f0 + 1.0, uLastFrame)), f - f0);
    // Past the end of the simulation, the shaking fades rather than stopping dead.
    vLoud *= 1.0 - smoothstep(uLastFrame, uLastFrame + 15.0, uFrame);
    vWorld = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform float uOpacity;
  uniform float uNearFade;
  varying float vLoud;
  varying vec3 vWorld;

  void main() {
    // Embers to white heat: the loud end of the log scale is what the eye should find.
    // The bottom of the scale is the long coda that rings round the whole globe for hours: drawn, it washes everything
    // the same orange and hides the fronts, so the glow starts about a decade and a half up.
    float l = vLoud;
    vec3 color = mix(vec3(0.55, 0.05, 0.12), vec3(1.0, 0.45, 0.1), smoothstep(0.4, 0.7, l));
    color = mix(color, vec3(1.0, 0.95, 0.75), smoothstep(0.72, 0.95, l));
    float alpha = smoothstep(0.35, 0.7, l) * (0.35 + 0.65 * l) * uOpacity;
    // Under the observer's feet a triangle fills the view: close to, it thins, as the rings do.
    alpha *= mix(uNearFade, 1.0, smoothstep(3.0e4, 9.0e5, distance(cameraPosition, vWorld)));
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

/** The shaking, drawn just under the rings so that a modelled front's ring lies on the simulated ground that moves. */
export class SurfaceShaking {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly texture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;

  constructor(readonly sim: SurfaceSim, renderOrder: number) {
    const { points, frames, frameS } = sim.manifest;
    const positions = new Float32Array(points * 3);
    const pointIndex = new Float32Array(points);
    const radius = EARTH_RADIUS_M * 1.0004;
    for (let i = 0; i < points; i++) {
      const lat = (sim.lat[i] * Math.PI) / 180;
      const lon = (sim.lon[i] * Math.PI) / 180;
      positions[i * 3] = radius * Math.cos(lat) * Math.cos(lon);
      positions[i * 3 + 1] = radius * Math.cos(lat) * Math.sin(lon);
      positions[i * 3 + 2] = radius * Math.sin(lat);
      pointIndex[i] = i;
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aPoint', new THREE.BufferAttribute(pointIndex, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(sim.triangles, 1));

    const texture = simTextureData(sim);
    this.texture = new THREE.DataTexture(texture.data, texture.width, texture.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uFrames: { value: this.texture },
        uSize: { value: new THREE.Vector2(texture.width, texture.height) },
        uRowsPerFrame: { value: texture.rowsPerFrame },
        uFrame: { value: -1 },
        uLastFrame: { value: frames - 1 },
        uOpacity: { value: 0.85 },
        uNearFade: { value: 0.3 },
      },
      side: THREE.DoubleSide,
      forceSinglePass: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'seismic-surface-shaking';
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
    this.frameS = frameS;
  }

  private readonly frameS: number;

  setTime(timeS: number): void {
    this.material.uniforms.uFrame.value = timeS / this.frameS;
  }

  setReducedMotion(reduced: boolean): void {
    this.material.uniforms.uNearFade.value = reduced ? 0 : 0.3;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.texture.dispose();
    this.material.dispose();
  }
}
