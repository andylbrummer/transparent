import { describe, it, expect, afterEach } from 'vitest';
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

  it('stops back to idle', async () => {
    const controller = createARController();
    await controller.stop();
    expect(controller.getState().phase).toBe('idle');
  });
});

describe('AR portal placement flow', () => {
  let endCalls: number;

  function mockSupportedDevice(): void {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { xr: { isSessionSupported: async () => true } },
    });
  }

  function startedController(): ReturnType<typeof createARController> {
    endCalls = 0;
    mockSupportedDevice();
    return createARController(async () => fakeSession());
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

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  });

  it('scans after the session opens', async () => {
    const controller = startedController();
    expect(controller.getState().phase).toBe('idle');
    await controller.start();
    expect(controller.getState().phase).toBe('scanning');
  });

  it('reaches placing once the floor is found, then places on tap', async () => {
    const controller = startedController();
    await controller.start();

    controller.onFloorHit(new THREE.Vector3(0, -1.2, 0));
    expect(controller.getState().phase).toBe('placing');

    controller.onTap(new THREE.Vector3(0.5, -1.2, -0.3));
    const state = controller.getState();
    expect(state.phase).toBe('placed');
    if (state.phase === 'placed') {
      expect(state.portalPosition.x).toBeCloseTo(0.5, 6);
      expect(state.portalPosition.y).toBeCloseTo(-1.2, 6);
    }
  });

  it('falls back to scanning when the floor is lost', async () => {
    const controller = startedController();
    await controller.start();

    controller.onFloorHit(new THREE.Vector3(0, -1.2, 0));
    controller.onFloorHit(null);
    expect(controller.getState().phase).toBe('scanning');

    // A tap with no floor must not place a portal in mid-air.
    controller.onTap(new THREE.Vector3(0, -1.2, 0));
    expect(controller.getState().phase).toBe('scanning');
  });

  it('keeps a placed portal anchored against later hit-tests', async () => {
    const controller = startedController();
    await controller.start();
    controller.onFloorHit(new THREE.Vector3(0, -1.2, 0));
    controller.onTap(new THREE.Vector3(1, -1.2, 1));

    controller.onFloorHit(new THREE.Vector3(5, -1.2, 5));
    const state = controller.getState();
    expect(state.phase).toBe('placed');
    if (state.phase === 'placed') expect(state.portalPosition.x).toBeCloseTo(1, 6);
  });

  it('reports permission_denied when the session is refused', async () => {
    mockSupportedDevice();
    const controller = createARController(async () => {
      throw new DOMException('camera denied', 'NotAllowedError');
    });
    await controller.start();
    expect(controller.getState().phase).toBe('permission_denied');
  });

  it('reports unsupported when a required feature is missing', async () => {
    mockSupportedDevice();
    const controller = createARController(async () => {
      throw new DOMException('no hit-test', 'NotSupportedError');
    });
    await controller.start();
    expect(controller.getState().phase).toBe('unsupported');
  });

  it('propagates unexpected session failures instead of blaming permissions', async () => {
    mockSupportedDevice();
    const controller = createARController(async () => {
      throw new TypeError('bad init');
    });
    await expect(controller.start()).rejects.toThrow('bad init');
    expect(controller.getState().phase).toBe('idle');
  });

  it('returns to idle when the platform ends the session', async () => {
    let session: XRSession | null = null;
    endCalls = 0;
    mockSupportedDevice();
    const controller = createARController(async () => (session = fakeSession()));
    await controller.start();

    await session!.end();
    expect(controller.getState().phase).toBe('idle');

    // stop() after an external end must not end the dead session again
    await controller.stop();
    expect(endCalls).toBe(1);
  });

  it('ends the session on stop', async () => {
    const controller = startedController();
    await controller.start();
    await controller.stop();
    expect(endCalls).toBe(1);
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

  it('puts north on the left when the user faces east', () => {
    const rot = headingToRotation(90);
    const north = new THREE.Vector3(0, 0, -1).applyMatrix4(rot);
    expect(north.x).toBeCloseTo(-1, 5);
    expect(north.z).toBeCloseTo(0, 5);
  });

  it('puts east straight ahead when the user faces east', () => {
    const east = new THREE.Vector3(1, 0, 0).applyMatrix4(headingToRotation(90));
    expect(east.z).toBeCloseTo(-1, 5);
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
