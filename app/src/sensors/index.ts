/**
 * Browser sensor wiring for Transparent Earth app.
 * Bridges heading gate logic (packages/core/src/heading) with browser APIs:
 * - Geolocation API for position fix
 * - DeviceOrientation (absolute) / iOS webkitCompassHeading for heading
 */

import {
  evaluateHeadingSamples,
  nextFixState,
  DEFAULT_HEADING_CONFIG,
  type HeadingSample,
  type FixStatus,
  type RejectReason,
} from '@transparent-earth/core/heading';

/** Where the user stands, from the latest geolocation reading at any accuracy. */
export interface SurfacePosition {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Device attitude as W3C DeviceOrientation Euler angles in degrees, with
 * alpha referenced to north: the device frame is Rz(alpha)·Rx(beta)·Ry(gamma)
 * in East-North-Up.
 */
export interface DeviceAttitude {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

export interface SensorState {
  /**
   * Latest position at any accuracy: at planetary scale even a coarse fix
   * places the view correctly, so this does not wait for `fix` to resolve.
   */
  readonly position: SurfacePosition | null;
  /** Accepted heading in degrees clockwise from true north, or null while ungated. */
  readonly heading: number | null;
  /** Why a heading is unavailable — drives the retry guidance shown to the user. */
  readonly headingReason: RejectReason | null;
  readonly fix: FixStatus;
}

export type SensorCallback = (state: SensorState) => void;

export interface SensorController {
  start(): void;
  stop(): void;
  /**
   * iOS gates orientation behind a user-gesture permission prompt. Safe to
   * call everywhere; resolves true where no prompt is required.
   */
  requestPermission(): Promise<boolean>;
  getState(): SensorState;
  /**
   * Latest north-referenced attitude, or null until one arrives. Polled per
   * frame by the camera rather than emitted, so orientation at display rate
   * never re-renders the HUD.
   */
  getAttitude(): DeviceAttitude | null;
}

/** Minimal shapes for the orientation event fields browsers disagree on. */
interface CompassEvent extends DeviceOrientationEvent {
  readonly webkitCompassHeading?: number;
  readonly webkitCompassAccuracy?: number;
}

type PermissionCapableEvent = {
  requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>;
};

/**
 * Convert an orientation event to a compass heading in degrees clockwise
 * from north, or null when the event carries no absolute reference.
 *
 * iOS reports a true-north heading directly. Elsewhere `alpha` is a
 * counter-clockwise rotation about the vertical axis, so it inverts.
 */
export function headingFromOrientation(event: CompassEvent): number | null {
  if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
    return normalizeDegrees(event.webkitCompassHeading);
  }
  if (event.absolute && typeof event.alpha === 'number' && !Number.isNaN(event.alpha)) {
    return normalizeDegrees(360 - event.alpha);
  }
  return null;
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Offset that turns iOS's arbitrary-origin alpha into a north-referenced
 * one, or null when the event carries no compass heading. A north-referenced
 * alpha satisfies heading = 360 - alpha for both a flat and an upright phone.
 */
export function compassAlphaOffset(event: CompassEvent): number | null {
  if (typeof event.webkitCompassHeading !== 'number' || Number.isNaN(event.webkitCompassHeading)) return null;
  if (typeof event.alpha !== 'number' || Number.isNaN(event.alpha)) return null;
  return normalizeDegrees(360 - event.webkitCompassHeading - event.alpha);
}

/** Step angle `from` toward `to` by `weight` along the shorter arc, in degrees. */
export function blendDegrees(from: number, to: number, weight: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return normalizeDegrees(from + delta * weight);
}

/** Weight each compass reading carries in the smoothed iOS alpha offset. */
const COMPASS_OFFSET_WEIGHT = 0.05;

/**
 * Create a sensor controller that drives heading and fix state.
 *
 * Emits on every accepted sensor event rather than on a timer, so the globe
 * reorients as fast as the magnetometer settles instead of lagging a poll.
 */
export function createSensorController(callback: SensorCallback): SensorController {
  const samples: HeadingSample[] = [];
  let state: SensorState = {
    position: null,
    heading: null,
    headingReason: 'insufficient_samples',
    fix: { phase: 'acquiring', accuracy: null },
  };
  let running = false;
  let watchId: number | null = null;
  let orientationTarget: string | null = null;
  let attitude: DeviceAttitude | null = null;
  let compassOffset: number | null = null;

  function emit(): void {
    callback(state);
  }

  function trackAttitude(event: CompassEvent): void {
    if (typeof event.alpha !== 'number' || typeof event.beta !== 'number' || typeof event.gamma !== 'number') return;
    let alpha: number;
    if (event.absolute) {
      alpha = event.alpha;
    } else {
      // iOS: smooth the offset, since single compass readings jitter by
      // several degrees while the gyro-integrated alpha does not.
      const offset = compassAlphaOffset(event);
      if (offset === null) return;
      compassOffset = compassOffset === null ? offset : blendDegrees(compassOffset, offset, COMPASS_OFFSET_WEIGHT);
      alpha = event.alpha + compassOffset;
    }
    attitude = { alpha: normalizeDegrees(alpha), beta: event.beta, gamma: event.gamma };
  }

  function onOrientation(event: Event): void {
    if (!running) return;
    trackAttitude(event as CompassEvent);
    const heading = headingFromOrientation(event as CompassEvent);
    if (heading === null) return;

    // Orientation fires at display rate. Spacing samples by the configured
    // interval makes the gate judge a ~1 s hold, not three events 33 ms
    // apart that a steadily turning phone would pass.
    const timestamp = eventTimestamp(event);
    const previous = samples[samples.length - 1];
    if (previous && timestamp - previous.timestamp < DEFAULT_HEADING_CONFIG.sampleIntervalMs) return;

    samples.push({ heading, timestamp });
    // Gate on the most recent window only; stale samples from before the user
    // stopped turning would otherwise keep the spread wide forever.
    while (samples.length > DEFAULT_HEADING_CONFIG.sampleCount) samples.shift();

    const result = evaluateHeadingSamples(samples);
    state =
      result.status === 'ok'
        ? { ...state, heading: result.heading, headingReason: null }
        : { ...state, heading: null, headingReason: result.reason };
    emit();
  }

  function onPosition(position: GeolocationPosition): void {
    if (!running) return;
    state = {
      ...state,
      position: { lat: position.coords.latitude, lon: position.coords.longitude },
      fix: nextFixState(state.fix, { accuracy: position.coords.accuracy }, false),
    };
    emit();
  }

  function onPositionError(error: GeolocationPositionError): void {
    if (!running) return;
    const phase = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';
    state = { ...state, fix: { phase } };
    emit();
  }

  function eventTimestamp(event: Event): number {
    return typeof event.timeStamp === 'number' ? event.timeStamp : 0;
  }

  return {
    start() {
      if (running) return;
      running = true;
      samples.length = 0;
      attitude = null;
      compassOffset = null;

      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
          enableHighAccuracy: true,
          maximumAge: 0,
        });
      } else {
        state = { ...state, fix: { phase: 'unavailable' } };
      }

      if (typeof window !== 'undefined') {
        // `deviceorientationabsolute` is the true-north stream on Chrome/Android;
        // iOS carries the same information on `deviceorientation`.
        orientationTarget =
          'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
        window.addEventListener(orientationTarget, onOrientation);
      }

      emit();
    },

    stop() {
      running = false;
      if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (orientationTarget !== null && typeof window !== 'undefined') {
        window.removeEventListener(orientationTarget, onOrientation);
        orientationTarget = null;
      }
      samples.length = 0;
    },

    async requestPermission() {
      if (typeof DeviceOrientationEvent === 'undefined') return false;
      const ctor = DeviceOrientationEvent as unknown as PermissionCapableEvent;
      if (typeof ctor.requestPermission !== 'function') return true;
      try {
        return (await ctor.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    },

    getState() {
      return state;
    },

    getAttitude() {
      return attitude;
    },
  };
}
