import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { axisAngleDeg, decodeRays, medianResidual, raySegments, RESIDUAL_RAMP, type InnerCoreData } from './rays';
import { rampColor } from '../weather/ramps';
import definition from './layer';

const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/inner-core.json'))) as InnerCoreData;
const rays = decodeRays(data);

describe('the baked rays', () => {
  it('are the 5,129 with a residual, from six source sets, all turning inside the inner core', () => {
    expect(rays).toHaveLength(5129);
    expect(new Set(rays.map((r) => r.study)).size).toBe(6);
    for (const ray of rays) {
      expect(ray.turnDepthKm).toBeGreaterThan(6371 - data.innerCoreRadiusKm);
      expect(ray.turnDepthKm).toBeLessThan(6371);
    }
    expect(rays.filter((r) => r.bcDf)).toHaveLength(1580);
  });

  it('show the anisotropy: near the axis early, along the equator not', () => {
    expect(medianResidual(rays, 0, 35)).toBeGreaterThan(2.5);
    expect(Math.abs(medianResidual(rays, 55, 91))).toBeLessThan(0.5);
  });
});

describe('the angle to the axis', () => {
  const ray = { entryLon: 0, entryLat: 0, exitLon: 0, exitLat: 0, turnDepthKm: 6000, residualS: 0, bcDf: false, study: '' };
  it('is 0 for a ray from pole to pole and 90 along the equator', () => {
    expect(axisAngleDeg({ ...ray, entryLat: 60, exitLat: -60 })).toBeCloseTo(0, 6);
    expect(axisAngleDeg({ ...ray, entryLon: -30, exitLon: 30 })).toBeCloseTo(90, 6);
  });
});

describe('the drawing', () => {
  it('is two legs per ray through its turning point, then the axis', () => {
    const one = raySegments([{ entryLon: -30, entryLat: 0, exitLon: 30, exitLat: 0, turnDepthKm: 5300, residualS: 4, bcDf: true, study: '' }], 1221.5, 6371);
    expect(one.positions).toHaveLength(3 * 6);
    // The turning point, under the middle of the chord at 5,300 km down.
    expect(one.positions[3]).toBeCloseTo(1071e3, -1);
    expect(one.positions[4]).toBeCloseTo(0, 3);
    // Early is blue.
    expect(one.colors[2]).toBeGreaterThan(one.colors[0]);
    expect(one.positions[14]).toBeCloseTo(1221.5e3, -1);
  });

  it('colours nothing a dim grey, early blue and late red', () => {
    const [r, g, b] = rampColor(RESIDUAL_RAMP, 0);
    expect(Math.max(r, g, b)).toBeLessThan(100);
    const early = rampColor(RESIDUAL_RAMP, 4);
    expect(early[2]).toBeGreaterThan(early[0]);
    const late = rampColor(RESIDUAL_RAMP, -3);
    expect(late[0]).toBeGreaterThan(late[2]);
  });
});

describe('the switch', () => {
  it('is off, inside the Earth, crediting Frost et al. under CC BY', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Inside the Earth');
    expect(definition.credits[0].licence).toBe('CC BY 4.0');
    expect(definition.caption).toContain('5,129');
  });
});
