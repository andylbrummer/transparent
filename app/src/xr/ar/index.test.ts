import { describe, it, expect } from 'vitest';
import {
  createARController,
  isARSupported,
  headingToRotation,
  computePortalPose,
} from './index';
import * as THREE from 'three';

describe('isARSupported', () => {
  it('returns false when navigator.xr is absent', async () => {
    const result = await isARSupported();
    // In Node/jsdom, navigator.xr is undefined
    expect(result).toBe(false);
  });
});

describe('createARController', () => {
  it('starts in unsupported state when navigator.xr absent', async () => {
    const controller = createARController();
    await controller.start();
    expect(controller.getState().phase).toBe('unsupported');
  });

  it('transitions through phases', async () => {
    const controller = createARController();
    expect(controller.getState().phase).toBe('idle');

    // Mock navigator.xr for testing
    const originalXR = (globalThis as any).navigator?.xr;
    (globalThis as any).navigator = {
      xr: {
        isSessionSupported: async () => true,
      },
    };

    await controller.start();
    // After start, should be scanning (or placing if we had hit-test)
    expect(['scanning', 'placing', 'placed']).toContain(controller.getState().phase);

    // Restore
    if (originalXR) {
      (globalThis as any).navigator.xr = originalXR;
    }
  });

  it('stops back to idle', async () => {
    const controller = createARController();
    await controller.stop();
    expect(controller.getState().phase).toBe('idle');
  });
});

describe('headingToRotation', () => {
  it('returns identity for 0° heading', () => {
    const rot = headingToRotation(0);
    const vec = new THREE.Vector3(0, 0, -1).applyMatrix4(rot);
    expect(vec.x).toBeCloseTo(0, 5);
    expect(vec.z).toBeCloseTo(-1, 5);
  });

  it('rotates 90° heading correctly', () => {
    const rot = headingToRotation(90);
    const vec = new THREE.Vector3(0, 0, -1).applyMatrix4(rot);
    // -Z rotated 90° CCW around Y → points toward +X (east)
    expect(vec.x).toBeCloseTo(1, 5);
    expect(vec.z).toBeCloseTo(0, 5);
  });
});

describe('computePortalPose', () => {
  it('returns position and rotation from hit + heading', () => {
    const hit = new THREE.Vector3(1, 0, 2);
    const pose = computePortalPose(hit, 45);
    expect(pose.position.x).toBe(1);
    expect(pose.position.z).toBe(2);
    expect(pose.rotation).toBeInstanceOf(THREE.Quaternion);
  });
});
