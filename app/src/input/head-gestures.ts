/**
 * Nods and head shakes from the head's own turning, for a Cardboard viewer
 * whose wearer has no hands free: the commands a headset can take without
 * a controller.
 *
 * The head's rate of turn comes from its orientation frame to frame, in
 * its own frame: a shake turns it about its own up axis and a nod about
 * its own right axis, wherever it looks. Each axis is cut into swings -
 * runs of turning one way, ended by a reversal or a stop. A swing counts
 * toward a gesture when it is quick (MIN_PEAK_DEG_PER_S at its fastest),
 * long enough (MIN_SWING_DEG), short (MAX_SWING_MS) and mostly on its own
 * axis (OFF_AXIS_MAX); counted swings that alternate with no pause longer
 * than MAX_GAP_MS between them make a chain.
 *
 * A shake is SHAKE_SWINGS of them about the up axis; a nod a down swing
 * then an up one. Looking around turns the head one way at a time, and
 * slower: it breaks the chain rather than building it.
 */

import * as THREE from 'three';

export type HeadGesture = 'nod' | 'shake';

/** Turning slower than this is holding still: it ends a swing. */
export const NOISE_DEG_PER_S = 20;
/** A swing must reach this speed to count. */
export const MIN_PEAK_DEG_PER_S = 60;
export const MIN_SWING_DEG = 4;
export const MAX_SWING_MS = 600;
/** Turning about the other axis, as a share of the swing's own turn, past which it is not a nod or shake. */
export const OFF_AXIS_MAX = 0.5;
/** The longest pause between the swings of one gesture. */
export const MAX_GAP_MS = 200;
export const SHAKE_SWINGS = 3;
/** After a gesture, motion is ignored this long: the head settling must not start another. */
export const REFRACTORY_MS = 400;

interface Swing {
  readonly sign: number;
  readonly startMs: number;
  angleDeg: number;
  offAxisDeg: number;
  peakDegPerS: number;
}

interface CountedSwing {
  readonly sign: number;
  readonly startMs: number;
  readonly endMs: number;
}

/** The swings about one axis of the head. */
class AxisSwings {
  private swing: Swing | null = null;
  private chain: CountedSwing[] = [];

  /** One frame turning at `rateDegPerS` about this axis and `offAxisDegPerS` about the other. */
  sample(rateDegPerS: number, offAxisDegPerS: number, deltaMs: number, nowMs: number): void {
    if (Math.abs(rateDegPerS) < NOISE_DEG_PER_S) {
      this.endSwing(nowMs);
      return;
    }
    const sign = Math.sign(rateDegPerS);
    if (this.swing && this.swing.sign !== sign) this.endSwing(nowMs);
    const swing = (this.swing ??= { sign, startMs: nowMs - deltaMs, angleDeg: 0, offAxisDeg: 0, peakDegPerS: 0 });
    swing.angleDeg += (Math.abs(rateDegPerS) * deltaMs) / 1000;
    swing.offAxisDeg += (Math.abs(offAxisDegPerS) * deltaMs) / 1000;
    swing.peakDegPerS = Math.max(swing.peakDegPerS, Math.abs(rateDegPerS));
  }

  /** The signs of the last `count` swings of the chain, oldest first, once it holds that many. */
  lastSigns(count: number): number[] | null {
    return this.chain.length >= count ? this.chain.slice(-count).map((swing) => swing.sign) : null;
  }

  clear(): void {
    this.swing = null;
    this.chain = [];
  }

  private endSwing(nowMs: number): void {
    const swing = this.swing;
    if (!swing) return;
    this.swing = null;
    const counts =
      swing.angleDeg >= MIN_SWING_DEG &&
      swing.peakDegPerS >= MIN_PEAK_DEG_PER_S &&
      nowMs - swing.startMs <= MAX_SWING_MS &&
      swing.offAxisDeg <= OFF_AXIS_MAX * swing.angleDeg;
    if (!counts) {
      this.chain = [];
      return;
    }
    const last = this.chain.at(-1);
    if (last && (last.sign === swing.sign || swing.startMs - last.endMs > MAX_GAP_MS)) this.chain = [];
    this.chain.push({ sign: swing.sign, startMs: swing.startMs, endMs: nowMs });
  }
}

export class HeadGestures {
  private readonly previous = new THREE.Quaternion();
  private hasPrevious = false;
  private readonly turn = new THREE.Quaternion();
  /** About the head's up axis: positive turns it left. */
  private readonly yaw = new AxisSwings();
  /** About the head's right axis: positive tips it up. */
  private readonly pitch = new AxisSwings();
  private nowMs = 0;
  private quietUntilMs = 0;

  /** One frame with the head at world `orientation`; the gesture it completes, if any. */
  update(orientation: THREE.Quaternion, deltaMs: number): HeadGesture | null {
    this.nowMs += deltaMs;
    if (!this.hasPrevious || deltaMs <= 0) {
      this.previous.copy(orientation);
      this.hasPrevious = true;
      return null;
    }
    // The turn since the last frame, in the head's own frame.
    const turn = this.turn.copy(this.previous).invert().multiply(orientation);
    this.previous.copy(orientation);
    if (this.nowMs < this.quietUntilMs) return null;
    // A small turn's quaternion is (axis · angle/2, ~1); w's sign picks the short way round.
    const toDegPerS = ((turn.w < 0 ? -2 : 2) * THREE.MathUtils.RAD2DEG * 1000) / deltaMs;
    const pitchRate = turn.x * toDegPerS;
    const yawRate = turn.y * toDegPerS;
    this.yaw.sample(yawRate, pitchRate, deltaMs, this.nowMs);
    this.pitch.sample(pitchRate, yawRate, deltaMs, this.nowMs);

    const gesture = this.completed();
    if (gesture) {
      this.yaw.clear();
      this.pitch.clear();
      this.quietUntilMs = this.nowMs + REFRACTORY_MS;
    }
    return gesture;
  }

  reset(): void {
    this.hasPrevious = false;
    this.yaw.clear();
    this.pitch.clear();
    this.quietUntilMs = 0;
  }

  private completed(): HeadGesture | null {
    if (this.yaw.lastSigns(SHAKE_SWINGS)) return 'shake';
    const nod = this.pitch.lastSigns(2);
    // Down, then up: the chain alternates, so the last two are down and up when the last is up.
    if (nod && nod[1] > 0) return 'nod';
    return null;
  }
}
