import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { iceAgeLabels, iceAgeStatus, millionsText, type IceAgeData } from './ice-age';
import definition from './layer';

/** The baked file itself: what the layer will read. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/ice-age.json'))) as IceAgeData;

describe('the baked figures', () => {
  it('have the northern ice sheets at about 26 million km² and the emerged shelves somewhat less', () => {
    expect(data.iceAreaKm2).toBeGreaterThan(24e6);
    expect(data.iceAreaKm2).toBeLessThan(29e6);
    expect(data.emergedAreaKm2).toBeGreaterThan(14e6);
    expect(data.emergedAreaKm2).toBeLessThan(data.iceAreaKm2);
  });

  it('record the depth the caption quotes', () => {
    expect(definition.caption).toContain(`${data.shoreDepthM} m deep`);
  });

  it('name the ice sheets and the drowned lands, each once', () => {
    const names = data.names.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Laurentide Ice Sheet');
    expect(names).toContain('Beringia');
    // Under the ice at the glacial maximum in this reconstruction; dry land only later.
    expect(names).not.toContain('Doggerland');
  });
});

describe('texts', () => {
  it('gives areas to two figures', () => {
    expect(millionsText(26_210_000)).toBe('26 million km²');
    expect(millionsText(17_730_000)).toBe('18 million km²');
    expect(millionsText(2_440_000)).toBe('2.4 million km²');
  });

  it('puts both totals on the chip', () => {
    expect(iceAgeStatus({ shoreDepthM: 125, iceAreaKm2: 26.2e6, emergedAreaKm2: 17.7e6, names: [] })).toBe('ice 26 million km² · new land 18 million km²');
  });

  it('labels ice and land separately, on the surface', () => {
    const ice = iceAgeLabels(data, 'ice');
    const land = iceAgeLabels(data, 'land');
    expect(ice.length + land.length).toBe(data.names.length);
    expect(ice.map((label) => label.text)).toContain('Scandinavian Ice Sheet');
    expect(land.map((label) => label.text)).toContain('Sahul Shelf');
    for (const label of [...ice, ...land]) expect(label.position.length()).toBeCloseTo(6371000, -3);
  });
});

describe('the layer', () => {
  it('says what it leaves out and what it assumes', () => {
    expect(definition.caption).toContain('Antarctica');
    expect(definition.caption).toContain('no allowance for the crust');
    expect(definition.caption).toContain('published reconstruction');
  });

  it('flags the data repository’s missing licence', () => {
    expect(definition.credits[0].licence).toContain('no stated licence');
  });
});
