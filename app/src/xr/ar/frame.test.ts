import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import { earthFromXr, headingAxis, headingOfDirection, headingOfXrForward, xrYawDeg } from './frame';

const LAT = 30.27;
const LON = -97.74;
const basis = enuBasis({ lat: LAT, lon: LON, alt: 0 });
const east = new THREE.Vector3(basis.e.x, basis.e.y, basis.e.z);
const north = new THREE.Vector3(basis.n.x, basis.n.y, basis.n.z);
const up = new THREE.Vector3(basis.u.x, basis.u.y, basis.u.z);

/** A camera orientation in an ENU-like frame looking along `forward` with `top` up. */
function lookQuaternion(forward: THREE.Vector3, top: THREE.Vector3): THREE.Quaternion {
  const z = forward.clone().negate().normalize();
  const x = top.clone().cross(z).normalize();
  const y = z.clone().cross(x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Smallest difference between two headings, degrees. */
function headingError(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

describe('earthFromXr', () => {
  const portal = new THREE.Vector3(0.4, -0.02, -1.3);

  it('puts the portal on the ground under the user', () => {
    const m = earthFromXr(portal, 0, LAT, LON);
    const ground = portal.clone().applyMatrix4(m);
    expect(ground.distanceTo(up.clone().multiplyScalar(EARTH_RADIUS_M))).toBeLessThan(1e-6);
  });

  it('turns XR up into local up, and a metre into a metre', () => {
    const m = earthFromXr(portal, 123, LAT, LON);
    const above = portal.clone().add(new THREE.Vector3(0, 1.5, 0)).applyMatrix4(m);
    expect(above.length() - EARTH_RADIUS_M).toBeCloseTo(1.5, 6);
  });

  it.each([0, 90, 200, 315])('points XR -Z at heading %i', (heading) => {
    const m = earthFromXr(portal, heading, LAT, LON);
    const ahead = portal.clone().add(new THREE.Vector3(0, 0, -1)).applyMatrix4(m).sub(portal.clone().applyMatrix4(m));
    expect(headingError(headingOfDirection(ahead, east, north), heading)).toBeLessThan(1e-6);
  });
});

describe('headings', () => {
  it('reads compass headings clockwise from north', () => {
    expect(headingOfDirection(east, east, north)).toBeCloseTo(90, 9);
    expect(headingOfDirection(north.clone().negate(), east, north)).toBeCloseTo(180, 9);
    expect(xrYawDeg(new THREE.Vector3(1, 0, 0))).toBeCloseTo(90, 9);
    expect(xrYawDeg(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0, 9);
  });

  it('reads the phone top when it points at the floor', () => {
    const level = lookQuaternion(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
    expect(headingAxis(level).z).toBe(-1);
    const down = lookQuaternion(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1));
    expect(headingAxis(down).y).toBe(1);
  });

  it.each([
    ['level', 'ahead'],
    ['down at the floor', 'down'],
  ])('recovers the heading of XR -Z with the phone held %s', (_name, pose) => {
    // The room's -Z faces 250°; the phone points 40° clockwise of it, so at 290°.
    const forwardHeading = 250;
    const phoneYaw = 40;
    const yaw = (deg: number) => new THREE.Vector3(Math.sin(deg * Math.PI / 180), 0, -Math.cos(deg * Math.PI / 180));
    const flat = yaw(phoneYaw);
    const xrQ = pose === 'ahead' ? lookQuaternion(flat, new THREE.Vector3(0, 1, 0)) : lookQuaternion(new THREE.Vector3(0, -1, 0), flat);
    // The same phone in the Earth frame: heading 290°.
    const h = ((forwardHeading + phoneYaw) * Math.PI) / 180;
    const flatEarth = north.clone().multiplyScalar(Math.cos(h)).add(east.clone().multiplyScalar(Math.sin(h)));
    const earthQ = pose === 'ahead' ? lookQuaternion(flatEarth, up) : lookQuaternion(up.clone().negate(), flatEarth);
    expect(headingError(headingOfXrForward(xrQ, earthQ, LAT, LON), forwardHeading)).toBeLessThan(1e-6);
  });
});
