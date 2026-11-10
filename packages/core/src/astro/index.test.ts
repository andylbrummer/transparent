import { describe, it, expect } from 'vitest';
import {
  ICRS_TO_GALACTIC,
  applyMat3,
  greenwichMeanSiderealTime,
  horizontalFromIcrs,
  icrsToEcefMatrix,
  julianDate,
  multiplyMat3,
  precessionMatrix,
  raDecToUnit,
  transposeMat3,
  unitToRaDec,
} from './index';

const DEG = Math.PI / 180;
const hms = (h: number, m: number, s: number): number => (h + m / 60 + s / 3600) * 15;
const dms = (d: number, m: number, s: number): number => d + m / 60 + s / 3600;

function angleBetweenDeg(a: readonly number[], b: readonly number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, dot)) / DEG;
}

describe('julianDate', () => {
  it('is 2451545.0 at the J2000 epoch', () => {
    expect(julianDate(new Date('2000-01-01T12:00:00Z'))).toBe(2451545.0);
  });
});

describe('greenwichMeanSiderealTime', () => {
  it('matches Meeus example 12.b (1987 April 10, 19:21:00 UT)', () => {
    const gmst = greenwichMeanSiderealTime(new Date('1987-04-10T19:21:00Z'));
    expect(gmst / DEG).toBeCloseTo(hms(8, 34, 57.0896), 5);
  });
});

describe('precessionMatrix', () => {
  it('matches Meeus example 21.b (θ Persei, J2000 → 2028 Nov 13.19)', () => {
    // Meeus applies proper motion first; these are the J2000-frame coordinates after it.
    const start = raDecToUnit(hms(2, 44, 12.975), dms(49, 13, 39.9));
    const date = new Date((2462088.69 - 2440587.5) * 86400000);
    const { raDeg, decDeg } = unitToRaDec(applyMat3(precessionMatrix(date), start));
    expect(raDeg).toBeCloseTo(hms(2, 46, 11.331), 4);
    expect(decDeg).toBeCloseTo(dms(49, 20, 54.54), 4);
  });

  it('is the identity at J2000 and a rotation at any date', () => {
    const p0 = precessionMatrix(new Date('2000-01-01T12:00:00Z'));
    expect(p0[0]).toBeCloseTo(1, 12);
    expect(p0[4]).toBeCloseTo(1, 12);
    const p = precessionMatrix(new Date('2026-11-09T00:00:00Z'));
    const shouldBeIdentity = multiplyMat3(p, transposeMat3(p));
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(shouldBeIdentity[i]).toBeCloseTo(v, 12));
  });
});

describe('icrsToEcefMatrix', () => {
  it('puts the star on the Greenwich meridian at its transit', () => {
    const date = new Date('2000-01-01T12:00:00Z');
    const gmstDeg = greenwichMeanSiderealTime(date) / DEG;
    const ecef = applyMat3(icrsToEcefMatrix(date), raDecToUnit(gmstDeg, 0));
    expect(ecef[0]).toBeCloseTo(1, 9);
    expect(ecef[1]).toBeCloseTo(0, 9);
  });

  it('turns the sky westward: a star 15° east of the meridian transits one sidereal hour later', () => {
    const date = new Date('2026-11-09T03:00:00Z');
    const gmstDeg = greenwichMeanSiderealTime(date) / DEG;
    // Use the equator of date so precession does not enter: take the vector back through P.
    const ofDate = raDecToUnit(gmstDeg + 15, 0);
    const icrs = applyMat3(transposeMat3(precessionMatrix(date)), ofDate);
    const now = applyMat3(icrsToEcefMatrix(date), icrs);
    expect(Math.atan2(now[1], now[0]) / DEG).toBeCloseTo(15, 6);
    const siderealHourMs = 3600000 / 1.00273790935;
    const later = applyMat3(icrsToEcefMatrix(new Date(date.getTime() + siderealHourMs)), icrs);
    expect(Math.atan2(later[1], later[0]) / DEG).toBeCloseTo(0, 3);
  });
});

describe('horizontalFromIcrs', () => {
  it('keeps Polaris within a degree of the pole: elevation ≈ latitude, azimuth ≈ north', () => {
    const polaris = raDecToUnit(hms(2, 31, 49.09), dms(89, 15, 50.8));
    const { azimuth, elevation } = horizontalFromIcrs(polaris, 30.27, -97.74, new Date('2026-11-09T06:00:00Z'));
    expect(Math.abs(elevation - 30.27)).toBeLessThan(1);
    expect(Math.min(azimuth, 360 - azimuth)).toBeLessThan(1.5);
  });

  it('puts Sirius in the southern pre-dawn sky over Austin in November', () => {
    const sirius = raDecToUnit(hms(6, 45, 8.917), -dms(16, 42, 58.02));
    const { azimuth, elevation } = horizontalFromIcrs(sirius, 30.27, -97.74, new Date('2026-11-09T09:00:00Z'));
    expect(elevation).toBeGreaterThan(35);
    expect(elevation).toBeLessThan(43.1); // its meridian altitude at this latitude: 90 − 30.27 − 16.72
    expect(azimuth).toBeGreaterThan(120);
    expect(azimuth).toBeLessThan(200);
  });
});

describe('horizontalFromIcrs against JPL Horizons', () => {
  // Horizons observer tables for 97.74°W 30.27°N 0 km (geodetic), airless:
  // astrometric ICRF RA/Dec as seen from the site, and apparent azimuth/elevation.
  // Fetched 2026-11-09 from https://ssd.jpl.nasa.gov/api/horizons.api.
  const rows: readonly [string, string, number, number, number, number][] = [
    ['Sun', '2026-11-09T06:00:00Z', 224.00914, -16.76125, 345.058004, -76.18174],
    ['Sun', '2026-11-09T12:00:00Z', 224.26294, -16.83353, 103.009566, -11.54613],
    ['Sun', '2026-11-09T18:00:00Z', 224.51252, -16.90558, 175.191136, 42.583521],
    ['Sun', '2026-11-10T00:00:00Z', 224.76203, -16.97609, 253.374555, -5.435986],
    ['Moon', '2026-11-09T12:00:00Z', 226.0164, -22.65431, 107.523305, -15.713873],
    ['Mars', '2026-11-09T12:00:00Z', 145.35962, 15.73022, 133.948459, 70.028918],
    ['Jupiter', '2026-11-09T06:00:00Z', 147.40091, 13.90858, 69.370102, -7.250259],
  ];

  it.each(rows)('%s at %s lands within 0.02° of Horizons', (_body, iso, ra, dec, azimuth, elevation) => {
    const got = horizontalFromIcrs(raDecToUnit(ra, dec), 30.27, -97.74, new Date(iso));
    // What is left out - aberration, nutation, UT1−UTC - sums to under 0.015°.
    expect(Math.abs(got.elevation - elevation)).toBeLessThan(0.02);
    const azimuthError = Math.abs(got.azimuth - azimuth) * Math.cos(elevation * DEG);
    expect(azimuthError).toBeLessThan(0.02);
  });
});

describe('ICRS_TO_GALACTIC', () => {
  it('sends the galactic centre to +x and the north galactic pole to +z', () => {
    // Sgr A* (ICRS 17 45 40.04 −29 00 28.1) is at l = 359.944°, b = −0.046°.
    const centre = applyMat3(ICRS_TO_GALACTIC, raDecToUnit(hms(17, 45, 40.04), -dms(29, 0, 28.1)));
    expect(Math.atan2(centre[1], centre[0]) / DEG).toBeCloseTo(-0.056, 2);
    expect(Math.asin(centre[2]) / DEG).toBeCloseTo(-0.046, 2);
    const pole = applyMat3(ICRS_TO_GALACTIC, raDecToUnit(192.85948, 27.12825));
    expect(angleBetweenDeg(pole, [0, 0, 1])).toBeLessThan(0.001);
  });
});
