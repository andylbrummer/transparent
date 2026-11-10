import { describe, expect, it } from 'vitest';
import { observerIcrsM, separationDeg, sunGeocentricAu } from '@transparent-earth/core';
import {
  AU_M,
  MU_EARTH_MOON,
  MU_SUN_EARTH,
  collinearLagrange,
  craftPositionAu,
  distanceText,
  lightTimeText,
  type CraftTable,
  type SpacecraftData,
} from './ephemeris-table';
import layers from './layer';
import { earthMoonPoints } from './moon-orbit';
import { craftText, displayName, sunEarthPointsKm } from './spacecraft';

// The baked table itself, as the build serves it.
const files = import.meta.glob('../../../public/space/spacecraft.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const data = JSON.parse(Object.values(files)[0]) as SpacecraftData;
const startMs = Date.parse(`${data.start}T00:00:00Z`);
const craft = (horizons: string): CraftTable => data.craft.find((c) => c.horizons === horizons)!;

/** Direction (unit ICRS) and distance (au) of a craft from Austin at `date`, the way the layer works it out. */
function fromAustin(table: CraftTable, date: Date): { direction: [number, number, number]; au: number } {
  const p = [0, 0, 0];
  expect(craftPositionAu(table, startMs, date.getTime(), p)).toBe(true);
  const observer = observerIcrsM(30.27, -97.74, 0, date);
  const v: [number, number, number] = [p[0] * AU_M - observer[0], p[1] * AU_M - observer[1], p[2] * AU_M - observer[2]];
  const m = Math.hypot(...v);
  return { direction: [v[0] / m, v[1] / m, v[2] / m], au: m / AU_M };
}

const unit = (raDeg: number, decDeg: number): [number, number, number] => {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
};

describe('the baked table against JPL Horizons, asked directly', () => {
  // Horizons observer tables for Austin (30.27, -97.74, 0 km) at 2026-11-09 18:00 UTC, between two of the
  // table's midnight samples: astrometric RA, Dec (ICRF, degrees) and range (au). Queried 2026-11-10.
  const when = new Date('2026-11-09T18:00:00Z');
  it.each([
    ['-170', 'James Webb Space Telescope', 72.72277, 15.63627, 0.01099860219733, 0.02],
    ['-21', 'SOHO', 214.48412, -9.69335, 0.00852853849366, 0.02],
    ['-31', 'Voyager 1', 258.79088, 12.07613, 172.999030448612, 0.002],
  ] as const)('%s (%s) is where Horizons puts it for someone in Austin', (id, name, ra, dec, au, toleranceDeg) => {
    const table = craft(id);
    expect(table.name).toBe(name);
    const seen = fromAustin(table, when);
    // The L-point craft are close enough that the user's place on the Earth moves them a quarter of a degree:
    // the tolerance is what a day's interpolation of the direction leaves.
    expect(separationDeg(seen.direction, unit(ra, dec))).toBeLessThan(toleranceDeg);
    expect(Math.abs(seen.au - au) / au).toBeLessThan(2e-3);
  });

  it('would miss JWST by a quarter of a degree without the user’s parallax', () => {
    const p = [0, 0, 0];
    craftPositionAu(craft('-170'), startMs, when.getTime(), p);
    const geocentric = separationDeg([p[0], p[1], p[2]], unit(72.72277, 15.63627));
    expect(geocentric).toBeGreaterThan(0.1);
    expect(geocentric).toBeLessThan(0.3);
  });
});

describe('the table', () => {
  it('holds the craft the layers name, each where it should be', () => {
    const names = data.craft.map(displayName);
    for (const name of ['SOHO', 'ACE', 'DSCOVR', 'JWST', 'Euclid', 'Voyager 1', 'Voyager 2', 'New Horizons', 'Parker Solar Probe', 'OSIRIS-APEX']) {
      expect(names).toContain(name);
    }
    const date = new Date('2026-06-01T12:00:00Z');
    const sun = sunGeocentricAu(date);
    const p = [0, 0, 0];
    for (const table of data.craft) {
      if (table.where === 'deep' || !craftPositionAu(table, startMs, date.getTime(), p)) continue;
      const au = Math.hypot(p[0], p[1], p[2]);
      // Around a point 0.01 au sunward or anti-sunward, in a wide halo about it.
      expect(au).toBeGreaterThan(0.006);
      expect(au).toBeLessThan(0.013);
      const fromSun = separationDeg([p[0], p[1], p[2]], sun);
      if (table.where === 'L1') expect(fromSun).toBeLessThan(40);
      else expect(fromSun).toBeGreaterThan(140);
    }
    // The Voyagers and Pioneers are far beyond the planets; nothing else in the table is.
    const far = data.craft.filter((table) => table.au[0] > 100).map((table) => table.name);
    expect(far.sort()).toEqual(['Pioneer 10', 'Pioneer 11', 'Voyager 1', 'Voyager 2']);
  });

  it('interpolates between samples and gives nothing outside them', () => {
    const table: CraftTable = { name: 'X', horizons: '0', where: 'deep', stepDays: 2, offsetDays: 4, ra: [10, 16, 22], dec: [0, 0, 0], au: [1, 2, 4] };
    const day = 86400000;
    const p = [0, 0, 0];
    expect(craftPositionAu(table, 0, 4 * day, p)).toBe(true);
    expect(p[0]).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 12);
    expect(craftPositionAu(table, 0, 5 * day, p)).toBe(true);
    expect((Math.atan2(p[1], p[0]) * 180) / Math.PI).toBeCloseTo(13, 9);
    expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1.5, 12);
    expect(craftPositionAu(table, 0, 8 * day, p)).toBe(true);
    expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(4, 12);
    expect(craftPositionAu(table, 0, 3.9 * day, p)).toBe(false);
    expect(craftPositionAu(table, 0, 8.1 * day, p)).toBe(false);
  });

  it('shows nothing across the days of an Earth flyby, when a daily table cannot say where a probe is', () => {
    const clipper = craft('-159');
    const p = [0, 0, 0];
    let hidden = 0;
    let closest = Infinity;
    for (let i = 0; i < clipper.ra.length - 1; i++) {
      const ms = startMs + (clipper.offsetDays + (i + 0.5) * clipper.stepDays) * 86400000;
      if (craftPositionAu(clipper, startMs, ms, p)) continue;
      hidden++;
      closest = Math.min(closest, clipper.au[i], clipper.au[i + 1]);
      // Europa Clipper's Earth gravity assist is in early December 2026.
      expect(new Date(ms).toISOString().slice(0, 7)).toBe('2026-12');
    }
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(6);
    expect(closest).toBeLessThan(0.01);
  });
});

describe('Lagrange points', () => {
  it('balances the forces at each collinear point', () => {
    for (const mu of [MU_EARTH_MOON, MU_SUN_EARTH]) {
      const { l1, l2, l3 } = collinearLagrange(mu);
      const force = (x: number): number => x - ((1 - mu) * (x + mu)) / Math.abs(x + mu) ** 3 - (mu * (x - 1 + mu)) / Math.abs(x - 1 + mu) ** 3;
      expect(Math.abs(force(1 - mu - l1))).toBeLessThan(1e-9);
      expect(Math.abs(force(1 - mu + l2))).toBeLessThan(1e-9);
      expect(Math.abs(force(-mu - l3))).toBeLessThan(1e-9);
      // Hill's approximation: both near (mu/3)^(1/3), L1 a little inside it and L2 a little outside.
      const hill = (mu / 3) ** (1 / 3);
      expect(l1).toBeLessThan(hill);
      expect(l2).toBeGreaterThan(hill);
      expect(Math.abs(l1 - hill * (1 - hill / 3 - (hill * hill) / 9))).toBeLessThan(hill ** 4 * 2);
      expect(l3).toBeCloseTo(1, 1);
    }
  });

  it('puts the Sun-Earth points a million and a half kilometres away, and the Earth-Moon ones about the Moon', () => {
    const points = sunEarthPointsKm(1);
    expect(points.l1).toBeGreaterThan(1.48e6);
    expect(points.l1).toBeLessThan(1.5e6);
    expect(points.l2).toBeGreaterThan(1.5e6);
    expect(points.l2).toBeLessThan(1.52e6);
    const moon = collinearLagrange(MU_EARTH_MOON);
    // 15 and 17 percent of the way to the Moon, this side and that.
    expect(moon.l1).toBeGreaterThan(0.14);
    expect(moon.l1).toBeLessThan(0.16);
    expect(moon.l2).toBeGreaterThan(0.16);
    expect(moon.l2).toBeLessThan(0.18);
  });

  it('places L4 ahead of the Moon and L5 behind, as far from the Earth as the Moon is', () => {
    const out = new Array<number>(15).fill(0);
    earthMoonPoints([384400, 0, 0], [0.1, 1, 0], out);
    expect(out[0]).toBeCloseTo(384400 * (1 - collinearLagrange(MU_EARTH_MOON).l1), 6);
    expect(out[3]).toBeGreaterThan(384400);
    expect(out[6]).toBeLessThan(-380000);
    expect(Math.hypot(out[9], out[10], out[11])).toBeCloseTo(384400, 6);
    expect(out[9]).toBeCloseTo(192200, 6);
    expect(out[10]).toBeGreaterThan(0);
    expect(out[13]).toBeCloseTo(-out[10], 6);
  });
});

describe('texts and definitions', () => {
  it('writes distances and light times in the unit that fits', () => {
    expect(distanceText(0.0099)).toBe('1.48 million km');
    expect(distanceText(0.35)).toBe('0.35 au');
    expect(distanceText(172.999)).toBe('173.0 au');
    expect(lightTimeText(0.011)).toBe('5.5 light-seconds');
    expect(lightTimeText(1.5)).toBe('12.5 light-minutes');
    expect(lightTimeText(173)).toBe('24.0 light-hours');
    expect(craftText('Voyager 1', 173)).toBe('Voyager 1 · 173.0 au · 24.0 light-hours');
  });

  it('defines three switches, off by default', () => {
    expect(layers.map((layer) => layer.id)).toEqual(['moon-orbit', 'spacecraft-lagrange', 'spacecraft-deep']);
    for (const layer of layers) {
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.credits.length).toBeGreaterThan(0);
    }
  });
});
