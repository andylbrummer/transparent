import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AGE_PALETTE, AGE_RAMP, OLDEST_MA, ageColor, ageOfValue, provinceLabel } from './ages';
import type { IgneousData } from './igneous';
import definition from './layer';

const baked = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/igneous-provinces.json'))) as IgneousData;

describe('the age scale', () => {
  it('is the one the bake wrote: value 1 is 0 Ma, 255 is the oldest', () => {
    expect(baked.oldestMa).toBe(OLDEST_MA);
    expect(ageOfValue(1)).toBe(0);
    expect(ageOfValue(255)).toBe(OLDEST_MA);
    expect(AGE_PALETTE).toHaveLength(255);
    expect(AGE_PALETTE[0]).toEqual([1, AGE_RAMP[0][1], 0.75]);
  });

  it('puts each ramp colour at its age and clamps beyond', () => {
    for (const [age, color] of AGE_RAMP) expect(ageColor(age)).toBe(color);
    expect(ageColor(650)).toBe(ageColor(OLDEST_MA));
    expect(ageColor(-1)).toBe(ageColor(0));
  });
});

describe('the names', () => {
  it('carry the file’s ages, except at the end of the scale', () => {
    expect(provinceLabel('Deccan Traps', [65, 65])).toBe('Deccan Traps · 65 Ma');
    expect(provinceLabel('Siberian Traps', [248, 251])).toBe('Siberian Traps · 248–251 Ma');
    expect(provinceLabel('Kalkarindji', [510, 510])).toBe('Kalkarindji');
    const siberian = baked.labels.find((l) => l.name === 'Siberian Traps');
    expect(siberian?.ageMa).toEqual([248, 251]);
    expect(baked.labels.map((l) => l.name)).toEqual(expect.arrayContaining(['Deccan Traps', 'Central Atlantic Magmatic Province', 'Ontong Java Plateau']));
  });
});

describe('the switch', () => {
  it('is off, on the surface, credited CC BY 3.0 to EarthByte', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Surface');
    expect(definition.credits[0].licence).toBe('CC BY 3.0');
    expect(definition.caption).toMatch(/not where they erupted/);
  });
});
