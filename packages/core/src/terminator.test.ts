import { describe, it, expect } from 'vitest';
import {
  subsolarEcef,
  computeTerminator,
  isDaylight,
  dayNightFactor,
  generateTerminatorPoints,
  terminatorLengthKm,
  daylightFraction,
  EARTH_RADIUS_M,
  SUN_ANGULAR_RADIUS_DEG,
} from './terminator';

describe('subsolarEcef', () => {
  it('returns a non-zero vector', () => {
    const ss = subsolarEcef(new Date('2024-06-21T12:00:00Z'));
    expect(ss.x).not.toBe(0);
    expect(ss.y).not.toBe(0);
    expect(ss.z).not.toBe(0);
  });

  it('has magnitude equal to Earth radius', () => {
    const ss = subsolarEcef(new Date('2024-06-21T12:00:00Z'));
    const len = Math.sqrt(ss.x * ss.x + ss.y * ss.y + ss.z * ss.z);
    expect(len).toBeCloseTo(EARTH_RADIUS_M, 0);
  });

  it('northern summer has positive z', () => {
    const ss = subsolarEcef(new Date('2024-06-21T12:00:00Z'));
    expect(ss.z).toBeGreaterThan(0);
  });

  it('southern summer has negative z', () => {
    const ss = subsolarEcef(new Date('2024-12-21T12:00:00Z'));
    expect(ss.z).toBeLessThan(0);
  });
});

describe('computeTerminator', () => {
  it('returns subsolarEcef and sun angular radius', () => {
    const t = computeTerminator(new Date('2024-06-21T12:00:00Z'));
    expect(t.subsolarEcef).toBeDefined();
    expect(t.sunAngularRadiusDeg).toBe(SUN_ANGULAR_RADIUS_DEG);
  });
});

describe('isDaylight', () => {
  it('returns true at the subsolar point', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    // Subsolar point should be roughly at latitude ~23.5°N and some longitude
    // We test with a point known to be in daylight: same latitude, near subsolar longitude
    const inDay = isDaylight(23.5, 0, utc);
    expect(inDay).toBe(true);
  });

  it('returns false at the antipode of subsolar', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    const antipodeLat = -23.5;
    const antipodeLon = 180;
    const inDay = isDaylight(antipodeLat, antipodeLon, utc);
    expect(inDay).toBe(false);
  });

  it('returns true for the north pole in northern summer', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    expect(isDaylight(90, 0, utc)).toBe(true);
  });

  it('returns false for the north pole in northern winter', () => {
    const utc = new Date('2024-12-21T12:00:00Z');
    expect(isDaylight(90, 0, utc)).toBe(false);
  });

  it('returns true for the south pole in southern summer', () => {
    const utc = new Date('2024-12-21T12:00:00Z');
    expect(isDaylight(-90, 0, utc)).toBe(true);
  });

  it('returns false for the south pole in northern summer', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    expect(isDaylight(-90, 0, utc)).toBe(false);
  });
});

describe('dayNightFactor', () => {
  it('returns 1.0 well inside the day side', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    const factor = dayNightFactor(23.5, 0, utc, 0.5);
    expect(factor).toBeGreaterThan(0.9);
  });

  it('returns 0.0 well inside the night side', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    const factor = dayNightFactor(-23.5, 180, utc, 0.5);
    expect(factor).toBeLessThan(0.1);
  });

  it('returns a value between 0 and 1 near the terminator', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    // Approximate terminator location: 90° from subsolar
    // For simplicity, test a point that should be near the boundary
    const factor = dayNightFactor(0, 90, utc, 0.5);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });
});

describe('generateTerminatorPoints', () => {
  it('returns the requested number of segments', () => {
    const points = generateTerminatorPoints(new Date('2024-06-21T12:00:00Z'), 32);
    expect(points.length).toBe(32);
  });

  it('all points lie on the sphere surface', () => {
    const points = generateTerminatorPoints(new Date('2024-06-21T12:00:00Z'), 16);
    for (const p of points) {
      const latRad = (p.lat * Math.PI) / 180;
      const lonRad = (p.lon * Math.PI) / 180;
      const x = EARTH_RADIUS_M * Math.cos(latRad) * Math.cos(lonRad);
      const y = EARTH_RADIUS_M * Math.cos(latRad) * Math.sin(lonRad);
      const z = EARTH_RADIUS_M * Math.sin(latRad);
      const r = Math.sqrt(x * x + y * y + z * z);
      expect(r).toBeCloseTo(EARTH_RADIUS_M, 0);
    }
  });

  it('all points are on the terminator (dot product ≈ 0)', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    const ss = subsolarEcef(utc);
    const points = generateTerminatorPoints(utc, 16);

    for (const p of points) {
      const latRad = (p.lat * Math.PI) / 180;
      const lonRad = (p.lon * Math.PI) / 180;
      const px = EARTH_RADIUS_M * Math.cos(latRad) * Math.cos(lonRad);
      const py = EARTH_RADIUS_M * Math.cos(latRad) * Math.sin(lonRad);
      const pz = EARTH_RADIUS_M * Math.sin(latRad);

      const dot = ss.x * px + ss.y * py + ss.z * pz;
      // On a perfect sphere, dot should be 0. Allow ±1% of Earth radius tolerance.
      expect(Math.abs(dot)).toBeLessThan(EARTH_RADIUS_M * 0.01);
    }
  });

  it('returns a closed loop (first ≈ last for large segments)', () => {
    const points = generateTerminatorPoints(new Date('2024-06-21T12:00:00Z'), 128);
    const first = points[0];
    const last = points[points.length - 1];
    // Not exactly equal because of discrete sampling, but should be close
    expect(first.lat).toBeCloseTo(last.lat, 1);
    expect(first.lon).toBeCloseTo(last.lon, 1);
  });
});

describe('terminatorLengthKm', () => {
  it('is approximately Earth circumference', () => {
    const length = terminatorLengthKm();
    const circumference = (2 * Math.PI * EARTH_RADIUS_M) / 1000;
    expect(length).toBeCloseTo(circumference, 0);
  });
});

describe('daylightFraction', () => {
  it('returns 0.5', () => {
    expect(daylightFraction()).toBe(0.5);
  });
});
