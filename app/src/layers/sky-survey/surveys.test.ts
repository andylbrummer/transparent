import { describe, it, expect } from 'vitest';
import { SURVEYS } from './surveys';
import definitions from './layer';

describe('the surveys', () => {
  it('have unique ids and one switch each, all in the whole-sky pictures’ exclusive group', () => {
    expect(new Set(SURVEYS.map((spec) => spec.id)).size).toBe(SURVEYS.length);
    expect(definitions.map((definition) => definition.id)).toEqual(SURVEYS.map((spec) => spec.id));
    for (const definition of definitions) {
      expect(definition.section).toBe('Sky maps');
      expect(definition.exclusiveGroup).toBe('sky-map');
      // Fetched tile by tile over the network: never on unasked.
      expect(definition.defaultOn).toBeUndefined();
    }
  });

  it.each(SURVEYS)('$id is served over https and has a sane range of orders', (spec) => {
    expect(spec.bases.length).toBeGreaterThan(0);
    for (const base of spec.bases) expect(base).toMatch(/^https:\/\/[a-z0-9.-]+\/\S+[^/]$/);
    expect(spec.minOrder).toBeGreaterThanOrEqual(0);
    expect(spec.maxOrder).toBeGreaterThan(spec.minOrder);
    expect(spec.maxOrder).toBeLessThanOrEqual(13);
    expect(spec.floor).toBeGreaterThanOrEqual(0);
    expect(spec.floor).toBeLessThan(0.5);
    expect(spec.gain).toBeGreaterThanOrEqual(1);
  });

  it.each(SURVEYS)('$id credits the survey and the tile service, and says it loads live', (spec) => {
    expect(spec.credits.length).toBeGreaterThanOrEqual(2);
    expect(spec.credits.some((credit) => credit.what.includes('Tile service'))).toBe(true);
    for (const credit of spec.credits) {
      expect(credit.licence.length).toBeGreaterThan(5);
      expect(credit.url).toMatch(/^https:\/\//);
    }
    expect(spec.caption).toContain('loaded live');
  });
});
