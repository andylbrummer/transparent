import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { MARKER_SDF_GLSL, MARKER_SHAPES, buildGeoMarkerBuffers, ecefAtAltitude, groundCircleSegments } from './geo-markers';

describe('ecefAtAltitude', () => {
  it('puts longitude 0 on +x, 90°E on +y and the north pole on +z', () => {
    const p = new THREE.Vector3();
    expect(ecefAtAltitude(0, 0, 0, p).toArray()[0]).toBeCloseTo(EARTH_RADIUS_M, 3);
    expect(ecefAtAltitude(90, 0, 0, p).y).toBeCloseTo(EARTH_RADIUS_M, 3);
    expect(ecefAtAltitude(0, 90, 0, p).z).toBeCloseTo(EARTH_RADIUS_M, 3);
    expect(ecefAtAltitude(12, 34, -10_000, p).length()).toBeCloseTo(EARTH_RADIUS_M - 10_000, 3);
  });
});

describe('buildGeoMarkerBuffers', () => {
  it('keeps the order given and writes colour as display channels', () => {
    const buffers = buildGeoMarkerBuffers([
      { lon: 0, lat: 0, shape: 'triangle', color: 0xff8000, sizePx: 9 },
      { lon: 90, lat: 0, shape: 'ring', color: 0x000000, sizePx: 7, alpha: 0.5 },
    ]);
    expect(Array.from(buffers.colors.slice(0, 4))).toEqual([1, 128 / 255, 0, 1].map(Math.fround));
    expect(buffers.colors[7]).toBe(0.5);
    expect(Array.from(buffers.styles)).toEqual([9, MARKER_SHAPES.indexOf('triangle'), 7, MARKER_SHAPES.indexOf('ring')]);
    expect(buffers.positions[4]).toBeCloseTo(EARTH_RADIUS_M, 0);
  });
});

describe('the marker shapes', () => {
  /** MARKER_SDF_GLSL's branches, by hand. */
  function distance(x: number, y: number, shape: number): number {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (shape === 0) return Math.hypot(x, y) - 0.86;
    if (shape === 1) return Math.max(ax * 0.8660254 + y * 0.5 - 0.46, -y - 0.72);
    if (shape === 2) return Math.abs(Math.hypot(x, y) - 0.7) - 0.16;
    if (shape === 3) return (ax + ay - 0.92) * 0.7071;
    if (shape === 4) return Math.max(ax, ay) - 0.72;
    if (shape === 5) return (Math.sqrt(ax) + Math.sqrt(ay) - 0.98) * 0.5;
    return Math.min(Math.max(ax - 0.24, ay - 0.9), Math.max(ay - 0.24, ax - 0.9));
  }

  it('has one branch per shape, in MARKER_SHAPES order', () => {
    expect(MARKER_SDF_GLSL.match(/if \(shape < /g)).toHaveLength(MARKER_SHAPES.length - 1);
    expect(MARKER_SDF_GLSL).toContain('length(p) - 0.86');
    expect(MARKER_SDF_GLSL).toContain('abs(length(p) - 0.7) - 0.16');
  });

  it('fit their box, and all but the ring are solid at the centre', () => {
    MARKER_SHAPES.forEach((shape, index) => {
      for (const [x, y] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        expect(distance(x, y, index)).toBeGreaterThan(0);
      }
      if (shape === 'ring') expect(distance(0, 0, index)).toBeGreaterThan(0);
      else expect(distance(0, 0, index)).toBeLessThan(0);
    });
  });

  it('points the triangle up: solid above the centre, base at the bottom', () => {
    expect(distance(0, 0.8, 1)).toBeLessThan(0);
    expect(distance(0.7, 0.6, 1)).toBeGreaterThan(0);
    expect(distance(0.7, -0.6, 1)).toBeLessThan(0);
    expect(distance(0, -0.8, 1)).toBeGreaterThan(0);
  });
});

describe('groundCircleSegments', () => {
  it('closes the circle and holds its radius along the ground, at a pole too', () => {
    for (const [lon, lat] of [
      [27.5, -27],
      [0, 90],
    ]) {
      const out: number[] = [];
      groundCircleSegments(lon, lat, 125, 32, out);
      expect(out).toHaveLength(32 * 6);
      for (let k = 0; k < 3; k++) expect(out[out.length - 3 + k]).toBeCloseTo(out[k], 3);
      const centre = ecefAtAltitude(lon, lat, 0, new THREE.Vector3());
      const point = new THREE.Vector3();
      for (let i = 0; i < out.length; i += 3) {
        point.fromArray(out, i);
        expect((point.angleTo(centre) * EARTH_RADIUS_M) / 1000).toBeCloseTo(125, 2);
      }
    }
  });
});
