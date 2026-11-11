import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { R_STEP, ZONES, permafrostStatus, totalText, zoneFromRed, type PermafrostData } from './zones';
import definition from './layer';

const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/permafrost.json'))) as PermafrostData;

describe('the baked zones', () => {
  it('are the four, coldest first, read in the bake’s steps', () => {
    expect(data.zones).toEqual(ZONES);
    expect(data.rStep).toBe(R_STEP);
    expect(data.areaKm2.continuous).toBeGreaterThan(data.areaKm2.discontinuous);
  });
});

describe('the picture’s red', () => {
  it('reads back as the zone number', () => {
    expect(zoneFromRed(64 / 255)).toBeCloseTo(1);
    expect(zoneFromRed(192 / 255)).toBeCloseTo(3);
    expect(zoneFromRed(1)).toBeCloseTo(3.98, 2);
  });
});

describe('the chip', () => {
  it('gives the region and the continuous zone in millions of km²', () => {
    const sample: PermafrostData = {
      zones: ZONES,
      rStep: R_STEP,
      areaKm2: { continuous: 11_558_813, discontinuous: 3_240_853, sporadic: 3_679_469, isolated: 4_737_282 },
    };
    expect(totalText(sample)).toBe('23.2 million km²');
    expect(permafrostStatus(sample)).toBe('permafrost region 23.2 million km² · continuous 11.6 million km²');
  });
});

describe('the switch', () => {
  it('is off, on the surface, and names the zones by the share frozen', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Surface');
    expect(definition.caption).toMatch(/continuous over 90%/);
    expect(definition.credits[0].licence).toBe('CC BY 3.0');
  });
});
