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
  readonly maxVarianceDeg: number;
  readonly maxSpreadDeg: number;
}

export const DEFAULT_HEADING_CONFIG: HeadingGateConfig = {
  sampleCount: 3,
  sampleIntervalMs: 500,
  maxVarianceDeg: 5,
  maxSpreadDeg: 15,
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

function circularVariance(samples: readonly number[], mean: number): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (const h of samples) {
    let diff = Math.abs(h - mean);
    if (diff > 180) diff = 360 - diff;
    sumSq += diff * diff;
  }
  return sumSq / samples.length;
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

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Evaluate a batch of heading samples against quality gates.
 * Returns the median heading if all gates pass, otherwise rejects with a reason.
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
  const variance = circularVariance(headings, mean);

  if (variance > config.maxVarianceDeg * config.maxVarianceDeg) {
    return { status: 'reject', reason: 'device_moving' };
  }

  const spread = circularSpread(headings);
  if (spread > config.maxSpreadDeg) {
    return { status: 'reject', reason: 'high_variance' };
  }

  return { status: 'ok', heading: median(headings) };
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
