/**
 * Gyro/desktop fallback input controller.
 *
 * - Touch orbit (one-finger drag to rotate, two-finger pinch to zoom)
 * - Keyboard controls (arrow keys to rotate, +/- to zoom, R to reset)
 * - Works on any phone/desktop without WebXR
 */

import * as THREE from 'three';

export interface OrbitState {
  /** Camera distance from target */
  distance: number;
  /** Horizontal rotation angle in radians */
  azimuth: number;
  /** Vertical rotation angle in radians (0 = equator, PI/2 = north pole) */
  polar: number;
  /** Target point to orbit around */
  target: THREE.Vector3;
}

export const DEFAULT_ORBIT_STATE: OrbitState = {
  distance: 15_000_000, // ~2.4× Earth radius
  azimuth: 0,
  polar: Math.PI / 4,
  target: new THREE.Vector3(0, 0, 0),
};

export interface OrbitController {
  /** Update camera from current orbit state */
  updateCamera(camera: THREE.Camera): void;
  /** Handle touch start */
  onTouchStart(x: number, y: number, touches: number): void;
  /** Handle touch move */
  onTouchMove(x: number, y: number, touches: number): void;
  /** Handle touch end */
  onTouchEnd(): void;
  /** Handle keyboard input */
  onKeyDown(key: string): void;
  /** Get current orbit state */
  getState(): OrbitState;
  /** Reset to default */
  reset(): void;
}

/** Sensitivity multipliers */
const TOUCH_ROTATE_SENSITIVITY = 0.005;
const TOUCH_ZOOM_SENSITIVITY = 0.01;
const KEY_ROTATE_STEP = 0.05;
const KEY_ZOOM_STEP = 0.1;

/** Clamp polar angle to avoid gimbal lock */
const MIN_POLAR = 0.01;
const MAX_POLAR = Math.PI - 0.01;

/** Clamp distance */
const MIN_DISTANCE = 7_000_000;
const MAX_DISTANCE = 50_000_000;

export function createOrbitController(initial?: Partial<OrbitState>): OrbitController {
  const state: OrbitState = {
    ...DEFAULT_ORBIT_STATE,
    ...initial,
    target: initial?.target?.clone() ?? DEFAULT_ORBIT_STATE.target.clone(),
  };

  let lastTouchX = 0;
  let lastTouchY = 0;
  let lastPinchDist = 0;
  let isDragging = false;

  function clampState(): void {
    state.polar = Math.max(MIN_POLAR, Math.min(MAX_POLAR, state.polar));
    state.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, state.distance));
  }

  function updateCamera(camera: THREE.Camera): void {
    clampState();

    const sinPolar = Math.sin(state.polar);
    const cosPolar = Math.cos(state.polar);
    const sinAzimuth = Math.sin(state.azimuth);
    const cosAzimuth = Math.cos(state.azimuth);

    const x = state.distance * sinPolar * sinAzimuth;
    const y = state.distance * cosPolar;
    const z = state.distance * sinPolar * cosAzimuth;

    camera.position.set(x, y, z);
    camera.lookAt(state.target);
  }

  return {
    updateCamera,

    onTouchStart(x: number, y: number, touches: number): void {
      lastTouchX = x;
      lastTouchY = y;
      isDragging = true;
      if (touches === 2) {
        // Pinch start — distance will be computed on first move
        lastPinchDist = 0;
      }
    },

    onTouchMove(x: number, y: number, touches: number): void {
      if (!isDragging) return;

      if (touches === 1) {
        // One-finger orbit
        const dx = x - lastTouchX;
        const dy = y - lastTouchY;
        state.azimuth -= dx * TOUCH_ROTATE_SENSITIVITY;
        state.polar += dy * TOUCH_ROTATE_SENSITIVITY;
      } else if (touches === 2 && lastPinchDist > 0) {
        // Two-finger pinch zoom
        // x here is the pinch distance between two touches
        const pinchDelta = x - lastPinchDist;
        state.distance *= 1 - pinchDelta * TOUCH_ZOOM_SENSITIVITY;
      }

      lastTouchX = x;
      lastTouchY = y;
      if (touches === 2) {
        lastPinchDist = x;
      }
    },

    onTouchEnd(): void {
      isDragging = false;
      lastPinchDist = 0;
    },

    onKeyDown(key: string): void {
      switch (key) {
        case 'ArrowLeft':
          state.azimuth -= KEY_ROTATE_STEP;
          break;
        case 'ArrowRight':
          state.azimuth += KEY_ROTATE_STEP;
          break;
        case 'ArrowUp':
          state.polar -= KEY_ROTATE_STEP;
          break;
        case 'ArrowDown':
          state.polar += KEY_ROTATE_STEP;
          break;
        case '+':
        case '=':
          state.distance *= 1 - KEY_ZOOM_STEP;
          break;
        case '-':
        case '_':
          state.distance *= 1 + KEY_ZOOM_STEP;
          break;
        case 'r':
        case 'R':
          state.azimuth = DEFAULT_ORBIT_STATE.azimuth;
          state.polar = DEFAULT_ORBIT_STATE.polar;
          state.distance = DEFAULT_ORBIT_STATE.distance;
          break;
      }
      clampState();
    },

    getState(): OrbitState {
      return {
        distance: state.distance,
        azimuth: state.azimuth,
        polar: state.polar,
        target: state.target.clone(),
      };
    },

    reset(): void {
      state.azimuth = DEFAULT_ORBIT_STATE.azimuth;
      state.polar = DEFAULT_ORBIT_STATE.polar;
      state.distance = DEFAULT_ORBIT_STATE.distance;
      state.target.copy(DEFAULT_ORBIT_STATE.target);
      isDragging = false;
      lastPinchDist = 0;
    },
  };
}

/**
 * Convert spherical (azimuth, polar, distance) to Cartesian coordinates.
 */
export function sphericalToCartesian(
  azimuth: number,
  polar: number,
  distance: number
): THREE.Vector3 {
  const sinPolar = Math.sin(polar);
  const cosPolar = Math.cos(polar);
  const sinAzimuth = Math.sin(azimuth);
  const cosAzimuth = Math.cos(azimuth);

  return new THREE.Vector3(
    distance * sinPolar * sinAzimuth,
    distance * cosPolar,
    distance * sinPolar * cosAzimuth
  );
}
