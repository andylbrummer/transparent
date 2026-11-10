import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import {
  DEPTH_RAMP,
  DEPTH_RAMP_GLSL,
  FLOW_LEVEL_COLOR,
  FLOW_RISING_COLOR,
  FLOW_SINKING_COLOR,
  MantleFlowLayer,
  PlumeLayer,
  depthColor,
  depthRampGradient,
  ecefAtDepth,
  flowColor,
} from './interior';

/** Segment endpoints of a fat-line object, as [start, end] vectors. */
function segments(lines: THREE.Object3D): [THREE.Vector3, THREE.Vector3][] {
  const geometry = (lines as LineSegments2).geometry;
  const start = geometry.getAttribute('instanceStart');
  const end = geometry.getAttribute('instanceEnd');
  const out: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < start.count; i++) {
    out.push([
      new THREE.Vector3(start.getX(i), start.getY(i), start.getZ(i)),
      new THREE.Vector3(end.getX(i), end.getY(i), end.getZ(i)),
    ]);
  }
  return out;
}

const lonOf = (v: THREE.Vector3): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const depthKmOf = (v: THREE.Vector3): number => (EARTH_RADIUS_M - v.length()) / 1000;

/** The colour a CSS linear-gradient through DEPTH_RAMP shows at a depth: display channels blended between stops. */
function legendColor(depthKm: number): [number, number, number] {
  const last = DEPTH_RAMP.length - 1;
  const clamped = Math.min(Math.max(depthKm, DEPTH_RAMP[0].depthKm), DEPTH_RAMP[last].depthKm);
  let i = 1;
  while (i < last && DEPTH_RAMP[i].depthKm < clamped) i++;
  const t = (clamped - DEPTH_RAMP[i - 1].depthKm) / (DEPTH_RAMP[i].depthKm - DEPTH_RAMP[i - 1].depthKm);
  const channel = (shift: number): number => {
    const a = (DEPTH_RAMP[i - 1].color >> shift) & 0xff;
    const b = (DEPTH_RAMP[i].color >> shift) & 0xff;
    return a + (b - a) * t;
  };
  return [channel(16), channel(8), channel(0)];
}

/** Run DEPTH_RAMP_GLSL's body by hand: a chain of `color = mix(color, vec3(..), clamp((depthKm - a) / b, 0.0, 1.0));`. */
function glslRampColor(depthKm: number): [number, number, number] {
  const first = /vec3 color = vec3\(([^)]+)\);/.exec(DEPTH_RAMP_GLSL);
  if (!first) throw new Error('no starting colour in DEPTH_RAMP_GLSL');
  let color = first[1].split(',').map(Number);
  const steps = [...DEPTH_RAMP_GLSL.matchAll(/color = mix\(color, vec3\(([^)]+)\), clamp\(\(depthKm - ([\d.]+)\) \/ ([\d.]+), 0\.0, 1\.0\)\);/g)];
  for (const [, rgb, from, span] of steps) {
    const t = Math.min(Math.max((depthKm - Number(from)) / Number(span), 0), 1);
    color = color.map((c, k) => c + (Number(rgb.split(',')[k]) - c) * t);
  }
  return [color[0] * 255, color[1] * 255, color[2] * 255];
}

describe('depthColor', () => {
  it('hits each ramp stop', () => {
    const color = new THREE.Color();
    for (const stop of DEPTH_RAMP) expect(depthColor(stop.depthKm, color).getHex()).toBe(stop.color);
  });

  it('clamps above and below the ramp', () => {
    const color = new THREE.Color();
    expect(depthColor(-5, color).getHex()).toBe(DEPTH_RAMP[0].color);
    expect(depthColor(2000, color).getHex()).toBe(DEPTH_RAMP[DEPTH_RAMP.length - 1].color);
  });

  it('draws the same ramp as a CSS legend', () => {
    expect(depthRampGradient(700)).toBe(
      'linear-gradient(to right, #ff453a 0.0%, #ff9f0a 10.0%, #ffd60a 21.4%, #32d74b 42.9%, #0a84ff 71.4%, #bf5af2 100.0%)'
    );
  });

  it('shows, at every depth, the colour the legend bar shows there', () => {
    const color = new THREE.Color();
    const shown = new THREE.Color();
    let worst = 0;
    for (let depthKm = -10; depthKm <= 720; depthKm += 1) {
      const legend = legendColor(depthKm);
      // What reaches the screen: THREE.Color is linear, the canvas is sRGB.
      depthColor(depthKm, color).getRGB(shown, THREE.SRGBColorSpace);
      const drawn = [shown.r * 255, shown.g * 255, shown.b * 255];
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(drawn[k] - legend[k]));
    }
    // Under half a step of an 8-bit channel: the same pixel value.
    expect(worst).toBeLessThan(0.5);
  });

  it('is brighter between stops than a blend of linear light would be dark', () => {
    // 35 km, half way from red #ff453a to orange #ff9f0a: the legend shows green 0x72.
    const shown = depthColor(35, new THREE.Color()).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
    expect(Math.round(shown.g * 255)).toBe(0x72);
  });
});

describe('DEPTH_RAMP_GLSL', () => {
  it('gives a shader the legend colours too, as display values', () => {
    expect([...DEPTH_RAMP_GLSL.matchAll(/color = mix\(/g)]).toHaveLength(DEPTH_RAMP.length - 1);
    let worst = 0;
    for (let depthKm = -10; depthKm <= 720; depthKm += 1) {
      const legend = legendColor(depthKm);
      const glsl = glslRampColor(depthKm);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(glsl[k] - legend[k]));
    }
    expect(worst).toBeLessThan(0.5);
  });
});

describe('PlumeLayer', () => {
  it('draws the imaged conduit solid and its possible reach faint, below the hotspot', () => {
    const layer = new PlumeLayer([
      { name: 'Reunion', lon: 56, lat: -21, rootLon: 56, rootLat: -21, depthKm: 1000, possibleDepthKm: 2891 },
      { name: 'Eifel', lon: 4, lat: 50, rootLon: 4, rootLat: 50, depthKm: 660 },
    ]);
    const [imaged, possible] = layer.getObject().children as LineSegments2[];
    const solid = segments(imaged);
    expect(solid).toHaveLength(2);
    expect(depthKmOf(solid[0][0])).toBeCloseTo(0, 3);
    expect(depthKmOf(solid[0][1])).toBeCloseTo(1000, 3);
    expect(depthKmOf(solid[1][1])).toBeCloseTo(660, 3);
    expect(lonOf(solid[0][1])).toBeCloseTo(56, 4);

    const faint = segments(possible);
    expect(faint).toHaveLength(1);
    expect(depthKmOf(faint[0][0])).toBeCloseTo(1000, 3);
    expect(depthKmOf(faint[0][1])).toBeCloseTo(2891, 3);
    expect((possible.material as { opacity: number }).opacity).toBeLessThan(
      (imaged.material as { opacity: number }).opacity
    );
    layer.dispose();
  });

  it('leans a conduit toward an off-axis root', () => {
    const layer = new PlumeLayer([
      { name: 'Hawaii', lon: -155, lat: 19, rootLon: -162, rootLat: 20, depthKm: 2891 },
    ]);
    const [[top, bottom]] = segments(layer.getObject().children[0]);
    expect(lonOf(top)).toBeCloseTo(-155, 4);
    expect(lonOf(bottom)).toBeCloseTo(-162, 4);
    expect(bottom.distanceTo(ecefAtDepth(-162, 20, 2891, new THREE.Vector3()))).toBeLessThan(1);
    expect(layer.getObject().children).toHaveLength(1);
    layer.dispose();
  });
});

describe('MantleFlowLayer', () => {
  const shell = (east10: number, north10: number, up10: number) => ({
    depthKm: 1450,
    lon: [0],
    lat: [0],
    east10: [east10],
    north10: [north10],
    up10: [up10],
  });

  it('draws an arrow from its point at depth along the flow, as far as arrowMyr carries it', () => {
    // 20 mm/yr east for 5 Myr: 100 km along +y at (0, 0).
    const layer = new MantleFlowLayer({ quantumPerDegree: 100, arrowMyr: 5, shells: [shell(200, 0, 0)] });
    const [shaft, ...barbs] = segments(layer.getObject().children[0]);
    const r = EARTH_RADIUS_M - 1450e3;
    expect(shaft[0].x).toBeCloseTo(r, 0);
    expect(shaft[1].clone().sub(shaft[0]).y).toBeCloseTo(100e3, 0);
    expect(barbs).toHaveLength(2);
    for (const [from, to] of barbs) {
      expect(from.distanceTo(shaft[1])).toBeCloseTo(0, 0);
      // Barbs point back toward the base.
      expect(to.y).toBeLessThan(shaft[1].y);
    }
    layer.dispose();
  });

  it('tilts a rising arrow outward', () => {
    const layer = new MantleFlowLayer({ quantumPerDegree: 100, arrowMyr: 5, shells: [shell(0, 0, 100)] });
    const [shaft] = segments(layer.getObject().children[0]);
    expect(shaft[1].x - shaft[0].x).toBeCloseTo(50e3, 0);
    layer.dispose();
  });

  it('colours by vertical motion, saturating at 10 mm/yr', () => {
    const c = new THREE.Color();
    expect(flowColor(0, c).getHex()).toBe(FLOW_LEVEL_COLOR);
    expect(flowColor(25, c).getHex()).toBe(FLOW_RISING_COLOR);
    expect(flowColor(-10, c).getHex()).toBe(FLOW_SINKING_COLOR);
  });
});
