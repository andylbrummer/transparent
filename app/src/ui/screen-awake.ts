/**
 * Keeps the screen on while something is playing that the viewer watches without touching: a guide's narration, a
 * clip. A phone held up to the sky is moved, never tapped, so its screen timeout (30 s on many phones) would put it
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
