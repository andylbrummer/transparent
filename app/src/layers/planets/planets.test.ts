import { describe, it, expect } from 'vitest';
import { PLANET_NAMES } from '@transparent-earth/core';
import { starSizePx } from '../../render/star-color';
import { PLANET_COLORS, planetAppearance } from './planets';

describe('planetAppearance', () => {
  it('draws a bright planet on the stars’ own scale: Venus larger than Sirius', () => {
    const venus = planetAppearance(-4.5);
    expect(venus.sizePx).toBe(starSizePx(-4.5));
    expect(venus.sizePx).toBeGreaterThan(starSizePx(-1.46));
    expect(venus.alpha).toBe(1);
  });

  it('keeps faint Neptune findable rather than true to its magnitude', () => {
    const neptune = planetAppearance(7.8);
    expect(neptune.sizePx).toBeGreaterThan(starSizePx(7.8));
    expect(neptune.alpha).toBeGreaterThanOrEqual(0.7);
  });

  it('orders the planets by brightness', () => {
    expect(planetAppearance(-2.1).sizePx).toBeGreaterThan(planetAppearance(0.6).sizePx);
  });
});

describe('PLANET_COLORS', () => {
  it('has a colour for each planet, Mars the reddest and Neptune the bluest', () => {
    for (const planet of PLANET_NAMES) expect(PLANET_COLORS[planet]).toHaveLength(3);
    const redness = (c: readonly number[]): number => c[0] - c[2];
    for (const planet of PLANET_NAMES) {
      expect(redness(PLANET_COLORS.mars)).toBeGreaterThanOrEqual(redness(PLANET_COLORS[planet]));
      expect(redness(PLANET_COLORS.neptune)).toBeLessThanOrEqual(redness(PLANET_COLORS[planet]));
    }
  });
});
