import { describe, it, expect } from 'vitest';
import { GFS_NI, GFS_NJ } from '../weather/gfs';
import { rampColor } from '../weather/ramps';
import { sampleWind } from '../weather/wind-field';
import { CURRENT_STYLE, STILL_WATER_MS, currentLabels, decodeCurrentField, periodText } from './currents';
import oceanCurrents, { CURRENT_DEGREES_PER_SECOND_AT_1_MS, CURRENT_RAMP } from './layer';

const GRID = { ni: 360, nj: 181, latFirst: 90, latStep: -1, lonFirst: 0, lonStep: 1 };

describe('decodeCurrentField', () => {
  const size = GFS_NI * GFS_NJ;
  const bytes = new Int8Array(2 * size);
  // The Gulf Stream's node off Cape Hatteras, 36°N 74°W: +0.59 m/s east, +0.56 m/s north in the baked file.
  const node = (90 - 36) * GFS_NI + (360 - 74);
  bytes[node] = 59;
  bytes[size + node] = 56;
  const field = decodeCurrentField(bytes.buffer, { scale: 0.01, grid: GRID });

  it('reads eastward then northward grids in m/s, on the wind particles’ grid', () => {
    const out = new Float32Array(2);
    sampleWind(field, 36, -74, out);
    expect(out[0]).toBeCloseTo(0.59, 5);
    expect(out[1]).toBeCloseTo(0.56, 5);
    sampleWind(field, 36, 74, out);
    expect(Array.from(out)).toEqual([0, 0]);
  });

  it('refuses a file of the wrong size or grid', () => {
    expect(() => decodeCurrentField(new ArrayBuffer(10), { scale: 0.01, grid: GRID })).toThrow(/bytes/);
    expect(() => decodeCurrentField(bytes.buffer, { scale: 0.01, grid: { ...GRID, lonFirst: -180 } })).toThrow(/1° grid/);
  });
});

describe('the current style', () => {
  it('runs the animation at the pace the caption states: 1 s is about 13 days', () => {
    expect(CURRENT_STYLE.degreesPerSecondAt10Ms).toBe(10 * CURRENT_DEGREES_PER_SECOND_AT_1_MS);
    // 10° of arc is 1112 km: at 1 m/s that takes 12.9 days.
    const days = (CURRENT_DEGREES_PER_SECOND_AT_1_MS * 111_195) / 86_400;
    expect(days).toBeCloseTo(12.9, 1);
    expect(oceanCurrents.caption).toContain('1 s of animation ≈ 13 days of drift');
  });

  it('treats as still only water slower than the file can tell from none', () => {
    // One code is 1 cm/s: a node with any motion in it has at least that.
    expect(STILL_WATER_MS).toBeLessThan(0.01);
    expect(STILL_WATER_MS).toBeGreaterThan(0);
  });

  it('brightens with speed', () => {
    const luma = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luma(rampColor(CURRENT_RAMP, 0.6))).toBeGreaterThan(luma(rampColor(CURRENT_RAMP, 0.1)));
    expect(luma(rampColor(CURRENT_RAMP, 0.1))).toBeGreaterThan(luma(rampColor(CURRENT_RAMP, 0)));
  });
});

describe('labels and status', () => {
  it('names a current where the source places it', () => {
    const [gulf] = currentLabels({ names: [{ name: 'Gulf Stream', lon: -70, lat: 35 }] });
    expect(gulf.text).toBe('Gulf Stream');
    // 70°W: x positive, y negative.
    expect(gulf.position.x).toBeGreaterThan(0);
    expect(gulf.position.y).toBeLessThan(0);
    expect(gulf.position.z).toBeGreaterThan(0);
  });

  it('says what span the mean covers', () => {
    expect(periodText(['2011-12-06', '2014-09-16'])).toMatch(/^Dec 2011 – Sept? 2014$/);
  });
});

describe('the ocean current layer', () => {
  it('is a surface layer, off until asked for, and says it is a mean and not today', () => {
    expect(oceanCurrents.id).toBe('ocean-currents');
    expect(oceanCurrents.section).toBe('Surface');
    expect(oceanCurrents.defaultOn).toBeUndefined();
    expect(oceanCurrents.label).toContain('mean');
    expect(oceanCurrents.caption).toContain('not today’s currents');
  });
});
