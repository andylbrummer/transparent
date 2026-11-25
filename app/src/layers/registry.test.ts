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

  // Written out, so a new feed of today's data is a choice someone makes here, not a flag nobody set.
  it("marks live exactly the layers that show the provider's newest data whatever the clock says", () => {
    const live = LAYER_DEFINITIONS.filter((d) => d.live).map((d) => d.id);
    expect(new Set(live)).toEqual(
      new Set([
        'earth-now',
        'clouds',
        'precipitation',
        'wind-10m',
        'wind-250hpa',
        'air-temperature',
        'overlay-sea-ice',
        'overlay-snow',
        'overlay-fires',
        'overlay-aerosol',
        'overlay-no2',
        'overlay-carbon-monoxide',
        'overlay-ozone',
        'overlay-water-vapour',
        'overlay-soil-moisture',
        'quakes-recent',
        'hazards-live',
        'cyclones-live',
        'magnetopause',
        'aurora',
        'sun-euv-171',
        'sun-euv-195',
        'sun-euv-304',
        'sun-corona-lasco',
        'sun-corona-ccor1',
        'sun-activity',
      ]),
    );
  });
});
