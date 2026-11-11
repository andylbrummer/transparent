import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROVINCE_CLASSES, PROVINCE_PALETTE } from './classes';
import { DRAPE_SHADE_GLSL, PALETTE_SIZE, bandsLegend, paletteBytes } from './drape';
import definition from './layer';

interface BakedClass {
  readonly id: number;
  readonly name: string;
  readonly count: number;
}
/** The baked file itself: the classes the picture's red channel holds. */
const baked = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/provinces.json'))) as { classes: BakedClass[]; provinces: number };

describe('the province colours', () => {
  it('cover exactly the classes the bake wrote, by the same numbers', () => {
    expect(PROVINCE_CLASSES.map((c) => [c.id, c.name])).toEqual(baked.classes.map((c) => [c.id, c.name]));
    expect(baked.provinces).toBe(921);
  });

  it('are distinct, and the ocean floor is fainter than the land', () => {
    expect(new Set(PROVINCE_CLASSES.map((c) => c.color)).size).toBe(PROVINCE_CLASSES.length);
    const ocean = PROVINCE_PALETTE.find(([id]) => id === 11);
    const craton = PROVINCE_PALETTE.find(([id]) => id === 1);
    expect(ocean?.[2]).toBeLessThan(craton?.[2] ?? 0);
  });
});

describe('the palette texture', () => {
  it('puts class i at texel i and leaves class 0, nothing, clear', () => {
    const bytes = paletteBytes([[3, 0x102030, 0.5]]);
    expect(bytes.length).toBe(PALETTE_SIZE * 4);
    expect([...bytes.slice(12, 16)]).toEqual([0x10, 0x20, 0x30, 128]);
    expect([...bytes.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it('refuses a class the picture cannot hold', () => {
    expect(() => paletteBytes([[0, 0, 1]])).toThrow();
    expect(() => paletteBytes([[256, 0, 1]])).toThrow();
  });

  it('reads the class unfiltered, so borders never blend two classes into a third', () => {
    expect(DRAPE_SHADE_GLSL).toContain('texelFetch(uMap');
    expect(DRAPE_SHADE_GLSL).toContain('texel.b');
  });

  it('makes a legend of hard bands', () => {
    expect(bandsLegend([0xff0000, 0x00ff00])).toBe('linear-gradient(to right, #ff0000 0% 50%, #00ff00 50% 100%)');
  });
});

describe('the switch', () => {
  it('is off, on the surface, crediting the Zenodo copy under CC BY 4.0', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Surface');
    expect(definition.credits[0].licence).toContain('CC BY 4.0');
    expect(definition.credits[0].url).toContain('zenodo.6586972');
  });
});
