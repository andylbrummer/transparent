import { describe, it, expect } from 'vitest';
import { PLANET_MOON_NAMES, PLANET_NAMES, SATURN_RINGS, planetShape, separationDeg, type Vec3Tuple } from '@transparent-earth/core';
import { MAGNIFICATION, MAPPED_PLANETS, MOON_COLORS, magnifiedDirection, moonLabelText, moonShines, panelExtent, skyAxes } from './discs';
import { DISC_FRAGMENT_SHADER, ringProfileGlsl } from './shader';
import definition from './layer';

const dot = (a: Vec3Tuple, b: Vec3Tuple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('panelExtent', () => {
  it('leaves a margin round a bare disc and reaches past Saturn’s A ring', () => {
    for (const planet of PLANET_NAMES) expect(panelExtent(planet)).toBeGreaterThan(1);
    expect(panelExtent('jupiter')).toBeLessThan(1.1);
    expect(panelExtent('saturn')).toBeGreaterThan(136780 / planetShape('saturn').equatorialRadiusKm);
    expect(panelExtent('saturn')).toBeLessThan(2.5);
  });
});

describe('skyAxes', () => {
  it('gives unit east and north at right angles to the direction and each other', () => {
    const direction: Vec3Tuple = [0.48, -0.6, 0.64];
    const { east, north } = skyAxes(direction);
    expect(Math.hypot(...east)).toBeCloseTo(1, 12);
    expect(Math.hypot(...north)).toBeCloseTo(1, 12);
    expect(dot(east, direction)).toBeCloseTo(0, 12);
    expect(dot(north, direction)).toBeCloseTo(0, 12);
    expect(dot(east, north)).toBeCloseTo(0, 12);
  });

  it('points north toward the pole and east toward growing right ascension', () => {
    // At RA 0 on the equator: north is +z, east is +y.
    const { east, north } = skyAxes([1, 0, 0]);
    expect(north[2]).toBeCloseTo(1, 12);
    expect(east[1]).toBeCloseTo(1, 12);
  });
});

describe('magnifiedDirection', () => {
  const planet: Vec3Tuple = [1, 0, 0];
  const arcsec = Math.PI / 648000;
  const moon: Vec3Tuple = [Math.cos(100 * arcsec), Math.sin(100 * arcsec), 0];

  it('stretches a moon’s offset by the magnification, the same way', () => {
    const at = magnifiedDirection(planet, moon, MAGNIFICATION);
    expect(Math.hypot(...at)).toBeCloseTo(1, 12);
    expect(separationDeg(at, planet) * 3600).toBeCloseTo(100 * MAGNIFICATION, -1);
    expect(at[1]).toBeGreaterThan(0);
    expect(at[2]).toBeCloseTo(0, 12);
  });

  it('leaves the moon where it is at life size', () => {
    const at = magnifiedDirection(planet, moon, 1);
    expect(separationDeg(at, moon) * 3600).toBeLessThan(1e-6);
  });
});

describe('moon labels', () => {
  it('says what the planet is doing to the moon', () => {
    expect(moonLabelText('io', 'clear')).toBe('Io');
    expect(moonLabelText('io', 'occulted')).toBe('');
    expect(moonLabelText('titan', 'eclipsed')).toBe('Titan · in Saturn’s shadow');
    expect(moonLabelText('triton', 'transit')).toBe('Triton · crossing Neptune');
  });

  it('puts out a moon that is hidden or shadowed, not one crossing the face', () => {
    expect(moonShines('clear')).toBe(true);
    expect(moonShines('transit')).toBe(true);
    expect(moonShines('occulted')).toBe(false);
    expect(moonShines('eclipsed')).toBe(false);
  });

  it('has a colour for every moon', () => {
    for (const moon of PLANET_MOON_NAMES) expect(MOON_COLORS[moon]).toHaveLength(3);
  });
});

describe('the disc shader', () => {
  it('carries every ring band, edges in Saturn radii', () => {
    const glsl = ringProfileGlsl();
    const radius = planetShape('saturn').equatorialRadiusKm;
    for (const band of SATURN_RINGS) {
      expect(glsl).toContain((band.innerKm / radius).toFixed(5));
      expect(glsl).toContain((band.outerKm / radius).toFixed(5));
      expect(glsl).toContain(band.opticalDepth.toFixed(3));
    }
    expect(DISC_FRAGMENT_SHADER).toContain(glsl);
  });
});

describe('the layer', () => {
  it('says in its caption how much the discs are magnified', () => {
    expect(definition.caption).toContain(`${MAGNIFICATION}×`);
  });

  it('credits a map for each mapped planet’s source and maps only planets', () => {
    for (const planet of MAPPED_PLANETS) expect(PLANET_NAMES).toContain(planet);
    expect(definition.credits.some((credit) => credit.what.includes('Maps of Mars, Jupiter, Saturn and Neptune'))).toBe(true);
  });
});
