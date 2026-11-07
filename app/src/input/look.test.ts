import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import { createLookController, EYE_HEIGHT_M, DEFAULT_FOV_DEG } from './look';

const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const enu = enuBasis({ ...AUSTIN, alt: 0 });
const EAST = new THREE.Vector3(enu.e.x, enu.e.y, enu.e.z);
const NORTH = new THREE.Vector3(enu.n.x, enu.n.y, enu.n.z);
const UP = new THREE.Vector3(enu.u.x, enu.u.y, enu.u.z);

function forward(camera: THREE.Camera): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
}

function cameraUp(camera: THREE.Camera): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
}

function expectDirection(actual: THREE.Vector3, expected: THREE.Vector3): void {
  expect(actual.angleTo(expected)).toBeLessThan(1e-6);
}

describe('createLookController', () => {
  it('stands the camera at eye height above the user', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();
    look.updateCamera(camera, AUSTIN, null, 0);

    expect(camera.position.length()).toBeCloseTo(EARTH_RADIUS_M + EYE_HEIGHT_M, 3);
    expectDirection(camera.position.clone(), UP);
  });

  it('looks straight down at the antipode before any input', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();
    look.updateCamera(camera, AUSTIN, null, 0);

    expectDirection(forward(camera), UP.clone().negate());
  });

  it('looks where an upright phone points', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();

    look.updateCamera(camera, AUSTIN, { alpha: 0, beta: 90, gamma: 0 }, 0);
    expectDirection(forward(camera), NORTH);
    expectDirection(cameraUp(camera), UP);

    // alpha 90 = heading 270: the back camera faces west.
    look.updateCamera(camera, AUSTIN, { alpha: 90, beta: 90, gamma: 0 }, 0);
    expectDirection(forward(camera), EAST.clone().negate());
  });

  it('looks down through the Earth when the phone lies face up', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();
    look.updateCamera(camera, AUSTIN, { alpha: 0, beta: 0, gamma: 0 }, 0);

    expectDirection(forward(camera), UP.clone().negate());
    expectDirection(cameraUp(camera), NORTH);
  });

  it('rolls with a landscape screen without changing where it looks', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();
    look.updateCamera(camera, AUSTIN, { alpha: 0, beta: 90, gamma: 0 }, 90);

    expectDirection(forward(camera), NORTH);
    // Angle 90 = device turned counter-clockwise, so content-up is the
    // device's right edge (+X), which faces east in this pose.
    expectDirection(cameraUp(camera), EAST);
  });

  it('nudges heading with a horizontal drag while the gyro aims', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();
    const upright = { alpha: 0, beta: 90, gamma: 0 };
    look.updateCamera(camera, AUSTIN, upright, 0);

    // Drag right by the full viewport height = one field of view.
    look.onPointerDown(1, 0, 400);
    look.onPointerMove(1, 800, 400, 800);
    look.onPointerUp(1);
    look.updateCamera(camera, AUSTIN, upright, 0);

    // Scene follows the finger right, so the view turns left: north -> 60° west of north.
    const expected = NORTH.clone().applyAxisAngle(UP, (DEFAULT_FOV_DEG * Math.PI) / 180);
    expectDirection(forward(camera), expected);
    expect(look.getState().pitchRad).toBe(-Math.PI / 2);
  });

  it('aims with a drag when there is no attitude', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();
    look.updateCamera(camera, AUSTIN, null, 0);

    // Drag down by 1.5 fields of view: from straight down up to the horizon.
    look.onPointerDown(1, 0, 0);
    look.onPointerMove(1, 0, 1200, 800);
    look.updateCamera(camera, AUSTIN, null, 0);

    expectDirection(forward(camera), NORTH);
  });

  it('zooms in when two fingers spread', () => {
    const look = createLookController();
    look.onPointerDown(1, 100, 100);
    look.onPointerDown(2, 200, 100);
    look.onPointerMove(2, 300, 100, 800);

    expect(look.getState().fovDeg).toBeCloseTo(DEFAULT_FOV_DEG / 2, 9);
    const camera = new THREE.PerspectiveCamera();
    look.updateCamera(camera, AUSTIN, null, 0);
    expect(camera.fov).toBeCloseTo(DEFAULT_FOV_DEG / 2, 9);
  });

  it('does not turn while two fingers pinch', () => {
    const look = createLookController();
    look.onPointerDown(1, 100, 100);
    look.onPointerDown(2, 200, 100);
    look.onPointerMove(2, 300, 140, 800);

    expect(look.getState().yawRad).toBe(0);
    expect(look.getState().pitchRad).toBe(-Math.PI / 2);
  });

  it('snaps a nudged heading back to the compass, keeping the zoom', () => {
    const look = createLookController();
    const camera = new THREE.PerspectiveCamera();
    const upright = { alpha: 0, beta: 90, gamma: 0 };
    look.updateCamera(camera, AUSTIN, upright, 0);
    look.onPointerDown(1, 0, 400);
    look.onPointerMove(1, 300, 400, 800);
    look.onPointerUp(1);
    look.onKeyDown('+');
    const zoomed = look.getState().fovDeg;

    look.resetOffset();
    look.updateCamera(camera, AUSTIN, upright, 0);

    expectDirection(forward(camera), NORTH);
    expect(look.getState().headingNudgeRad).toBe(0);
    expect(look.getState().fovDeg).toBe(zoomed);
    expect(zoomed).toBeLessThan(DEFAULT_FOV_DEG);
  });

  it('resets the manual aim with R', () => {
    const look = createLookController();
    look.onKeyDown('ArrowUp');
    look.onKeyDown('ArrowLeft');
    look.onKeyDown('r');

    expect(look.getState().yawRad).toBe(0);
    expect(look.getState().pitchRad).toBe(-Math.PI / 2);
  });
});
