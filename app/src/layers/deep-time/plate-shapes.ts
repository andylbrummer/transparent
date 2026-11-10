/**
 * Draws the plate model's shapes where the model puts them at any age.
 *
 * The geometry never changes: every vertex is where it is today, tagged
 * with its plate. Each frame of an animation only rewrites a small float
 * texture - one quaternion per plate - and the vertex shader turns each
 * vertex by its plate's. A piece that does not exist at the age shown is
 * collapsed off screen by the same shader. So moving a billion years of
 * continents costs a few hundred slerps and one tiny texture upload, with
 * no per-frame allocation.
 *
 * Lines are screen-width quads built in the shader (the stock fat-line
 * material cannot rotate its endpoints per plate). Like every other
 * surface line they draw without a depth test, onto the far side as seen
 * through the planet.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import type { PlateFill, PlateModel, PlateSet } from './plates-data';
import { writePlateQuaternions } from './plates-data';

/** A span no real piece has: "exists at every age". */
export const ALWAYS = 65535;

const TURN_GLSL = `
  uniform sampler2D uRotations;
  uniform float uAge;
  uniform float uRadius;
  // x: the plate's column in uRotations; y, z: the ages the piece exists between (older, younger).
  attribute vec3 aMeta;
  bool exists() {
    return uAge <= aMeta.y && uAge >= aMeta.z;
  }
  vec3 placed(vec3 today) {
    vec4 q = texelFetch(uRotations, ivec2(int(aMeta.x + 0.5), 0), 0);
    return (today + 2.0 * cross(q.xyz, cross(q.xyz, today) + q.w * today)) * uRadius;
  }
`;

const LINE_VERTEX_SHADER = `
  ${TURN_GLSL}
  attribute vec3 aStart;
  attribute vec3 aEnd;
  uniform vec2 uResolution;
  uniform float uWidthPx;
  // View-space z of the near plane: a segment is cut there, or its far end would project through infinity.
  const float NEAR_Z = -0.1;
  void main() {
    if (!exists()) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec4 a = modelViewMatrix * vec4(placed(aStart), 1.0);
    vec4 b = modelViewMatrix * vec4(placed(aEnd), 1.0);
    if (a.z > NEAR_Z && b.z > NEAR_Z) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    if (a.z > NEAR_Z) a = mix(b, a, (NEAR_Z - b.z) / (a.z - b.z));
    else if (b.z > NEAR_Z) b = mix(a, b, (NEAR_Z - a.z) / (b.z - a.z));
    vec4 clipA = projectionMatrix * a;
    vec4 clipB = projectionMatrix * b;
    vec2 along = (clipB.xy / clipB.w - clipA.xy / clipA.w) * uResolution;
    float lengthPx = length(along);
    along = lengthPx > 1e-6 ? along / lengthPx : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);
    // position.x: -1 or 1, the side; position.y: 0 at the start, 1 at the end.
    vec4 clip = position.y < 0.5 ? clipA : clipB;
    // Half a width past each end too, so consecutive segments meet without a notch.
    vec2 offsetPx = (across * position.x + along * (position.y * 2.0 - 1.0)) * uWidthPx * 0.5;
    clip.xy += offsetPx * 2.0 / uResolution * clip.w;
    gl_Position = clip;
  }
`;

const LINE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

const FILL_VERTEX_SHADER = `
  ${TURN_GLSL}
  varying vec3 vWorld;
  void main() {
    if (!exists()) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec4 world = modelMatrix * vec4(placed(position), 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * A flat triangle lies a little under the sphere. Far away that does not
 * matter, but the one under the viewer's feet would cover the whole
 * downward view. Every ray from the surface leaves the sphere at one far
 * point, a known distance off; a fragment well short of that is the near
 * ground seen from underneath, and is dropped.
 *
 * The model's blocks overlap in places, and tinted twice they would show
 * as darker patches. All fragments are written at one depth with a
 * less-than test, so each pixel takes the tint once. Nothing else in the
 * scene tests depth, so this disturbs nothing.
 */
const FILL_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vWorld;
  void main() {
    vec3 toFragment = vWorld - cameraPosition;
    float range = length(toFragment);
    float farSide = -2.0 * dot(cameraPosition, toFragment / range);
    if (range < 0.75 * farSide) discard;
    gl_FragDepth = 0.5;
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

export interface LineStyle {
  /** 0xRRGGBB, written to the screen as given. */
  readonly color: number;
  readonly opacity: number;
  /** CSS px. */
  readonly widthPx: number;
  readonly renderOrder: number;
}

export interface FillStyle {
  readonly color: number;
  readonly opacity: number;
  readonly renderOrder: number;
}

/** Uniforms every material of one PlateShapes shares by reference. */
interface SharedUniforms {
  readonly uRotations: { value: THREE.DataTexture };
  readonly uAge: { value: number };
  readonly uRadius: { value: number };
  readonly uResolution: { value: THREE.Vector2 };
}

/**
 * One segment per step of every ring that is an outer edge at some age:
 * [aStart, aEnd, aMeta] for the instances. A step that is a seam inside a
 * continent back to some age (PlateSet.interior) is given that age as the
 * youngest at which it shows, so it appears when the land parts.
 */
export function ringSegments(set: PlateSet): { start: Float32Array; end: Float32Array; meta: Float32Array } {
  const shows = (ring: number, point: number): boolean => set.interior[point] < set.ringBegin[ring];
  let count = 0;
  for (let ring = 0; ring < set.ringCount; ring++) {
    for (let point = set.ringStart[ring]; point < set.ringStart[ring + 1] - 1; point++) {
      if (shows(ring, point)) count += 1;
    }
  }
  const start = new Float32Array(count * 3);
  const end = new Float32Array(count * 3);
  const meta = new Float32Array(count * 3);
  let segment = 0;
  for (let ring = 0; ring < set.ringCount; ring++) {
    for (let point = set.ringStart[ring]; point < set.ringStart[ring + 1] - 1; point++) {
      if (!shows(ring, point)) continue;
      start.set(set.unit.subarray(point * 3, point * 3 + 3), segment * 3);
      end.set(set.unit.subarray(point * 3 + 3, point * 3 + 6), segment * 3);
      meta[segment * 3] = set.ringPlate[ring];
      meta[segment * 3 + 1] = set.ringBegin[ring];
      // Half a million years past the seam's last age: the two sides are then apart.
      meta[segment * 3 + 2] = set.interior[point] > 0 ? Math.max(set.ringEnd[ring], set.interior[point] + 0.5) : set.ringEnd[ring];
      segment += 1;
    }
  }
  return { start, end, meta };
}

/** Per fill vertex: its ring's plate and ages. */
export function fillMeta(set: PlateSet, fill: PlateFill): Float32Array {
  const meta = new Float32Array(fill.ring.length * 3);
  for (let vertex = 0; vertex < fill.ring.length; vertex++) {
    const ring = fill.ring[vertex];
    meta[vertex * 3] = set.ringPlate[ring];
    meta[vertex * 3 + 1] = set.ringBegin[ring];
    meta[vertex * 3 + 2] = set.ringEnd[ring];
  }
  return meta;
}

const QUAD = new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]);
const QUAD_INDEX = [0, 1, 2, 2, 1, 3];

export class PlateShapes {
  readonly group = new THREE.Group();
  /** One quaternion per plate, then the identity: for lines that are already where they should be. */
  private readonly rotations: Float32Array;
  private readonly texture: THREE.DataTexture;
  private readonly shared: SharedUniforms;
  private readonly disposables: { dispose(): void }[] = [];
  private shownAge = Number.NaN;

  constructor(private readonly model: PlateModel) {
    const columns = model.plateIds.length + 1;
    this.rotations = new Float32Array(columns * 4);
    this.rotations[columns * 4 - 1] = 1;
    this.texture = new THREE.DataTexture(this.rotations, columns, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.shared = {
      uRotations: { value: this.texture },
      uAge: { value: 0 },
      uRadius: { value: EARTH_RADIUS_M },
      uResolution: { value: new THREE.Vector2(1, 1) },
    };
    this.disposables.push(this.texture);
    this.group.name = 'deep-time-plates';
    this.setAge(0);
  }

  /** The texture column that leaves a vertex where it is. */
  get identityColumn(): number {
    return this.model.plateIds.length;
  }

  /** Outlines of a set, moving with its plates. */
  addOutlines(name: string, set: PlateSet, style: LineStyle): THREE.Mesh {
    const segments = ringSegments(set);
    return this.addSegments(name, segments.start, segments.end, segments.meta, style);
  }

  /** Segments given as unit-vector endpoints and per-segment [column, older age, younger age]. */
  addSegments(name: string, start: Float32Array, end: Float32Array, meta: Float32Array, style: LineStyle): THREE.Mesh {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
    geometry.setIndex(QUAD_INDEX);
    this.setSegments(geometry, start, end, meta);
    const material = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX_SHADER,
      fragmentShader: LINE_FRAGMENT_SHADER,
      uniforms: {
        ...this.shared,
        uWidthPx: { value: style.widthPx },
        uColor: { value: new THREE.Color().setHex(style.color, THREE.LinearSRGBColorSpace) },
        uOpacity: { value: style.opacity },
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    return this.add(name, geometry, material, style.renderOrder);
  }

  /** Replace a segment mesh's segments (the viewer moved, so their own track did). */
  setSegments(geometry: THREE.BufferGeometry, start: Float32Array, end: Float32Array, meta: Float32Array): void {
    // Frees the buffers of the segments being replaced; the rest re-upload on the next draw.
    geometry.dispose();
    geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 3));
    geometry.setAttribute('aEnd', new THREE.InstancedBufferAttribute(end, 3));
    geometry.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 3));
    (geometry as THREE.InstancedBufferGeometry).instanceCount = start.length / 3;
  }

  /** A set's pieces as a flat tint. */
  addFill(name: string, set: PlateSet, style: FillStyle): THREE.Mesh | null {
    if (!set.fill) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(set.fill.unit, 3));
    geometry.setAttribute('aMeta', new THREE.BufferAttribute(fillMeta(set, set.fill), 3));
    geometry.setIndex(new THREE.BufferAttribute(set.fill.triangles, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: FILL_VERTEX_SHADER,
      fragmentShader: FILL_FRAGMENT_SHADER,
      uniforms: {
        ...this.shared,
        uColor: { value: new THREE.Color().setHex(style.color, THREE.LinearSRGBColorSpace) },
        uOpacity: { value: style.opacity },
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.LessDepth,
    });
    return this.add(name, geometry, material, style.renderOrder);
  }

  private add(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, renderOrder: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    // The vertices are moved in the shader; bounds computed from where they are today would cull wrongly.
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    this.group.add(mesh);
    this.disposables.push(geometry, material);
    return mesh;
  }

  /** Move every plate to where the model has it at `ageMa`. */
  setAge(ageMa: number): void {
    if (ageMa === this.shownAge) return;
    this.shownAge = ageMa;
    writePlateQuaternions(this.model, ageMa, this.rotations);
    this.texture.needsUpdate = true;
    this.shared.uAge.value = ageMa;
  }

  /** Line widths are in CSS pixels, so the shader needs the CSS viewport size (one eye's in stereo). */
  setResolution(widthCss: number, heightCss: number): void {
    this.shared.uResolution.value.set(widthCss, heightCss);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}
