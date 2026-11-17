import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { earthPoint } from './earth-point';

describe('earthPoint', () => {
  it('puts the equator at the prime meridian on +x', () => {
    expect(earthPoint(0, 0).toArray()).toEqual([EARTH_RADIUS_M, 0, 0]);
  });

  it('puts the equator at 90° east on +y', () => {
    const point = earthPoint(0, 90);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBe(EARTH_RADIUS_M);
    expect(point.z).toBe(0);
  });

  it('puts the north pole on +z', () => {
    const point = earthPoint(90, 0);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBe(0);
    expect(point.z).toBe(EARTH_RADIUS_M);
  });

  it('goes down by the depth, to the centre at the full radius', () => {
    expect(earthPoint(0, 0, 2600).length()).toBe(EARTH_RADIUS_M - 2_600_000);
    expect(earthPoint(-33.9, 151.2, EARTH_RADIUS_M / 1000).length()).toBeCloseTo(0, 6);
  });

  it('lands on a sphere, not the WGS84 ellipsoid', () => {
    expect(earthPoint(51.5, -0.1).length()).toBeCloseTo(EARTH_RADIUS_M, 6);
  });

  it('takes no depth as the surface', () => {
    expect(earthPoint(-33.9, 151.2).toArray()).toEqual(earthPoint(-33.9, 151.2, 0).toArray());
  });
});
