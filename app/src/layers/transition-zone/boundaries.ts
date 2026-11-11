/**
 * The two boundaries of the mantle transition zone as baked
 * (app/public/geo/transition-zone.json, from tools/pipeline/generate_transition_zone.py).
 */

export interface TransitionZoneBoundary {
  readonly id: '410' | '660';
  readonly file: string;
  /** Area-weighted mean depth of this map, km: the grey midpoint. */
  readonly meanKm: number;
  readonly minKm: number;
  readonly maxKm: number;
}

export interface TransitionZoneData {
  readonly width: number;
  readonly height: number;
  /** Grey 1 and 255 are this many km shallower and deeper than the mean. */
  readonly scaleKm: number;
  readonly boundaries: readonly TransitionZoneBoundary[];
}

export const transitionZoneId = (boundary: '410' | '660'): string => `transition-zone-${boundary}`;

export function boundaryOf(data: TransitionZoneData, id: '410' | '660'): TransitionZoneBoundary {
  const boundary = data.boundaries.find((entry) => entry.id === id);
  if (!boundary) throw new Error(`transition-zone.json has no ${id} boundary`);
  return boundary;
}

/** "the 660 · 654 km on average": what names the ball where it passes under the user. */
export const boundaryLabelText = (boundary: TransitionZoneBoundary): string => `the ${boundary.id} · ${Math.round(boundary.meanKm)} km on average`;

export const boundaryStatus = (boundary: TransitionZoneBoundary): string =>
  `the ${boundary.id}: ${boundary.minKm.toFixed(0)}–${boundary.maxKm.toFixed(0)} km deep, ${boundary.meanKm.toFixed(0)} on average`;
