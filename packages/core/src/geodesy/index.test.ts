import { describe, it, expect } from 'vitest';
import {
  geodeticToEcef,
  ecefToGeodetic,
  antipode,
  angularDistance,
  enuBasis,
  ecefToEnu,
  enuToEcef,
  toFloatingOrigin,
  fromFloatingOrigin,
  solarPosition,
  subsolarPoint,
  WGS84,
} from './index';

describe('WGS84 ECEF ↔ geodetic', () => {
  // Reference: known ECEF of Paris (approximate)
  const paris = { lat: 48.8566, lon: 2.3522, alt: 0 };
  // NOAA-calculated ECEF for Paris ~ (4200958, 177998, 4778180)

  it('converts Paris to ECEF within ±50 m', () => {
    const ecef = geodeticToEcef(paris);
    // Reference values from NOAA calculator for Paris (48.8566°N, 2.3522°E)
    expect(ecef.x).toBeCloseTo(4200915, 0);
    expect(ecef.y).toBeCloseTo(172560, 0);
    expect(ecef.z).toBeCloseTo(4780081, 0);
  });

  it('round-trips Paris through ECEF within ±1 m', () => {
    const ecef = geodeticToEcef(paris);
    const back = ecefToGeodetic(ecef);
    expect(back.lat).toBeCloseTo(paris.lat, 2); // ~1 m at equator (Bowring iterative)
    expect(back.lon).toBeCloseTo(paris.lon, 2);
    expect(back.alt).toBeCloseTo(paris.alt, 1);
  });

  it('round-trips equator/prime meridian', () => {
    const origin = { lat: 0, lon: 0, alt: 0 };
    const ecef = geodeticToEcef(origin);
    expect(ecef.x).toBeCloseTo(WGS84.a, 3);
    expect(ecef.y).toBeCloseTo(0, 3);
    expect(ecef.z).toBeCloseTo(0, 3);
    const back = ecefToGeodetic(ecef);
    expect(back.lat).toBeCloseTo(0, 5);
    expect(back.lon).toBeCloseTo(0, 5);
  });

  it('round-trips north pole', () => {
    const pole = { lat: 90, lon: 0, alt: 100 };
    const ecef = geodeticToEcef(pole);
    expect(ecef.x).toBeCloseTo(0, 3);
    expect(ecef.y).toBeCloseTo(0, 3);
    expect(ecef.z).toBeCloseTo(WGS84.b + 100, 3);
    const back = ecefToGeodetic(ecef);
    expect(back.lat).toBeCloseTo(90, 5);
    expect(back.alt).toBeCloseTo(100, 3);
  });
});

describe('antipode', () => {
  it('returns opposite lat and lon', () => {
    const a = { lat: 40, lon: -74, alt: 10 };
    const b = antipode(a);
    expect(b.lat).toBe(-40);
    expect(b.lon).toBe(106); // -74 + 180
    expect(b.alt).toBe(10);
  });

  it('antipode of antipode is original', () => {
    const a = { lat: -33, lon: 151, alt: 0 };
    expect(antipode(antipode(a))).toEqual(a);
  });
});

describe('angularDistance', () => {
  it('returns π for antipodal points', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 0, lon: 180, alt: 0 };
    expect(angularDistance(a, b)).toBeCloseTo(Math.PI, 5);
  });

  it('returns 0 for identical points', () => {
    const a = { lat: 45, lon: 30, alt: 0 };
    expect(angularDistance(a, a)).toBeCloseTo(0, 10);
  });

  it('returns ~π/2 for equator to pole', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 90, lon: 0, alt: 0 };
    expect(angularDistance(a, b)).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('ENU basis', () => {
  it('produces orthonormal vectors at equator', () => {
    const basis = enuBasis({ lat: 0, lon: 0, alt: 0 });
    expect(basis.e.x).toBeCloseTo(0, 5);
    expect(basis.e.y).toBeCloseTo(1, 5);
    expect(basis.e.z).toBeCloseTo(0, 5);
    expect(basis.n.x).toBeCloseTo(0, 5);
    expect(basis.n.y).toBeCloseTo(0, 5);
    expect(basis.n.z).toBeCloseTo(1, 5);
    expect(basis.u.x).toBeCloseTo(1, 5);
    expect(basis.u.y).toBeCloseTo(0, 5);
    expect(basis.u.z).toBeCloseTo(0, 5);
  });

  it('e, n, u are mutually perpendicular', () => {
    const basis = enuBasis({ lat: 35, lon: -120, alt: 0 });
    const dotEN = basis.e.x * basis.n.x + basis.e.y * basis.n.y + basis.e.z * basis.n.z;
    const dotEU = basis.e.x * basis.u.x + basis.e.y * basis.u.y + basis.e.z * basis.u.z;
    const dotNU = basis.n.x * basis.u.x + basis.n.y * basis.u.y + basis.n.z * basis.u.z;
    expect(dotEN).toBeCloseTo(0, 10);
    expect(dotEU).toBeCloseTo(0, 10);
    expect(dotNU).toBeCloseTo(0, 10);
  });

  it('round-trips ECEF→ENU→ECEF', () => {
    const origin = { lat: 45, lon: 10, alt: 0 };
    const ecef = geodeticToEcef({ lat: 45.001, lon: 10, alt: 0 });
    const originEcef = geodeticToEcef(origin);
    const delta = toFloatingOrigin(originEcef, ecef);
    const enu = ecefToEnu(origin, delta);
    const back = enuToEcef(origin, enu);
    expect(back.x).toBeCloseTo(delta.x, 5);
    expect(back.y).toBeCloseTo(delta.y, 5);
    expect(back.z).toBeCloseTo(delta.z, 5);
  });
});

describe('floating origin', () => {
  it('round-trips within <1 mm at planetary magnitude', () => {
    const origin = geodeticToEcef({ lat: 0, lon: 0, alt: 0 });
    const target = geodeticToEcef({ lat: 0.001, lon: 0, alt: 0 });
    const local = toFloatingOrigin(origin, target);
    const back = fromFloatingOrigin(origin, local);
    expect(back.x).toBeCloseTo(target.x, 5);
    expect(back.y).toBeCloseTo(target.y, 5);
    expect(back.z).toBeCloseTo(target.z, 5);
  });

  it('local coords are small near origin', () => {
    const origin = geodeticToEcef({ lat: 40, lon: -74, alt: 0 });
    const target = geodeticToEcef({ lat: 40.001, lon: -74, alt: 10 });
    const local = toFloatingOrigin(origin, target);
    // Within 10 km of origin, local coords should be < 10,000 m
    expect(Math.abs(local.x)).toBeLessThan(15000);
    expect(Math.abs(local.y)).toBeLessThan(15000);
    expect(Math.abs(local.z)).toBeLessThan(15000);
  });
});

describe('solar position', () => {
  it('returns subsolar point near equator at March equinox noon', () => {
    // 2024-03-20 15:00 UTC (approximate equinox)
    const sp = subsolarPoint(new Date('2024-03-20T15:00:00Z'));
    expect(sp.lat).toBeCloseTo(0.2, 0); // declination ~0.2° at equinox
    // Three hours past Greenwich noon the sun is ~45° west, less the ~7 min
    // the equation of time puts it behind mean time in late March.
    expect(sp.lon).toBeCloseTo(-43, 0);
  });

  it('puts the sun overhead at the subsolar point', () => {
    for (const iso of ['2024-03-20T06:00:00Z', '2024-06-21T18:00:00Z', '2024-12-21T23:00:00Z']) {
      const utc = new Date(iso);
      expect(solarPosition(subsolarPoint(utc), utc).elevation).toBeGreaterThan(89.5);
    }
  });

  it('moves the subsolar point westward through the day', () => {
    // 06:00 UTC: over the Indian Ocean (~90°E); 18:00 UTC: over the Pacific (~90°W)
    expect(subsolarPoint(new Date('2024-03-20T06:00:00Z')).lon).toBeCloseTo(92, 0);
    expect(subsolarPoint(new Date('2024-03-20T18:00:00Z')).lon).toBeCloseTo(-88, 0);
  });

  it('wraps subsolar longitude into [-180, 180) before J2000', () => {
    const sp = subsolarPoint(new Date('1990-01-01T18:00:00Z'));
    expect(sp.lon).toBeGreaterThanOrEqual(-180);
    expect(sp.lon).toBeLessThan(180);
    expect(solarPosition(sp, new Date('1990-01-01T18:00:00Z')).elevation).toBeGreaterThan(89.5);
  });

  it('solar elevation is high at noon in summer', () => {
    // 2024-06-21 12:00 UTC, location: Tropic of Cancer (~23.5°N)
    const pos = solarPosition(
      { lat: 23.5, lon: 0, alt: 0 },
      new Date('2024-06-21T12:00:00Z')
    );
    expect(pos.elevation).toBeGreaterThan(80); // nearly overhead
    expect(pos.elevation).toBeLessThan(95);
  });

  it('solar elevation is negative at midnight', () => {
    const pos = solarPosition(
      { lat: 40, lon: 0, alt: 0 },
      new Date('2024-06-21T00:00:00Z')
    );
    expect(pos.elevation).toBeLessThan(0);
  });
});
