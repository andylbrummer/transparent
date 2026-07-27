/**
 * WebXR AR magic window portal.
 *
 * - Starts an immersive-ar session
 * - Hit-test locates floor plane
 * - User taps to place/confirm portal disc
 * - ENU frame anchored from heading sensor at session start
 * - ARCore VIO tracks the portal position
 */

import * as THREE from 'three';

export type ARState =
  | { phase: 'unsupported' }
  | { phase: 'permission_denied' }
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'scanning' }      // looking for floor
  | { phase: 'placing' }       // floor found, waiting for tap
  | { phase: 'placed'; portalPosition: THREE.Vector3 };

export interface ARController {
  start(): Promise<void>;
  stop(): Promise<void>;
  onTap(position: THREE.Vector3): void;
  getState(): ARState;
}

/**
 * Check if WebXR immersive-ar is supported.
 */
export async function isARSupported(): Promise<boolean> {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

/**
 * Create an AR controller for the magic window portal.
 * This is a scaffold — actual WebXR session management requires
 * XRSystem.requestSession() and XRReferenceSpace setup.
 */
export function createARController(): ARController {
  let state: ARState = { phase: 'idle' };

  return {
    async start() {
      const supported = await isARSupported();
      if (!supported) {
        state = { phase: 'unsupported' };
        return;
      }
      state = { phase: 'starting' };
      // Simulate session startup delay
      await new Promise((r) => setTimeout(r, 100));
      state = { phase: 'scanning' };
    },

    async stop() {
      state = { phase: 'idle' };
    },

    onTap(position: THREE.Vector3) {
      if (state.phase === 'placing') {
        state = { phase: 'placed', portalPosition: position.clone() };
      }
    },

    getState(): ARState {
      return state;
    },
  };
}

/**
 * Compute the ENU-to-world rotation matrix from a heading (degrees, clockwise from north).
 * Returns a THREE.Matrix4 that rotates the globe so north aligns with the user's heading.
 */
export function headingToRotation(headingDeg: number): THREE.Matrix4 {
  const headingRad = (headingDeg * Math.PI) / 180;
  const rot = new THREE.Matrix4();
  // Rotate around Y (up) so that -Z (nadir) points toward heading
  rot.makeRotationY(-headingRad);
  return rot;
}

/**
 * Compute the portal pose (position + rotation) from an XR hit-test result
 * and a heading sample.
 */
export function computePortalPose(
  hitPosition: THREE.Vector3,
  headingDeg: number
): { position: THREE.Vector3; rotation: THREE.Quaternion } {
  const rotMatrix = headingToRotation(headingDeg);
  const quat = new THREE.Quaternion();
  quat.setFromRotationMatrix(rotMatrix);

  return {
    position: hitPosition.clone(),
    rotation: quat,
  };
}
