/**
 * The depth slices of the tomography layer and their colours: small and
 * free of three.js, because layer.ts builds the panel's legends from it.
 * The depths and scales are those of tools/pipeline/generate_tomography.py
 * (SHELLS); the layer's test holds the two together.
 */

import type { RampStop } from '../weather/ramps';

export interface TomographyShell {
  /** A depth layer of the model, km. */
  readonly depthKm: number;
  /** The image's grey scale and the colour ramp span ± this, per cent. */
  readonly rangePercent: number;
  /** What to look for at this depth. */
  readonly look: string;
}

export const TOMOGRAPHY_SHELLS: readonly TomographyShell[] = [
  { depthKm: 150, rangePercent: 8, look: 'fast keels under the old continents, slow under ridges and hotspots' },
  { depthKm: 400, rangePercent: 3, look: 'slabs going down round the Pacific' },
  { depthKm: 700, rangePercent: 2, look: 'slabs flattening at the base of the transition zone' },
  { depthKm: 1250, rangePercent: 1.5, look: 'old slabs sinking: the Farallon plate under North America' },
  { depthKm: 2050, rangePercent: 1.5, look: 'the two slow provinces rising under Africa and the Pacific' },
  { depthKm: 2850, rangePercent: 3, look: 'just above the core: slow provinces under Africa and the Pacific, ringed by fast old slabs' },
];

/**
 * Anomaly as a fraction of the shell's range, −1..1, to colour:
 * seismology's own convention, slow red and fast blue. Near zero the
 * layer is clear (see DVS_CLEAR_BELOW), so the pale middle is hardly seen.
 */
export const DVS_RAMP: readonly RampStop[] = [
  [-1, 0xc8102e],
  [-0.6, 0xf0553a],
  [-0.25, 0xf9a56b],
  [0, 0xf2efe6],
  [0.25, 0x7fc3ea],
  [0.6, 0x2f86d9],
  [1, 0x1546b0],
];

/** Anomalies smaller than this fraction of the range are not drawn; full strength from DVS_FULL_FROM. */
export const DVS_CLEAR_BELOW = 0.06;
export const DVS_FULL_FROM = 0.45;

export const tomographyId = (depthKm: number): string => `tomography-${depthKm}`;

/** "−8 %" with a true minus sign. */
export const signedPercent = (percent: number): string => `${percent < 0 ? '−' : '+'}${Math.abs(percent)} %`;
