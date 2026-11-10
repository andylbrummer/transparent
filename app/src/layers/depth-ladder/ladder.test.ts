import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import type { LabelData } from '../../render/labels';
import {
  RING_FIRST_DEG,
  RING_STEP_DEG,
  antipodeOf,
  distanceKm,
  nearestCityText,
  pointBelow,
  ringRadiusKm,
  ringSegments,
  rungNameText,
  rungValuesText,
  screenDown,
  upVector,
  type Rung,
} from './ladder';
import depthLadder from './layer';

const AUSTIN = { lat: 30.27, lon: -97.74 };
/** Rows of app/public/geo/depth-ladder.json. */
const CMB: Rung = { depthKm: 2891, name: 'core–mantle boundary', pressureGPa: 135.75, densityGcm3: [5.57, 9.9], temperatureK: [2937, 3637] };
const THOUSAND: Rung = { depthKm: 1000, pressureGPa: 38.61, densityGcm3: [4.58], temperatureK: [2142] };

describe('pointBelow', () => {
  it('goes straight down: the surface at 0, the centre at one radius, the antipode at two', () => {
    const up = upVector(AUSTIN, new THREE.Vector3());
    const p = new THREE.Vector3();
    expect(pointBelow(AUSTIN, 0, p).distanceTo(up.clone().multiplyScalar(EARTH_RADIUS_M))).toBeLessThan(1e-3);
    expect(pointBelow(AUSTIN, EARTH_RADIUS_M / 1000, p).length()).toBeLessThan(1e-3);
    expect(pointBelow(AUSTIN, (2 * EARTH_RADIUS_M) / 1000, p).distanceTo(up.clone().multiplyScalar(-EARTH_RADIUS_M))).toBeLessThan(1e-3);
    const antipode = antipodeOf(AUSTIN);
    expect(antipode).toEqual({ lat: -30.27, lon: 82.26 });
    expect(upVector(antipode, new THREE.Vector3()).dot(up)).toBeCloseTo(-1, 9);
  });
});

describe('the rings', () => {
  it('look evenly spaced from the top: each subtends its own angle at the user', () => {
    const eye = pointBelow(AUSTIN, 0, new THREE.Vector3());
    const down = upVector(AUSTIN, new THREE.Vector3()).negate();
    [12742, 6371, 2891, 100].forEach((distance, k) => {
      const out: number[] = [];
      ringSegments(AUSTIN, distance, ringRadiusKm(distance, k), out);
      expect(out).toHaveLength(72 * 6);
      const point = new THREE.Vector3();
      for (let i = 0; i < out.length; i += 3) {
        const angle = (point.fromArray(out, i).sub(eye).angleTo(down) * 180) / Math.PI;
        expect(angle).toBeCloseTo(RING_FIRST_DEG + RING_STEP_DEG * k, 6);
      }
    });
  });

  it('are level: every point of a ring is at one depth along the line', () => {
    const out: number[] = [];
    ringSegments(AUSTIN, 2891, 500, out);
    const up = upVector(AUSTIN, new THREE.Vector3());
    for (let i = 0; i < out.length; i += 3) {
      expect(new THREE.Vector3().fromArray(out, i).dot(up)).toBeCloseTo(EARTH_RADIUS_M - 2_891_000, 0);
    }
  });
});

describe('rung texts', () => {
  it('name a boundary and its depth, or the depth alone', () => {
    expect(rungNameText(CMB)).toBe('core–mantle boundary · 2,891 km');
    expect(rungNameText(THOUSAND)).toBe('1,000 km');
  });

  it('give pressure, temperature and density, both sides of a discontinuity', () => {
    expect(rungValuesText(CMB)).toBe('136 GPa · 2,937→3,637 K · 5.57→9.90 g/cm³');
    expect(rungValuesText(THOUSAND)).toBe('38.6 GPa · 2,142 K · 4.58 g/cm³');
  });
});

describe('the antipode’s nearest city', () => {
  const places: LabelData = {
    labels: [
      { kind: 'city', name: 'Port Louis', lon: 57.5, lat: -20.17, priority: 3 },
      { kind: 'city', name: 'Perth', lon: 115.86, lat: -31.95, priority: 3 },
      { kind: 'country', name: 'Nearer Than Both', lon: 82, lat: -30, priority: 1 },
    ],
  };

  it('is the nearest city, not the nearest label, with its distance', () => {
    // Austin's antipode is in the Indian Ocean, 2,720 km from Port Louis and 3,180 km from Perth.
    expect(nearestCityText(antipodeOf(AUSTIN), places)).toBe('nearest city: Port Louis, 2,720 km');
    expect(distanceKm(antipodeOf(AUSTIN), { lat: -31.95, lon: 115.86 })).toBeGreaterThan(3000);
  });

  it('is absent when the map has no cities', () => {
    expect(nearestCityText(antipodeOf(AUSTIN), { labels: [] })).toBeNull();
  });
});

describe('screenDown', () => {
  it('is the camera’s down, flattened onto the level', () => {
    const up = new THREE.Vector3(0, 0, 1);
    const camera = new THREE.PerspectiveCamera();
    // Looking straight down the line with the top of the screen to +y: screen-down is −y.
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const down = screenDown(camera, up, new THREE.Vector3());
    expect(down).not.toBeNull();
    expect(down!.x).toBeCloseTo(0, 6);
    expect(down!.y).toBeCloseTo(-1, 6);
    expect(down!.z).toBeCloseTo(0, 6);
  });

  it('is undefined when the camera’s up is the line itself', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.lookAt(1, 0, 0);
    camera.updateMatrixWorld();
    expect(screenDown(camera, new THREE.Vector3(0, 0, 1), new THREE.Vector3())).toBeNull();
  });
});

describe('the depth ladder layer', () => {
  it('is inside the Earth, off until asked for, and says what is model and what is estimate', () => {
    expect(depthLadder.id).toBe('depth-ladder');
    expect(depthLadder.section).toBe('Inside the Earth');
    expect(depthLadder.defaultOn).toBeUndefined();
    expect(depthLadder.caption).toContain('PREM, a radial average');
    expect(depthLadder.caption).toContain('temperature is an estimate (Anderson 1982)');
  });
});
