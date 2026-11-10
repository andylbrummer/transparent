/**
 * Wind as flowing trails: particles carried by the real GFS wind field,
 * each drawing the path it has just travelled, coloured by the wind speed
 * along it.
 *
 * The particles and their trail history are advanced on the CPU
 * (wind-field.ts) - eight thousand bilinear samples a frame is nothing -
 * and drawn in one instanced call: every trail segment is a quad the
 * vertex shader stretches between two consecutive points of the history
 * buffer, widened in screen space so a trail is the same width near and
 * far. The camera turns freely with the phone, so the trails are geometry
 * on the globe, not an accumulated screen image that would smear.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import type { LayerContext, LayerInstance } from '../types';
import { cacheStore, ProductWatcher } from './live';
import { rampStrip, type RampStop, WIND_10M_RAMP, WIND_250HPA_RAMP } from './ramps';
import { WEATHER_ORDER } from './shells';
import { gfsFieldSource, type GfsSnapshotField } from './sources';
import { LoadGovernor, POINT_STRIDE, WindParticles, type WindField } from './wind-field';

const VERTEX_SHADER = `
  // One trail point: unit ECEF direction, and the wind speed there (negative: a respawn).
  attribute vec4 aStart;
  attribute vec4 aEnd;
  // The history slot aStart sits in.
  attribute float aSlot;

  // projection × view × model, composed once per draw: each vertex projects two points.
  uniform mat4 uTransform;
  uniform float uRadius;
  uniform float uHead;
  uniform float uSlots;
  uniform float uPhase;
  uniform vec2 uResolution;
  uniform float uWidthPx;
  uniform vec2 uSpeedRange;
  uniform vec3 uObserverUp;
  uniform vec2 uNearFadeCos;
  uniform sampler2D uRamp;

  varying float vSide;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // Slots since this segment was the newest (see segmentAge in wind-field.ts).
    float age = mod(uHead - aSlot - 1.0 + uSlots, uSlots);
    // Clear round the user, as the shells are. This is also what keeps the frame
    // rate: a segment a few km overhead would otherwise be a quad across the
    // whole screen, shaded to nothing a dozen times over.
    float nearStart = 1.0 - smoothstep(uNearFadeCos.y, uNearFadeCos.x, dot(aStart.xyz, uObserverUp));
    float nearEnd = 1.0 - smoothstep(uNearFadeCos.y, uNearFadeCos.x, dot(aEnd.xyz, uObserverUp));
    // Not drawn: the seam of the ring, a jump to a respawn, the clear zone.
    if (age > uSlots - 1.5 || aEnd.w < 0.0 || nearStart + nearEnd <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec4 a = uTransform * vec4(aStart.xyz * uRadius, 1.0);
    vec4 b = uTransform * vec4(aEnd.xyz * uRadius, 1.0);
    // Nor anything behind the eye.
    if (a.w < 1.0 || b.w < 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 along = (b.xy / b.w - a.xy / a.w) * uResolution;
    float lengthPx = length(along);
    vec2 direction = lengthPx > 1e-3 ? along / lengthPx : vec2(1.0, 0.0);
    vec4 p = mix(a, b, position.x);
    // Half the width to either side, and half again beyond each end so segments overlap at bends.
    vec2 offsetPx = vec2(-direction.y, direction.x) * position.y * uWidthPx * 0.5
      + direction * (position.x * 2.0 - 1.0) * uWidthPx * 0.25;
    p.xy += offsetPx / uResolution * 2.0 * p.w;
    gl_Position = vec4(p.xy, 0.0, p.w);

    // Age along the trail in slots, 0 at the moving head.
    float startAge = age + uPhase;
    float endAge = age < 0.5 ? 0.0 : age - 1.0 + uPhase;
    float fade = 1.0 - mix(startAge, endAge, position.x) / (uSlots - 1.0);
    float near = mix(nearStart, nearEnd, position.x);
    float speed = mix(max(aStart.w, 0.0), aEnd.w, position.x);
    float onRamp = clamp((speed - uSpeedRange.x) / (uSpeedRange.y - uSpeedRange.x), 0.0, 1.0);
    // Coloured here, per vertex: the trails cover a great many pixels, and
    // every one of them would otherwise pay for the lookup.
    vColor = texture2D(uRamp, vec2(onRamp, 0.5)).rgb;
    // Still air leaves faint marks; the wind that matters draws itself.
    vAlpha = pow(fade, 1.4) * near * mix(0.45, 1.0, smoothstep(0.0, 0.3, onRamp));
    vSide = position.y;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform float uOpacity;
  varying float vSide;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    gl_FragColor = vec4(vColor, vAlpha * edge * uOpacity);
  }
`;

export interface WindStyle {
  readonly ramp: readonly RampStop[];
  /** Height of the trails above the surface, metres. */
  readonly altitudeM: number;
  /**
   * Degrees of arc a 10 m/s wind covers per second on screen. The real
   * figure is 0.00009°: the animation runs tens of thousands of times
   * faster than the air, or nothing would be seen to move.
   */
  readonly degreesPerSecondAt10Ms: number;
  /** Trail width in CSS pixels on a screen of one device pixel each; see trailWidthCss. */
  readonly widthPx: number;
  /**
   * Share of the particle budget this level uses. Fast air draws long
   * trails: fewer of them fill the picture, and the pixels they cover -
   * the cost that matters on a phone - stay in budget.
   */
  readonly particleShare: number;
}

export const WIND_STYLES: Record<'wind-10m' | 'wind-250hpa', WindStyle> = {
  // 2.2°/s for 10 m/s: one second of animation is 6.8 hours of wind.
  'wind-10m': { ramp: WIND_10M_RAMP, altitudeM: 1_000, degreesPerSecondAt10Ms: 2.2, widthPx: 2.2, particleShare: 1 },
  // The jet is five times faster: slowed so it streams and does not flicker (1 s = 2 h).
  // 250 hPa is about 10.4 km up in the standard atmosphere, and drawn there.
  'wind-250hpa': { ramp: WIND_250HPA_RAMP, altitudeM: 10_400, degreesPerSecondAt10Ms: 0.65, widthPx: 2, particleShare: 0.8 },
};

/** Trail points per particle, and seconds between them: a trail shows the last 1.8 s of travel. */
const SLOTS = 12;
const SLOT_SECONDS = 0.16;
/** The spec's phone budget; a mouse-driven screen has the fill rate for more. */
const PARTICLES_TOUCH = 8_000;
const PARTICLES_DESKTOP = 10_000;
/** A stalled tab must not fling every particle across the globe on its first frame back. */
const MAX_STEP_SECONDS = 0.05;
const RAMP_TEXELS = 64;
/**
 * The particles are drawn as this many independent sets, so that a device
 * that cannot keep up can stop simulating and drawing whole sets (see
 * LoadGovernor) - which saves the vertex work as well as the pixels.
 */
const SETS = 4;

/**
 * A trail's width in CSS pixels for a screen's pixel ratio. What a trail
 * costs is the device pixels it covers, and what it needs to be seen is
 * about three of them across: on a dense screen the same CSS width would
 * pay for twice the pixels to no visible gain, so it narrows by a third.
 */
export function trailWidthCss(widthPx: number, pixelRatio: number): number {
  return pixelRatio >= 1.5 ? widthPx * 0.68 : widthPx;
}

export function particleBudget(coarsePointer: boolean): number {
  return coarsePointer ? PARTICLES_TOUCH : PARTICLES_DESKTOP;
}

/** The trail quads for a particle system: instanced, reading the history buffer at two offsets. */
export class WindTrails {
  readonly object: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.InstancedInterleavedBuffer;
  private readonly rampTexture: THREE.DataTexture;

  constructor(
    private readonly particles: WindParticles,
    style: WindStyle,
    observerUp: { value: THREE.Vector3 },
    name: string,
    pixelRatio: number = 1
  ) {
    const { count, slots } = particles.options;
    // A unit quad: x runs start → end, y is the side.
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.points = new THREE.InstancedInterleavedBuffer(particles.buffer, POINT_STRIDE, 1);
    this.points.setUsage(THREE.DynamicDrawUsage);
    // Slot k+1 lies one whole slot (count points) further on in the buffer:
    // the same data read twice, the second time from there, pairs each
    // point with the next one of its trail.
    this.geometry.setAttribute('aStart', new THREE.InterleavedBufferAttribute(this.points, 4, 0));
    this.geometry.setAttribute('aEnd', new THREE.InterleavedBufferAttribute(this.points, 4, count * POINT_STRIDE));
    const slotOf = new Float32Array(slots * count);
    for (let slot = 0; slot < slots; slot++) slotOf.fill(slot, slot * count, (slot + 1) * count);
    this.geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slotOf, 1));
    this.geometry.instanceCount = slots * count;

    this.rampTexture = new THREE.DataTexture(rampStrip(style.ramp, RAMP_TEXELS), RAMP_TEXELS, 1, THREE.RGBAFormat);
    this.rampTexture.minFilter = THREE.LinearFilter;
    this.rampTexture.magFilter = THREE.LinearFilter;
    this.rampTexture.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTransform: { value: new THREE.Matrix4() },
        uRadius: { value: EARTH_RADIUS_M + style.altitudeM },
        uHead: { value: 0 },
        uSlots: { value: slots },
        uPhase: { value: 0 },
        uResolution: { value: new THREE.Vector2(1280, 800) },
        uWidthPx: { value: trailWidthCss(style.widthPx, pixelRatio) },
        uSpeedRange: { value: new THREE.Vector2(style.ramp[0][0], style.ramp[style.ramp.length - 1][0]) },
        uObserverUp: observerUp,
        // The same clear zone round the user as the draped shells: 2° to 5°.
        uNearFadeCos: { value: new THREE.Vector2(Math.cos((2 * Math.PI) / 180), Math.cos((5 * Math.PI) / 180)) },
        uRamp: { value: this.rampTexture },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = name;
    this.object.frustumCulled = false;
    this.object.renderOrder = WEATHER_ORDER.wind;
    const transform = this.material.uniforms.uTransform.value as THREE.Matrix4;
    // Per render, from the camera drawing: each eye of a stereo pair has its own.
    this.object.onBeforeRender = (_renderer, _scene, camera) => {
      transform.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.object.matrixWorld);
    };
  }

  /** Advance the particles and send the GPU the one slot that changed. */
  update(seconds: number): void {
    const { count, slots } = this.particles.options;
    this.particles.step(Math.min(seconds, MAX_STEP_SECONDS));
    const head = this.particles.head;
    this.points.addUpdateRange(head * count * POINT_STRIDE, count * POINT_STRIDE);
    // Slot 0 is kept twice (see WindParticles.buffer).
    if (head === 0) this.points.addUpdateRange(slots * count * POINT_STRIDE, count * POINT_STRIDE);
    this.points.needsUpdate = true;
    this.material.uniforms.uHead.value = head;
    this.material.uniforms.uPhase.value = this.particles.phase;
  }

  setResolution(widthCss: number, heightCss: number): void {
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(widthCss, heightCss);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.rampTexture.dispose();
  }
}

export async function createWindLayer(context: LayerContext, level: Extract<GfsSnapshotField, 'wind-10m' | 'wind-250hpa'>): Promise<LayerInstance> {
  const style = WIND_STYLES[level];
  const sets: { particles: WindParticles; trails: WindTrails }[] = [];
  const governor = new LoadGovernor(undefined, undefined, 1 / SETS, 1 / SETS);
  let resolution: [number, number] | null = null;
  let visible = false;
  let drawn = SETS;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const show = (): void => sets.forEach((set, i) => (set.trails.object.visible = visible && i < drawn));

  const watcher = new ProductWatcher(gfsFieldSource(context, level), cacheStore(), {
    refreshMs: 30 * 60_000,
    // A forecast file every three hours: the nearest is at most 1.5 h from now.
    freshMs: 3 * 3_600_000,
    now: context.now,
    setStatus: context.setStatus,
    onProduct(product) {
      const field: WindField = { u: product.value[0], v: product.value[1] };
      if (sets.length > 0) {
        for (const set of sets) set.particles.setField(field);
        return;
      }
      const count = Math.round((particleBudget(coarse) * style.particleShare) / SETS);
      for (let i = 0; i < SETS; i++) {
        const particles = new WindParticles(field, {
          count,
          slots: SLOTS,
          slotSeconds: SLOT_SECONDS,
          radiansPerMsPerSecond: ((style.degreesPerSecondAt10Ms / 10) * Math.PI) / 180,
          lifeSeconds: [2.5, 7],
        });
        const trails = new WindTrails(particles, style, context.skyUniforms.uObserverUp, `${level}-${i}`, context.skyUniforms.uPixelRatio.value);
        if (resolution) trails.setResolution(...resolution);
        context.earthRoot.add(trails.object);
        sets.push({ particles, trails });
      }
      show();
    },
  });
  await watcher.start();

  return {
    setVisible(next) {
      visible = next;
      show();
    },
    update(frame) {
      watcher.tick();
      const keep = Math.round(governor.sample(frame.deltaMs) * SETS);
      if (keep !== drawn) {
        drawn = keep;
        show();
      }
      for (let i = 0; i < drawn && i < sets.length; i++) sets[i].trails.update(frame.deltaMs / 1000);
    },
    setResolution(widthCss, heightCss) {
      resolution = [widthCss, heightCss];
      for (const set of sets) set.trails.setResolution(widthCss, heightCss);
    },
    dispose() {
      watcher.stop();
      for (const set of sets) set.trails.dispose();
    },
  };
}
