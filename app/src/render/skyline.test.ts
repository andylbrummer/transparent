import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { ElevationMosaic, TILE_PX, skylineProfile, skylineProfileSliced, terrariumMetres, tileBlock, tileXY } from './skyline';

const DEG = Math.PI / 180;

describe('the terrarium encoding', () => {
  it('decodes sea level and a summit', () => {
    expect(terrariumMetres(128, 0, 0)).toBe(0);
    expect(terrariumMetres(128 + 34, 140, 128)).toBeCloseTo(8844.5, 6);
  });
});

describe('the tiles', () => {
  it('puts lat 0, lon 0 at the middle of the world', () => {
    const xy = tileXY(0, 0, 3);
    expect(xy.x).toBe(4);
    expect(xy.y).toBeCloseTo(4, 9);
  });

  it('covers a radius with a block around the point', () => {
    const block = tileBlock(30.27, -97.74, 8, 160_000);
    const here = tileXY(30.27, -97.74, 8);
    expect(here.x).toBeGreaterThan(block.x0);
    expect(here.x).toBeLessThan(block.x0 + block.cols);
    expect(here.y).toBeGreaterThan(block.y0);
    expect(here.y).toBeLessThan(block.y0 + block.rows);
  });

  it('samples a mosaic where it has data and gives NaN where it doesn’t', () => {
    const block = { z: 0, x0: 0, y0: 0, cols: 1, rows: 1 };
    expect(new ElevationMosaic(block, new Float32Array(TILE_PX * TILE_PX).fill(250)).sample(10, 20)).toBeCloseTo(250, 6);
    expect(new ElevationMosaic(block, new Float32Array(TILE_PX * TILE_PX).fill(NaN)).sample(10, 20)).toBeNaN();
  });
});

describe('the skyline', () => {
  it('stays at the floor over flat land and over the sea', () => {
    // Flat land with refraction tops out at about −0.00064 rad (at ~4.7 km), under a floor of 0.
    const floor = 0;
    for (const height of [0, -4000]) {
      const profile = skylineProfile(() => height, 0, 0, { bins: 8, floorRad: floor });
      expect(Array.from(profile).every((a) => Math.abs(a - floor) < 1e-7)).toBe(true);
    }
  });

  it('rises toward a ridge to the east and only there', () => {
    // A 1,000 m wall from 10 km east onward.
    const ridge = (_lat: number, lon: number): number => (lon * DEG * EARTH_RADIUS_M > 10_000 ? 1000 : 0);
    const profile = skylineProfile(ridge, 0, 0, { bins: 4, maxDistanceM: 20_000 });
    const nearest = Math.atan2(1000 - 1.5, 10_000);
    expect(profile[1]).toBeGreaterThan(nearest - 0.01);
    expect(profile[1]).toBeLessThan(nearest + 0.001);
    expect(profile[0]).toBe(0);
    expect(profile[3]).toBe(0);
  });

  it('comes out the same a slice at a time', async () => {
    const hills = (lat: number, lon: number): number => 800 * Math.sin(lat * 40) * Math.cos(lon * 30);
    const whole = skylineProfile(hills, 10, 20, { bins: 36, maxDistanceM: 30_000 });
    expect(await skylineProfileSliced(hills, 10, 20, { bins: 36, maxDistanceM: 30_000 }, 5)).toEqual(whole);
  });
});
