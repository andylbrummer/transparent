import { describe, it, expect } from 'vitest';
import { decimalYear, geomagneticNorthPole, magneticDeclination, magneticDipPole, magneticField, magneticFieldEcef } from './index';

// NOAA NCEI WMM2025_TestValues.txt: [decimal year, height km, lat, lon, declination °].
// Declinations are published to 0.01°, so agreement is checked to half that.
const NOAA_TEST_VALUES: readonly (readonly [number, number, number, number, number])[] = [
  [2025, 28, 89, -121, -99.77],
  [2025, 48, 80, -96, -29.91],
  [2025, 54, 82, 87, 54.89],
  [2025, 65, 43, 93, 0.50],
  [2025, 51, -33, 109, -5.49],
  [2025, 39, -59, -8, -15.75],
  [2025, 3, -50, -103, 27.96],
  [2025, 94, -29, -110, 15.74],
  [2025, 66, 14, 143, -0.19],
  [2025, 18, 0, 21, 1.29],
  [2025.5, 6, -36, -137, 20.28],
  [2025.5, 63, 26, 81, 0.51],
  [2025.5, 69, 38, -144, 12.93],
  [2025.5, 50, -70, -133, 57.21],
  [2025.5, 8, -52, -75, 14.91],
  [2025.5, 8, -66, 17, -33.14],
  [2025.5, 22, -37, 140, 9.28],
  [2025.5, 40, -12, -129, 10.76],
  [2025.5, 44, 33, -118, 11.10],
  [2025.5, 50, -81, -67, 28.13],
  [2026, 74, -57, 3, -22.51],
  [2026, 46, -24, -122, 14.01],
  [2026, 69, 23, 63, 1.17],
  [2026, 33, -3, -147, 9.71],
  [2026, 47, -72, -22, -6.32],
  [2026, 62, -14, 99, -1.43],
  [2026, 83, 86, -46, -30.61],
  [2026, 82, -64, 87, -81.74],
  [2026, 34, -19, 43, -14.98],
  [2026, 56, -81, 40, -59.77],
  [2026.5, 14, 0, 80, -3.10],
  [2026.5, 12, -82, -68, 29.79],
  [2026.5, 44, -46, -42, -11.36],
  [2026.5, 43, 17, 52, 1.19],
  [2026.5, 64, 10, 78, -1.53],
  [2026.5, 12, 33, -145, 11.96],
  [2026.5, 12, -79, 115, -137.58],
  [2026.5, 14, -33, -114, 18.12],
  [2026.5, 19, 29, 66, 2.24],
  [2026.5, 86, -11, 167, 10.24],
  [2027, 37, -66, -5, -17.22],
  [2027, 67, 72, -115, 13.73],
  [2027, 44, 22, 174, 6.46],
  [2027, 54, 54, 178, 0.63],
  [2027, 57, -43, 50, -48.27],
  [2027, 44, -43, -111, 24.31],
  [2027, 12, -63, 178, 57.87],
  [2027, 38, 27, -169, 8.48],
  [2027, 61, 59, -77, -16.48],
  [2027, 67, -47, -32, -13.52],
  [2027.5, 8, 62, 53, 19.39],
  [2027.5, 77, -68, -7, -16.19],
  [2027.5, 98, -5, 159, 7.79],
  [2027.5, 34, -29, -107, 15.64],
  [2027.5, 60, 27, 65, 1.85],
  [2027.5, 73, -72, 95, -102.64],
  [2027.5, 96, -46, -85, 17.93],
  [2027.5, 0, -13, -59, -17.49],
  [2027.5, 16, 66, -178, 0.37],
  [2027.5, 72, -87, 38, -65.44],
  [2028, 49, 20, 167, 5.10],
  [2028, 71, 5, -13, -6.47],
  [2028, 95, 14, 65, -0.51],
  [2028, 86, -85, -79, 41.09],
  [2028, 30, -36, -64, -4.65],
  [2028, 75, 79, 125, -18.59],
  [2028, 21, 6, -32, -14.34],
  [2028, 1, -76, -75, 29.87],
  [2028, 45, -46, -41, -11.68],
  [2028, 11, -22, -21, -23.24],
  [2028.5, 28, 54, -120, 15.43],
  [2028.5, 68, -58, 156, 41.57],
  [2028.5, 39, -65, -88, 29.45],
  [2028.5, 27, -23, 81, -13.27],
  [2028.5, 11, 34, 0, 1.57],
  [2028.5, 72, -62, 65, -67.87],
  [2028.5, 55, 86, 70, 67.64],
  [2028.5, 59, 32, 163, 0.15],
  [2028.5, 65, 48, 148, -9.55],
  [2028.5, 95, 30, 28, 4.56],
  [2029, 95, -60, -59, 8.58],
  [2029, 95, -70, 42, -55.06],
  [2029, 50, 87, -154, -73.48],
  [2029, 58, 32, 19, 4.11],
  [2029, 57, 34, -13, -1.89],
  [2029, 38, -76, 49, -64.28],
  [2029, 49, -50, -179, 32.11],
  [2029, 90, -55, -171, 38.65],
  [2029, 41, 42, -19, -4.13],
  [2029, 19, 46, -22, -5.65],
  [2029.5, 31, 13, -132, 9.04],
  [2029.5, 93, -2, 158, 7.09],
  [2029.5, 51, -76, 40, -56.34],
  [2029.5, 64, 22, -132, 10.23],
  [2029.5, 26, -65, 55, -63.48],
  [2029.5, 66, -21, 32, -14.63],
  [2029.5, 18, 9, -172, 9.24],
  [2029.5, 63, 88, 26, 36.52],
  [2029.5, 33, 17, 5, 0.89],
  [2029.5, 77, -18, 138, 4.45],
];

describe('magneticDeclination', () => {
  it('matches every NOAA WMM2025 test value', () => {
    for (const [year, heightKm, lat, lon, expected] of NOAA_TEST_VALUES) {
      expect(magneticDeclination(lat, lon, heightKm, year), `${year} ${lat},${lon} @${heightKm} km`).toBeCloseTo(
        expected,
        2
      );
    }
  });

  it('puts Austin a few degrees east', () => {
    const d = magneticDeclination(30.2672, -97.7431, 0, 2026.85);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(3.5);
  });

  it('refuses to extrapolate past the model window', () => {
    expect(() => magneticDeclination(30, -97, 0, 2030.5)).toThrow(RangeError);
    expect(() => magneticDeclination(30, -97, 0, 2024.9)).toThrow(RangeError);
  });
});

describe('decimalYear', () => {
  it('counts the fraction of the UTC year elapsed', () => {
    expect(decimalYear(new Date(Date.UTC(2026, 0, 1)))).toBe(2026);
    expect(decimalYear(new Date(Date.UTC(2026, 6, 2, 12)))).toBeCloseTo(2026.5, 3);
  });
});

// NOAA NCEI WMM2025_TEST_VALUES.txt (https://www.ncei.noaa.gov/sites/default/files/2025-02/WMM2025_TEST_VALUES.txt),
// all twelve rows: [year, height km, lat, lon, X nT, Y nT, Z nT, H nT, F nT, inclination °, declination °].
const NOAA_FIELD_VALUES: readonly (readonly number[])[] = [
  [2025.0, 0.0, 80.0, 0.0, 6521.6, 145.9, 54791.5, 6523.2, 55178.5, 83.21, 1.28],
  [2025.0, 0.0, 0.0, 120.0, 39677.8, -109.6, -10580.2, 39677.9, 41064.3, -14.93, -0.16],
  [2025.0, 0.0, -80.0, 240.0, 6117.5, 15751.9, -52022.5, 16898.1, 54698.2, -72.0, 68.78],
  [2025.0, 100.0, 80.0, 0.0, 6216.0, 92.4, 52598.8, 6216.7, 52964.9, 83.26, 0.85],
  [2025.0, 100.0, 0.0, 120.0, 37688.6, -96.2, -10152.1, 37688.7, 39032.1, -15.08, -0.15],
  [2025.0, 100.0, -80.0, 240.0, 5907.6, 14780.3, -49540.7, 15917.1, 52035.0, -72.19, 68.21],
  [2027.5, 0.0, 80.0, 0.0, 6500.8, 294.5, 54869.4, 6507.5, 55253.9, 83.24, 2.59],
  [2027.5, 0.0, 0.0, 120.0, 39701.6, -167.4, -10381.8, 39702.0, 41036.9, -14.65, -0.24],
  [2027.5, 0.0, -80.0, 240.0, 6200.7, 15730.3, -51783.7, 16908.3, 54474.2, -71.92, 68.49],
  [2027.5, 100.0, 80.0, 0.0, 6196.7, 233.8, 52670.5, 6201.1, 53034.3, 83.29, 2.16],
  [2027.5, 100.0, 0.0, 120.0, 37711.5, -148.7, -9969.8, 37711.8, 39007.4, -14.81, -0.23],
  [2027.5, 100.0, -80.0, 240.0, 5984.0, 14760.1, -49317.7, 15927.0, 51825.7, -72.1, 67.93],
];

describe('magneticField', () => {
  it('reproduces every component of the NOAA WMM2025 test values', () => {
    for (const [year, height, lat, lon, x, y, z, h, f, inclination, declination] of NOAA_FIELD_VALUES) {
      const field = magneticField(lat, lon, height, year);
      // Published to 0.1 nT and 0.01°.
      expect(Math.abs(field.north - x)).toBeLessThan(0.06);
      expect(Math.abs(field.east - y)).toBeLessThan(0.06);
      expect(Math.abs(field.down - z)).toBeLessThan(0.06);
      expect(Math.abs(field.horizontal - h)).toBeLessThan(0.06);
      expect(Math.abs(field.total - f)).toBeLessThan(0.06);
      expect(Math.abs(field.inclination - inclination)).toBeLessThan(0.006);
      expect(Math.abs(field.declination - declination)).toBeLessThan(0.006);
    }
  });
});

describe('magneticFieldEcef', () => {
  const DEG = Math.PI / 180;
  const A = 6378.137;
  const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);

  it('is the same vector as the NOAA test values, turned into Earth-fixed axes', () => {
    const out = [0, 0, 0];
    for (const [year, height, latDeg, lonDeg, x, y, z] of NOAA_FIELD_VALUES) {
      const lat = latDeg * DEG;
      const lon = lonDeg * DEG;
      const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
      const px = (n + height) * Math.cos(lat) * Math.cos(lon);
      const py = (n + height) * Math.cos(lat) * Math.sin(lon);
      const pz = (n * (1 - E2) + height) * Math.sin(lat);
      magneticFieldEcef(px, py, pz, year, out);
      // Geodetic north, east, down as Earth-fixed unit vectors.
      const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
      const east = [-Math.sin(lon), Math.cos(lon), 0];
      const down = [-Math.cos(lat) * Math.cos(lon), -Math.cos(lat) * Math.sin(lon), -Math.sin(lat)];
      const dot = (a: number[]) => a[0] * out[0] + a[1] * out[1] + a[2] * out[2];
      expect(Math.abs(dot(north) - x)).toBeLessThan(0.06);
      expect(Math.abs(dot(east) - y)).toBeLessThan(0.06);
      expect(Math.abs(dot(down) - z)).toBeLessThan(0.06);
    }
  });

  it('falls off as a dipole far from the Earth and stays finite on the axis', () => {
    const near = [0, 0, 0];
    const far = [0, 0, 0];
    magneticFieldEcef(0, 0, 6371.2 * 5, 2026, near);
    magneticFieldEcef(0, 0, 6371.2 * 10, 2026, far);
    const ratio = Math.hypot(...near) / Math.hypot(...far);
    expect(ratio).toBeGreaterThan(7.6);
    expect(ratio).toBeLessThan(8.4);
    expect(Number.isFinite(near[0] + near[1] + near[2])).toBe(true);
  });

  it('throws outside the validity window', () => {
    expect(() => magneticFieldEcef(7000, 0, 0, 2031, [0, 0, 0])).toThrow(RangeError);
  });
});

describe('poles', () => {
  it('puts the geomagnetic north pole where NOAA does for 2025.0', () => {
    // NCEI, "Wandering of the Geomagnetic Poles": 72.76°W, 80.79°N geocentric from the WMM2025 coefficients.
    const pole = geomagneticNorthPole(2025);
    expect(pole.lat).toBeCloseTo(80.79, 2);
    expect(pole.lon).toBeCloseTo(-72.76, 2);
  });

  it('finds dip poles where the field is vertical', () => {
    const north = magneticDipPole('north', 2025);
    const south = magneticDipPole('south', 2025);
    expect(magneticField(north.lat, north.lon, 0, 2025).horizontal).toBeLessThan(0.05);
    expect(magneticField(south.lat, south.lon, 0, 2025).horizontal).toBeLessThan(0.05);
    expect(magneticField(north.lat, north.lon, 0, 2025).inclination).toBeCloseTo(90, 3);
    expect(magneticField(south.lat, south.lon, 0, 2025).inclination).toBeCloseTo(-90, 3);
    // Not antipodes: the north one has crossed the Arctic Ocean toward Siberia, the south one lies off Adelie Land.
    expect(north.lat).toBeGreaterThan(84);
    expect(south.lat).toBeLessThan(-60);
    expect(south.lat).toBeGreaterThan(-68);
  });
});
