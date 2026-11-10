import { describe, it, expect } from 'vitest';
import { LAYER_DEFINITIONS } from './registry';
import { LAYER_SECTIONS } from './types';
import { LAYER_SWITCHES } from '../ui/layers-panel';

describe('LAYER_DEFINITIONS', () => {
  it('finds the layers under src/layers', () => {
    expect(LAYER_DEFINITIONS.map((d) => d.id)).toContain('sky-below-horizon');
  });

  it('gives every layer a kebab-case id unlike any always-loaded switch', () => {
    const builtin = new Set(LAYER_SWITCHES.map((s) => s.id));
    for (const definition of LAYER_DEFINITIONS) {
      expect(definition.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(builtin.has(definition.id)).toBe(false);
    }
  });

  it('files every layer under a known section, with complete credits', () => {
    for (const definition of LAYER_DEFINITIONS) {
      expect(LAYER_SECTIONS).toContain(definition.section);
      for (const credit of definition.credits) {
        expect(credit.what.length).toBeGreaterThan(0);
        expect(credit.source.length).toBeGreaterThan(0);
        expect(credit.licence.length).toBeGreaterThan(0);
        expect(credit.url).toMatch(/^https:\/\//);
      }
    }
  });
});
