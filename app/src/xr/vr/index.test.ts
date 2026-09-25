import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  let endCalls: number;

  function mockSupportedDevice(): void {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { xr: { isSessionSupported: async () => true } },
    });
  }

  /** An XRSession stand-in: real EventTarget, end() fires 'end' like a UA. */
  function fakeSession(): XRSession {
    const session = new EventTarget() as EventTarget & { end(): Promise<void> };
    session.end = async () => {
      endCalls++;
      session.dispatchEvent(new Event('end'));
    };
    return session as unknown as XRSession;
  }

  beforeEach(() => {
    endCalls = 0;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  });

  it('starts in idle state', () => {
    const controller = createVRController();
    expect(controller.getState().phase).toBe('idle');
  });

  it('transitions to unsupported when navigator.xr absent', async () => {
    const controller = createVRController();
    await controller.start();
    expect(controller.getState().phase).toBe('unsupported');
  });

  it('runs a real session and ends it on stop', async () => {
    mockSupportedDevice();
    const session = fakeSession();
    const controller = createVRController(undefined, undefined, async () => session);
    await controller.start();
    const state = controller.getState();
    expect(state.phase).toBe('running');
    if (state.phase === 'running') expect(state.session).toBe(session);

    await controller.stop();
    expect(endCalls).toBe(1);
    expect(controller.getState().phase).toBe('idle');
  });

  it('returns to idle when the platform ends the session', async () => {
    mockSupportedDevice();
    const session = fakeSession();
    const controller = createVRController(undefined, undefined, async () => session);
    await controller.start();

    await session.end();
    expect(controller.getState().phase).toBe('idle');
    await controller.stop();
    expect(endCalls).toBe(1);
  });

  it('reports permission_denied when the session is refused', async () => {
    mockSupportedDevice();
    const controller = createVRController(undefined, undefined, async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    await controller.start();
    expect(controller.getState().phase).toBe('permission_denied');
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
    mockSupportedDevice();
    const thermal = new ThermalProxy();
    const controller = createVRController(thermal, undefined, async () => fakeSession());
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
  });

  it('reports soft cap after 10 minutes, even from a zero clock', async () => {
    mockSupportedDevice();
    let mockTime = 0;
    const controller = createVRController(undefined, () => mockTime, async () => fakeSession());
    await controller.start();

    mockTime = SESSION_SOFT_CAP_MS + 1000;

    const state = controller.getState();
    expect(state.phase).toBe('thermal_limited');
    if (state.phase === 'thermal_limited') {
      expect(state.message).toContain('soft cap');
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
