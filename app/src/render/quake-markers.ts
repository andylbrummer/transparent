/**
 * Ring markers for earthquakes singled out from the catalogue's dots: the
 * recent ones from the live feed, and the notable ones.
 *
 * A marker is a ring in its depth's colour (DEPTH_RAMP, as the dots) around
 * a faint fill, sized by magnitude in screen pixels and placed at the
 * hypocentre exactly as a catalogue dot is. Each carries its origin time:
 * a marker whose earthquake lies in the app clock's future is not drawn,
 * one from the last `pulseWindowS` sends out a fading ripple, and rings
 * dim with age down to `oldestAlpha` at `fadeOverS`.
 */

import * as THREE from 'three';
import { depthColor, ecefAtDepth } from './interior';
import { RENDER_ORDER } from './order';

/** One marker: where, when, how big. */
export interface QuakeMarker {
  readonly lon: number;
  readonly lat: number;
  /** Kilometres below sea level; an event above it is drawn at the surface. */
  readonly depthKm: number;
  readonly mag: number;
  /** Origin time, epoch ms. */
  readonly timeMs: number;
}

export interface QuakeMarkerOptions {
  readonly name: string;
  /** Ring diameter in CSS px for a magnitude. */
  readonly sizePx: (magnitude: number) => number;
  /** Events younger than this ripple. 0: none do. */
  readonly pulseWindowS: number;
  /** Age at which a ring has dimmed to `oldestAlpha`. Infinity: no dimming. */
  readonly fadeOverS: number;
  readonly oldestAlpha: number;
  /** Thickness of the ring's line, CSS px. */
  readonly ringWidthPx: number;
  /** Shared by reference with the app's other point layers. */
  readonly pixelRatio: { value: number };
}

/** A ripple grows to this many ring diameters. */
export const PULSE_SCALE = 2.6;
const PULSE_PERIOD_S = 2.4;

export interface QuakeMarkerBuffers {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  /** Seconds after `epochMs`: Float32 keeps a second's precision over 190 days. */
  readonly times: Float32Array;
  readonly epochMs: number;
}

/** Vertex buffers for a set of markers, in drawing order: the greatest last, on top. */
export function buildQuakeMarkerBuffers(
  markers: readonly QuakeMarker[],
  sizePx: (magnitude: number) => number
): QuakeMarkerBuffers {
  const ordered = [...markers].sort((a, b) => a.mag - b.mag || a.timeMs - b.timeMs);
  const epochMs = ordered.reduce((min, m) => Math.min(min, m.timeMs), Infinity);
  const positions = new Float32Array(ordered.length * 3);
  const colors = new Float32Array(ordered.length * 3);
  const sizes = new Float32Array(ordered.length);
  const times = new Float32Array(ordered.length);
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  ordered.forEach((marker, i) => {
    const depthKm = Math.max(0, marker.depthKm);
    ecefAtDepth(marker.lon, marker.lat, depthKm, point).toArray(positions, i * 3);
    depthColor(depthKm, color).toArray(colors, i * 3);
    sizes[i] = sizePx(marker.mag);
    times[i] = (marker.timeMs - epochMs) / 1000;
  });
  return { positions, colors, sizes, times, epochMs: Number.isFinite(epochMs) ? epochMs : 0 };
}

const VERTEX_SHADER = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aTime;
  uniform float uPixelRatio;
  uniform float uNow;
  uniform float uPulseWindow;
  uniform float uFadeOver;
  uniform float uOldestAlpha;
  uniform float uPulseClock;
  varying vec3 vColor;
  varying float vRingPx;
  varying float vSpritePx;
  varying float vPhase;
  varying float vFade;
  void main() {
    vColor = aColor;
    float age = uNow - aTime;
    float recent = step(age, uPulseWindow) * step(0.0001, uPulseWindow);
    vRingPx = aSize * uPixelRatio;
    vSpritePx = vRingPx * mix(1.0, ${PULSE_SCALE.toFixed(1)}, recent) + 2.0;
    // Each ripple keeps its own beat, so a swarm does not flash in unison.
    vPhase = recent > 0.5 ? fract(uPulseClock / ${PULSE_PERIOD_S.toFixed(1)} + fract(aTime * 0.618)) : -1.0;
    vFade = mix(1.0, uOldestAlpha, clamp(age / uFadeOver, 0.0, 1.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = vSpritePx;
    // Not yet happened on the app clock: off the screen.
    if (age < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform float uPixelRatio;
  uniform float uRingWidth;
  varying vec3 vColor;
  varying float vRingPx;
  varying float vSpritePx;
  varying float vPhase;
  varying float vFade;
  void main() {
    // Distance from the hypocentre, device pixels.
    float d = length(gl_PointCoord - 0.5) * vSpritePx;
    // Half the line's width, with half a pixel of soft edge either side.
    float halfLine = 0.5 * uRingWidth * uPixelRatio;
    float ringRadius = vRingPx * 0.5 - halfLine;
    float ring = 1.0 - smoothstep(halfLine - 0.5, halfLine + 0.5, abs(d - ringRadius));
    float fill = 0.22 * (1.0 - smoothstep(ringRadius - 1.0, ringRadius, d));
    float ripple = 0.0;
    if (vPhase >= 0.0) {
      float rippleRadius = mix(ringRadius, vSpritePx * 0.5 - halfLine - 1.0, vPhase);
      ripple = 0.85 * (1.0 - vPhase) * (1.0 - smoothstep(halfLine - 0.5, halfLine + 0.5, abs(d - rippleRadius)));
    }
    float alpha = max(max(ring, fill), ripple) * vFade;
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
  }
`;

export class QuakeMarkers {
  readonly object: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private epochMs = 0;
  private pulseClockS = 0;

  constructor(private readonly options: QuakeMarkerOptions) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uPixelRatio: options.pixelRatio,
        uNow: { value: 0 },
        uPulseWindow: { value: options.pulseWindowS },
        uFadeOver: { value: Number.isFinite(options.fadeOverS) ? options.fadeOverS : 1e30 },
        uOldestAlpha: { value: options.oldestAlpha },
        uRingWidth: { value: options.ringWidthPx },
        uPulseClock: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.object.name = options.name;
    this.object.frustumCulled = false;
    // Over the catalogue's dots.
    this.object.renderOrder = RENDER_ORDER.quakes + 0.1;
  }

  /** Replace the markers shown. */
  setMarkers(markers: readonly QuakeMarker[]): void {
    const buffers = buildQuakeMarkerBuffers(markers, this.options.sizePx);
    this.epochMs = buffers.epochMs;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(buffers.colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(buffers.sizes, 1));
    geometry.setAttribute('aTime', new THREE.BufferAttribute(buffers.times, 1));
    this.object.geometry.dispose();
    this.object.geometry = geometry;
  }

  /** Move to the app clock's instant; `deltaMs` of wall time drives the ripples. */
  update(nowMs: number, deltaMs: number): void {
    this.material.uniforms.uNow.value = (nowMs - this.epochMs) / 1000;
    // Wrapped at a whole number of periods, so Float32 never runs out of phase.
    this.pulseClockS = (this.pulseClockS + Math.min(deltaMs, 250) / 1000) % (PULSE_PERIOD_S * 1000);
    this.material.uniforms.uPulseClock.value = this.pulseClockS;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
