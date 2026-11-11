import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROVINCE_COLORS, PROVINCES_LEGEND, PROVINCES_SHADE_GLSL, provinceLabelText, type PetroleumProvincesData } from './classes';
import definition from './layer';

/** The baked file itself. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/petroleum-provinces.json'))) as PetroleumProvincesData;

describe('the baked provinces', () => {
  it('are the 939 provinces of the 2000 assessment, 142 records of them assessed', () => {
    expect(data.records).toBe(1023);
    expect(data.provinces).toBe(939);
    expect(data.counts).toEqual({ 'not assessed': 881, Oil: 96, Gas: 37, NA: 9 });
  });

  it('name the 14 with the most found by 2000, most first, West Siberia at the top', () => {
    expect(data.labels).toHaveLength(14);
    expect(data.labels[0].name).toBe('West Siberian Basin');
    expect(data.labels[0].knownMmboe).toBe(354730);
    for (let i = 1; i < data.labels.length; i++) expect(data.labels[i].knownMmboe).toBeLessThanOrEqual(data.labels[i - 1].knownMmboe);
    for (const label of data.labels) expect(['oil', 'gas']).toContain(label.commodity);
  });
});

describe('the label text', () => {
  it('gives what was found in billions of barrels of oil equivalent', () => {
    expect(provinceLabelText(data.labels[0])).toBe('West Siberian Basin · 355 bn boe found by 2000');
  });
});

describe('the layer', () => {
  it('sits in Human world, public domain, and says the US was not reassessed', () => {
    expect(definition.section).toBe('Human world');
    expect(definition.caption).toContain('939');
    expect(definition.caption).toContain('United States was not reassessed');
    expect(definition.credits?.[0].licence).toContain('public domain');
  });

  it('colours oil, gas and the rest as the legend does', () => {
    for (const color of [PROVINCE_COLORS.oil, PROVINCE_COLORS.gas, PROVINCE_COLORS.assessed]) expect(PROVINCES_LEGEND).toContain(color);
    for (const uniform of ['uOil', 'uGas', 'uAssessed', 'uOutline', 'texel.g', 'texel.b']) expect(PROVINCES_SHADE_GLSL).toContain(uniform);
  });
});
