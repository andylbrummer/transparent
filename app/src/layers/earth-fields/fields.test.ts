import { describe, it, expect } from 'vitest';
import { rampColor } from '../weather/ramps';
import { fieldShadeGlsl } from './field';
import { EARTH_FIELDS, geoidCode, heatFlowCode, magneticCode, mohoCode, sedimentCode } from './fields';
import earthFields from './layer';

const field = (id: string): (typeof EARTH_FIELDS)[number] => {
  const found = EARTH_FIELDS.find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
};

describe('the field codes', () => {
  it('are the bake’s: grey 128 is zero for the signed fields, and the ends of each scale are 0 and 1', () => {
    expect(magneticCode(0) * 255).toBeCloseTo(128, 9);
    expect(magneticCode(400) * 255).toBeCloseTo(255, 9);
    // Square-root scale: 100 nT is half-way from zero to 400.
    expect(magneticCode(100) * 255).toBeCloseTo(128 + 63.5, 9);
    expect(magneticCode(-5000) * 255).toBeCloseTo(1, 9);
    expect(geoidCode(0) * 255).toBeCloseTo(128, 9);
    // The geoid low south of India, −106.99 m: grey 4.
    expect(Math.round(geoidCode(-106.99) * 255)).toBe(4);
    expect(mohoCode(40)).toBeCloseTo(0.5, 9);
    expect(sedimentCode(5)).toBeCloseTo(0.5, 9);
    expect(heatFlowCode(10)).toBeCloseTo(0, 9);
    expect(heatFlowCode(100)).toBeCloseTo(0.5, 9);
    expect(heatFlowCode(1000)).toBeCloseTo(1, 9);
  });
});

describe('the field ramps', () => {
  it('ascend, so the legend reads left to right', () => {
    for (const f of EARTH_FIELDS) {
      for (let i = 1; i < f.ramp.length; i++) expect(f.ramp[i][0]).toBeGreaterThan(f.ramp[i - 1][0]);
    }
  });

  it('are not the depth rainbow: the magnetic and geoid ramps are two-sided about a pale zero', () => {
    for (const [id, zero] of [
      ['magnetic-anomaly', magneticCode(0)],
      ['geoid', geoidCode(0)],
    ] as const) {
      const [r, g, b] = rampColor(field(id).ramp, zero);
      expect(Math.min(r, g, b)).toBeGreaterThan(215);
    }
    const low = rampColor(field('geoid').ramp, geoidCode(-107));
    const high = rampColor(field('geoid').ramp, geoidCode(85));
    expect(low[2]).toBeGreaterThan(low[0]);
    expect(high[0]).toBeGreaterThan(high[2]);
  });

  it('make thick crust bright and thin crust dark', () => {
    const luma = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const ramp = field('moho-depth').ramp;
    expect(luma(rampColor(ramp, mohoCode(70)))).toBeGreaterThan(luma(rampColor(ramp, mohoCode(40))));
    expect(luma(rampColor(ramp, mohoCode(40)))).toBeGreaterThan(luma(rampColor(ramp, mohoCode(10))));
  });
});

describe('fieldShadeGlsl', () => {
  it('looks the code up across exactly the span the legend shows', () => {
    const glsl = fieldShadeGlsl(field('moho-depth'));
    expect(glsl).toContain(`(t - ${mohoCode(7).toFixed(6)}) / ${(mohoCode(75) - mohoCode(7)).toFixed(6)}`);
    expect(glsl).toContain('float s = clamp((t * 255.0 - 128.0) / 127.0, -1.0, 1.0);');
  });

  it('takes coverage from green only where the image has it', () => {
    expect(fieldShadeGlsl(field('heat-flow'))).toContain('texel.g');
    expect(fieldShadeGlsl(field('magnetic-anomaly'))).not.toContain('texel.g');
  });

  it('rules contours only for the fields that ask, at their interval: 10 m of geoid, 10 km of Moho', () => {
    expect(fieldShadeGlsl(field('geoid'))).toContain(`float interval = ${((127 * 10) / 110 / 255).toFixed(6)};`);
    expect(fieldShadeGlsl(field('moho-depth'))).toContain(`float interval = ${(10 / 80).toFixed(6)};`);
    expect(fieldShadeGlsl(field('heat-flow'))).not.toContain('interval');
  });
});

describe('the field layers', () => {
  it('are exclusive surface layers, off until asked for', () => {
    expect(earthFields.map((l) => l.id)).toEqual(['magnetic-anomaly', 'geoid', 'moho-depth', 'sediment-thickness', 'heat-flow']);
    for (const layer of earthFields) {
      expect(layer.section).toBe('Surface');
      expect(layer.exclusiveGroup).toBe('earth-field');
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.legend).toContain('linear-gradient');
      expect(layer.credits.length).toBeGreaterThan(0);
    }
  });

  it('say which are models and which are measurements', () => {
    expect(field('geoid').caption).toContain('a model (EGM96)');
    expect(field('moho-depth').caption).toContain('a model (CRUST1.0)');
    expect(field('sediment-thickness').caption).toContain('a model (CRUST1.0)');
    expect(field('heat-flow').caption).toContain('unmeasured and left clear');
    expect(field('magnetic-anomaly').caption).toContain('clear also where nothing was measured');
  });
});
