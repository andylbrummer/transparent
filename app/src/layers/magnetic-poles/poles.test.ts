import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { magneticDipPole } from '@transparent-earth/core';
import {
  FORECAST_COLOR,
  driftKmPerYear,
  fullTrack,
  greatCircleKm,
  markedYears,
  nowLabel,
  poleAt,
  trackSegments,
  yearColor,
  type MagneticPoleData,
  type PoleRow,
} from './poles';
import definition from './layer';

/** The baked file itself: what the layer will read. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/magnetic-poles.json'))) as MagneticPoleData;
const north = fullTrack(data.north);
const south = fullTrack(data.south);

describe('the baked tracks', () => {
  it('run a position a year from 1590 through the forecast to 2030, each year once', () => {
    for (const track of [north, south]) {
      expect(track.map((row) => row[0])).toEqual(Array.from({ length: 2030 - 1590 + 1 }, (_, i) => 1590 + i));
    }
  });

  it('agree with the app’s own World Magnetic Model where NOAA’s forecast is that model', () => {
    // NOAA computed these from WMM2025; so does packages/core, independently. Under 3 km apart.
    for (const hemisphere of ['north', 'south'] as const) {
      for (const [year, lon, lat] of data[hemisphere].forecast) {
        const own = magneticDipPole(hemisphere, year);
        expect(greatCircleKm([year, lon, lat], [year, own.lon, own.lat])).toBeLessThan(3);
      }
    }
  });
});

describe('greatCircleKm', () => {
  it('measures a quarter of the way round and across the pole', () => {
    expect(greatCircleKm([0, 0, 0], [0, 90, 0])).toBeCloseTo((Math.PI / 2) * 6371, 6);
    expect(greatCircleKm([0, 0, 89], [0, 180, 89])).toBeCloseTo(((2 * Math.PI) / 180) * 6371, 6);
  });
});

describe('poleAt', () => {
  it('is at the yearly position on the year and between two in mid-year', () => {
    const at = poleAt(north, 2000);
    expect(at.lon).toBeCloseTo(north.find((row) => row[0] === 2000)![1], 9);
    expect(at.lat).toBeCloseTo(north.find((row) => row[0] === 2000)![2], 9);
    const mid = poleAt(north, 2000.5);
    const a = north.find((row) => row[0] === 2000)!;
    const b = north.find((row) => row[0] === 2001)!;
    const whole = greatCircleKm(a, b);
    expect(greatCircleKm(a, [0, mid.lon, mid.lat])).toBeCloseTo(whole / 2, 3);
    expect(greatCircleKm(b, [0, mid.lon, mid.lat])).toBeCloseTo(whole / 2, 3);
  });

  it('goes the short way where the track crosses the date line near the pole', () => {
    // 2017 → 2018 the northern pole's longitude passes 180°: it must not swing round the world.
    const a = north.find((row) => row[0] === 2017)!;
    const b = north.find((row) => row[0] === 2018)!;
    expect(Math.sign(a[1])).not.toBe(Math.sign(b[1]));
    const mid = poleAt(north, 2017.5);
    expect(greatCircleKm(a, [0, mid.lon, mid.lat])).toBeLessThan(greatCircleKm(a, b));
    expect(mid.lat).toBeGreaterThan(85);
  });

  it('stays at the ends of the record outside it', () => {
    expect(poleAt(north, 1200)).toEqual({ lon: north[0][1], lat: north[0][2] });
    expect(poleAt(north, 2500)).toEqual({ lon: north[north.length - 1][1], lat: north[north.length - 1][2] });
  });
});

describe('driftKmPerYear', () => {
  it('shows the northern pole near-still in 1900, racing by 2005 and slowing since', () => {
    expect(driftKmPerYear(north, 1900)).toBeLessThan(10);
    expect(driftKmPerYear(north, 2005)).toBeGreaterThan(50);
    expect(driftKmPerYear(north, 2026)).toBeGreaterThan(30);
    expect(driftKmPerYear(north, 2026)).toBeLessThan(driftKmPerYear(north, 2005));
  });

  it('shows the southern pole ambling', () => {
    expect(driftKmPerYear(south, 2026)).toBeLessThan(12);
  });

  it('answers at and beyond the ends of the record', () => {
    expect(driftKmPerYear(north, 1590)).toBeGreaterThan(0);
    expect(driftKmPerYear(north, 2030)).toBeGreaterThan(0);
    expect(driftKmPerYear(north, 2400)).toBe(driftKmPerYear(north, 2030));
  });
});

describe('drawing', () => {
  const rows: PoleRow[] = [
    [2000, 0, 80],
    [2001, 10, 81],
    [2002, 20, 82],
  ];

  it('makes a segment between each pair of years, coloured by year', () => {
    const { positions, colors } = trackSegments(rows, (year) => [year - 2000, 0, 0]);
    expect(positions).toHaveLength(2 * 6);
    expect(colors).toHaveLength(2 * 6);
    // Each segment ends where the next begins.
    expect([...positions.slice(3, 6)]).toEqual([...positions.slice(6, 9)]);
    expect([colors[0], colors[3], colors[6], colors[9]]).toEqual([0, 1, 1, 2]);
    // Just above the ground.
    expect(Math.hypot(positions[0], positions[1], positions[2])).toBeGreaterThan(6371000);
    expect(Math.hypot(positions[0], positions[1], positions[2])).toBeLessThan(6371000 + 5000);
  });

  it('runs from blue in 1590 to yellow now, and keeps white for the forecast', () => {
    const old = yearColor(1590, 1590, 2025);
    const recent = yearColor(2025, 1590, 2025);
    expect(old[2]).toBeGreaterThan(old[0]);
    expect(recent[0]).toBeGreaterThan(recent[2]);
    expect(yearColor(1200, 1590, 2025)).toEqual(old);
    expect(FORECAST_COLOR).toEqual([1, 1, 1]);
  });

  it('names every half century and both ends of the record', () => {
    expect(markedYears(north)).toEqual([1590, 1600, 1650, 1700, 1750, 1800, 1850, 1900, 1950, 2000, 2030]);
  });

  it('labels the pole with the year and its speed', () => {
    expect(nowLabel('north', north, 2026.86)).toMatch(/^North magnetic pole · 2026 · \d+ km a year$/);
    expect(nowLabel('south', south, 2026.86)).toMatch(/^South magnetic pole · 2026 · \d km a year$/);
    // A clock pinned outside the record names the record's end, not a year it has no position for.
    expect(nowLabel('north', north, 2100)).toContain('· 2030 ·');
  });
});

describe('the layer', () => {
  it('says the positions are computed, not surveyed', () => {
    expect(definition.caption).toContain('not surveyed');
    expect(definition.caption).toContain('forecast');
  });
});
