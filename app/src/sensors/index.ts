/**
 * Browser sensor wiring for Transparent Earth app.
 * Bridges heading gate logic (packages/core/src/heading) with browser APIs:
 * - Geolocation API for position fix
 * - DeviceOrientation (absolute) / iOS webkitCompassHeading for heading
 *
 * Both compass sources are magnetic: iOS fills webkitCompassHeading from
 * CLHeading.magneticHeading, and Chrome's absolute stream comes from
 * Android's rotation-vector sensor. Everything this module hands out is
 * turned to true north with the WMM declination at the latest GPS fix, so
 * nothing north-referenced is available before the first fix.
 */

import {
  evaluateHeadingSamples,
  nextFixState,
  DEFAULT_HEADING_CONFIG,
  type HeadingSample,
  type FixStatus,
  type RejectReason,
} from '@transparent-earth/core/heading';
import { decimalYear, magneticDeclination } from '@transparent-earth/core/magnetic';

/** Where the user stands, from the latest geolocation reading at any accuracy. */
export interface SurfacePosition {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Where the view stands when the browser gives no location: denied, unavailable
 * or absent. A black screen tells a visitor nothing; a labelled stand-in shows
 * what the app does. Austin, Texas, where the app is made.
 */
export const FALLBACK_POSITION: SurfacePosition = { lat: 30.27, lon: -97.74 };
export const FALLBACK_PLACE = 'Austin, Texas';

/**
 * Device attitude as W3C DeviceOrientation Euler angles in degrees, with
 * alpha referenced to true north: the device frame is Rz(alpha)·Rx(beta)·Ry(gamma)
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
  /**
   * Why a heading is unavailable — drives the retry guidance shown to the
   * user. `awaiting_position`: the compass has settled, but true north needs
   * the declination at a GPS fix.
   */
  readonly headingReason: HeadingUnavailableReason | null;
  /** Magnetic declination at `position`, degrees east of true north; null before a fix. */
  readonly declination: number | null;
  readonly fix: FixStatus;
  /** True while `position` is FALLBACK_POSITION standing in for a fix the browser would not give. */
  readonly fallback: boolean;
}

export type HeadingUnavailableReason = RejectReason | 'awaiting_position';

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
 * from magnetic north, or null when the event carries no absolute reference.
 *
 * iOS reports the heading directly. Elsewhere `alpha` is a counter-clockwise
 * rotation about the vertical axis, so it inverts.
 */
export function magneticHeadingFromOrientation(event: CompassEvent): number | null {
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
 * Offset that turns iOS's arbitrary-origin alpha into a magnetic-north-referenced
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
    declination: null,
    fix: { phase: 'acquiring', accuracy: null },
    fallback: false,
  };
  let running = false;
  // The gate's latest verdict, still magnetic; state.heading is its true-north view.
  let magneticHeading: number | null = null;
  let headingReject: RejectReason = 'insufficient_samples';
  let watchId: number | null = null;
  let orientationTarget: string | null = null;
  let attitude: DeviceAttitude | null = null;
  let compassOffset: number | null = null;

  function emit(): void {
    callback(state);
  }

  /** Heading fields of the state, turned to true north once a fix gives the declination. */
  function trueHeadingState(): Pick<SensorState, 'heading' | 'headingReason'> {
    if (magneticHeading === null) return { heading: null, headingReason: headingReject };
    if (state.declination === null) return { heading: null, headingReason: 'awaiting_position' };
    return { heading: normalizeDegrees(magneticHeading + state.declination), headingReason: null };
  }

  function trackAttitude(event: CompassEvent): void {
    if (typeof event.alpha !== 'number' || typeof event.beta !== 'number' || typeof event.gamma !== 'number') return;
    let magneticAlpha: number;
    if (event.absolute) {
      magneticAlpha = event.alpha;
    } else {
      // iOS: smooth the offset, since single compass readings jitter by
      // several degrees while the gyro-integrated alpha does not.
      const offset = compassAlphaOffset(event);
      if (offset === null) return;
      compassOffset = compassOffset === null ? offset : blendDegrees(compassOffset, offset, COMPASS_OFFSET_WEIGHT);
      magneticAlpha = event.alpha + compassOffset;
    }
    if (state.declination === null) return;
    // Heading = 360 - alpha, so turning heading east by the declination
    // turns alpha the other way.
    attitude = { alpha: normalizeDegrees(magneticAlpha - state.declination), beta: event.beta, gamma: event.gamma };
  }

  function onOrientation(event: Event): void {
    if (!running) return;
    trackAttitude(event as CompassEvent);
    const heading = magneticHeadingFromOrientation(event as CompassEvent);
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
    if (result.status === 'ok') {
      magneticHeading = result.heading;
    } else {
      magneticHeading = null;
      headingReject = result.reason;
    }
    state = { ...state, ...trueHeadingState() };
    emit();
  }

  function onPosition(position: GeolocationPosition): void {
    if (!running) return;
    const { latitude, longitude, accuracy } = position.coords;
    state = {
      ...state,
      position: { lat: latitude, lon: longitude },
      // Height is taken as the ellipsoid surface: a kilometre of altitude
      // moves declination by thousandths of a degree.
      declination: magneticDeclination(latitude, longitude, 0, decimalYear(new Date(position.timestamp))),
      fix: nextFixState(state.fix, { accuracy }, false),
      fallback: false,
    };
    state = { ...state, ...trueHeadingState() };
    emit();
  }

  /** Stand at FALLBACK_POSITION until a real fix arrives; a fix already taken is kept. */
  function fallBack(phase: 'denied' | 'unavailable'): void {
    state = state.position !== null && !state.fallback
      ? { ...state, fix: { phase } }
      : {
          ...state,
          position: FALLBACK_POSITION,
          declination: magneticDeclination(FALLBACK_POSITION.lat, FALLBACK_POSITION.lon, 0, decimalYear(new Date())),
          fix: { phase },
          fallback: true,
        };
    state = { ...state, ...trueHeadingState() };
  }

  function onPositionError(error: GeolocationPositionError): void {
    if (!running) return;
    fallBack(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
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
      magneticHeading = null;
      headingReject = 'insufficient_samples';

      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
          enableHighAccuracy: true,
          maximumAge: 0,
        });
      } else {
        fallBack('unavailable');
      }

      if (typeof window !== 'undefined') {
        // `deviceorientationabsolute` is the magnetic-north stream on Chrome/Android;
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
