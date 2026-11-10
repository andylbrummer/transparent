/**
 * A sky survey drawn from its HiPS tiles, fetched as the view needs them:
 * the whole sky in a dozen coarse tiles when looking wide, and deeper
 * tiles for just the patch in view as the user zooms, down to the
 * survey's own resolution. Andromeda is then a picture, not an outline.
 *
 * Tiles come live from the survey's server and nothing is baked; without
 * a connection the layer draws nothing and says so beside its switch.
 * While a sharper tile loads, the part of a coarser one already held
 * stands in for it. The light is added to the sky, like the all-sky maps,
 * so what is below the horizon still shows through the planet, dimmed.
 */

import * as THREE from 'three';
import { ICRS_TO_GALACTIC, healpixPixelPoint, type Mat3 } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';
import { bestSource, targetOrder, tileKey, tileSegments, tileUrl, tilesForView, viewRadiusRad, type HipsTile } from './hips';
import type { SurveySpec } from './surveys';

/** Most tiles drawn at once: a screen needs a dozen or two at the order chosen for it. */
const MAX_TILES = 40;
/** Tile images kept, each a megabyte of texture: those in view, and the coarser ones a zoom out returns to. */
const MAX_TEXTURES = 56;
const MAX_REQUESTS = 6;
const REQUEST_TIMEOUT_MS = 15000;
/** A tile that failed is asked for again after this long. */
const RETRY_MS = 30000;
/** After this many failures in a row the next server on the survey's list is tried. */
const FAILURES_BEFORE_MIRROR = 4;

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
  uniform vec3 uWindow;
  uniform float uFloor;
  uniform float uGain;
  uniform vec3 uObserverUp;
  uniform float uBelowHorizon;
  varying vec2 vUv;
  varying vec3 vWorldDir;
  void main() {
    // The wanted tile's place in the image being drawn (its own, or an ancestor's).
    vec2 w = uWindow.xy + vUv * uWindow.z;
    // A HiPS image has HEALPix v along its rows and u down its columns; the bitmap's first row is t = 0.
    vec3 c = texture2D(uMap, vec2(w.y, w.x)).rgb;
    // The survey's sky background is not black; what is under the floor is no light at all.
    vec3 light = max(c - uFloor, 0.0) * uGain;
    float horizon = mix(uBelowHorizon, 1.0, smoothstep(-0.005, 0.005, dot(normalize(vWorldDir), uObserverUp)));
    gl_FragColor = vec4(light * horizon, 1.0);
  }
`;

interface Held {
  /** Null: the server has no such tile (a survey that does not cover the whole sky). */
  readonly texture: THREE.Texture | null;
  lastUsed: number;
}

interface Drawn {
  readonly tile: HipsTile;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
}

function tileGeometry(tile: HipsTile): THREE.BufferGeometry {
  const n = tileSegments(tile.order);
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  const uvs = new Float32Array((n + 1) * (n + 1) * 2);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i;
      positions.set(healpixPixelPoint(tile.order, tile.ipix, i / n, j / n), k * 3);
      uvs[k * 2] = i / n;
      uvs[k * 2 + 1] = j / n;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function createSurveyLayer(context: LayerContext, spec: SurveySpec): LayerInstance {
  const group = new THREE.Group();
  group.name = `sky-survey-${spec.id}`;
  // A survey kept in galactic coordinates is turned onto the ICRS sky as a whole.
  const toSurvey: Mat3 | null = spec.frame === 'galactic' ? ICRS_TO_GALACTIC : null;
  if (toSurvey) {
    const m = toSurvey;
    // The group's rotation is survey → ICRS: the transpose.
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1));
  }
  context.skyRoot.add(group);

  const held = new Map<string, Held>();
  const pending = new Map<string, AbortController>();
  const retryAt = new Map<string, number>();
  const drawn = new Map<string, Drawn>();
  let baseIndex = 0;
  let failuresInARow = 0;
  let mirrorsTried = 0;
  /** When to look again at tiles that failed, ms on the performance clock; Infinity: nothing is waiting. */
  let lookAgainAt = Infinity;
  let everLoaded = false;
  let dirty = true;
  let disposed = false;
  let visible = false;
  let heightCss = window.innerHeight;
  let clock = 0;
  const lastDirection = new THREE.Vector3(2, 0, 0);
  let lastOrder = -1;
  let lastRadius = 0;
  const forward = new THREE.Vector3();
  const skyToWorld = new THREE.Quaternion();
  let status: string | null = null;

  const setStatus = (text: string | null, tone: 'info' | 'error' = 'info'): void => {
    if (text === status) return;
    status = text;
    context.setStatus(text, tone);
  };

  const request = (tile: HipsTile): void => {
    const key = tileKey(tile);
    if (held.has(key) || pending.has(key) || pending.size >= MAX_REQUESTS) return;
    if ((retryAt.get(key) ?? 0) > performance.now()) return;
    const controller = new AbortController();
    pending.set(key, controller);
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const url = tileUrl(spec.bases[baseIndex % spec.bases.length], tile, spec.extension);
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
        if (response.status === 404) {
          held.set(key, { texture: null, lastUsed: clock });
        } else {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bitmap = await createImageBitmap(await response.blob());
          if (disposed) {
            bitmap.close();
            return;
          }
          const texture = new THREE.Texture(bitmap);
          texture.colorSpace = THREE.NoColorSpace;
          texture.flipY = false;
          // Tiles are drawn at about their own scale: mipmaps would add a third to each for nothing.
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.needsUpdate = true;
          held.set(key, { texture, lastUsed: clock });
          everLoaded = true;
        }
        failuresInARow = 0;
        mirrorsTried = 0;
        retryAt.delete(key);
      } catch {
        // Aborted because the view moved on, or the network failed: either way ask again later if still wanted.
        if (!controller.signal.aborted || !disposed) {
          retryAt.set(key, performance.now() + RETRY_MS);
          if (!controller.signal.aborted) {
            failuresInARow++;
            // Try the next server once round the list; if none answers, wait out the retry time rather than hammer them.
            if (failuresInARow >= FAILURES_BEFORE_MIRROR && mirrorsTried < spec.bases.length - 1) {
              baseIndex++;
              mirrorsTried++;
              failuresInARow = 0;
              retryAt.clear();
            }
          }
        }
      } finally {
        window.clearTimeout(timer);
        pending.delete(key);
        dirty = true;
      }
    })();
  };

  const select = (direction: THREE.Vector3, order: number, radius: number): void => {
    clock++;
    const wanted = tilesForView(order, [direction.x, direction.y, direction.z], radius, MAX_TILES);
    const wantedKeys = new Set(wanted.map(tileKey));
    // Requests for tiles no longer in view give way to those that are.
    for (const [key, controller] of pending) {
      if (!wantedKeys.has(key)) {
        controller.abort();
        retryAt.delete(key);
      }
    }
    for (const [key, entry] of drawn) {
      if (wantedKeys.has(key)) continue;
      entry.mesh.removeFromParent();
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      drawn.delete(key);
    }
    let shown = 0;
    let waiting = 0;
    for (const tile of wanted) {
      const key = tileKey(tile);
      const own = held.get(key);
      if (!own) {
        waiting++;
        request(tile);
      }
      const source = bestSource(tile, spec.minOrder, (candidate) => (held.get(tileKey(candidate))?.texture ?? null) !== null);
      let entry = drawn.get(key);
      if (own && own.texture === null) {
        // The survey has nothing here.
        if (entry) entry.mesh.visible = false;
        continue;
      }
      if (!source) {
        if (entry) entry.mesh.visible = false;
        continue;
      }
      if (!entry) {
        const material = new THREE.ShaderMaterial({
          vertexShader: VERTEX_SHADER,
          fragmentShader: FRAGMENT_SHADER,
          uniforms: {
            uMap: { value: null },
            uWindow: { value: new THREE.Vector3(0, 0, 1) },
            uFloor: { value: spec.floor },
            uGain: { value: spec.gain },
            uObserverUp: context.skyUniforms.uObserverUp,
            uBelowHorizon: context.skyUniforms.uBelowHorizon,
          },
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(tileGeometry(tile), material);
        mesh.frustumCulled = false;
        // Just over the all-sky maps, under the stars.
        mesh.renderOrder = RENDER_ORDER.skyMap + 0.01;
        group.add(mesh);
        entry = { tile, mesh, material };
        drawn.set(key, entry);
      }
      const sourceHeld = held.get(tileKey(source.tile))!;
      sourceHeld.lastUsed = clock;
      entry.material.uniforms.uMap.value = sourceHeld.texture;
      (entry.material.uniforms.uWindow.value as THREE.Vector3).set(source.window.u0, source.window.v0, source.window.size);
      entry.mesh.visible = true;
      shown++;
    }
    // Forget the images least recently drawn.
    if (held.size > MAX_TEXTURES) {
      const idle = [...held.entries()].filter(([, entry]) => entry.lastUsed !== clock).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [key, entry] of idle.slice(0, held.size - MAX_TEXTURES)) {
        entry.texture?.dispose();
        (entry.texture?.image as ImageBitmap | undefined)?.close?.();
        held.delete(key);
      }
    }
    // Tiles still missing with nothing on its way: they failed, and are due again after the retry time.
    lookAgainAt = waiting > 0 && pending.size === 0 ? performance.now() + RETRY_MS : Infinity;
    if (lookAgainAt !== Infinity && mirrorsTried > 0) {
      // Every server was tried: start again from the first when the time comes.
      mirrorsTried = 0;
      baseIndex = 0;
    }
    if (waiting === 0) setStatus(null);
    else if (shown === 0 && !everLoaded && pending.size === 0) setStatus('no connection', 'error');
    else if (pending.size === 0 && failuresInARow > 0) setStatus('some tiles missing', 'error');
    else setStatus('loading…');
  };

  return {
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (!next) {
        for (const controller of pending.values()) controller.abort();
        setStatus(null);
      } else {
        dirty = true;
      }
    },
    setResolution(_widthCss, height) {
      heightCss = height;
      dirty = true;
    },
    update(frame) {
      if (!visible) return;
      // Where the camera looks, in the survey's own frame.
      frame.camera.getWorldDirection(forward);
      skyToWorld.copy(context.skyRoot.quaternion).multiply(group.quaternion).invert();
      forward.applyQuaternion(skyToWorld);
      const pxPerRad = heightCss / ((frame.camera.fov * Math.PI) / 180);
      const order = targetOrder(pxPerRad, spec.minOrder, spec.maxOrder);
      const radius = viewRadiusRad(frame.camera.fov, frame.camera.aspect) * 1.05;
      // Reselect when the view has moved a twentieth of its own width, zoomed, or a tile has arrived.
      const moved = forward.angleTo(lastDirection) > radius * 0.05 || order !== lastOrder || Math.abs(radius - lastRadius) > lastRadius * 0.05;
      if (!moved && !dirty && performance.now() < lookAgainAt) return;
      dirty = false;
      lastDirection.copy(forward);
      lastOrder = order;
      lastRadius = radius;
      select(forward, order, radius);
    },
    dispose() {
      disposed = true;
      for (const controller of pending.values()) controller.abort();
      for (const entry of drawn.values()) {
        entry.mesh.geometry.dispose();
        entry.material.dispose();
      }
      for (const entry of held.values()) {
        entry.texture?.dispose();
        (entry.texture?.image as ImageBitmap | undefined)?.close?.();
      }
      group.removeFromParent();
      setStatus(null);
    },
  };
}
