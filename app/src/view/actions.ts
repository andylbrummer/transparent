/**
 * The view's action vocabulary: what a guide cue, a voice command and,
 * later, the voice AI may ask of the view. Actions are absolute - "these
 * switches on", never "toggle" - so the view at any point can be worked
 * out from the actions alone. Types only; view-control.ts does them.
 */

import type { PlanetName } from '@transparent-earth/core';
import type { LabelKind } from '../render/labels';

/** Something to look at. Every kind resolves to a direction from where the view stands (targets.ts). */
export type Target =
  /** The Sun, the Moon or a planet, at the app clock's time. */
  | { readonly kind: 'body'; readonly body: 'sun' | 'moon' | PlanetName }
  /** A fixed place on the sky, ICRS. */
  | { readonly kind: 'sky'; readonly raDeg: number; readonly decDeg: number; readonly name?: string; readonly extentDeg?: number }
  /** A direction in the local frame: azimuth clockwise from north, altitude above the horizon. -90 is straight down. */
  | { readonly kind: 'horizon'; readonly azDeg: number; readonly altDeg: number }
  /** A place on or in the Earth. */
  | { readonly kind: 'ground'; readonly lat: number; readonly lon: number; readonly depthKm?: number; readonly name?: string }
  /**
   * A name from the baked label files (geo/labels.json, geology.json,
   * quakes.json). `labelKind` tells apart places that share a name: Georgia
   * the country from Georgia the state.
   */
  | { readonly kind: 'label'; readonly name: string; readonly labelKind?: LabelKind };

export type ViewAction =
  /** Every switch as the preset has it (ui/presets.ts). */
  | { readonly do: 'preset'; readonly id: string }
  /** Named switches on or off; the rest stay. */
  | { readonly do: 'layers'; readonly on?: readonly string[]; readonly off?: readonly string[] };

export type ActionErrorCode = 'unknown-preset' | 'unknown-layer' | 'layer-unavailable' | 'bad-value';

/** What came of an action. A mistake in the action is an outcome, not a throw, so its caller can show it. */
export type ActionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ActionErrorCode; readonly message: string };

export interface ViewControl {
  /** Do one action. Resolves when it has taken effect: the switches flipped, the layers they turn on loaded. */
  perform(action: ViewAction): Promise<ActionOutcome>;
}
