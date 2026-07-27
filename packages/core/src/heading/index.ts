/**
 * Heading acquisition state machine with quality gates.
 * Pure functions — no browser APIs here.
 *
 * Flow:
 * 1. Collect N heading samples
 * 2. Check hold-still (variance < threshold)
 * 3. Check magnetometer variance (spread < threshold)
 * 4. Return median of accepted samples or reject with reason code
 */

export type HeadingSample = {
  readonly heading: number; // degrees, 0-360, clockwise from north
  readonly timestamp: number; // ms
};

export type RejectReason =
  | 'insufficient_samples'
  | 'device_moving'
  | 'high_variance'
  | 'sensor_unavailable';

export type HeadingResult =
  | { readonly status: 'ok'; readonly heading: number }
  | { readonly status: 'reject'; readonly reason: RejectReason };

export interface HeadingGateConfig {
  readonly sampleCount: number;
  readonly sampleIntervalMs: number;
  readonly maxSpreadDeg: number;
  /**
   * Largest spread still attributable to the user turning the phone rather
   * than to magnetic interference. Beyond this, a consistent rotation is too
   * fast to be a hold-still attempt and is treated as an unusable stream.
   */
  readonly maxDriftDeg: number;
}

export const DEFAULT_HEADING_CONFIG: HeadingGateConfig = {
  sampleCount: 3,
  sampleIntervalMs: 500,
  maxSpreadDeg: 15,
  maxDriftDeg: 90,
};

function circularMean(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  let sumSin = 0;
  let sumCos = 0;
  for (const h of samples) {
    const rad = (h * Math.PI) / 180;
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }
  const meanRad = Math.atan2(sumSin / samples.length, sumCos / samples.length);
  let deg = (meanRad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function circularSpread(samples: readonly number[]): number {
  if (samples.length < 2) return 0;
  let maxDiff = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      let diff = Math.abs(samples[i] - samples[j]);
      if (diff > 180) diff = 360 - diff;
      if (diff > maxDiff) maxDiff = diff;
    }
  }
  return maxDiff;
}

/** Shortest signed angle from `a` to `b`, in (-180, 180]. */
function signedDelta(a: number, b: number): number {
  let d = ((b - a + 180) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Median that respects wrap-around.
 *
 * A numeric sort would place 350 next to 10 and pick the wrong sample, so
 * offsets are taken relative to the circular mean, the median is chosen in
 * that unwrapped space, then folded back to [0, 360).
 */
function circularMedian(samples: readonly number[], mean: number): number {
  const offsets = samples.map((h) => signedDelta(mean, h)).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const medianOffset =
    offsets.length % 2 === 0 ? (offsets[mid - 1] + offsets[mid]) / 2 : offsets[mid];
  return ((mean + medianOffset) % 360 + 360) % 360;
}

/**
 * True when every consecutive step turns the same way — the signature of the
 * user rotating the device, as opposed to a magnetometer scattering readings
 * around a fixed bearing.
 */
function isConsistentRotation(samples: readonly number[]): boolean {
  if (samples.length < 3) return false;
  let sign = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = signedDelta(samples[i - 1], samples[i]);
    if (d === 0) return false;
    const s = Math.sign(d);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/**
 * Evaluate a batch of heading samples against quality gates.
 *
 * Dispersion alone cannot separate the two failure modes — a slow turn and a
 * noisy magnetometer produce comparable spreads — so the shape of the stream
 * decides the reason:
 *
 * - within `maxSpreadDeg`      → accept, reporting the circular median
 * - consistent turn, ≤ maxDrift → `device_moving`, ask the user to hold still
 * - anything else              → `high_variance`, ask them to move away from
 *                                 whatever is disturbing the magnetometer
 *
 * Reporting these separately matters because the two have opposite remedies.
 */
export function evaluateHeadingSamples(
  samples: readonly HeadingSample[],
  config: HeadingGateConfig = DEFAULT_HEADING_CONFIG
): HeadingResult {
  if (samples.length < config.sampleCount) {
    return { status: 'reject', reason: 'insufficient_samples' };
  }

  const headings = samples.map((s) => s.heading);
  const mean = circularMean(headings);
  const spread = circularSpread(headings);

  if (spread <= config.maxSpreadDeg) {
    return { status: 'ok', heading: circularMedian(headings, mean) };
  }

  if (isConsistentRotation(headings) && spread <= config.maxDriftDeg) {
    return { status: 'reject', reason: 'device_moving' };
  }

  return { status: 'reject', reason: 'high_variance' };
}

/**
 * Geolocation fix flow state machine.
 * Tracks accuracy sequence and resolves when accuracy ≤ threshold or user accepts.
 */
export type FixStatus =
  | { readonly phase: 'acquiring'; readonly accuracy: number | null }
  | { readonly phase: 'resolved'; readonly accuracy: number; readonly accepted: boolean }
  | { readonly phase: 'denied' }
  | { readonly phase: 'unavailable' };

export interface FixConfig {
  readonly targetAccuracyM: number;
  readonly maxAttempts: number;
}

export const DEFAULT_FIX_CONFIG: FixConfig = {
  targetAccuracyM: 20,
  maxAttempts: 10,
};

export function nextFixState(
  current: FixStatus,
  reading: { accuracy: number | null } | null,
  userAccept: boolean,
  config: FixConfig = DEFAULT_FIX_CONFIG
): FixStatus {
  if (current.phase === 'denied' || current.phase === 'unavailable') {
    return current;
  }

  if (userAccept && current.phase === 'acquiring') {
    return {
      phase: 'resolved',
      accuracy: current.accuracy ?? Number.POSITIVE_INFINITY,
      accepted: true,
    };
  }

  if (reading === null) {
    return { phase: 'acquiring', accuracy: null };
  }

  if (reading.accuracy !== null && reading.accuracy <= config.targetAccuracyM) {
    return { phase: 'resolved', accuracy: reading.accuracy, accepted: false };
  }

  return { phase: 'acquiring', accuracy: reading.accuracy };
}
