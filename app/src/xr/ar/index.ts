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
import { isSessionModeSupported, openSession, type SessionFactory } from '../session';

export type { SessionFactory } from '../session';

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
  /**
   * Report the current floor hit-test result for this frame. Passing null
   * means the frame found no floor, which drops back to scanning so the user
   * is prompted to keep looking rather than tapping into empty space.
   */
  onFloorHit(position: THREE.Vector3 | null): void;
  onTap(position: THREE.Vector3): void;
  getState(): ARState;
}

/** Features the portal needs: a floor-relative frame and hit-testing against it. */
export const AR_SESSION_INIT: XRSessionInit = {
  requiredFeatures: ['local-floor', 'hit-test'],
};

/**
 * Check if WebXR immersive-ar is supported.
 */
export function isARSupported(): Promise<boolean> {
  return isSessionModeSupported('immersive-ar');
}

/**
 * Create an AR controller for the magic window portal.
 *
 * Drives the placement flow: request a floor-anchored session, scan until
 * hit-testing finds the floor, then let the user tap to commit the portal.
 * A denied camera permission surfaces as permission_denied, and a session
 * the platform ends on its own returns the controller to idle.
 */
export function createARController(sessionFactory?: SessionFactory): ARController {
  let state: ARState = { phase: 'idle' };
  let session: XRSession | null = null;

  const requestSession: SessionFactory =
    sessionFactory ??
    (async () => {
      if (!navigator.xr) throw new Error('WebXR unavailable');
      return navigator.xr.requestSession('immersive-ar', AR_SESSION_INIT);
    });

  return {
    async start() {
      if (!(await isARSupported())) {
        state = { phase: 'unsupported' };
        return;
      }

      state = { phase: 'starting' };
      let outcome;
      try {
        outcome = await openSession(requestSession, (ended) => {
          if (session !== ended) return;
          session = null;
          state = { phase: 'idle' };
        });
      } catch (error) {
        state = { phase: 'idle' };
        throw error;
      }
      if (outcome.kind !== 'opened') {
        state = { phase: outcome.kind };
        return;
      }
      session = outcome.session;
      state = { phase: 'scanning' };
    },

    async stop() {
      const ending = session;
      session = null;
      state = { phase: 'idle' };
      if (ending) await ending.end();
    },

    onFloorHit(position: THREE.Vector3 | null) {
      // Only meaningful between session start and portal placement; once
      // placed the portal is anchored and later hits must not move it.
      if (state.phase !== 'scanning' && state.phase !== 'placing') return;
      state = position === null ? { phase: 'scanning' } : { phase: 'placing' };
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
 * Compute the ENU-to-world rotation from the heading the user faced when the
 * session started (degrees, clockwise from north).
 *
 * In the ENU model frame north is -Z and east is +X; in the XR world frame
 * -Z is wherever the user faced. Facing heading h, true north lies h degrees
 * counter-clockwise (seen from above) of forward, which is a +h rotation
 * about +Y.
 */
export function headingToRotation(headingDeg: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY((headingDeg * Math.PI) / 180);
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
