import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GFS_NI, GFS_NJ } from './gfs';
import { TEMPERATURE_RAMP, rampColor } from './ramps';
import { formatSubsolar, sunDirection, temperatureTexels, WEATHER_ORDER } from './shells';
import { RENDER_ORDER } from '../../render/order';

const DEG = Math.PI / 180;

/**
 * The subsolar point from JPL Horizons (queried 2026-11-10): the Sun's
 * apparent right ascension and declination and the apparent sidereal time
 * for an observer at 0°N 0°E (quantities 2 and 7), as longitude = RA −
 * sidereal time and latitude = declination. Horizons places the observer
 * on the surface, not at the Earth's centre: that parallax is under 0.003°.
 */
const HORIZONS: readonly (readonly [utc: string, lonDeg: number, latDeg: number])[] = [
  ['2024-02-29T12:00:00Z', 3.0989, -7.67304],
  ['2026-03-20T14:46:00Z', -39.65111, 0.00009],
  ['2026-06-21T08:25:00Z', 54.19829, 23.43846],
  ['2026-11-09T06:00:00Z', 85.95246, -16.86834],
  ['2026-11-10T00:00:00Z', 175.96658, -17.08042],
  ['2026-12-21T20:50:00Z', -132.93987, -23.43677],
  ['2030-07-04T17:30:00Z', -81.37039, 22.81901],
];

describe('sunDirection', () => {
  it('points at the subsolar point JPL Horizons gives, within 0.02°', () => {
    const sun = new THREE.Vector3();
    const reference = new THREE.Vector3();
    let worst = 0;
    for (const [utc, lon, lat] of HORIZONS) {
      sunDirection(new Date(utc), sun);
      reference.set(Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG));
      expect(sun.length()).toBeCloseTo(1, 9);
      worst = Math.max(worst, sun.angleTo(reference) / DEG);
    }
    // Measured: 0.008° at worst. 0.02° is 2 km on the ground, a hair beside the twilight band.
    expect(worst).toBeLessThan(0.02);
  });

  it('puts the Sun over the equator at an equinox and the tropics at the solstices', () => {
    const sun = new THREE.Vector3();
    expect(Math.asin(sunDirection(new Date('2026-03-20T14:46:00Z'), sun).z) / DEG).toBeCloseTo(0, 1);
    expect(Math.asin(sunDirection(new Date('2026-06-21T08:25:00Z'), sun).z) / DEG).toBeCloseTo(23.44, 1);
    expect(Math.asin(sunDirection(new Date('2026-12-21T20:50:00Z'), sun).z) / DEG).toBeCloseTo(-23.44, 1);
  });

  it('names the subsolar point for the chip', () => {
    expect(formatSubsolar(new Date('2026-11-10T00:00:00Z'))).toBe('17.1°S 176.0°E');
    expect(formatSubsolar(new Date('2026-06-21T08:25:00Z'))).toBe('23.4°N 54.2°E');
    expect(formatSubsolar(new Date('2030-07-04T17:30:00Z'))).toBe('22.8°N 81.4°W');
  });
});

describe('temperatureTexels', () => {
  const celsius = new Float32Array(GFS_NI * GFS_NJ).fill(10);
  // GFS rows run north to south: row 0 is the North Pole.
  celsius.fill(-40, 0, GFS_NI);
  celsius.fill(-60, (GFS_NJ - 1) * GFS_NI);
  // 30 °C at the equator, 100°E.
  celsius[90 * GFS_NI + 100] = 30;
  const texels = temperatureTexels(celsius);
  const texel = (row: number, column: number): number[] => Array.from(texels.subarray((row * GFS_NI + column) * 4, (row * GFS_NI + column) * 4 + 4));
  const rounded = (value: number): number[] => [...rampColor(TEMPERATURE_RAMP, value).map(Math.round), 255];

  it('is one opaque texel per grid point', () => {
    expect(texels).toHaveLength(GFS_NI * GFS_NJ * 4);
    expect(texel(50, 50)).toEqual(rounded(10));
  });

  it('puts the South Pole in the first texture row and the North Pole in the last', () => {
    expect(texel(0, 0)).toEqual(rounded(-60));
    expect(texel(GFS_NJ - 1, 0)).toEqual(rounded(-40));
  });

  it('keeps the grid columns: column i is i°E', () => {
    expect(texel(90, 100)).toEqual(rounded(30));
    expect(texel(90, 101)).toEqual(rounded(10));
  });
});

describe('WEATHER_ORDER', () => {
  it('stacks the shells between the globe and the coastlines, wind on top', () => {
    const order = [WEATHER_ORDER.temperature, WEATHER_ORDER.clouds, WEATHER_ORDER.precipitation, WEATHER_ORDER.wind];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect(order[0]).toBeGreaterThan(RENDER_ORDER.sky);
    expect(order[order.length - 1]).toBeLessThan(RENDER_ORDER.outlines);
  });
});
