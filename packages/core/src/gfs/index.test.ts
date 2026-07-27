import { describe, it, expect } from 'vitest';
import {
  wrapLon,
  clampLat,
  latLonToGridFrac,
  sampleBilinear,
  sampleWindAtLatLon,
  windToEcefVelocity,
  advectStep,
  createEmptyGrid,
  buildGridFromFn,
  maxWindSpeed,
  subsolarEcef,
  computeTerminator,
  isDaylight,
} from './index';
import { EARTH_RADIUS_M } from '../terminator';

describe('wrapLon', () => {
  it('wraps 190 to -170', () => {
    expect(wrapLon(190)).toBeCloseTo(-170, 5);
  });
  it('wraps -200 to 160', () => {
    expect(wrapLon(-200)).toBeCloseTo(160, 5);
  });
  it('leaves 0 unchanged', () => {
    expect(wrapLon(0)).toBe(0);
  });
  it('leaves -180 unchanged', () => {
    expect(wrapLon(-180)).toBe(-180);
  });
  it('wraps 540 to -180', () => {
    expect(wrapLon(540)).toBeCloseTo(-180, 5);
  });
});

describe('clampLat', () => {
  it('clamps 100 to 90', () => {
    expect(clampLat(100)).toBe(90);
  });
  it('clamps -100 to -90', () => {
    expect(clampLat(-100)).toBe(-90);
  });
  it('leaves 45 unchanged', () => {
    expect(clampLat(45)).toBe(45);
  });
});

describe('latLonToGridFrac', () => {
  const grid = { width: 360, height: 180, data: new Float32Array(360 * 180 * 2) };

  it('maps equator/prime meridian to center-ish', () => {
    const { fx, fy } = latLonToGridFrac(grid, 0, 0);
    expect(fx).toBeCloseTo(180, 5);
    expect(fy).toBeCloseTo(89.5, 5); // (0+90)/180 * 179
  });

  it('maps south pole to fy=0', () => {
    const { fy } = latLonToGridFrac(grid, -90, 0);
    expect(fy).toBeCloseTo(0, 5);
  });

  it('maps north pole to fy=179', () => {
    const { fy } = latLonToGridFrac(grid, 90, 0);
    expect(fy).toBeCloseTo(179, 5);
  });

  it('wraps lon=180 to fx=0 (antimeridian)', () => {
    const { fx } = latLonToGridFrac(grid, 0, 180);
    // 180 wraps to -180, which maps to fx=0
    expect(fx).toBeCloseTo(0, 5);
  });

  it('wraps lon=-180 to fx=0', () => {
    const { fx } = latLonToGridFrac(grid, 0, -180);
    expect(fx).toBeCloseTo(0, 5);
  });
});

describe('sampleBilinear', () => {
  it('interpolates between four corners', () => {
    const grid = createEmptyGrid(4, 4);
    // Set u=1 at (0,0), u=2 at (1,0), u=3 at (0,1), u=4 at (1,1)
    grid.data[0] = 1;  // (0,0)
    grid.data[2] = 2;  // (1,0)
    grid.data[8] = 3;  // (0,1)  (row 1 = 1*4*2 = 8)
    grid.data[10] = 4; // (1,1)

    const wind = sampleBilinear(grid, 0.5, 0.5);
    expect(wind.u).toBeCloseTo(2.5, 5); // average of 1,2,3,4
    expect(wind.v).toBe(0);
  });

  it('wraps across antimeridian (x0=3, x1=0)', () => {
    const grid = createEmptyGrid(4, 4);
    grid.data[6] = 10;  // (3,0)  index = (0*4+3)*2 = 6
    grid.data[0] = 20;  // (0,0)  index = (0*4+0)*2 = 0

    // At fx=3.5, fy=0.25:
    // x0=3, x1=0 (wrapped), wx=0.5
    // y0=0, y1=1, wy=0.25
    // All four samples are from row 0 since y0=0, y1=1, but clampedWy=0.25
    // i00=(0*4+3)*2=6  u=10
    // i10=(0*4+0)*2=0  u=20
    // i01=(1*4+3)*2=14 u=0
    // i11=(1*4+0)*2=8  u=0
    // u = 10*(1-0.5)*(1-0.25) + 20*0.5*(1-0.25) + 0 + 0
    //   = 10*0.5*0.75 + 20*0.5*0.75
    //   = 3.75 + 7.5 = 11.25
    const wind = sampleBilinear(grid, 3.5, 0.25);
    expect(wind.u).toBeCloseTo(11.25, 5);
  });

  it('clamps at south pole (y=0)', () => {
    const grid = createEmptyGrid(4, 4);
    grid.data[0] = 5;  // (0,0)
    grid.data[2] = 7;  // (1,0)

    // At fx=0.5, fy=-0.5:
    // Math.floor(-0.5) = -1
    // y0 = max(0, min(3, -1)) = 0
    // y1 = max(0, min(3, 0+1)) = 1
    // wy = -0.5 - (-1) = 0.5, clampedWy = max(0, min(1, 0.5)) = 0.5
    // So we interpolate between row 0 and row 1 with weight 0.5
    // i00=(0*4+0)*2=0  u=5
    // i10=(0*4+1)*2=2  u=7
    // i01=(1*4+0)*2=8  u=0 (empty)
    // i11=(1*4+1)*2=10 u=0 (empty)
    // u = 5*(1-0.5)*(1-0.5) + 7*0.5*(1-0.5) + 0 + 0
    //   = 5*0.25 + 7*0.25 = 1.25 + 1.75 = 3
    const wind = sampleBilinear(grid, 0.5, -0.5);
    expect(wind.u).toBeCloseTo(3, 5);
  });

  it('clamps at north pole (y=height-1)', () => {
    const grid = createEmptyGrid(4, 4);
    // Row 3 = 3*4*2 = 24
    grid.data[24] = 5;
    grid.data[26] = 7;

    const wind = sampleBilinear(grid, 0.5, 3.5);
    expect(wind.u).toBeCloseTo(6, 5);
  });
});

describe('sampleWindAtLatLon', () => {
  it('returns zero for empty grid', () => {
    const grid = createEmptyGrid(360, 180);
    const wind = sampleWindAtLatLon(grid, 0, 0);
    expect(wind.u).toBe(0);
    expect(wind.v).toBe(0);
  });

  it('samples constant wind field correctly', () => {
    const grid = buildGridFromFn(360, 180, () => ({ u: 10, v: 5 }));
    const wind = sampleWindAtLatLon(grid, 45, 120);
    expect(wind.u).toBeCloseTo(10, 5);
    expect(wind.v).toBeCloseTo(5, 5);
  });
});

describe('windToEcefVelocity', () => {
  it('eastward wind at equator points in +y direction at lon=0', () => {
    const vel = windToEcefVelocity(0, 0, { u: 10, v: 0 });
    expect(vel.x).toBeCloseTo(0, 5);
    expect(vel.y).toBeCloseTo(10, 5);
    expect(vel.z).toBeCloseTo(0, 5);
  });

  it('northward wind at equator points in +z direction', () => {
    const vel = windToEcefVelocity(0, 0, { u: 0, v: 10 });
    expect(vel.x).toBeCloseTo(0, 5);
    expect(vel.y).toBeCloseTo(0, 5);
    expect(vel.z).toBeCloseTo(10, 5);
  });

  it('produces a tangent vector (dot with radial = 0)', () => {
    const lat = 35;
    const lon = -120;
    const vel = windToEcefVelocity(lat, lon, { u: 15, v: 8 });

    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const cosLon = Math.cos(lonRad);
    const sinLon = Math.sin(lonRad);

    const radial = {
      x: cosLat * cosLon,
      y: cosLat * sinLon,
      z: sinLat,
    };

    const dot = vel.x * radial.x + vel.y * radial.y + vel.z * radial.z;
    expect(dot).toBeCloseTo(0, 5);
  });
});

describe('advectStep', () => {
  it('keeps particle on sphere (|r| ≈ 6371 km within 1 km)', () => {
    const grid = buildGridFromFn(360, 180, () => ({ u: 10, v: 5 }));
    const pos = { x: EARTH_RADIUS_M, y: 0, z: 0 };
    const newPos = advectStep(grid, pos, 1);

    const r = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y + newPos.z * newPos.z);
    expect(Math.abs(r - EARTH_RADIUS_M)).toBeLessThan(1000);
  });

  it('keeps particle on sphere with strong wind', () => {
    const grid = buildGridFromFn(360, 180, () => ({ u: 50, v: 30 }));
    const pos = { x: 0, y: EARTH_RADIUS_M, z: 0 };
    const newPos = advectStep(grid, pos, 10);

    const r = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y + newPos.z * newPos.z);
    expect(Math.abs(r - EARTH_RADIUS_M)).toBeLessThan(1000);
  });

  it('moves eastward particle in +y direction at equator/lon=0', () => {
    const grid = buildGridFromFn(360, 180, () => ({ u: 10, v: 0 }));
    const pos = { x: EARTH_RADIUS_M, y: 0, z: 0 };
    const newPos = advectStep(grid, pos, 1);

    expect(newPos.y).toBeGreaterThan(0);
    expect(newPos.z).toBeCloseTo(0, 3);
  });

  it('keeps particle on sphere at the pole', () => {
    const grid = buildGridFromFn(360, 180, () => ({ u: 5, v: 2 }));
    const pos = { x: 0, y: 0, z: EARTH_RADIUS_M };
    const newPos = advectStep(grid, pos, 5);

    const r = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y + newPos.z * newPos.z);
    expect(Math.abs(r - EARTH_RADIUS_M)).toBeLessThan(1000);
  });

  it('keeps particle on sphere at antimeridian (lon=180)', () => {
    const grid = buildGridFromFn(360, 180, (lat, lon) => ({
      u: Math.sin((lon * Math.PI) / 180) * 10,
      v: Math.cos((lat * Math.PI) / 180) * 5,
    }));
    const pos = { x: -EARTH_RADIUS_M, y: 0, z: 0 };
    const newPos = advectStep(grid, pos, 2);

    const r = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y + newPos.z * newPos.z);
    expect(Math.abs(r - EARTH_RADIUS_M)).toBeLessThan(1000);
  });
});

describe('maxWindSpeed', () => {
  it('returns 0 for empty grid', () => {
    const grid = createEmptyGrid(4, 4);
    expect(maxWindSpeed(grid)).toBe(0);
  });

  it('finds maximum speed', () => {
    const grid = buildGridFromFn(4, 4, (lat, lon) => ({
      u: lat,
      v: lon,
    }));
    const max = maxWindSpeed(grid);
    expect(max).toBeGreaterThan(0);
  });
});

describe('subsolarEcef', () => {
  it('returns a vector with magnitude ≈ 6371 km', () => {
    const ss = subsolarEcef(new Date('2024-06-21T12:00:00Z'));
    const r = Math.sqrt(ss.x * ss.x + ss.y * ss.y + ss.z * ss.z);
    expect(r).toBeCloseTo(EARTH_RADIUS_M, 0);
  });

  it('June solstice: subsolar lat near +23.5°', () => {
    const ss = subsolarEcef(new Date('2024-06-21T12:00:00Z'));
    const lat = (Math.asin(ss.z / EARTH_RADIUS_M) * 180) / Math.PI;
    expect(lat).toBeCloseTo(23.5, 0); // within 1°
  });
});

describe('computeTerminator', () => {
  it('returns terminator geometry with sun angular radius', () => {
    const t = computeTerminator(new Date());
    expect(t.sunAngularRadiusDeg).toBe(0.266);
    expect(t.subsolarEcef.x).toBeDefined();
  });
});

describe('isDaylight', () => {
  it('returns true at subsolar point', () => {
    // At June solstice noon, subsolar is near 23.5°N, 0°E (roughly)
    const utc = new Date('2024-06-21T12:00:00Z');
    // The subsolar point should be in daylight
    const ss = subsolarEcef(utc);
    const lat = (Math.asin(ss.z / EARTH_RADIUS_M) * 180) / Math.PI;
    const lon = (Math.atan2(ss.y, ss.x) * 180) / Math.PI;
    expect(isDaylight(lat, lon, utc)).toBe(true);
  });

  it('returns false at antipode of subsolar point', () => {
    const utc = new Date('2024-06-21T12:00:00Z');
    const ss = subsolarEcef(utc);
    const lat = -(Math.asin(ss.z / EARTH_RADIUS_M) * 180) / Math.PI;
    let lon = (Math.atan2(ss.y, ss.x) * 180) / Math.PI + 180;
    lon = ((lon + 180) % 360) - 180;
    expect(isDaylight(lat, lon, utc)).toBe(false);
  });

  it('terminator position matches subsolar point within 0.5°', () => {
    // Verify that the computed subsolar point from subsolarEcef
    // matches the one from geodesy subsolarPoint within 0.5°
    const utc = new Date('2024-03-20T15:00:00Z');
    const ss = subsolarEcef(utc);
    const lat = (Math.asin(ss.z / EARTH_RADIUS_M) * 180) / Math.PI;
    const lon = (Math.atan2(ss.y, ss.x) * 180) / Math.PI;

    // Reference: from geodesy subsolarPoint test, expected ~0.2° lat, ~43° lon
    expect(lat).toBeCloseTo(0.2, 0); // within 1°
    expect(lon).toBeCloseTo(43, 0); // within 1°
  });
});
