import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { buildGeoMarkerBuffers } from '../../render/geo-markers';
import {
  NO_ALTITUDE_ALPHA,
  energyText,
  fireballDate,
  fireballLabelText,
  fireballMarkers,
  fireballSizePx,
  fireballsBy,
  type Fireball,
} from './fireballs';
import fireballs, { FIREBALL_COLOR } from './layer';

/** Real rows of app/public/geo/fireballs.json (NASA/JPL CNEOS). */
const CHELYABINSK: Fireball = {
  t: '2013-02-15T03:20:26Z',
  lat: 54.8,
  lon: 61.1,
  altKm: 23.3,
  velKms: 18.6,
  energyKt: 441,
  radiatedJ: 3.75e14,
  name: 'Chelyabinsk',
};
const BERING: Fireball = { t: '2018-12-18T23:48:18Z', lat: 56.9, lon: 172.4, altKm: 26, velKms: 13.6, energyKt: 49, radiatedJ: 3.13e13, name: 'Bering Sea' };
const NO_HEIGHT: Fireball = { t: '1994-02-01T22:38:09Z', lat: 2.7, lon: 164.1, altKm: null, velKms: null, energyKt: 30, radiatedJ: 1.82e13 };
const SMALL: Fireball = { t: '2026-10-04T03:14:45Z', lat: -41.8, lon: -173.1, altKm: 26.9, velKms: 13.8, energyKt: 0.18, radiatedJ: 5.4e10 };

describe('fireball symbols', () => {
  it('grow with energy: four pixels for every tenfold, within bounds', () => {
    expect(fireballSizePx(0.1)).toBeCloseTo(7);
    expect(fireballSizePx(1)).toBeCloseTo(11);
    expect(fireballSizePx(10)).toBeCloseTo(15);
    expect(fireballSizePx(441)).toBeGreaterThan(21);
    expect(fireballSizePx(1e6)).toBe(22);
    expect(fireballSizePx(0.01)).toBe(6);
  });

  it('are drawn at the height of the flash, not on the ground', () => {
    const buffers = buildGeoMarkerBuffers(fireballMarkers([CHELYABINSK]));
    const radius = Math.hypot(buffers.positions[0], buffers.positions[1], buffers.positions[2]);
    expect(radius - EARTH_RADIUS_M).toBeCloseTo(23300, -1);
    // 54.8 N: well up the z axis; 61.1 E: x and y both positive.
    expect(buffers.positions[2] / radius).toBeCloseTo(Math.sin((54.8 * Math.PI) / 180), 5);
    expect(buffers.positions[0]).toBeGreaterThan(0);
    expect(buffers.positions[1]).toBeGreaterThan(0);
  });

  it('are fainter and on the ground where no height was reported', () => {
    const [marker] = fireballMarkers([NO_HEIGHT]);
    expect(marker.altitudeM).toBe(0);
    expect(marker.alpha).toBe(NO_ALTITUDE_ALPHA);
    expect(fireballMarkers([CHELYABINSK])[0].alpha).toBe(1);
    expect(marker.shape).toBe('star');
    expect(marker.color).toBe(FIREBALL_COLOR);
  });
});

describe('fireball labels', () => {
  it('write energy to two figures', () => {
    expect(energyText(441)).toBe('440 kt');
    expect(energyText(49)).toBe('49 kt');
    expect(energyText(3.24)).toBe('3.2 kt');
    expect(energyText(0.18)).toBe('0.18 kt');
    expect(energyText(0.073)).toBe('0.073 kt');
  });

  it('date in UTC', () => {
    expect(fireballDate('2013-02-15T03:20:26Z')).toBe('15 Feb 2013');
    expect(fireballDate('2018-12-18T23:48:18Z')).toBe('18 Dec 2018');
  });

  it('give name, date, energy and height, leaving out what is not known', () => {
    expect(fireballLabelText(CHELYABINSK)).toBe('✦ Chelyabinsk · 15 Feb 2013 · 440 kt · 23 km up');
    expect(fireballLabelText(BERING)).toBe('✦ Bering Sea · 18 Dec 2018 · 49 kt · 26 km up');
    expect(fireballLabelText(NO_HEIGHT)).toBe('✦ 1 Feb 1994 · 30 kt');
  });
});

describe('fireballsBy', () => {
  const all = [CHELYABINSK, BERING, NO_HEIGHT, SMALL];

  it('hides what has not yet happened by the app clock', () => {
    expect(fireballsBy(all, Date.parse('2026-11-09T00:00:00Z'))).toEqual(all);
    expect(fireballsBy(all, Date.parse('2015-01-01T00:00:00Z'))).toEqual([CHELYABINSK, NO_HEIGHT]);
    expect(fireballsBy(all, Date.parse('2013-02-15T03:20:25Z'))).toEqual([NO_HEIGHT]);
    expect(fireballsBy(all, Date.parse('1980-01-01T00:00:00Z'))).toEqual([]);
  });
});

describe('the layer definition', () => {
  it('is off by default, on the surface, with a credit', () => {
    expect(fireballs.id).toBe('fireballs');
    expect(fireballs.defaultOn).toBeUndefined();
    expect(fireballs.section).toBe('Surface');
    expect(fireballs.credits[0].source).toContain('CNEOS');
  });
});
