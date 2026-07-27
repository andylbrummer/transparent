import { describe, it, expect } from 'vitest';
import {
  createOrbitController,
  DEFAULT_ORBIT_STATE,
  sphericalToCartesian,
} from './orbit';
import * as THREE from 'three';

describe('createOrbitController', () => {
  it('creates with default state', () => {
    const controller = createOrbitController();
    const state = controller.getState();
    expect(state.distance).toBe(DEFAULT_ORBIT_STATE.distance);
    expect(state.azimuth).toBe(DEFAULT_ORBIT_STATE.azimuth);
    expect(state.polar).toBe(DEFAULT_ORBIT_STATE.polar);
  });

  it('accepts custom initial state', () => {
    const controller = createOrbitController({ distance: 10_000_000, azimuth: 1 });
    const state = controller.getState();
    expect(state.distance).toBe(10_000_000);
    expect(state.azimuth).toBe(1);
  });

  it('updates camera position', () => {
    const controller = createOrbitController();
    const camera = new THREE.PerspectiveCamera();
    controller.updateCamera(camera);
    expect(camera.position.length()).toBeGreaterThan(0);
  });

  it('orbits on touch drag (one finger)', () => {
    const controller = createOrbitController();
    const initialAzimuth = controller.getState().azimuth;

    controller.onTouchStart(100, 100, 1);
    controller.onTouchMove(200, 100, 1); // Drag right
    controller.onTouchEnd();

    const newAzimuth = controller.getState().azimuth;
    expect(newAzimuth).not.toBe(initialAzimuth);
  });

  it('zooms on pinch (two fingers)', () => {
    const controller = createOrbitController();
    const initialDistance = controller.getState().distance;

    controller.onTouchStart(0, 0, 2);
    // First move sets baseline
    controller.onTouchMove(100, 0, 2);
    // Second move zooms
    controller.onTouchMove(150, 0, 2);
    controller.onTouchEnd();

    const newDistance = controller.getState().distance;
    expect(newDistance).not.toBe(initialDistance);
  });

  it('rotates left with ArrowLeft', () => {
    const controller = createOrbitController();
    const initialAzimuth = controller.getState().azimuth;
    controller.onKeyDown('ArrowLeft');
    expect(controller.getState().azimuth).toBeLessThan(initialAzimuth);
  });

  it('rotates right with ArrowRight', () => {
    const controller = createOrbitController();
    const initialAzimuth = controller.getState().azimuth;
    controller.onKeyDown('ArrowRight');
    expect(controller.getState().azimuth).toBeGreaterThan(initialAzimuth);
  });

  it('moves up with ArrowUp', () => {
    const controller = createOrbitController();
    const initialPolar = controller.getState().polar;
    controller.onKeyDown('ArrowUp');
    expect(controller.getState().polar).toBeLessThan(initialPolar);
  });

  it('moves down with ArrowDown', () => {
    const controller = createOrbitController();
    const initialPolar = controller.getState().polar;
    controller.onKeyDown('ArrowDown');
    expect(controller.getState().polar).toBeGreaterThan(initialPolar);
  });

  it('zooms in with +', () => {
    const controller = createOrbitController();
    const initialDistance = controller.getState().distance;
    controller.onKeyDown('+');
    expect(controller.getState().distance).toBeLessThan(initialDistance);
  });

  it('zooms out with -', () => {
    const controller = createOrbitController();
    const initialDistance = controller.getState().distance;
    controller.onKeyDown('-');
    expect(controller.getState().distance).toBeGreaterThan(initialDistance);
  });

  it('resets with R key', () => {
    const controller = createOrbitController();
    controller.onKeyDown('ArrowLeft');
    controller.onKeyDown('ArrowLeft');
    controller.onKeyDown('+');
    expect(controller.getState().azimuth).not.toBe(DEFAULT_ORBIT_STATE.azimuth);

    controller.onKeyDown('R');
    const state = controller.getState();
    expect(state.azimuth).toBe(DEFAULT_ORBIT_STATE.azimuth);
    expect(state.polar).toBe(DEFAULT_ORBIT_STATE.polar);
    expect(state.distance).toBe(DEFAULT_ORBIT_STATE.distance);
  });

  it('clamps polar angle', () => {
    const controller = createOrbitController();
    // Try to go past north pole
    for (let i = 0; i < 100; i++) {
      controller.onKeyDown('ArrowUp');
    }
    expect(controller.getState().polar).toBeGreaterThan(0);
    expect(controller.getState().polar).toBeLessThan(Math.PI);
  });

  it('clamps distance', () => {
    const controller = createOrbitController();
    // Zoom in excessively
    for (let i = 0; i < 100; i++) {
      controller.onKeyDown('+');
    }
    expect(controller.getState().distance).toBeGreaterThanOrEqual(7_000_000);
  });

  it('resets to default', () => {
    const controller = createOrbitController();
    controller.onKeyDown('ArrowLeft');
    controller.onKeyDown('+');
    controller.reset();
    const state = controller.getState();
    expect(state.azimuth).toBe(DEFAULT_ORBIT_STATE.azimuth);
    expect(state.polar).toBe(DEFAULT_ORBIT_STATE.polar);
    expect(state.distance).toBe(DEFAULT_ORBIT_STATE.distance);
  });
});

describe('sphericalToCartesian', () => {
  it('returns a Vector3', () => {
    const vec = sphericalToCartesian(0, Math.PI / 2, 10);
    expect(vec).toBeInstanceOf(THREE.Vector3);
  });

  it('places point on +Y axis when polar=0', () => {
    const vec = sphericalToCartesian(0, 0, 10);
    expect(vec.x).toBeCloseTo(0, 5);
    expect(vec.y).toBeCloseTo(10, 5);
    expect(vec.z).toBeCloseTo(0, 5);
  });

  it('places point on equator when polar=PI/2', () => {
    const vec = sphericalToCartesian(0, Math.PI / 2, 10);
    expect(vec.x).toBeCloseTo(0, 5);
    expect(vec.y).toBeCloseTo(0, 5);
    expect(vec.z).toBeCloseTo(10, 5);
  });
});
