import { describe, it, expect } from 'vitest';
import { rampColor, rampGradient, rampStrip, TEMPERATURE_RAMP, WIND_10M_RAMP, WIND_250HPA_RAMP, type RampStop } from './ramps';

const RAMP: readonly RampStop[] = [
  [0, 0x000000],
  [10, 0xff0000],
  [30, 0xff00ff],
];

describe('rampColor', () => {
  it('gives each stop its own colour', () => {
    expect(rampColor(RAMP, 0)).toEqual([0, 0, 0]);
    expect(rampColor(RAMP, 10)).toEqual([255, 0, 0]);
    expect(rampColor(RAMP, 30)).toEqual([255, 0, 255]);
  });

  it('blends linearly between stops', () => {
    expect(rampColor(RAMP, 5)).toEqual([127.5, 0, 0]);
    expect(rampColor(RAMP, 20)).toEqual([255, 0, 127.5]);
  });

  it('holds the end colours beyond the ends', () => {
    expect(rampColor(RAMP, -50)).toEqual([0, 0, 0]);
    expect(rampColor(RAMP, 500)).toEqual([255, 0, 255]);
  });
});

describe('rampGradient', () => {
  it('places each stop by its value, so the legend is to scale', () => {
    expect(rampGradient(RAMP)).toBe('linear-gradient(to right, #000000 0%, #ff0000 33%, #ff00ff 100%)');
  });
});

describe('rampStrip', () => {
  it('samples the ramp end to end as opaque texels', () => {
    const strip = rampStrip(RAMP, 4);
    expect(Array.from(strip.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(strip.subarray(4, 8))).toEqual([255, 0, 0, 255]);
    expect(Array.from(strip.subarray(12, 16))).toEqual([255, 0, 255, 255]);
  });
});

describe('the weather ramps', () => {
  it.each([
    ['temperature', TEMPERATURE_RAMP],
    ['10 m wind', WIND_10M_RAMP],
    ['250 hPa wind', WIND_250HPA_RAMP],
  ])('%s ascends by value', (_name, ramp) => {
    for (let i = 1; i < ramp.length; i++) expect(ramp[i][0]).toBeGreaterThan(ramp[i - 1][0]);
  });

  it('puts freezing at the pale stop between the blues and the greens', () => {
    const [r, g, b] = rampColor(TEMPERATURE_RAMP, 0);
    expect(Math.min(r, g, b)).toBeGreaterThan(180);
    const cold = rampColor(TEMPERATURE_RAMP, -20);
    const warm = rampColor(TEMPERATURE_RAMP, 32);
    expect(cold[2]).toBeGreaterThan(cold[0]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });
});
