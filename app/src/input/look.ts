/**
 * First-person look controller: the camera stands where the user stands and
 * looks where the phone points.
 *
 * - Phone with a north-referenced attitude: the device pose aims the view;
 *   a one-finger drag nudges heading to correct the compass.
 * - No attitude (desktop, no compass): a one-finger/mouse drag aims the view.
 * - Two-finger pinch (or +/-) zooms by narrowing the field of view.
 * - Reset (button or R) clears the drag offset and keeps the zoom.
 *
 * World space is ECEF; the view is built in the local East-North-Up frame.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import type { DeviceAttitude, SurfacePosition } from '../sensors';

/** Camera height above the surface shell, in metres. */
export const EYE_HEIGHT_M = 1.5;

export const DEFAULT_FOV_DEG = 60;
/**
 * A fifth of a degree: about where the photographed sky reaches its own
 * resolution (an arcsecond a pixel), a galaxy a few arcminutes across fills
 * the view, and Jupiter drawn 40× life size does too.
 */
export const MIN_FOV_DEG = 0.2;
export const MAX_FOV_DEG = 100;
const KEY_STEP_RAD = 0.05;
const KEY_ZOOM_FACTOR = 1.1;
const HALF_PI = Math.PI / 2;

export interface LookState {
  /** Heading correction added to the compass, radians, counter-clockwise seen from above. */
  readonly headingNudgeRad: number;
  /** Manual aim without attitude: yaw counter-clockwise from north, radians. */
  readonly yawRad: number;
  /** Manual aim without attitude: elevation, -PI/2 (straight down) to PI/2. */
  readonly pitchRad: number;
  readonly fovDeg: number;
}

export const DEFAULT_LOOK_STATE: LookState = {
  headingNudgeRad: 0,
  yawRad: 0,
  // Straight down: the antipode, through the core.
  pitchRad: -HALF_PI,
  fovDeg: DEFAULT_FOV_DEG,
};

export interface LookController {
  onPointerDown(id: number, x: number, y: number): void;
  /** viewportHeight scales drags so the scene follows the finger 1:1. */
  onPointerMove(id: number, x: number, y: number, viewportHeight: number): void;
  onPointerUp(id: number): void;
  onKeyDown(key: string): void;
  /**
   * Stand the camera at `position` and aim it from `attitude` (or the manual
   * aim when null). `screenAngleDeg` is the screen's rotation from portrait.
   */
  updateCamera(
    camera: THREE.PerspectiveCamera,
    position: SurfacePosition,
    attitude: DeviceAttitude | null,
    screenAngleDeg: number
  ): void;
  getState(): LookState;
  /**
   * Clear the drag offset - heading nudge and manual aim - so the view
   * snaps back to where the phone points. Zoom is the user's own choice
   * and is kept.
   */
  resetOffset(): void;
  /**
   * Aim the manual view: yaw counter-clockwise from north and elevation,
   * radians, and optionally the field of view in degrees. For scripted
   * views (screenshots, tours); a phone's attitude still overrides it.
   */
  setAim(yawRad: number, pitchRad: number, fovDeg?: number): void;
}

const DEG = Math.PI / 180;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

export function createLookController(): LookController {
  let state: LookState = { ...DEFAULT_LOOK_STATE };
  let gyroActive = false;
  const pointers = new Map<number, { x: number; y: number }>();

  // Per-frame scratch, so aiming the camera never allocates.
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const basisQuat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const localQuat = new THREE.Quaternion();
  const stepQuat = new THREE.Quaternion();

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function zoom(factor: number): void {
    state = { ...state, fovDeg: clamp(state.fovDeg * factor, MIN_FOV_DEG, MAX_FOV_DEG) };
  }

  /** Turn the view by a scene displacement, in radians, that follows the finger. */
  function turn(dxRad: number, dyRad: number): void {
    if (gyroActive) {
      state = { ...state, headingNudgeRad: state.headingNudgeRad + dxRad };
    } else {
      state = {
        ...state,
        yawRad: state.yawRad + dxRad,
        pitchRad: clamp(state.pitchRad + dyRad, -HALF_PI, HALF_PI),
      };
    }
  }

  function resetOffset(): void {
    state = { ...DEFAULT_LOOK_STATE, fovDeg: state.fovDeg };
  }

  function pinchDistance(): number {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  return {
    onPointerDown(id, x, y) {
      pointers.set(id, { x, y });
    },

    onPointerMove(id, x, y, viewportHeight) {
      const previous = pointers.get(id);
      if (!previous) return;
      if (pointers.size === 1) {
        const radPerPixel = (state.fovDeg * DEG) / viewportHeight;
        turn((x - previous.x) * radPerPixel, (y - previous.y) * radPerPixel);
        pointers.set(id, { x, y });
      } else if (pointers.size === 2) {
        const before = pinchDistance();
        pointers.set(id, { x, y });
        const after = pinchDistance();
        // Fingers apart -> narrower field of view -> magnified.
        if (before > 0 && after > 0) zoom(before / after);
      } else {
        pointers.set(id, { x, y });
      }
    },

    onPointerUp(id) {
      pointers.delete(id);
    },

    onKeyDown(key) {
      switch (key) {
        case 'ArrowLeft':
          turn(KEY_STEP_RAD, 0);
          break;
        case 'ArrowRight':
          turn(-KEY_STEP_RAD, 0);
          break;
        case 'ArrowUp':
          turn(0, KEY_STEP_RAD);
          break;
        case 'ArrowDown':
          turn(0, -KEY_STEP_RAD);
          break;
        case '+':
        case '=':
          zoom(1 / KEY_ZOOM_FACTOR);
          break;
        case '-':
        case '_':
          zoom(KEY_ZOOM_FACTOR);
          break;
        case 'r':
        case 'R':
          resetOffset();
          break;
      }
    },

    updateCamera(camera, position, attitude, screenAngleDeg) {
      gyroActive = attitude !== null;

      const enu = enuBasis({ lat: position.lat, lon: position.lon, alt: 0 });
      east.set(enu.e.x, enu.e.y, enu.e.z);
      north.set(enu.n.x, enu.n.y, enu.n.z);
      up.set(enu.u.x, enu.u.y, enu.u.z);
      camera.position.copy(up).multiplyScalar(EARTH_RADIUS_M + EYE_HEIGHT_M);
      basisQuat.setFromRotationMatrix(basis.makeBasis(east, north, up));

      if (attitude) {
        // W3C device frame in ENU: Rz(alpha)·Rx(beta)·Ry(gamma). The camera
        // shares the device axes (looks out the back along -Z, +Y toward the
        // top edge), then rolls with the screen and takes the heading nudge.
        euler.set(attitude.beta * DEG, attitude.gamma * DEG, attitude.alpha * DEG, 'ZXY');
        localQuat.setFromEuler(euler);
        localQuat.multiply(stepQuat.setFromAxisAngle(Z_AXIS, -screenAngleDeg * DEG));
        localQuat.premultiply(stepQuat.setFromAxisAngle(Z_AXIS, state.headingNudgeRad));
      } else {
        // Rx(PI/2) turns a down-looking camera to face north on the horizon.
        localQuat.setFromAxisAngle(X_AXIS, HALF_PI + state.pitchRad);
        localQuat.premultiply(stepQuat.setFromAxisAngle(Z_AXIS, state.yawRad));
      }
      camera.quaternion.copy(basisQuat).multiply(localQuat);

      if (camera.fov !== state.fovDeg) {
        camera.fov = state.fovDeg;
        camera.updateProjectionMatrix();
      }
    },

    getState() {
      return state;
    },

    resetOffset,

    setAim(yawRad, pitchRad, fovDeg) {
      state = {
        ...state,
        yawRad,
        pitchRad: clamp(pitchRad, -HALF_PI, HALF_PI),
        fovDeg: fovDeg === undefined ? state.fovDeg : clamp(fovDeg, MIN_FOV_DEG, MAX_FOV_DEG),
      };
    },
  };
}
