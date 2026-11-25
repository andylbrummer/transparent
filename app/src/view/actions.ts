/**
 * The view's action vocabulary: what a guide cue, a voice command and,
 * later, the voice AI may ask of the view. Actions are absolute - "these
 * switches on", never "toggle" - so the view at any point can be worked
 * out from the actions alone. Types only; view-control.ts does them.
 * The actions and targets are derived from their schema (action-schema.ts).
 */

import type * as THREE from 'three';
import type { LayerParamValues } from '../layers/types';
import type { PLACE_SCHEMA, SchemaType, TARGET_SCHEMA, VIEW_ACTION_SCHEMA } from './action-schema';

/** Something to look at. Every kind resolves to a direction from where the view stands (targets.ts). Written once, as a schema (action-schema.ts). */
export type Target = SchemaType<typeof TARGET_SCHEMA>;

/** Where the view stands: here, the far side from here, or a named place. Written once, as a schema (action-schema.ts). */
export type Place = SchemaType<typeof PLACE_SCHEMA>;

/** One thing asked of the view. Written once, as a schema (action-schema.ts). */
export type ViewAction = SchemaType<typeof VIEW_ACTION_SCHEMA>;

/** The app clock's setting: a time action without its `do`. */
export type TimeSetting = Omit<Extract<ViewAction, { readonly do: 'time' }>, 'do'>;

/**
 * A view worked out from actions alone, with nothing done: where a guide
 * stands after its scene and the cues so far. Enough to put the view there
 * in one go.
 */
export interface FoldedView {
  /**
   * The switches. Every one as a preset has it, then the ones turned on
   * and off since; or only the ones listed on. What is on is in the order it
   * was last turned on: in an exclusive group, the last one shows.
   */
  readonly layers:
    | { readonly preset: string; readonly on: readonly string[]; readonly off: readonly string[] }
    | { readonly only: readonly string[] };
  /** Where the view stands. */
  readonly place: Place;
  /** The app clock's setting, as the last time cue or the scene gave it. */
  readonly time: TimeSetting;
  /** What the view looks at and how wide. */
  readonly look: { readonly target: Target; readonly fovDeg: number };
  /** The marks up, in the order they went up. */
  readonly marks: readonly { readonly target: Target; readonly text: string }[];
  /**
   * The layers' settings given so far, by switch id, the last value of each; absent when none were. A layer keeps
   * what it was set to while it is off, so these are kept when its switch goes off or a preset comes.
   */
  readonly params?: Readonly<Record<string, LayerParamValues>>;
}

/** What aims the view: the device's pose, or the user's drag. */
export type AimMode = 'pose' | 'manual';

/** A guide's hold on the view, from ViewControl.borrow. */
export interface ViewBorrow {
  /** Give the view back. */
  end(): void;
  /**
   * Hold the clock where it stands while the guide is paused, and let it run on as it was on resume: a time-lapse
   * waits for the narration. A live clock is left live: the present does not wait. end() lets go of a hold.
   */
  hold(held: boolean): void;
}

export type ActionErrorCode = 'unknown-preset' | 'unknown-layer' | 'layer-unavailable' | 'target-unresolved' | 'bad-value';

/** What came of an action. A mistake in the action is an outcome, not a throw, so its caller can show it. */
export type ActionOutcome =
  | { readonly ok: true }
  /** `look` when the view is not the guide's to turn: the user has to turn to the target. `awaitedGaze()` says when they have. */
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

/** A look that waits on the user: what they have to turn to, and how nearly they are there. */
export interface AwaitedGaze {
  readonly target: Target;
  /** What to call it beside the pointer; null for a bare direction. */
  readonly name: string | null;
  /** World unit vector toward it, found again every frame. */
  readonly direction: THREE.Vector3;
  /** How much of the stay at the view's centre is done, 0 to 1. */
  readonly arriving: number;
}

export interface ViewControl {
  /**
   * Do one action. Resolves when it has taken effect: the switches flipped, the layers they turn on loaded, the ease
   * finished. A look that waits on the user resolves at once (`awaitingGaze`). A preset changes every switch at once,
   * so it is made in the dark of a dip, as restore is.
   */
  perform(action: ViewAction): Promise<ActionOutcome>;
  /**
   * Put the whole view as `view` has it, at once and with no ease: for a chapter's start and for a seek. Everything
   * is checked before anything is changed, and the change is made in the dark of a dip, which lasts until the layers
   * it turns on have loaded; it resolves then. Where the view is not the guide's to turn, its look waits on the user
   * (`awaitingGaze`), as a performed look does.
   */
  restore(view: FoldedView): Promise<ActionOutcome>;
  /**
   * Load ahead the layers `view` would turn on, showing nothing and flipping no switch. The outcome is what restore
   * would say of its switches: an unknown preset or switch, or a layer that failed to load.
   */
  preload(view: FoldedView): Promise<ActionOutcome>;
  /**
   * Borrow the view, for a guide. Until `end()` no switch is saved; `end()` puts the switches and the field of view
   * back as they stood, takes every mark down, and stops an ease or a look that waits. The aim stays where the user
   * has it. One borrow at a time.
   */
  borrow(): ViewBorrow;
  /** Where a target is now and how far the view's centre is from it. */
  locate(target: Target): Located | TargetUnresolved;
  /** The look still waiting on the user to turn; null once they have arrived, or when no look waits. */
  awaitedGaze(): AwaitedGaze | null;
  /** Give up on the look that waits: the user went on without turning. Its field of view is not applied. */
  stopAwaitingGaze(): void;
}
