import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import { createLookController } from '../input/look';
import type { SurfacePosition } from '../sensors';
import { EYE_HEIGHT_M, antipodeOf, createStandingPlace, standingPoint } from './standing-place';

const austin = { lat: 30.27, lon: -97.74 };
const austinUp = (): THREE.Vector3 => {
  const { u } = enuBasis({ ...austin, alt: 0 });
  return new THREE.Vector3(u.x, u.y, u.z);
};

describe('standingPoint', () => {
  it('stands at eye height above the sphere along the up it is given', () => {
    expect(standingPoint(new THREE.Vector3(1, 0, 0)).toArray()).toEqual([EARTH_RADIUS_M + EYE_HEIGHT_M, 0, 0]);
    const up = austinUp();
    const point = standingPoint(up);
    expect(point.length()).toBeCloseTo(EARTH_RADIUS_M + EYE_HEIGHT_M, 6);
    expect(point.clone().normalize().distanceTo(up)).toBeLessThan(1e-12);
    expect(up.toArray()).toEqual(austinUp().toArray());
  });

  it('writes into the vector it is given and returns it', () => {
    const out = new THREE.Vector3();
    expect(standingPoint(austinUp(), out)).toBe(out);
    expect(out.toArray()).toEqual(standingPoint(austinUp()).toArray());
  });

  it('is where the camera stands', () => {
    const camera = new THREE.PerspectiveCamera();
    createLookController().updateCamera(camera, austin, null, 0);
    expect(camera.position.toArray()).toEqual(standingPoint(austinUp()).toArray());
  });
});

describe('antipodeOf', () => {
  it('goes through the centre: latitude mirrored, longitude half way round, kept in -180 to 180', () => {
    expect(antipodeOf(austin)).toEqual({ lat: -30.27, lon: 82.26 });
    expect(antipodeOf({ lat: 0, lon: 0 })).toEqual({ lat: -0, lon: 180 });
    expect(antipodeOf({ lat: 10, lon: 180 })).toEqual({ lat: -10, lon: 0 });
    expect(antipodeOf({ lat: 10, lon: -180 })).toEqual({ lat: -10, lon: 0 });
  });
});

describe('createStandingPlace', () => {
  it('stands here, on the fix as it is now, until set elsewhere', () => {
    let fix: SurfacePosition | null = null;
    const standing = createStandingPlace(() => fix);
    expect(standing.place()).toEqual({ kind: 'here' });
    expect(standing.position()).toBeNull();
    fix = austin;
    expect(standing.position()).toBe(austin);
  });

  it('stands at a named place whatever the fix does', () => {
    let fix: SurfacePosition | null = austin;
    const standing = createStandingPlace(() => fix);
    standing.set({ kind: 'at', lat: 90, lon: 0, name: 'North Pole' });
    expect(standing.place()).toEqual({ kind: 'at', lat: 90, lon: 0, name: 'North Pole' });
    expect(standing.position()).toEqual({ lat: 90, lon: 0 });
    fix = null;
    expect(standing.position()).toEqual({ lat: 90, lon: 0 });
    standing.set({ kind: 'here' });
    expect(standing.position()).toBeNull();
  });

  it('stands at the far side of the fix, following it, and builds it again only when the fix changes', () => {
    let fix: SurfacePosition | null = austin;
    const standing = createStandingPlace(() => fix);
    standing.set({ kind: 'antipode' });
    const first = standing.position();
    expect(first).toEqual(antipodeOf(austin));
    expect(standing.position()).toBe(first);
    fix = { lat: 0, lon: 0 };
    expect(standing.position()).toEqual({ lat: -0, lon: 180 });
    fix = null;
    expect(standing.position()).toBeNull();
  });

  it('gives the same object every read at a named place', () => {
    const standing = createStandingPlace(() => austin);
    standing.set({ kind: 'at', lat: -77.85, lon: 166.67, name: 'McMurdo Station' });
    expect(standing.position()).toBe(standing.position());
  });

  it('refuses a place off the globe and stays where it was', () => {
    const standing = createStandingPlace(() => austin);
    expect(() => standing.set({ kind: 'at', lat: 91, lon: 0, name: 'Nowhere' })).toThrow(RangeError);
    expect(() => standing.set({ kind: 'at', lat: 0, lon: NaN, name: 'Nowhere' })).toThrow(RangeError);
    expect(standing.place()).toEqual({ kind: 'here' });
    expect(standing.position()).toBe(austin);
  });
});
