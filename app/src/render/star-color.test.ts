import { describe, it, expect } from 'vitest';
import { blackbodyRgb, starAlpha, starRgb, starSizePx, temperatureFromBV } from './star-color';

describe('temperatureFromBV', () => {
  it('gives the Sun (B−V 0.65) about 5800 K and Vega (0.00) about 10000 K', () => {
    expect(temperatureFromBV(0.65)).toBeGreaterThan(5600);
    expect(temperatureFromBV(0.65)).toBeLessThan(6000);
    expect(temperatureFromBV(0)).toBeGreaterThan(9500);
    expect(temperatureFromBV(0)).toBeLessThan(10500);
  });

  it('gives Betelgeuse (1.85) under 4000 K', () => {
    expect(temperatureFromBV(1.85)).toBeLessThan(4000);
  });
});

describe('star colours', () => {
  it('makes hot stars blue-white and cool stars orange', () => {
    const [hr, , hb] = starRgb(-0.2);
    const [cr, , cb] = starRgb(1.6);
    expect(hb).toBeGreaterThan(hr);
    expect(cr).toBeGreaterThan(cb + 0.2);
  });

  it('keeps every channel in range across the table', () => {
    for (let k = 1000; k <= 40000; k += 500) {
      for (const channel of blackbodyRgb(k)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('star size and opacity', () => {
  it('draws brighter stars larger, never under 2.2 px', () => {
    expect(starSizePx(-1.44)).toBeGreaterThan(starSizePx(1));
    expect(starSizePx(1)).toBeGreaterThan(starSizePx(4));
    expect(starSizePx(12)).toBe(2.2);
  });

  it('dims the faint ones instead', () => {
    expect(starAlpha(2)).toBe(1);
    expect(starAlpha(6.5)).toBeLessThan(starAlpha(5));
    expect(starAlpha(12)).toBe(0.12);
  });
});
