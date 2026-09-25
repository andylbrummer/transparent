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

export interface SensorState {
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
 * Create a sensor controller that drives heading and fix state.
 *
 * Emits on every accepted sensor event rather than on a timer, so the globe
 * reorients as fast as the magnetometer settles instead of lagging a poll.
 */
export function createSensorController(callback: SensorCallback): SensorController {
  const samples: HeadingSample[] = [];
  let state: SensorState = {
    heading: null,
    headingReason: 'insufficient_samples',
    fix: { phase: 'acquiring', accuracy: null },
  };
  let running = false;
  let watchId: number | null = null;
  let orientationTarget: string | null = null;

  function emit(): void {
    callback(state);
  }

  function onOrientation(event: Event): void {
    if (!running) return;
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
    state = { ...state, fix: nextFixState(state.fix, { accuracy: position.coords.accuracy }, false) };
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
  };
}
