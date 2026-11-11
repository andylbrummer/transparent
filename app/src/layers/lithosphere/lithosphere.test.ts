import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rampColor } from '../weather/ramps';
import definition from './layer';
import { LITHOSPHERE_RAMP, LITHOSPHERE_SCALE_KM, LITHOSPHERE_SHADE_GLSL, lithosphereCode } from './ramp';

const luma = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('the lithosphere code', () => {
  it('is the bake’s: grey 255 is 300 km', () => {
    const bake = new TextDecoder().decode(readFileSync('../tools/pipeline/generate_lithosphere.py'));
    expect(bake).toContain(`DEPTH_SCALE_KM = ${LITHOSPHERE_SCALE_KM.toFixed(1)}`);
    expect(lithosphereCode(150)).toBeCloseTo(0.5, 9);
  });

  it('colours thick plate brighter than thin', () => {
    expect(luma(rampColor(LITHOSPHERE_RAMP, lithosphereCode(200)))).toBeGreaterThan(luma(rampColor(LITHOSPHERE_RAMP, lithosphereCode(100))));
    expect(luma(rampColor(LITHOSPHERE_RAMP, lithosphereCode(100)))).toBeGreaterThan(luma(rampColor(LITHOSPHERE_RAMP, lithosphereCode(30))));
    for (let i = 1; i < LITHOSPHERE_RAMP.length; i++) expect(LITHOSPHERE_RAMP[i][0]).toBeGreaterThan(LITHOSPHERE_RAMP[i - 1][0]);
  });

  it('draws a contour every 50 km', () => {
    expect(LITHOSPHERE_SHADE_GLSL).toContain(lithosphereCode(50).toFixed(6));
  });
});

describe('the switch', () => {
  it('is off, inside the Earth, crediting CAM2023, and says it is a model', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Inside the Earth');
    expect(definition.credits[0].source).toContain('Priestley');
    expect(definition.caption).toMatch(/a model/);
  });
});
