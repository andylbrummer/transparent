import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_HEADING_CONFIG } from '@transparent-earth/core/heading';
import { createSensorController, headingFromOrientation, type SensorState } from './index';

/** Event clock for dispatched orientation events, in ms. */
let eventClockMs = 0;

/**
 * Dispatch an absolute-orientation event the way Chrome/Android reports it,
 * `afterMs` after the previous one (default: one full sample interval).
 */
function dispatchHeading(alpha: number, afterMs = DEFAULT_HEADING_CONFIG.sampleIntervalMs): void {
  eventClockMs += afterMs;
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { alpha, beta: 80, gamma: 0, absolute: true });
  Object.defineProperty(event, 'timeStamp', { value: eventClockMs });
  window.dispatchEvent(event);
}

type PositionHandlers = {
  success?: PositionCallback;
  error?: PositionErrorCallback;
};

function installGeolocation(handlers: PositionHandlers = {}): {
  emit: (accuracy: number) => void;
  fail: (code: number) => void;
  cleared: () => boolean;
} {
  let success: PositionCallback | undefined = handlers.success;
  let error: PositionErrorCallback | undefined = handlers.error;
  let wasCleared = false;

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition(s: PositionCallback, e: PositionErrorCallback) {
        success = s;
        error = e;
        return 42;
      },
      clearWatch(id: number) {
        wasCleared = id === 42;
      },
      getCurrentPosition(s: PositionCallback) {
        success = s;
      },
    },
  });

  return {
    emit: (accuracy: number) =>
      success?.({
        coords: { latitude: 30.2672, longitude: -97.7431, altitude: 149, accuracy },
        timestamp: 1,
      } as GeolocationPosition),
    fail: (code: number) =>
      error?.({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError),
    cleared: () => wasCleared,
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'ondeviceorientationabsolute', { configurable: true, value: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headingFromOrientation', () => {
  it('inverts alpha into a clockwise compass bearing', () => {
    expect(headingFromOrientation({ alpha: 90, absolute: true } as never)).toBe(270);
    expect(headingFromOrientation({ alpha: 0, absolute: true } as never)).toBe(0);
  });

  it('prefers the iOS true-north heading when present', () => {
    expect(headingFromOrientation({ alpha: 90, absolute: true, webkitCompassHeading: 42 } as never)).toBe(42);
  });

  it('rejects a non-absolute event, which carries no north reference', () => {
    expect(headingFromOrientation({ alpha: 90, absolute: false } as never)).toBeNull();
  });
});

describe('createSensorController', () => {
  it('emits immediately on start rather than after a poll interval', () => {
    installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));

    controller.start();
    expect(seen).toHaveLength(1);
    expect(seen[0].heading).toBeNull();
    expect(seen[0].fix.phase).toBe('acquiring');
    controller.stop();
  });

  it('accepts a heading once enough steady samples arrive', () => {
    installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    // alpha 315/314/316 -> bearings 45/46/44, a steady hold within the gate.
    dispatchHeading(315);
    dispatchHeading(314);
    dispatchHeading(316);

    const last = seen[seen.length - 1];
    expect(last.heading).toBeCloseTo(45, 6);
    expect(last.headingReason).toBeNull();
    controller.stop();
  });

  it('samples at the configured interval, not at the event rate', () => {
    installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    // A phone turning ~1°/frame at 60 Hz: three events 16 ms apart look
    // steady, but they must count as one sample, not a completed hold.
    dispatchHeading(315);
    dispatchHeading(314, 16);
    dispatchHeading(313, 16);

    const last = seen[seen.length - 1];
    expect(last.heading).toBeNull();
    expect(last.headingReason).toBe('insufficient_samples');
    controller.stop();
  });

  it('reports magnetic interference instead of a bogus heading', () => {
    installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    dispatchHeading(0);
    dispatchHeading(90);
    dispatchHeading(184);

    const last = seen[seen.length - 1];
    expect(last.heading).toBeNull();
    expect(last.headingReason).toBe('high_variance');
    controller.stop();
  });

  it('keeps only the most recent window, so an old turn stops blocking a hold', () => {
    installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    // A turn first — these must not hold the gate open once it settles.
    dispatchHeading(0);
    dispatchHeading(60);
    dispatchHeading(120);
    expect(seen[seen.length - 1].heading).toBeNull();

    dispatchHeading(315);
    dispatchHeading(314);
    dispatchHeading(316);
    expect(seen[seen.length - 1].heading).toBeCloseTo(45, 6);
    controller.stop();
  });

  it('resolves the fix when accuracy is good enough', () => {
    const geo = installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    geo.emit(80);
    expect(seen[seen.length - 1].fix.phase).toBe('acquiring');

    geo.emit(12);
    const resolved = seen[seen.length - 1].fix;
    expect(resolved.phase).toBe('resolved');
    if (resolved.phase === 'resolved') expect(resolved.accuracy).toBe(12);
    controller.stop();
  });

  it('surfaces a denied location permission', () => {
    const geo = installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    geo.fail(1);
    expect(seen[seen.length - 1].fix.phase).toBe('denied');
    controller.stop();
  });

  it('detaches its listeners and geolocation watch on stop', () => {
    const geo = installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();
    controller.stop();

    expect(geo.cleared()).toBe(true);

    const countAfterStop = seen.length;
    dispatchHeading(315);
    dispatchHeading(314);
    dispatchHeading(316);
    expect(seen).toHaveLength(countAfterStop);
  });

  it('reports the fix unavailable when the browser has no geolocation', () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    expect(seen[seen.length - 1].fix.phase).toBe('unavailable');
    controller.stop();
  });
});
