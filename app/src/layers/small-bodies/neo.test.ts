import { describe, expect, it } from 'vitest';
import { raDecToUnit, separationDeg } from '@transparent-earth/core';
import { approachDirection, approachLabel, approachPositionKm, approachSizePx, approachStatus, shortDate, sizeText, type Approach, type ApproachData } from './neo';

const raw = import.meta.glob(['../../../public/sky/neo-approaches.json', './neo.fixture.json'], { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;
const data = JSON.parse(raw['../../../public/sky/neo-approaches.json']) as ApproachData;
interface Fixture {
  readonly approaches: readonly {
    des: string;
    distLd: number;
    samples: readonly { jd: number; km: readonly [number, number, number] }[];
    topocentric: { jdUtc: number; lon: number; lat: number; ra: number; dec: number };
  }[];
}
const fixture = JSON.parse(raw['./neo.fixture.json']) as Fixture;
const tabled = data.approaches.filter((a) => a.xyz !== undefined);
const DEG = 180 / Math.PI;

describe('the baked list of close approaches', () => {
  it('holds a few hundred approaches within 10 LD, in time order, most with a table', () => {
    expect(data.approaches.length).toBeGreaterThan(150);
    expect(tabled.length).toBeGreaterThan(data.approaches.length * 0.8);
    for (let i = 1; i < data.approaches.length; i++) expect(data.approaches[i].jd).toBeGreaterThanOrEqual(data.approaches[i - 1].jd);
    for (const a of data.approaches) {
      expect(a.distLd).toBeLessThanOrEqual(10.001);
      expect(a.distMinLd).toBeLessThanOrEqual(a.distLd);
      expect(a.distMaxLd).toBeGreaterThanOrEqual(a.distLd);
    }
  });

  it('gives no table to an approach whose time is uncertain by more than an hour', () => {
    for (const a of data.approaches) if (a.sigmaMin > 60) expect(a.xyz).toBeUndefined();
  });

  it('reproduces CNEOS’s miss distance from each Horizons table', () => {
    // Two services, one orbit: the table interpolated at CNEOS's time of closest approach must give CNEOS's distance.
    const km: number[] = [];
    let worst = 0;
    for (const a of tabled) {
      expect(approachPositionKm(a, a.jd, km)).toBe(true);
      const error = Math.abs(Math.hypot(km[0], km[1], km[2]) / data.ldKm / a.distLd - 1);
      worst = Math.max(worst, error);
    }
    expect(worst).toBeLessThan(0.01);
  });
});

describe('approachPositionKm', () => {
  it('returns the samples themselves at the sample times', () => {
    const a = tabled[0];
    const km: number[] = [];
    for (const k of [0, 1, 7, (a.xyz?.length ?? 0) / 3 - 1]) {
      expect(approachPositionKm(a, (a.t0 ?? 0) + (k * (a.stepMin ?? 0)) / 1440, km)).toBe(true);
      for (let axis = 0; axis < 3; axis++) expect(km[axis]).toBeCloseTo(a.xyz?.[k * 3 + axis] ?? NaN, 0);
    }
  });

  it('shows nothing outside the table, or without one', () => {
    const a = tabled[0];
    const km: number[] = [];
    expect(approachPositionKm(a, (a.t0 ?? 0) - 0.01, km)).toBe(false);
    expect(approachPositionKm(a, a.jd + 2.01, km)).toBe(false);
    const bare = data.approaches.find((x) => x.xyz === undefined);
    expect(bare).toBeDefined();
    if (bare) expect(approachPositionKm(bare, bare.jd, km)).toBe(false);
  });

  it('lands within a twentieth of a degree of Horizons between samples, even for the closest passes', () => {
    const km: number[] = [];
    for (const item of fixture.approaches) {
      const a = data.approaches.find((x) => x.des === item.des && x.xyz !== undefined);
      expect(a).toBeDefined();
      if (!a) continue;
      let worstDeg = 0;
      for (const sample of item.samples) {
        expect(approachPositionKm(a, sample.jd, km)).toBe(true);
        const miss = Math.hypot(km[0] - sample.km[0], km[1] - sample.km[1], km[2] - sample.km[2]);
        // The angle the error makes from the Earth's centre.
        worstDeg = Math.max(worstDeg, (miss / Math.hypot(...sample.km)) * DEG);
      }
      expect(worstDeg, item.des).toBeLessThan(0.05);
    }
  });
});

describe('approachDirection', () => {
  it('matches Horizons’ place for an observer in Austin, 15 minutes after closest approach', () => {
    // Measured: 0.004° - 0.007° for all five, 2026 TP128 (under 2,000 km above the surface) included.
    const direction: number[] = [];
    for (const item of fixture.approaches) {
      const a = data.approaches.find((x) => x.des === item.des && x.xyz !== undefined);
      expect(a).toBeDefined();
      if (!a) continue;
      const t = item.topocentric;
      const date = new Date((t.jdUtc - 2440587.5) * 86400000);
      expect(approachDirection(a, date, t.lat, t.lon, direction)).not.toBeNull();
      const error = separationDeg(direction as [number, number, number], raDecToUnit(t.ra, t.dec));
      expect(error, item.des).toBeLessThan(0.02);
    }
  });

  it('differs from the geocentric direction by the parallax', () => {
    const a = data.approaches.find((x) => x.des === fixture.approaches[0].des && x.xyz !== undefined);
    expect(a).toBeDefined();
    if (!a) return;
    const date = new Date((a.jd - 2440587.5) * 86400000);
    const austin: number[] = [];
    const perth: number[] = [];
    approachDirection(a, date, 30.27, -97.74, austin);
    approachDirection(a, date, -31.95, 115.86, perth);
    // Within 0.06 LD the two sides of the planet see it in quite different places.
    expect(separationDeg(austin as [number, number, number], perth as [number, number, number])).toBeGreaterThan(20);
  });
});

describe('texts', () => {
  const approach = (over: Partial<Approach>): Approach => ({
    des: '2026 RH10',
    jd: 2461293.77742,
    date: '2026-Sep-10 06:39',
    distLd: 0.646,
    distMinLd: 0.643,
    distMaxLd: 0.648,
    vRel: 18.16,
    h: 27.062,
    sigmaMin: 3,
    ...over,
  });

  it('gives the size range H allows, or the measured size', () => {
    // H 27.06: 1329 km × 10^(−5.412) = 5.14 m, over √0.25 and √0.05.
    expect(sizeText(approach({}))).toBe('~10–23 m');
    expect(sizeText(approach({ diameterM: 340 }))).toBe('340 m');
    expect(sizeText(approach({ h: 18 }))).toBe('~0.7–1.5 km');
    expect(sizeText(approach({ h: null }))).toBe('size unknown');
  });

  it('says whether the object is still coming', () => {
    expect(approachLabel(approach({}), 3.21, 2461292)).toBe('2026 RH10 · 3.2 LD, closing to 0.65 on 10 Sep · ~10–23 m');
    expect(approachLabel(approach({}), 3.21, 2461295)).toBe('2026 RH10 · 3.2 LD, passed at 0.65 on 10 Sep · ~10–23 m');
    expect(shortDate('2027-Mar-04 20:59')).toBe('4 Mar');
  });

  it('draws nearer objects larger', () => {
    expect(approachSizePx(0.5)).toBe(14);
    expect(approachSizePx(10)).toBe(8);
    expect(approachSizePx(3)).toBeGreaterThan(approachSizePx(6));
  });

  it('names the next approach, marks an old list stale, and admits where the list ends', () => {
    const bakedMs = Date.parse(`${data.baked}T12:00:00Z`);
    const jdOf = (ms: number): number => ms / 86400000 + 2440587.5;
    const fresh = approachStatus(data, new Date(bakedMs), jdOf(bakedMs), 4);
    expect(fresh.tone).toBe('info');
    expect(fresh.text).toMatch(/^4 passing · next .+ LD on \d+ [A-Z][a-z]{2} · list of \d+ [A-Z][a-z]{2} \d{4}$/);
    const later = approachStatus(data, new Date(bakedMs + 30 * 86400000), jdOf(bakedMs + 30 * 86400000), 0);
    expect(later.tone).toBe('stale');
    expect(later.text).toContain('later finds missing');
    const before = approachStatus(data, new Date('2020-01-01T00:00:00Z'), 2458849.5, 0);
    expect(before.tone).toBe('error');
    expect(before.text).toContain('no list for this date');
  });
});
