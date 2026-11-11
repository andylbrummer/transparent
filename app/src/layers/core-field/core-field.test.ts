import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { momentAt, momentDescription, momentStatus, positionFromLocation, yearText, yearsSpanned, type CoreFieldData } from './epochs';
import { CORE_FIELD_SHADE_GLSL } from './shade';
import definition from './layer';

/** The baked file itself: what the layer will read. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/core-field.json'))) as CoreFieldData;

describe('the baked epochs', () => {
  it('are IGRF’s 26, every five years from 1900, each with its picture, on the core’s surface', () => {
    expect(data.epochs.map((epoch) => epoch.year)).toEqual(Array.from({ length: 26 }, (_, i) => 1900 + 5 * i));
    expect(data.radiusKm).toBe(3480);
    for (const epoch of data.epochs) {
      expect(() => readFileSync(`public/${epoch.file}`)).not.toThrow();
      expect(epoch.definitive).toBe(epoch.year >= 1945);
    }
    expect(yearsSpanned(data)).toBe(125);
  });
});

describe('a moment on the control', () => {
  it('counts back from 2025 and blends the two epochs either side', () => {
    expect(momentAt(data, 0)).toMatchObject({ year: 2025, mix: 1 });
    expect(momentAt(data, 0).newer.year).toBe(2025);
    const m = momentAt(data, 88);
    expect(m.year).toBe(1937);
    expect([m.older.year, m.newer.year]).toEqual([1935, 1940]);
    expect(m.mix).toBeCloseTo(0.4, 9);
    expect(momentAt(data, 500).year).toBe(1900);
    expect(yearText(momentAt(data, 12.6))).toBe('2012');
  });

  it('says when the model is not definitive', () => {
    expect(momentDescription(momentAt(data, 88))).toMatch(/less certain/);
    expect(momentDescription(momentAt(data, 10))).toBe('');
    expect(momentStatus(momentAt(data, 88))).toMatch(/^1937 · reversed flux under \d+% of the southern core · not a definitive model$/);
    expect(momentStatus(momentAt(data, 0))).toMatch(/^2025 · reversed flux under 21% of the southern core$/);
  });

  it('opens at ?core=<year>, else at the newest epoch', () => {
    expect(positionFromLocation('?core=1900', data)).toBe(125);
    expect(positionFromLocation('?core=1960', data)).toBe(65);
    expect(positionFromLocation('?core=1850', data)).toBe(0);
    expect(positionFromLocation('', data)).toBe(0);
  });
});

describe('the colouring', () => {
  it('decodes grey 128 as no field and blends the two epochs', () => {
    expect(CORE_FIELD_SHADE_GLSL).toContain('128.0');
    expect(CORE_FIELD_SHADE_GLSL).toContain('uMix');
  });
});

describe('the switch', () => {
  it('is off, inside the Earth, crediting IGRF and saying it is continued down from the surface', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Inside the Earth');
    expect(definition.credits[0].source).toContain('IGRF');
    expect(definition.caption).toMatch(/continued down/);
  });
});
