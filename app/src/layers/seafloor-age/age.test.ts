import { describe, it, expect } from 'vitest';
import seafloorAge, { ISOCHRON_MYR } from './layer';
import { SEAFLOOR_AGE_SHADE_GLSL } from './age';
import { AGE_LEGEND_MYR, AGE_MAX_MYR, AGE_RAMP, AGE_RAMP_GLSL, ageColor, ageRampGradient } from './ramp';

const hex = ([r, g, b]: [number, number, number]): number => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

/** Run AGE_RAMP_GLSL's body by hand: a chain of `color = mix(color, vec3(..), clamp((myr - a) / b, 0.0, 1.0));`. */
function glslColor(myr: number): number[] {
  const first = /vec3 color = vec3\(([^)]+)\);/.exec(AGE_RAMP_GLSL);
  if (!first) throw new Error('no starting colour in AGE_RAMP_GLSL');
  let color = first[1].split(',').map(Number);
  for (const [, rgb, from, span] of AGE_RAMP_GLSL.matchAll(
    /color = mix\(color, vec3\(([^)]+)\), clamp\(\(myr - ([\d.]+)\) \/ ([\d.]+), 0\.0, 1\.0\)\);/g
  )) {
    const t = Math.min(Math.max((myr - Number(from)) / Number(span), 0), 1);
    color = color.map((c, k) => c + (Number(rgb.split(',')[k]) - c) * t);
  }
  return color.map((c) => c * 255);
}

describe('the seafloor-age ramp', () => {
  it('hits each stop and clamps beyond the ends', () => {
    for (const stop of AGE_RAMP) expect(hex(ageColor(stop.myr))).toBe(stop.color);
    expect(hex(ageColor(-1))).toBe(AGE_RAMP[0].color);
    expect(hex(ageColor(AGE_MAX_MYR))).toBe(AGE_RAMP[AGE_RAMP.length - 1].color);
  });

  it('only darkens with age, so new crust is the brightest thing on the ocean floor', () => {
    const luma = (myr: number): number => {
      const [r, g, b] = ageColor(myr);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (let myr = 1; myr <= AGE_LEGEND_MYR; myr++) expect(luma(myr)).toBeLessThan(luma(myr - 1));
  });

  it('is drawn by the shader as the legend shows it', () => {
    expect(ageRampGradient()).toContain('#fff7b8 0.0%');
    expect(ageRampGradient()).toContain('#1f3a7a 100.0%');
    let worst = 0;
    for (let myr = 0; myr <= AGE_MAX_MYR; myr += 0.5) {
      const expected = ageColor(myr);
      const drawn = glslColor(myr);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(drawn[k] - expected[k]));
    }
    expect(worst).toBeLessThan(0.5);
  });
});

describe('the seafloor-age layer', () => {
  it('is a surface overlay, off until asked for', () => {
    expect(seafloorAge.id).toBe('seafloor-age');
    expect(seafloorAge.section).toBe('Surface');
    expect(seafloorAge.defaultOn).toBeUndefined();
    expect(seafloorAge.caption).toContain(`0 – ${AGE_LEGEND_MYR} Myr`);
    expect(seafloorAge.credits[0].licence).toBe('CC BY 4.0');
  });

  it('decodes the age as the bake encoded it: AGE_MAX_MYR times the square of the red channel', () => {
    expect(SEAFLOOR_AGE_SHADE_GLSL).toContain(`${AGE_MAX_MYR.toFixed(1)} * texel.r * texel.r`);
    // Code 186 of 255 is 180.9 Myr; code 44 is 10.1 Myr.
    expect(AGE_MAX_MYR * (186 / 255) ** 2).toBeCloseTo(180.9, 1);
    expect(AGE_MAX_MYR * (44 / 255) ** 2).toBeCloseTo(10.1, 1);
  });

  it('takes coverage from green and rules its isochrons at the stated interval', () => {
    expect(SEAFLOOR_AGE_SHADE_GLSL).toContain('texel.g');
    expect(SEAFLOOR_AGE_SHADE_GLSL).toContain(`float interval = ${ISOCHRON_MYR.toFixed(1)};`);
  });
});
