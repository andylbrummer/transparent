import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import { createLookController } from '../input/look';
import { EYE_HEIGHT_M, standingPoint } from './standing-place';

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
