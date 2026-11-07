import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_HEADING_CONFIG } from '@transparent-earth/core/heading';
import { decimalYear, magneticDeclination } from '@transparent-earth/core/magnetic';
import {
  blendDegrees,
  compassAlphaOffset,
  createSensorController,
  magneticHeadingFromOrientation,
  type SensorState,
} from './index';

/** Every geolocation reading below: Austin, on this instant. */
const FIX_TIME_MS = Date.UTC(2026, 10, 7, 18);
const AUSTIN_DECLINATION = magneticDeclination(30.2672, -97.7431, 0, decimalYear(new Date(FIX_TIME_MS)));

/** Normalize to [0, 360). */
function wrap(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

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
        timestamp: FIX_TIME_MS,
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

describe('magneticHeadingFromOrientation', () => {
  it('inverts alpha into a clockwise compass bearing', () => {
    expect(magneticHeadingFromOrientation({ alpha: 90, absolute: true } as never)).toBe(270);
    expect(magneticHeadingFromOrientation({ alpha: 0, absolute: true } as never)).toBe(0);
  });

  it('prefers the iOS compass heading when present', () => {
    expect(magneticHeadingFromOrientation({ alpha: 90, absolute: true, webkitCompassHeading: 42 } as never)).toBe(42);
  });

  it('rejects a non-absolute event, which carries no north reference', () => {
    expect(magneticHeadingFromOrientation({ alpha: 90, absolute: false } as never)).toBeNull();
  });
});

describe('compassAlphaOffset', () => {
  it('makes alpha satisfy heading = 360 - alpha', () => {
    // iOS: alpha starts wherever the page loaded; compass says 30° magnetic.
    const offset = compassAlphaOffset({ alpha: 100, webkitCompassHeading: 30 } as never);
    expect(offset).toBe(230);
    expect(360 - ((100 + (offset as number)) % 360)).toBe(30);
  });

  it('is null without a compass heading', () => {
    expect(compassAlphaOffset({ alpha: 100 } as never)).toBeNull();
  });
});

describe('blendDegrees', () => {
  it('steps along the shorter arc across north', () => {
    expect(blendDegrees(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(blendDegrees(10, 350, 0.25)).toBeCloseTo(5, 9);
  });
});

describe('createSensorController', () => {
  it('places the user on the first reading, before the fix resolves', () => {
    const geo = installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();
    expect(seen[0].position).toBeNull();

    geo.emit(900);
    const last = seen[seen.length - 1];
    expect(last.fix.phase).toBe('acquiring');
    expect(last.position).toEqual({ lat: 30.2672, lon: -97.7431 });
    controller.stop();
  });

  it('turns an absolute attitude to true north on every event, not per sample', () => {
    const geo = installGeolocation();
    const controller = createSensorController(() => undefined);
    controller.start();
    geo.emit(20);
    expect(controller.getAttitude()).toBeNull();

    dispatchHeading(315);
    dispatchHeading(300, 16);
    const attitude = controller.getAttitude();
    expect(attitude?.alpha).toBeCloseTo(wrap(300 - AUSTIN_DECLINATION), 9);
    expect(attitude?.beta).toBe(80);
    expect(attitude?.gamma).toBe(0);
    controller.stop();
  });

  it('withholds attitude until a fix gives the declination', () => {
    installGeolocation();
    const controller = createSensorController(() => undefined);
    controller.start();

    dispatchHeading(300);
    expect(controller.getAttitude()).toBeNull();
    controller.stop();
  });

  it('references the iOS relative alpha to true north through the compass', () => {
    const geo = installGeolocation();
    delete (window as { ondeviceorientationabsolute?: unknown }).ondeviceorientationabsolute;
    const controller = createSensorController(() => undefined);
    controller.start();
    geo.emit(20);

    const event = new Event('deviceorientation');
    Object.assign(event, { alpha: 100, beta: 90, gamma: 0, absolute: false, webkitCompassHeading: 30 });
    window.dispatchEvent(event);

    // Facing 30° magnetic = 30° + declination true, so alpha is 330 - declination.
    expect(controller.getAttitude()?.alpha).toBeCloseTo(330 - AUSTIN_DECLINATION, 9);
    controller.stop();
  });

  it('withholds attitude when the event has no north reference', () => {
    const geo = installGeolocation();
    delete (window as { ondeviceorientationabsolute?: unknown }).ondeviceorientationabsolute;
    const controller = createSensorController(() => undefined);
    controller.start();
    geo.emit(20);

    const event = new Event('deviceorientation');
    Object.assign(event, { alpha: 100, beta: 90, gamma: 0, absolute: false });
    window.dispatchEvent(event);

    expect(controller.getAttitude()).toBeNull();
    controller.stop();
  });

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

  it('accepts a true-north heading once enough steady samples arrive', () => {
    const geo = installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();
    geo.emit(20);

    // alpha 315/314/316 -> bearings 45/46/44 magnetic, a steady hold within the gate.
    dispatchHeading(315);
    dispatchHeading(314);
    dispatchHeading(316);

    const last = seen[seen.length - 1];
    expect(last.declination).toBeCloseTo(AUSTIN_DECLINATION, 9);
    expect(last.heading).toBeCloseTo(45 + AUSTIN_DECLINATION, 6);
    expect(last.headingReason).toBeNull();
    controller.stop();
  });

  it('holds a settled compass heading until the fix arrives, then turns it true', () => {
    const geo = installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();

    dispatchHeading(315);
    dispatchHeading(314);
    dispatchHeading(316);
    expect(seen[seen.length - 1].heading).toBeNull();
    expect(seen[seen.length - 1].headingReason).toBe('awaiting_position');

    geo.emit(20);
    expect(seen[seen.length - 1].heading).toBeCloseTo(45 + AUSTIN_DECLINATION, 6);
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
    const geo = installGeolocation();
    const seen: SensorState[] = [];
    const controller = createSensorController((s) => seen.push(s));
    controller.start();
    geo.emit(20);

    // A turn first — these must not hold the gate open once it settles.
    dispatchHeading(0);
    dispatchHeading(60);
    dispatchHeading(120);
    expect(seen[seen.length - 1].heading).toBeNull();

    dispatchHeading(315);
    dispatchHeading(314);
    dispatchHeading(316);
    expect(seen[seen.length - 1].heading).toBeCloseTo(45 + AUSTIN_DECLINATION, 6);
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
