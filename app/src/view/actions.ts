/**
 * The view's action vocabulary: what a guide cue, a voice command and,
 * later, the voice AI may ask of the view. Actions are absolute - "these
 * switches on", never "toggle" - so the view at any point can be worked
 * out from the actions alone. Types only; view-control.ts does them.
 */

import type * as THREE from 'three';
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
  | { readonly do: 'layers'; readonly on?: readonly string[]; readonly off?: readonly string[] }
  /** Look at a target, optionally `fovDeg` wide. */
  | { readonly do: 'look'; readonly target: Target; readonly fovDeg?: number }
  /** The field of view with no target: 60 is the default. */
  | { readonly do: 'fov'; readonly fovDeg: number }
  /** A ring and a line of text on a target; `text: null` removes it. */
  | { readonly do: 'mark'; readonly target: Target; readonly text: string | null };

/** What aims the view: the device's pose, or the user's drag. */
export type AimMode = 'pose' | 'manual';

export type ActionErrorCode = 'unknown-preset' | 'unknown-layer' | 'layer-unavailable' | 'target-unresolved' | 'bad-value';

/** What came of an action. A mistake in the action is an outcome, not a throw, so its caller can show it. */
export type ActionOutcome =
  | { readonly ok: true }
  /** `look` when the view is not the guide's to turn: the user has to turn to the target. */
  | { readonly ok: true; readonly awaitingGaze: true }
  | { readonly ok: false; readonly code: ActionErrorCode; readonly message: string };

/** Why a target has no direction: an unknown or shared label name, a value that is not a number, no position yet. */
export type TargetUnresolved = { readonly ok: false; readonly code: 'target-unresolved'; readonly message: string };

/** Where a target is now. */
export interface Located {
  readonly ok: true;
  /** World unit vector from where the view stands. */
  readonly direction: THREE.Vector3;
  /** Clockwise from north, 0 to 360. */
  readonly azDeg: number;
  /** Above the horizon; -90 is straight down. */
  readonly altDeg: number;
  /** Angle from the view's centre, degrees. */
  readonly offCentreDeg: number;
}

export interface ViewControl {
  /** Do one action. Resolves when it has taken effect: the switches flipped, the layers they turn on loaded, the ease finished. */
  perform(action: ViewAction): Promise<ActionOutcome>;
  /** Where a target is now and how far the view's centre is from it. */
  locate(target: Target): Located | TargetUnresolved;
}
