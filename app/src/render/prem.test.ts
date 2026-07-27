import { describe, it, expect } from 'vitest';
import { PREM_LAYERS, premRadiiToMeters, premColors, premAlphas, EARTH_RADIUS_M } from './prem';

describe('PREM layers', () => {
  it('has 5 layers', () => {
    expect(PREM_LAYERS.length).toBe(5);
  });

  it('radii are in ascending order', () => {
    for (let i = 1; i < PREM_LAYERS.length; i++) {
      expect(PREM_LAYERS[i].radiusKm).toBeGreaterThan(PREM_LAYERS[i - 1].radiusKm);
    }
  });

  it('inner core radius is ~1221 km', () => {
    expect(PREM_LAYERS[0].radiusKm).toBeCloseTo(1221.5, 1);
  });

  it('crust extends above Earth surface', () => {
    const crust = PREM_LAYERS[PREM_LAYERS.length - 1];
    expect(crust.radiusKm).toBeGreaterThan(6371);
  });
});

describe('premRadiiToMeters', () => {
  it('converts to meters correctly', () => {
    const radii = premRadiiToMeters();
    expect(radii[0]).toBeCloseTo(1221500, 0);
    expect(radii[4]).toBeCloseTo(6406000, 0);
  });
});

describe('premColors', () => {
  it('returns 15 floats (5 layers × 3 channels)', () => {
    const colors = premColors();
    expect(colors.length).toBe(15);
  });
});

describe('premAlphas', () => {
  it('returns 5 alpha values', () => {
    const alphas = premAlphas();
    expect(alphas.length).toBe(5);
    expect(alphas[0]).toBeCloseTo(0.9, 2); // inner core most opaque
    expect(alphas[4]).toBeCloseTo(0.15, 2); // crust most transparent
  });
});

describe('EARTH_RADIUS_M', () => {
  it('equals 6,371,000 meters', () => {
    expect(EARTH_RADIUS_M).toBe(6_371_000);
  });
});
