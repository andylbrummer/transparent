import { describe, expect, it } from 'vitest';
import layer from './layer';
import { isActive, markerSizePx, peakTime, showerState, showerText, solarLongitude, type Shower, type ShowerList } from './showers';

// The baked list itself, as the build serves it.
const files = import.meta.glob('../../../public/space/meteor-showers.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const list = JSON.parse(Object.values(files)[0]) as ShowerList;
const shower = (code: string): Shower => list.showers.find((s) => s.code === code)!;

describe('the Sun’s place in the year', () => {
  it('is at 0° at the March equinox and 90° at the June solstice', () => {
    // 2026: equinox 20 March 14:46 UTC, solstice 21 June 08:24 UTC (the J2000 ecliptic lags the date's by 0.37°).
    expect(Math.abs(((solarLongitude(new Date('2026-03-20T14:46:00Z')) + 180) % 360) - 180)).toBeLessThan(0.4);
    expect(Math.abs(solarLongitude(new Date('2026-06-21T08:24:00Z')) - 90)).toBeLessThan(0.4);
  });
});

describe('the list', () => {
  it('holds the IMO working list', () => {
    expect(list.year).toBe(2026);
    expect(list.showers).toHaveLength(37);
    const perseids = shower('PER');
    expect(perseids).toMatchObject({ name: 'Perseids', iau: 7, ra: 48, dec: 58, zhr: 100, solarLongitude: 140, speedKmS: 59 });
    expect(shower('GEM')).toMatchObject({ name: 'Geminids', ra: 112, dec: 33, zhr: 150 });
    expect(shower('JBO').zhr).toBeNull();
    for (const s of list.showers) {
      expect(s.ra).toBeGreaterThanOrEqual(0);
      expect(s.ra).toBeLessThan(360);
      expect(Math.abs(s.dec)).toBeLessThanOrEqual(90);
    }
  });

  it('gives maxima whose dates agree with their solar longitudes', () => {
    // The calendar prints both a date and a solar longitude for each maximum in its own year: two columns
    // of the same table, checked against each other through the app's own Sun.
    for (const s of list.showers) {
      const printed = Date.UTC(list.year, s.peak[0] - 1, s.peak[1], 12);
      const computed = peakTime(s, new Date(printed)).getTime();
      expect(Math.abs(computed - printed) / 86400000).toBeLessThan(1.6);
    }
  });
});

describe('activity', () => {
  it('knows when a shower is on, across New Year too', () => {
    const leonids = shower('LEO');
    expect(isActive(leonids, new Date('2026-11-09T12:00:00Z'))).toBe(true);
    expect(isActive(leonids, new Date('2026-11-05T12:00:00Z'))).toBe(false);
    expect(isActive(leonids, new Date('2026-12-01T00:00:00Z'))).toBe(false);
    const quadrantids = shower('QUA');
    expect(isActive(quadrantids, new Date('2026-12-30T00:00:00Z'))).toBe(true);
    expect(isActive(quadrantids, new Date('2027-01-05T00:00:00Z'))).toBe(true);
    expect(isActive(quadrantids, new Date('2027-01-20T00:00:00Z'))).toBe(false);
  });

  it('tells quiet from active from the night of maximum', () => {
    const perseids = shower('PER');
    expect(showerState(perseids, new Date('2026-06-01T00:00:00Z'))).toBe('quiet');
    expect(showerState(perseids, new Date('2026-08-01T00:00:00Z'))).toBe('active');
    expect(showerState(perseids, new Date('2026-08-13T02:00:00Z'))).toBe('peak');
    // The same point of the orbit a year on, a quarter of a day later.
    const next = peakTime(perseids, new Date('2027-08-10T00:00:00Z'));
    expect(next.toISOString().slice(0, 10)).toBe('2027-08-13');
    expect(showerState(perseids, next)).toBe('peak');
  });

  it('says what a shower is doing', () => {
    expect(showerText(shower('LEO'), new Date('2026-11-09T12:00:00Z'))).toBe('Leonids · peak 17 Nov · ZHR 15');
    expect(showerText(shower('GEM'), new Date('2026-12-14T06:00:00Z'))).toBe('Geminids · at peak · ZHR 150');
    expect(showerText(shower('JBO'), new Date('2026-06-25T00:00:00Z'))).toMatch(/^June Bootids · peak 2[12] Jun · rate varies$/);
  });

  it('draws the strong and the active larger', () => {
    const geminids = shower('GEM');
    expect(markerSizePx(geminids, 'quiet')).toBe(7);
    expect(markerSizePx(geminids, 'peak')).toBeCloseTo(26, 6);
    expect(markerSizePx(geminids, 'active')).toBeGreaterThan(markerSizePx(shower('GUM'), 'active'));
    expect(markerSizePx(shower('JBO'), 'active')).toBeGreaterThan(11);
  });
});

describe('the layer', () => {
  it('is off by default and credits the IMO', () => {
    expect(layer.id).toBe('meteor-showers');
    expect(layer.defaultOn).toBeUndefined();
    expect(layer.credits[0].source).toMatch(/International Meteor Organization/);
  });
});
