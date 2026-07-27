import { describe, it, expect } from 'vitest';
import {
  createVRController,
  isVRSupported,
  createGlassPlatform,
  computeVRCameraPose,
  DEFAULT_RESOLUTION_SCALE,
  SESSION_SOFT_CAP_MS,
} from './index';
import { ThermalProxy } from '../../perf/thermal';
import * as THREE from 'three';

describe('isVRSupported', () => {
  it('returns false when navigator.xr is absent', async () => {
    const result = await isVRSupported();
    expect(result).toBe(false);
  });
});

describe('createVRController', () => {
  it('starts in idle state', () => {
    const controller = createVRController();
    expect(controller.getState().phase).toBe('idle');
  });

  it('transitions to unsupported when navigator.xr absent', async () => {
    const controller = createVRController();
    await controller.start();
    expect(controller.getState().phase).toBe('unsupported');
  });

  it('transitions through phases with mocked XR', async () => {
    const originalXR = (globalThis as any).navigator?.xr;
    (globalThis as any).navigator = {
      xr: {
        isSessionSupported: async () => true,
      },
    };

    const controller = createVRController();
    await controller.start();
    expect(controller.getState().phase).toBe('running');

    await controller.stop();
    expect(controller.getState().phase).toBe('idle');

    // Restore
    if (originalXR) {
      (globalThis as any).navigator.xr = originalXR;
    }
  });

  it('returns default resolution scale', () => {
    const controller = createVRController();
    expect(controller.getResolutionScale()).toBe(DEFAULT_RESOLUTION_SCALE);
  });

  it('adjusts resolution scale based on thermal proxy', () => {
    const thermal = new ThermalProxy();
    const controller = createVRController(thermal);

    // Normal state → full resolution scale
    expect(controller.getResolutionScale()).toBeCloseTo(0.7, 2);

    // Force thermal into critical
    for (let i = 0; i < 30; i++) {
      thermal.tick(40, i * 600);
    }
    // Critical quality = 0.3 → scale = 0.5 + 0.2 * 0.3 = 0.56
    expect(controller.getResolutionScale()).toBeCloseTo(0.56, 2);
  });

  it('reports thermal limit when proxy is critical', async () => {
    const originalXR = (globalThis as any).navigator?.xr;
    (globalThis as any).navigator = {
      xr: {
        isSessionSupported: async () => true,
      },
    };

    const thermal = new ThermalProxy();
    const controller = createVRController(thermal);
    await controller.start();

    // Force critical
    for (let i = 0; i < 30; i++) {
      thermal.tick(40, i * 600);
    }

    const state = controller.getState();
    expect(state.phase).toBe('thermal_limited');
    if (state.phase === 'thermal_limited') {
      expect(state.message).toContain('Thermal');
    }

    // Restore
    if (originalXR) {
      (globalThis as any).navigator.xr = originalXR;
    }
  });

  it('reports soft cap after 10 minutes', async () => {
    const originalXR = (globalThis as any).navigator?.xr;
    (globalThis as any).navigator = {
      xr: {
        isSessionSupported: async () => true,
      },
    };

    // Start mockTime at a positive value so sessionStartTime > 0
    let mockTime = 1000;
    const controller = createVRController(undefined, () => mockTime);
    await controller.start();

    // Advance past soft cap
    mockTime = 1000 + SESSION_SOFT_CAP_MS + 1000;

    // getState checks elapsed = now() - sessionStartTime
    // sessionStartTime was set to now() at start() = 1000
    // elapsed = (1000 + 600000 + 1000) - 1000 = 601000 > 600000
    const state = controller.getState();
    expect(state.phase).toBe('thermal_limited');
    if (state.phase === 'thermal_limited') {
      expect(state.message).toContain('soft cap');
    }

    if (originalXR) {
      (globalThis as any).navigator.xr = originalXR;
    }
  });
});

describe('createGlassPlatform', () => {
  it('returns a THREE.Group', () => {
    const platform = createGlassPlatform();
    expect(platform).toBeInstanceOf(THREE.Group);
  });

  it('contains a glass disc mesh', () => {
    const platform = createGlassPlatform();
    const meshes = platform.children.filter((c) => c instanceof THREE.Mesh);
    expect(meshes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('computeVRCameraPose', () => {
  it('returns position above origin', () => {
    const pose = computeVRCameraPose();
    expect(pose.position.y).toBeGreaterThan(0);
    expect(pose.position.x).toBe(0);
    expect(pose.position.z).toBe(0);
  });

  it('returns a quaternion rotation', () => {
    const pose = computeVRCameraPose();
    expect(pose.rotation).toBeInstanceOf(THREE.Quaternion);
  });
});
