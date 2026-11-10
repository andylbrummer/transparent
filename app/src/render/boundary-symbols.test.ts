import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import {
  OutlineLayer,
  RIDGE_RIBBON_FRAGMENT_SHADER,
  SPREADING_RAMP,
  SPREADING_RIBBON_MYR,
  TRENCH_TOOTH_KM,
  ridgeRibbon,
  spreadingArrows,
  spreadingRampGradient,
  trenchTeeth,
} from './outlines';

const point = (values: ArrayLike<number>, index: number): THREE.Vector3 =>
  new THREE.Vector3(values[index * 3], values[index * 3 + 1], values[index * 3 + 2]);
const lonOf = (v: THREE.Vector3): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const latOf = (v: THREE.Vector3): number => (Math.asin(v.z / v.length()) * 180) / Math.PI;
const KM_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180 / 1000;

/** A ridge running north along 30 W from the equator to 4 N, opening east-west (azimuth 90) at 100 mm/yr. */
const RIDGE = [[-3000, 0, 0, 200, 0, 200]];
const STEPS = { rate10: [[1000, 1000]], azimuth: [[90, 90]] };

describe('ridgeRibbon', () => {
  const ribbon = ridgeRibbon(RIDGE, STEPS, 100, 4);

  it('reaches as far to either side as the plates part in the time given, along their motion', () => {
    // 100 mm/yr for 4 Myr is 400 km: 200 km to each side.
    expect(ribbon.positions).toHaveLength(3 * 3 * 3);
    for (let i = 0; i < 3; i++) {
      const [left, axis, right] = [0, 1, 2].map((k) => point(ribbon.positions, i * 3 + k).add(point(ribbon.offsets, i * 3 + k)));
      expect(lonOf(axis)).toBeCloseTo(-30, 5);
      expect(latOf(axis)).toBeCloseTo(i * 2, 5);
      expect(axis.length()).toBeCloseTo(EARTH_RADIUS_M, -1);
      // Heading north, left is west.
      expect(lonOf(left)).toBeLessThan(-30);
      expect(lonOf(right)).toBeGreaterThan(-30);
      expect(left.distanceTo(axis) / 1000).toBeCloseTo(200, 0);
      expect(right.distanceTo(axis) / 1000).toBeCloseTo(200, 0);
      expect(left.length()).toBeCloseTo(EARTH_RADIUS_M, -1);
    }
    expect([...ribbon.across]).toEqual([-1, 0, 1, -1, 0, 1, -1, 0, 1]);
  });

  it('keeps every vertex at the axis point, so the shader can widen a thin ribbon on screen', () => {
    for (let i = 0; i < 3; i++) {
      expect(point(ribbon.positions, i * 3).distanceTo(point(ribbon.positions, i * 3 + 1))).toBe(0);
      expect(point(ribbon.offsets, i * 3 + 1).length()).toBe(0);
    }
  });

  it('carries the spreading rate in mm/yr and joins the points into a strip', () => {
    expect([...ribbon.rates]).toEqual(new Array(9).fill(100));
    // Two steps, each two quads of two triangles.
    expect(ribbon.indices).toHaveLength(2 * 12);
    expect(Math.max(...ribbon.indices)).toBe(8);
  });

  it('is half as wide where the plates part half as fast', () => {
    const slowing = ridgeRibbon(RIDGE, { rate10: [[1000, 500]], azimuth: [[90, 90]] }, 100, 4);
    const half = (i: number): number => point(slowing.offsets, i * 3).length() / 1000;
    expect(half(0)).toBeCloseTo(200, 0);
    // The middle point takes the mean of the steps either side.
    expect(half(1)).toBeCloseTo(150, 0);
    expect(half(2)).toBeCloseTo(100, 0);
    expect(slowing.rates[8]).toBe(50);
  });

  it('follows the plate motion where a ridge spreads obliquely', () => {
    // Opening toward the north-east: the edges are offset north-east and south-west, not due east and west.
    const oblique = ridgeRibbon(RIDGE, { rate10: [[1000, 1000]], azimuth: [[45, 45]] }, 100, 4);
    const left = point(oblique.positions, 0).add(point(oblique.offsets, 0));
    const right = point(oblique.positions, 2).add(point(oblique.offsets, 2));
    expect(lonOf(left)).toBeLessThan(-30);
    expect(latOf(left)).toBeLessThan(0);
    expect(lonOf(right)).toBeGreaterThan(-30);
    expect(latOf(right)).toBeGreaterThan(0);
    expect(latOf(right) * KM_PER_DEGREE).toBeCloseTo(200 * Math.SQRT1_2, 0);
  });

  it(`covers ${SPREADING_RIBBON_MYR} Myr unless told otherwise`, () => {
    const standard = ridgeRibbon(RIDGE, STEPS, 100);
    expect(point(standard.offsets, 0).length() / 1000).toBeCloseTo((100 * SPREADING_RIBBON_MYR) / 2, 0);
  });
});

describe('spreadingArrows', () => {
  it('draws a pair at the middle of a ridge piece, each pointing away from the axis', () => {
    const segments = spreadingArrows(RIDGE, STEPS, 100, 4);
    // Two arrows of a shaft and two barbs: six segments.
    expect(segments).toHaveLength(6 * 6);
    const shafts = [0, 3].map((s) => [point(segments, s * 2), point(segments, s * 2 + 1)]);
    for (const [from, to] of shafts) {
      expect(latOf(from)).toBeCloseTo(2, 1);
      // Starts on the ribbon's edge, 200 km out, and runs as far again.
      expect(Math.abs(lonOf(from) + 30) * KM_PER_DEGREE).toBeCloseTo(200, 0);
      expect(Math.abs(lonOf(to) + 30) * KM_PER_DEGREE).toBeCloseTo(400, -1);
    }
    expect(lonOf(shafts[0][1])).toBeLessThan(-30);
    expect(lonOf(shafts[1][1])).toBeGreaterThan(-30);
  });

  it('leaves a stub of ridge without arrows', () => {
    // 0.5 degrees: 56 km.
    expect(spreadingArrows([[-3000, 0, 0, 50]], { rate10: [[1000]], azimuth: [[90]] }, 100)).toHaveLength(0);
  });
});

describe('trenchTeeth', () => {
  /** A trench running north along 143 E for 6 degrees (667 km). */
  const TRENCH = [[14300, 3500, 0, 600]];

  it('spaces teeth along the trench, bases on it', () => {
    const teeth = trenchTeeth(TRENCH, [1], 100);
    const count = Math.floor((6 * KM_PER_DEGREE) / TRENCH_TOOTH_KM.spacing);
    expect(teeth).toHaveLength(count * 9);
    for (let t = 0; t < count; t++) {
      const [a, b] = [point(teeth, t * 3), point(teeth, t * 3 + 1)];
      expect(lonOf(a)).toBeCloseTo(143, 4);
      expect(lonOf(b)).toBeCloseTo(143, 4);
      expect(a.distanceTo(b) / 1000).toBeCloseTo(TRENCH_TOOTH_KM.base, 0);
      expect(latOf(a)).toBeGreaterThan(35);
      expect(latOf(b)).toBeLessThan(41);
    }
  });

  it('points them at the overriding plate: left of the line for +1, right for -1', () => {
    // Heading north, left is west - where Japan lies from its trench.
    const west = point(trenchTeeth(TRENCH, [1], 100), 2);
    expect(lonOf(west)).toBeLessThan(143);
    expect((143 - lonOf(west)) * KM_PER_DEGREE * Math.cos((latOf(west) * Math.PI) / 180)).toBeCloseTo(TRENCH_TOOTH_KM.height, 0);
    expect(west.length()).toBeCloseTo(EARTH_RADIUS_M, -1);
    const east = point(trenchTeeth(TRENCH, [-1], 100), 2);
    expect(lonOf(east)).toBeGreaterThan(143);
  });

  it('gives a trench shorter than the spacing no teeth', () => {
    expect(trenchTeeth([[14300, 3500, 0, 100]], [1], 100)).toHaveLength(0);
  });
});

describe('the spreading ramp', () => {
  it('runs from the slowest ridges to 160 mm/yr in the legend', () => {
    expect(spreadingRampGradient()).toBe(
      `linear-gradient(to right, ${SPREADING_RAMP.map(
        (stop) => `#${stop.color.toString(16).padStart(6, '0')} ${((stop.mmPerYr / 160) * 100).toFixed(1)}%`
      ).join(', ')})`
    );
  });

  it('is the ramp the ribbon draws: the same stops, as display values', () => {
    for (const stop of SPREADING_RAMP) {
      const channels = [(stop.color >> 16) & 0xff, (stop.color >> 8) & 0xff, stop.color & 0xff].map((c) => (c / 255).toFixed(5));
      expect(RIDGE_RIBBON_FRAGMENT_SHADER).toContain(`vec3(${channels.join(', ')})`);
    }
    expect(RIDGE_RIBBON_FRAGMENT_SHADER).not.toContain('colorspace_fragment');
  });
});

describe('OutlineLayer with plate-boundary symbols', () => {
  const layer = new OutlineLayer({
    encoding: 'delta',
    quantumPerDegree: 100,
    layers: { ridge: RIDGE, subduction: [[14300, 3500, 0, 600]], coastline: [[0, 0, 10, 10]] },
    ridgeSteps: STEPS,
    subductionOverriding: [1],
  });
  const children = layer.getObject().children;

  it('adds a ribbon and arrows to the ridges and teeth to the trenches', () => {
    expect(children.map((c) => c.name)).toEqual(['coastline', 'ridge', 'spreading', 'spreading', 'subduction', 'subduction']);
    for (const child of children) expect(child.frustumCulled).toBe(false);
  });

  it('draws the ribbon under the lines, and the trench over the slabs', () => {
    const order = (name: string): number[] => children.filter((c) => c.name === name).map((c) => c.renderOrder);
    expect(Math.min(...order('spreading'))).toBeLessThan(order('ridge')[0]);
    expect(Math.min(...order('spreading'))).toBeGreaterThan(0.5);
    // Slabs draw at 2, earthquakes at 3.
    for (const value of order('subduction')) {
      expect(value).toBeGreaterThan(2.01);
      expect(value).toBeLessThan(3);
    }
  });

  it('switches the spreading symbols apart from the boundary lines', () => {
    layer.setLayersVisible(['spreading'], false);
    expect(children.filter((c) => !c.visible).map((c) => c.name)).toEqual(['spreading', 'spreading']);
    layer.setLayersVisible(['spreading'], true);
    layer.setLayersVisible(['ridge', 'subduction'], false);
    expect(children.filter((c) => c.visible).map((c) => c.name)).toEqual(['coastline', 'spreading', 'spreading']);
  });

  it('tells the ribbon the viewport, for its least width in pixels', () => {
    layer.setResolution(412, 892);
    const ribbon = children.find((c) => c.name === 'spreading') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(ribbon.material.uniforms.uResolution.value.toArray()).toEqual([412, 892]);
    expect(ribbon.material.depthTest).toBe(false);
  });
});
