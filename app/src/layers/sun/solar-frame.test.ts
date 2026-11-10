import { describe, it, expect } from 'vitest';
import { raDecToUnit } from '@transparent-earth/core';
import { frameStatus } from './feed';
import { labelDropPx } from './moving-label';
import { computeSunState, imageAxes, productPole, surfacePointOnSky, type Vec } from './solar-frame';
import { discPixels, glowOpacity } from './sun';

const DEG = Math.PI / 180;
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('computeSunState', () => {
  // JPL Horizons, from Austin, 2026-11-10 00:00 UTC: RA 224.76203°, Dec −16.97609° (the Sun's parallax,
  // under 9″, is all that separates that from the geocentric place); angular diameter 1937.0″.
  const sun = computeSunState(new Date('2026-11-10T00:00:00Z'));

  it('puts the Sun where Horizons has it, at its true size', () => {
    const want = raDecToUnit(224.76203, -16.97609);
    expect(Math.acos(dot(sun.direction, want)) / DEG).toBeLessThan(0.003);
    expect(sun.radiusArcsec).toBeCloseTo(968.5, 0);
    expect(sun.angularRadius / DEG).toBeCloseTo(0.269, 2);
  });
});

describe('imageAxes', () => {
  const sun = computeSunState(new Date('2026-11-09T22:30:00Z'));

  it('gives perpendicular unit axes on the sky at the Sun, right being celestial west', () => {
    const { up, right } = imageAxes(sun.direction, [0, 0, 1]);
    expect(Math.hypot(...up)).toBeCloseTo(1, 9);
    expect(dot(up, right)).toBeCloseTo(0, 9);
    expect(dot(up, sun.direction)).toBeCloseTo(0, 9);
    expect(up[2]).toBeGreaterThan(0);
    // West is the direction of decreasing right ascension: against z × direction.
    const east: Vec = [-sun.direction[1], sun.direction[0], 0];
    expect(dot(right, east)).toBeLessThan(0);
  });

  it('tilts the Sun’s axis 22.8° east of celestial north in early November (Horizons: P = 22.79°)', () => {
    const celestial = imageAxes(sun.direction, [0, 0, 1]);
    const solar = imageAxes(sun.direction, productPole(sun, 'solar-north'));
    // Position angle: from celestial north toward east, which is −right.
    const p = Math.atan2(-dot(solar.up, celestial.right), dot(solar.up, celestial.up)) / DEG;
    expect(p).toBeCloseTo(22.79, 1);
  });

  it('has LASCO’s ecliptic-north frames rolled 6.3° west of solar north that day, as their stars showed (−6.5°)', () => {
    const solar = imageAxes(sun.direction, productPole(sun, 'solar-north'));
    const ecliptic = imageAxes(sun.direction, productPole(sun, 'ecliptic-north'));
    const roll = Math.atan2(-dot(ecliptic.up, solar.right), dot(ecliptic.up, solar.up)) / DEG;
    expect(roll).toBeGreaterThan(-6.8);
    expect(roll).toBeLessThan(-6.0);
  });
});

describe('surfacePointOnSky', () => {
  // SWPC's region summary for 2026-11-09 (valid at 24:00 UT): AR 4566 at S07W21, Carrington longitude 148;
  // AR 4568 at S08W01, longitude 128; AR 4572 at N12E70, longitude 57.
  const sun = computeSunState(new Date('2026-11-10T00:00:00Z'));
  const { up, right } = imageAxes(sun.direction, sun.pole);
  /** Offset from the disc centre in solar radii: [west, north]. */
  const onDisc = (latDeg: number, lonDeg: number): [number, number] => {
    const at = surfacePointOnSky(sun, latDeg, lonDeg);
    if (!at) throw new Error('on the far side');
    const d: Vec = [at[0] - sun.direction[0], at[1] - sun.direction[1], at[2] - sun.direction[2]];
    return [dot(d, right) / sun.angularRadius, dot(d, up) / sun.angularRadius];
  };

  it('puts AR 4566 21° west and 7° south, where SWPC located it', () => {
    const [west, north] = onDisc(-7, 148);
    // sin 21° cos 7° = 0.356 west; the Sun's 3.5° tilt toward us lowers southern features further.
    expect(west).toBeCloseTo(Math.sin(21 * DEG) * Math.cos(7 * DEG), 1);
    expect(north).toBeLessThan(-Math.sin(7 * DEG));
    expect(north).toBeGreaterThan(-0.25);
  });

  it('puts AR 4568 on the central meridian and AR 4572 near the east limb', () => {
    expect(Math.abs(onDisc(-8, 128)[0])).toBeLessThan(0.04);
    const [west, north] = onDisc(12, 57);
    expect(west).toBeLessThan(-0.85);
    expect(north).toBeGreaterThan(0.1);
  });

  it('drops a point the rotation has carried round the limb', () => {
    // Opposite the central meridian (L0 ≈ 126.8°).
    expect(surfacePointOnSky(sun, 0, 306.8)).toBeNull();
  });

  it('carries a region westward as the Sun turns, 13° a day', () => {
    const later = computeSunState(new Date('2026-11-11T00:00:00Z'));
    const axes = imageAxes(later.direction, later.pole);
    const at = surfacePointOnSky(later, -7, 148);
    if (!at) throw new Error('on the far side');
    const west = dot([at[0] - later.direction[0], at[1] - later.direction[1], at[2] - later.direction[2]], axes.right) / later.angularRadius;
    expect(Math.asin(west / Math.cos(7 * DEG)) / DEG).toBeCloseTo(21.2 + 13.2, 0);
  });
});

describe('what the zoom shows', () => {
  it('measures the Sun at 7 px across at the default field and 85 px at the narrowest, on an 800 px view', () => {
    const radius = 0.2666 * DEG;
    expect(discPixels(radius, 60, 800)).toBeCloseTo(7.1, 1);
    expect(discPixels(radius, 5, 800)).toBeCloseTo(85.3, 1);
  });

  it('lets the glow stand for the Sun until the disc can be seen, then fades it out', () => {
    expect(glowOpacity(7)).toBe(1);
    expect(glowOpacity(29)).toBeCloseTo(0.5, 5);
    expect(glowOpacity(85)).toBe(0);
  });

  it('keeps a name clear of its disc, in steps', () => {
    expect(labelDropPx(7, 20)).toBe(20);
    expect(labelDropPx(85, 20)).toBe(56);
    expect(labelDropPx(86, 20)).toBe(56);
    expect(labelDropPx(90, 20)).toBe(60);
  });
});

describe('frameStatus', () => {
  const now = Date.UTC(2026, 10, 10, 0, 30);

  it('calls a fresh frame live, with its time', () => {
    expect(frameStatus({ timeMs: Date.UTC(2026, 10, 9, 23, 52), fromNetwork: true }, now)).toEqual({
      text: 'live · 9 Nov 23:52 UT',
      tone: 'live',
    });
  });

  it('calls a frame far from the app clock stale: the clock was pinned to another day', () => {
    expect(frameStatus({ timeMs: Date.UTC(2026, 10, 9, 23, 52), fromNetwork: true }, Date.UTC(2026, 10, 20))).toEqual({
      text: 'image of 9 Nov 23:52 UT',
      tone: 'stale',
    });
  });

  it('says so when the image is the baked snapshot', () => {
    expect(frameStatus({ timeMs: Date.UTC(2026, 10, 9, 23, 52), fromNetwork: false }, now)).toEqual({
      text: 'offline · snapshot 9 Nov 2026',
      tone: 'stale',
    });
  });
});
