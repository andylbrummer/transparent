/**
 * VR Cardboard stereo controller.
 *
 * - WebXR immersive-vr session
 * - Fully virtual scene (glass platform above globe, no camera feed)
 * - 0.7× resolution scale for thermal budget
 * - Integrates with ThermalProxy for adaptive quality
 */

import * as THREE from 'three';
import { type ThermalProxy } from '../../perf/thermal';

export type VRState =
  | { phase: 'unsupported' }
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'running'; session: XRSession }
  | { phase: 'ending' }
  | { phase: 'thermal_limited'; message: string };

export interface VRController {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): VRState;
  getResolutionScale(): number;
}

/** Default resolution scale for Cardboard (0.7×) */
export const DEFAULT_RESOLUTION_SCALE = 0.7;

/** Soft cap session duration in ms (10 minutes) */
export const SESSION_SOFT_CAP_MS = 10 * 60 * 1000;

/** Clock provider for testability */
export type NowProvider = () => number;

/**
 * Check if WebXR immersive-vr is supported.
 */
export async function isVRSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/**
 * Create a VR controller for Cardboard stereo mode.
 */
export function createVRController(thermalProxy?: ThermalProxy, nowProvider?: NowProvider): VRController {
  const now = nowProvider ?? performance.now.bind(performance);
  let state: VRState = { phase: 'idle' };
  const resolutionScale = DEFAULT_RESOLUTION_SCALE;
  let sessionStartTime = 0;

  return {
    async start() {
      const supported = await isVRSupported();
      if (!supported) {
        state = { phase: 'unsupported' };
        return;
      }
      state = { phase: 'starting' };
      // Actual session would be requested here; scaffold simulates
      await new Promise((r) => setTimeout(r, 50));
      state = { phase: 'running', session: {} as XRSession };
      sessionStartTime = now();
    },

    async stop() {
      state = { phase: 'ending' };
      await new Promise((r) => setTimeout(r, 50));
      state = { phase: 'idle' };
      sessionStartTime = 0;
    },

    getState(): VRState {
      // Check thermal state if proxy available
      if (thermalProxy && state.phase === 'running') {
        const msg = thermalProxy.sessionMessage();
        if (msg && thermalProxy.getState() === 'critical') {
          return { phase: 'thermal_limited', message: msg };
        }
      }
      // Check soft cap
      if (state.phase === 'running' && sessionStartTime > 0) {
        const elapsed = now() - sessionStartTime;
        if (elapsed > SESSION_SOFT_CAP_MS) {
          return { phase: 'thermal_limited', message: 'Session soft cap reached (10 min). Consider a break.' };
        }
      }
      return state;
    },

    getResolutionScale(): number {
      // Adjust resolution scale based on thermal state
      if (thermalProxy) {
        const quality = thermalProxy.shellQuality();
        // Scale between 0.5× and 0.7× based on quality
        return 0.5 + 0.2 * quality;
      }
      return resolutionScale;
    },
  };
}

/**
 * Create a glass platform scene for VR mode.
 * User floats above the transparent globe on a reflective glass disc.
 */
export function createGlassPlatform(): THREE.Group {
  const group = new THREE.Group();

  // Glass disc (platform)
  const discGeometry = new THREE.CircleGeometry(3, 64);
  const discMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.3,
    roughness: 0.05,
    metalness: 0.1,
    transmission: 0.6,
    thickness: 0.5,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(discGeometry, discMaterial);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0;
  group.add(disc);

  // Subtle rim light ring
  const ringGeometry = new THREE.RingGeometry(2.9, 3.1, 64);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x44aaff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  group.add(ring);

  return group;
}

/**
 * Compute VR camera position for the glass platform view.
 * User stands at origin, looking down at the globe below.
 */
export function computeVRCameraPose(): {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
} {
  const position = new THREE.Vector3(0, 2, 0); // 2m above platform
  const rotation = new THREE.Quaternion();
  rotation.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); // Look down
  return { position, rotation };
}
