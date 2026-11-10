import { describe, it, expect } from 'vitest';
import { PLANET_NAMES } from '@transparent-earth/core';
import { starSizePx } from '../../render/star-color';
import { PLANET_COLORS, planetAppearance, planetLabelText, pointOpacity } from './planets';

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

describe('with the discs drawn', () => {
  it('fades a planet’s point as its disc grows under it', () => {
    expect(pointOpacity(0)).toBe(1);
    expect(pointOpacity(12)).toBe(1);
    expect(pointOpacity(20)).toBeCloseTo(0.5, 12);
    expect(pointOpacity(40)).toBe(0);
  });

  it('adds size and phase to the name only beside a disc', () => {
    expect(planetLabelText('jupiter', 44.13, 0.991, false)).toBe('Jupiter');
    expect(planetLabelText('jupiter', 44.13, 0.991, true)).toBe('Jupiter · 44″ · 99% lit');
    expect(planetLabelText('mars', 6.94, 0.887, true)).toBe('Mars · 6.9″ · 89% lit');
  });

  it('gives the opening of Saturn’s rings in place of its phase', () => {
    expect(planetLabelText('saturn', 19.2, 1, true, -7.8)).toBe('Saturn · 19″ · rings open 8°');
    expect(planetLabelText('saturn', 16.1, 1, true, 0.04)).toBe('Saturn · 16″ · rings edge-on');
    expect(planetLabelText('saturn', 19.2, 1, false, -7.8)).toBe('Saturn');
  });
});
