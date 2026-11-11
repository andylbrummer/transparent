import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FIELDS_LEGEND, FIELDS_SHADE_GLSL, FLUID_COLORS, FLUIDS, fieldLabelText, fieldName, type OilGasFieldsData } from './classes';
import definition from './layer';

/** The baked file itself. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/oil-gas-fields.json'))) as OilGasFieldsData;

describe('the baked fields', () => {
  it('are 17,181 of OGIM’s 17,742 outlines, each with one of the four fluids', () => {
    expect(data.records).toBe(17742);
    expect(data.drawn).toBe(17181);
    expect(new Set(Object.keys(data.fluids))).toEqual(new Set(FLUIDS));
    expect(Object.values(data.fluids).reduce((a, b) => a + b, 0)).toBe(data.drawn);
  });

  it('label the large fields with a fluid the layer colours, on the globe', () => {
    expect(data.labels.length).toBeGreaterThan(10);
    expect(data.labels.length).toBeLessThanOrEqual(30);
    for (const label of data.labels) {
      expect(FLUIDS).toContain(label.fluid);
      expect(Math.abs(label.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(label.lon)).toBeLessThanOrEqual(180);
      expect(label.km2).toBeGreaterThan(0);
    }
    const names = data.labels.map((label) => label.name);
    for (const name of ['PRUDHOE BAY', 'BURGAN', 'SAMOTLORSKOE', 'SHEDGUM', 'HARADH']) expect(names).toContain(name);
  });

  it('name no field in the countries the caption says are missing', () => {
    const countries = new Set(data.labels.map((label) => label.country));
    for (const country of ['CHINA', 'BRAZIL', 'VENEZUELA', 'ARGENTINA', 'COLOMBIA', 'MALAYSIA']) expect(countries.has(country)).toBe(false);
  });
});

describe('the label text', () => {
  it('turns the data’s capitals into a name', () => {
    expect(fieldName('PRUDHOE BAY')).toBe('Prudhoe Bay');
    expect(fieldName('ROMASHKINSKOE AND SHUGUROVSKOE')).toBe('Romashkinskoe and Shugurovskoe');
    expect(fieldName('NORTH FIELD-SOUTH PARS')).toBe('North Field-South Pars');
  });

  it('gives the field’s area', () => {
    const label = { name: 'BURGAN', country: 'KUWAIT', region: 'MIDDLE EAST', fluid: 'oil' as const, km2: 1234, lon: 48, lat: 29 };
    expect(fieldLabelText(label)).toBe('Burgan · 1,234 km²');
  });
});

describe('the layer', () => {
  it('sits in Human world and says what is missing', () => {
    expect(definition.section).toBe('Human world');
    for (const gap of ['China', 'Brazil', 'Venezuela', 'Texas', 'Ghawar', 'forum']) expect(definition.caption).toContain(gap);
    expect(definition.credits?.[0].licence).toContain('CC BY 4.0');
  });

  it('has a legend band per fluid, in class order, and a shader with four colours', () => {
    for (const fluid of FLUIDS) expect(FIELDS_LEGEND).toContain(FLUID_COLORS[fluid]);
    expect(FIELDS_LEGEND.indexOf(FLUID_COLORS.oil)).toBeLessThan(FIELDS_LEGEND.indexOf(FLUID_COLORS['not given']));
    expect(FIELDS_SHADE_GLSL).toContain('uColors[3]');
    expect(FIELDS_SHADE_GLSL).toContain('texel.b');
  });
});
