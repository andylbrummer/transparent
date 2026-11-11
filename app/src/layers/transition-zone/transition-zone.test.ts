import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { boundaryLabelText, boundaryOf, boundaryStatus, transitionZoneId, type TransitionZoneData } from './boundaries';
import { TRANSITION_ZONE_RAMP, TRANSITION_ZONE_SHADE_GLSL } from './shade';
import definitions from './layer';

/** The baked file itself: what the layer will read. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/transition-zone.json'))) as TransitionZoneData;

describe('the baked boundaries', () => {
  it('are the 410 and the 660, each with its picture, at their measured average depths', () => {
    expect(data.boundaries.map((b) => b.id)).toEqual(['410', '660']);
    for (const b of data.boundaries) expect(() => readFileSync(`public/${b.file}`)).not.toThrow();
    expect(boundaryOf(data, '410').meanKm).toBeCloseTo(410, 0);
    // From SS precursors the 660 averages 654 km: the name is not the depth.
    expect(boundaryOf(data, '660').meanKm).toBeGreaterThan(645);
    expect(boundaryOf(data, '660').meanKm).toBeLessThan(660);
    expect(data.scaleKm).toBeGreaterThanOrEqual(boundaryOf(data, '660').maxKm - boundaryOf(data, '660').meanKm);
  });

  it('name themselves and say their range', () => {
    expect(boundaryLabelText(boundaryOf(data, '660'))).toBe('the 660 · 654 km on average');
    expect(boundaryStatus(boundaryOf(data, '410'))).toBe('the 410: 396–425 km deep, 410 on average');
  });
});

describe('the colouring', () => {
  it('is symmetric about no departure and decodes grey 128 as the mean', () => {
    expect(TRANSITION_ZONE_RAMP[0][0]).toBe(-TRANSITION_ZONE_RAMP[TRANSITION_ZONE_RAMP.length - 1][0]);
    expect(TRANSITION_ZONE_SHADE_GLSL).toContain('128.0');
  });
});

describe('the switches', () => {
  it('are two, off, inside the Earth, crediting Waszek et al. and saying there is no licence', () => {
    expect(definitions.map((d) => d.id)).toEqual([transitionZoneId('410'), transitionZoneId('660')]);
    for (const d of definitions) {
      expect(d.defaultOn).toBeUndefined();
      expect(d.section).toBe('Inside the Earth');
      expect(d.credits[0].source).toContain('Waszek');
      expect(d.credits[0].licence).toMatch(/no stated licence/);
    }
    expect(definitions[1].caption).toMatch(/654 km/);
  });
});
