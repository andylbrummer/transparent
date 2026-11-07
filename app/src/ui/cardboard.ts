/**
 * Cardboard mode: the button that enters it, and the screen it needs.
 *
 * Entering asks for fullscreen, a landscape lock and a screen wake lock -
 * a phone in a headset cannot be touched to stay awake or to rotate - and
 * marks the body `stereo` so the page's CSS hides every control. Any of
 * the three can be refused (iPhone Safari has no element fullscreen; a
 * lock needs fullscreen); each refusal is reported and the split view
 * still runs, since the viewer can rotate the phone by hand.
 *
 * Leaving: a tap anywhere (the viewer's button taps the screen), or
 * leaving fullscreen with the system back gesture.
 */

export const STEREO_BODY_CLASS = 'stereo';

/** The parts of the platform Cardboard mode drives, so tests can stand in for them. */
export interface CardboardPlatform {
  requestFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  isFullscreen(): boolean;
  lockLandscape(): Promise<void>;
  unlockOrientation(): void;
  requestWakeLock(): Promise<{ release(): Promise<void> }>;
}

export const BROWSER_PLATFORM: CardboardPlatform = {
  requestFullscreen: () => document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
  exitFullscreen: () => document.exitFullscreen(),
  isFullscreen: () => document.fullscreenElement !== null,
  lockLandscape: async () => {
    // Not in lib.dom's ScreenOrientation everywhere; absent on iOS.
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (!orientation?.lock) throw new Error('screen.orientation.lock is not supported');
    await orientation.lock('landscape');
  },
  unlockOrientation: () => screen.orientation?.unlock?.(),
  requestWakeLock: async () => {
    if (!('wakeLock' in navigator)) throw new Error('navigator.wakeLock is not supported');
    return navigator.wakeLock.request('screen');
  },
};

export class CardboardToggle {
  private readonly button: HTMLButtonElement;
  private active = false;
  private enteredFullscreen = false;
  private wakeLock: { release(): Promise<void> } | null = null;
  private readonly onButtonClick = (): void => void this.enter();
  private readonly onFullscreenChange = (): void => {
    if (this.active && this.enteredFullscreen && !this.platform.isFullscreen()) this.exit();
  };

  /** Calls `onChange` as stereo turns on and off. */
  constructor(
    parent: HTMLElement,
    private readonly onChange: (stereo: boolean) => void,
    private readonly platform: CardboardPlatform = BROWSER_PLATFORM
  ) {
    this.button = document.createElement('button');
    this.button.id = 'cardboard-toggle';
    this.button.type = 'button';
    this.button.textContent = 'Cardboard';
    this.button.title = 'Split the view for a Cardboard viewer; tap to leave';
    this.button.addEventListener('click', this.onButtonClick);
    parent.appendChild(this.button);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  isActive(): boolean {
    return this.active;
  }

  async enter(): Promise<void> {
    if (this.active) return;
    this.active = true;
    document.body.classList.add(STEREO_BODY_CLASS);
    this.onChange(true);
    // Fullscreen first: Chrome only locks orientation for a fullscreen page.
    try {
      await this.platform.requestFullscreen();
      this.enteredFullscreen = true;
    } catch (error) {
      console.error('cardboard: fullscreen refused', error);
    }
    try {
      await this.platform.lockLandscape();
    } catch (error) {
      console.error('cardboard: landscape lock refused', error);
    }
    try {
      const lock = await this.platform.requestWakeLock();
      if (this.active) this.wakeLock = lock;
      else void lock.release();
    } catch (error) {
      console.error('cardboard: wake lock refused', error);
    }
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove(STEREO_BODY_CLASS);
    this.platform.unlockOrientation();
    if (this.enteredFullscreen && this.platform.isFullscreen()) {
      this.platform.exitFullscreen().catch((error: unknown) => console.error('cardboard: exit fullscreen failed', error));
    }
    this.enteredFullscreen = false;
    this.wakeLock?.release().catch((error: unknown) => console.error('cardboard: wake lock release failed', error));
    this.wakeLock = null;
    this.onChange(false);
  }

  dispose(): void {
    this.exit();
    this.button.removeEventListener('click', this.onButtonClick);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.button.remove();
  }
}
