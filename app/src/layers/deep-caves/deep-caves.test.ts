import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEPTH_BANDS, NAMED_MIN_DEPTH_M, caveLabelText, caveMarkers, depthBand, namedCaves, type CaveData } from './caves';
import definition from './layer';

const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/deep-caves.json'))) as CaveData;

describe('the baked caves', () => {
  it('are deepest first, the Arabika caves at the top', () => {
    expect(data.caves.length).toBeGreaterThan(200);
    expect(data.caves.slice(0, 3).map((c) => c[0]).sort()).toEqual(['Krubera Cave', 'Sarma Cave', 'Veryovkina Cave']);
    expect(data.caves.every((c, i) => i === 0 || data.caves[i - 1][3] >= c[3])).toBe(true);
  });
});

describe('depth bands', () => {
  it('colour by the band a depth falls in', () => {
    expect(depthBand(0)).toBe(DEPTH_BANDS[0]);
    expect(depthBand(99)).toBe(DEPTH_BANDS[0]);
    expect(depthBand(100)).toBe(DEPTH_BANDS[1]);
    expect(depthBand(520)).toBe(DEPTH_BANDS[2]);
    expect(depthBand(2212)).toBe(DEPTH_BANDS[3]);
  });
});

describe('the drawing', () => {
  it('names the caves half a kilometre deep and puts the deepest on top', () => {
    const named = namedCaves(data);
    expect(named.length).toBeGreaterThanOrEqual(5);
    expect(named.every((c) => c[3] >= NAMED_MIN_DEPTH_M)).toBe(true);
    const markers = caveMarkers(data.caves);
    expect(markers).toHaveLength(data.caves.length);
    expect(markers[markers.length - 1]).toMatchObject({ lon: data.caves[0][2], color: DEPTH_BANDS[3].color });
    expect(caveLabelText(['Hranice Abyss', 49.532, 17.751, 520, 16])).toBe('Hranice Abyss · 520 m deep');
  });
});

describe('the switch', () => {
  it('is off, on the surface, and says coverage is uneven', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Surface');
    expect(definition.caption).toMatch(/no depth on Wikidata/);
  });
});
