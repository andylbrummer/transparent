import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import definition from './layer';
import { HALF_BAR_KM_PER_S, barGeometry, decodeStations, nullRingPositions, type SksFile, type SksStation } from './stations';

const file = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/sks-splitting.json'))) as SksFile;
const stations = decodeStations(file);

const at = (phi: number, dt = 1): SksStation => ({ lon: 0, lat: 0, phi, dt, split: 3, nulls: 0, r: 1 });

describe('the baked stations', () => {
  it('decode to places, directions and delays in range, with the counts the caption gives', () => {
    expect(stations.length).toBe(file.stations.length / file.fields);
    const split = stations.filter((s) => s.split > 0);
    expect(split.length).toBe(13352);
    expect(stations.length - split.length).toBe(268);
    expect(stations.reduce((sum, s) => sum + s.split + s.nulls, 0)).toBe(66458);
    for (const s of stations) {
      expect(Math.abs(s.lat)).toBeLessThanOrEqual(90);
      expect(s.phi).toBeGreaterThanOrEqual(0);
      expect(s.phi).toBeLessThan(180);
    }
    expect(definition.caption).toContain('13,352');
    expect(definition.caption).toContain('268');
    expect(definition.caption).toContain('66,458');
  });
});

describe('a bar', () => {
  it('runs north-south for phi 0 and east-west for phi 90, centred on the station', () => {
    const half = HALF_BAR_KM_PER_S * 1000;
    const ns = barGeometry([at(0)]).positions;
    expect(ns[2]).toBeCloseTo(-half, -1);
    expect(ns[5]).toBeCloseTo(half, -1);
    expect(Math.abs(ns[1])).toBeLessThan(1);
    const ew = barGeometry([at(90)]).positions;
    // At longitude 0, east is +y.
    expect(ew[4]).toBeCloseTo(half, -1);
    expect(Math.abs(ew[5])).toBeLessThan(1);
    // Both ends on the sphere.
    expect(Math.hypot(ew[0], ew[1], ew[2])).toBeCloseTo(EARTH_RADIUS_M, -1);
  });

  it('grows with the delay, and is dimmer where the station’s directions scatter', () => {
    const length = (g: Float32Array): number => Math.hypot(g[3] - g[0], g[4] - g[1], g[5] - g[2]);
    expect(length(barGeometry([at(0, 2)]).positions)).toBeGreaterThan(1.9 * length(barGeometry([at(0, 1)]).positions));
    const sharp = barGeometry([at(0)]).colors;
    const scattered = barGeometry([{ ...at(0), r: 0.1 }]).colors;
    expect(scattered[1]).toBeLessThan(sharp[1]);
  });

  it('is not drawn for a station of nulls only, which gets a ring instead', () => {
    const nullOnly = { ...at(0), split: 0, nulls: 2, dt: 0 };
    expect(barGeometry([nullOnly]).positions.length).toBe(0);
    expect(nullRingPositions([nullOnly]).length).toBe(60);
    expect(nullRingPositions([at(0)]).length).toBe(0);
  });
});

describe('the switch', () => {
  it('is off, inside the Earth, crediting the Montpellier database', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Inside the Earth');
    expect(definition.credits[0].source).toContain('SKS-Splitting-database');
  });
});
