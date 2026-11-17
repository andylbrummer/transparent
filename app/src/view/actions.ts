/**
 * The view's action vocabulary: what a guide cue, a voice command and,
 * later, the voice AI may ask of the view. Actions are absolute - "these
 * switches on", never "toggle" - so the view at any point can be worked
 * out from the actions alone. Types only; view-control.ts does them.
 */

export type ViewAction =
  /** Every switch as the preset has it (ui/presets.ts). */
  | { readonly do: 'preset'; readonly id: string }
  /** Named switches on or off; the rest stay. */
  | { readonly do: 'layers'; readonly on?: readonly string[]; readonly off?: readonly string[] };

export type ActionErrorCode = 'unknown-preset' | 'unknown-layer' | 'bad-value';

/** What came of an action. A mistake in the action is an outcome, not a throw, so its caller can show it. */
export type ActionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ActionErrorCode; readonly message: string };

export interface ViewControl {
  /** Do one action. Resolves when it has taken effect. */
  perform(action: ViewAction): Promise<ActionOutcome>;
}
