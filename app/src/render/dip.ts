/**
 * The dip to dark (spec/guides.md §7.1): the one transition for every hard
 * change to the view - a preset, a new place, a time jump, a seek. The
 * view fades to the background colour, the change is made and waited for,
 * and the view fades back.
 *
 * It is one plate over everything the scene draws, so no layer has to know
 * about it. A plate in the page, not a quad in the scene: the names are
 * page elements over the canvas, and they must fade with it, which a quad
 * drawn into the canvas could not do. It covers both eyes in Cardboard.
 * The compass bar, the captions, the pointer and the play bar stand over
 * it: they say where things are and what the guide is doing, and the user
 * needs them while the view is dark.
 *
 * Driven by the frame loop, like the view's eases, so it takes no timer
 * and stops with the frames. It is a fade, not movement: reduced motion
 * keeps it.
 */

/** The fade to dark. */
export const DIP_OUT_MS = 250;
/** The fade back, once the change is made. */
export const DIP_IN_MS = 400;

type DipPhase = 'clear' | 'out' | 'dark' | 'in';

export class Dip {
  private readonly plate: HTMLDivElement;
  private phase: DipPhase = 'clear';
  /** 0 clear, 1 dark. */
  private opacity = 0;
  /** What the plate shows, so a frame that changes nothing writes nothing. */
  private shown = 0;
  /** Changes waiting for the dark, each settling its caller's promise. */
  private readonly waiting: (() => Promise<void>)[] = [];

  constructor(parent: HTMLElement, colour: string) {
    this.plate = document.createElement('div');
    this.plate.className = 'dip';
    this.plate.style.background = colour;
    this.plate.style.opacity = '0';
    // Nothing to composite while clear.
    this.plate.hidden = true;
    parent.appendChild(this.plate);
  }

  /**
   * Fade to dark, make `change`, wait for what it returns, then fade back. Resolves, or rejects, with the change's
   * result once it is made, as the fade back begins. A change asked for while the view is dark or going dark waits for
   * the dark with the others, in order; one asked for while it fades back turns it dark again from where it got to.
   */
  run<T>(change: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push(async () => {
        try {
          resolve(await change());
        } catch (error) {
          reject(error);
        }
      });
      if (this.phase === 'clear' || this.phase === 'in') this.phase = 'out';
    });
  }

  /** Whether the view is dark or on its way there or back. */
  isActive(): boolean {
    return this.phase !== 'clear';
  }

  /** 0 clear to 1 dark: for the browser harness. */
  darkness(): number {
    return this.opacity;
  }

  /** Once a frame. */
  update(deltaMs: number): void {
    if (this.phase === 'out') {
      this.opacity = Math.min(1, this.opacity + deltaMs / DIP_OUT_MS);
      if (this.opacity === 1) {
        this.phase = 'dark';
        void this.makeChanges();
      }
    } else if (this.phase === 'in') {
      this.opacity = Math.max(0, this.opacity - deltaMs / DIP_IN_MS);
      if (this.opacity === 0) this.phase = 'clear';
    }
    this.show();
  }

  dispose(): void {
    this.plate.remove();
  }

  /** Every change waiting, in order, those asked for meanwhile included, so the view stays dark until all are done; then fade back. */
  private async makeChanges(): Promise<void> {
    // The first change is made in this frame: an async function runs to its first await at once.
    while (this.waiting.length > 0) await this.waiting.shift()!();
    this.phase = 'in';
  }

  private show(): void {
    if (this.opacity === this.shown) return;
    this.shown = this.opacity;
    this.plate.hidden = this.opacity === 0;
    this.plate.style.opacity = String(this.opacity);
  }
}
