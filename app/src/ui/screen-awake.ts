/**
 * Keeps the screen on while something holds the viewer without a touch: a guide's narration, a clip, or the phone
 * being panned round the sky (PanningWatch). A phone held up to the sky is moved, never tapped, so its screen timeout (30 s on many phones) would put it
 * to sleep mid-guide. Pinning the app to a home screen changes nothing there; only a screen wake lock does.
 *
 * The frame loop says each frame whether the screen is wanted on (`want`); asking costs nothing when the answer has
 * not changed. The system drops the lock whenever the page is hidden and may drop it on its own: while still wanted
 * it is taken again when the page shows. A browser that refuses without a tap (some iOS versions) is asked again on
 * the next tap. Cardboard holds its own lock (ui/cardboard.ts); two locks on one screen are allowed.
 */

export interface WakeLockPlatform {
  /** A screen wake lock; `onLost` runs when the system releases it. */
  requestWakeLock(onLost: () => void): Promise<{ release(): Promise<void> }>;
  isPageVisible(): boolean;
  /** Calls `listener` when the page shows or hides, and on each tap; returns a function that stops it. */
  listen(listener: () => void): () => void;
}

export const BROWSER_WAKE_LOCK: WakeLockPlatform = {
  requestWakeLock: async (onLost) => {
    if (!('wakeLock' in navigator)) throw new Error('navigator.wakeLock is not supported');
    const sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', onLost);
    return sentinel;
  },
  isPageVisible: () => document.visibilityState === 'visible',
  listen: (listener) => {
    document.addEventListener('visibilitychange', listener);
    window.addEventListener('pointerdown', listener, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', listener);
      window.removeEventListener('pointerdown', listener);
    };
  },
};

export class ScreenAwake {
  private wanted = false;
  private lock: { release(): Promise<void> } | null = null;
  private pending = false;
  private problem: string | null = null;
  private readonly stopListening: () => void;

  constructor(private readonly platform: WakeLockPlatform = BROWSER_WAKE_LOCK) {
    this.stopListening = platform.listen(() => this.settle());
  }

  /** Whether the screen should stay on now. Called every frame: does nothing unless the answer changed. */
  want(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    this.settle();
  }

  isHeld(): boolean {
    return this.lock !== null;
  }

  /** Why the last request was refused, or null. */
  getProblem(): string | null {
    return this.problem;
  }

  dispose(): void {
    this.stopListening();
    this.wanted = false;
    this.settle();
  }

  private settle(): void {
    if (!this.wanted) {
      const lock = this.lock;
      this.lock = null;
      void lock?.release().catch(() => undefined);
      return;
    }
    if (this.lock || this.pending || !this.platform.isPageVisible()) return;
    this.pending = true;
    this.platform
      .requestWakeLock(() => {
        // Dropped by the system (page hidden, battery saver): taken again on the next show or tap while still wanted.
        this.lock = null;
      })
      .then(
        (lock) => {
          this.pending = false;
          this.problem = null;
          if (this.wanted) this.lock = lock;
          else void lock.release().catch(() => undefined);
        },
        (error: unknown) => {
          this.pending = false;
          this.problem = error instanceof Error ? error.message : String(error);
        },
      );
  }
}

/** A rotation as a unit quaternion: a THREE.Quaternion passes. */
export interface Orientation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Turned this far from where it last settled, the phone is being moved, not lying still: past a gyro's jitter. */
export const PANNING_THRESHOLD_RAD = (3 * Math.PI) / 180;
/** Still this long, the screen is let go: the phone's own timeout runs from there. */
export const PANNING_HOLD_MS = 20_000;

/**
 * Whether the phone is being panned around the sky: held up and moved, so its screen should stay on though nothing
 * touches it. A phone put down on a table stops turning and the screen is let go after PANNING_HOLD_MS. The turn is
 * measured from an anchor that moves only on a real turn, so a slow drift of the sensor never counts as panning.
 */
export class PanningWatch {
  private ax = 0;
  private ay = 0;
  private az = 0;
  private aw = 1;
  private anchored = false;
  private lastTurnMs = -Infinity;

  /** Called every frame with where the phone points, or null when no attitude aims the view; says whether it pans. */
  update(orientation: Orientation | null, nowMs: number): boolean {
    if (!orientation) {
      this.anchored = false;
      this.lastTurnMs = -Infinity;
      return false;
    }
    const dot = Math.abs(this.ax * orientation.x + this.ay * orientation.y + this.az * orientation.z + this.aw * orientation.w);
    const turned = 2 * Math.acos(Math.min(1, dot));
    if (!this.anchored || turned > PANNING_THRESHOLD_RAD) {
      if (this.anchored) this.lastTurnMs = nowMs;
      this.anchored = true;
      this.ax = orientation.x;
      this.ay = orientation.y;
      this.az = orientation.z;
      this.aw = orientation.w;
    }
    return nowMs - this.lastTurnMs < PANNING_HOLD_MS;
  }
}
