/**
 * The Cardboard spyglass: hold the head still on a name in the sky and a
 * magnified window opens over it - hands-free zoom for a viewer that has
 * nothing to pinch.
 *
 * Only a named object opens it, never bare sky: in a sky viewer holding
 * still is what looking is, so a stare at nothing must do nothing. The
 * name must stay under the view's centre (within CAPTURE_DEG) with the head
 * slower than STILL_DEG_PER_S for DWELL_MS; a ring fills meanwhile, shown
 * from FUSE_DELAY_MS so a passing glance draws nothing.
 *
 * The window is fixed on the sky, not on the head: the periphery moves one
 * to one with the head, as it must in a headset, and the magnified view
 * holds still inside its window, where head tremor would otherwise be
 * magnified with it. It opens from no magnification - SPYGLASS_DEG across,
 * the window's own size - so the zoom grows out of the view it covers,
 * evenly in log scale, to frame the object; looking RELEASE_DEG away from
 * it closes it the same way.
 *
 * This module is the timing alone; render/spyglass-lens draws it.
 */

import * as THREE from 'three';

/** The window's diameter, degrees of the eye's view. */
export const SPYGLASS_DEG = 30;
/** How far from the view's centre a name may be and still be the one stared at. */
export const CAPTURE_DEG = 2.5;
/** Head turning slower than this is holding still. */
export const STILL_DEG_PER_S = 6;
export const DWELL_MS = 1200;
export const FUSE_DELAY_MS = 300;
/** Looking this far from the object closes the window: past its rim, with a margin for a glance at the edge. */
export const RELEASE_DEG = SPYGLASS_DEG / 2 + 5;
export const OPEN_MS = 700;
export const CLOSE_MS = 300;
/** Field the window frames an object in, as a multiple of the object's size. */
export const FRAME_MARGIN = 1.6;
/** Framing for a name with no size: a star, a planet. */
export const DEFAULT_FRAMING_DEG = 2;
/** Deepest the window zooms: past this the sky's finest tiles are blur. */
export const MIN_FRAMING_DEG = 0.05;

/** Something a stare can open the spyglass on. */
export interface SpyglassTarget {
  /** The same object every frame for the same thing on the sky. */
  readonly key: unknown;
  readonly name: string;
  /** Its size on the sky, degrees; null for a point. */
  readonly extentDeg: number | null;
  /** Where it is now, a world unit vector, written into `out`. */
  directionInto(out: THREE.Vector3): THREE.Vector3;
}

export type SpyglassState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'fusing'; readonly target: SpyglassTarget; readonly heldMs: number }
  | { readonly kind: 'open'; readonly target: SpyglassTarget; readonly progress: number }
  | { readonly kind: 'closing'; readonly target: SpyglassTarget; readonly progress: number };

/** What to draw this frame. */
export interface SpyglassView {
  readonly target: SpyglassTarget;
  /** The window's field, degrees across. */
  readonly fovDeg: number;
}

/** The field the window frames `target` in, degrees across. */
export function framingDeg(target: SpyglassTarget): number {
  const wanted = target.extentDeg === null ? DEFAULT_FRAMING_DEG : target.extentDeg * FRAME_MARGIN;
  return Math.min(SPYGLASS_DEG, Math.max(MIN_FRAMING_DEG, wanted));
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

export class Spyglass {
  private state: SpyglassState = { kind: 'idle' };
  private readonly lastForward = new THREE.Vector3();
  private hasLastForward = false;
  private readonly targetDirection = new THREE.Vector3();

  getState(): SpyglassState {
    return this.state;
  }

  /**
   * One frame: `forward` is where the head looks (world unit vector),
   * `candidate` the name nearest the view's centre within CAPTURE_DEG, if any.
   */
  update(forward: THREE.Vector3, candidate: SpyglassTarget | null, deltaMs: number): void {
    const turnedDeg = this.hasLastForward ? THREE.MathUtils.radToDeg(forward.angleTo(this.lastForward)) : 0;
    const still = deltaMs > 0 && (turnedDeg / deltaMs) * 1000 < STILL_DEG_PER_S;
    this.lastForward.copy(forward);
    this.hasLastForward = true;
    const state = this.state;
    switch (state.kind) {
      case 'idle':
        if (candidate && still) this.state = { kind: 'fusing', target: candidate, heldMs: 0 };
        return;
      case 'fusing': {
        if (!candidate || candidate.key !== state.target.key || !still) {
          this.state = { kind: 'idle' };
          return;
        }
        const heldMs = state.heldMs + deltaMs;
        this.state = heldMs >= DWELL_MS ? { kind: 'open', target: state.target, progress: 0 } : { kind: 'fusing', target: state.target, heldMs };
        return;
      }
      case 'open': {
        if (this.offTargetDeg(forward, state.target) > RELEASE_DEG) {
          // Close from wherever the opening had got to.
          this.state = { kind: 'closing', target: state.target, progress: 1 - state.progress };
          return;
        }
        this.state = { kind: 'open', target: state.target, progress: Math.min(1, state.progress + deltaMs / OPEN_MS) };
        return;
      }
      case 'closing': {
        const progress = state.progress + deltaMs / CLOSE_MS;
        this.state = progress >= 1 ? { kind: 'idle' } : { kind: 'closing', target: state.target, progress };
        return;
      }
    }
  }

  /** Close now, from wherever it is (leaving Cardboard). */
  reset(): void {
    this.state = { kind: 'idle' };
    this.hasLastForward = false;
  }

  /** How full the dwell ring is, 0 to 1, while it shows; null when it does not. */
  fuse(): { readonly target: SpyglassTarget; readonly fraction: number } | null {
    const state = this.state;
    if (state.kind !== 'fusing' || state.heldMs < FUSE_DELAY_MS) return null;
    return { target: state.target, fraction: (state.heldMs - FUSE_DELAY_MS) / (DWELL_MS - FUSE_DELAY_MS) };
  }

  /** The window to draw, or null while it is shut. */
  view(): SpyglassView | null {
    const state = this.state;
    if (state.kind !== 'open' && state.kind !== 'closing') return null;
    const opened = smoothstep(state.kind === 'open' ? state.progress : 1 - state.progress);
    // Even in log scale: each moment of the zoom magnifies by the same factor.
    const fovDeg = SPYGLASS_DEG * Math.pow(framingDeg(state.target) / SPYGLASS_DEG, opened);
    return { target: state.target, fovDeg };
  }

  private offTargetDeg(forward: THREE.Vector3, target: SpyglassTarget): number {
    return THREE.MathUtils.radToDeg(forward.angleTo(target.directionInto(this.targetDirection)));
  }
}
