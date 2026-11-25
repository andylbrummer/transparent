/**
 * What a guide's play bar says ('Paused', 'Loading…', an error), in Cardboard, where the bar is hidden: one copy per
 * eye, each over its eye's convergence spot so the two read as one, above the middle where the captions and the
 * voice readout are not.
 *
 * A live region, as the bar's message is: hidden in stereo, the bar's own is out of the accessibility tree.
 */

export class StereoNotice {
  private readonly root: HTMLElement;
  private readonly readouts: readonly HTMLElement[];
  private text = '';
  private placedKey = '';

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'stereo-notice';
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    this.readouts = [0, 1].map(() => {
      const readout = doc.createElement('div');
      readout.className = 'stereo-notice__readout';
      this.root.appendChild(readout);
      return readout;
    });
    // The right eye's copy repeats the left: read once.
    this.readouts[1].setAttribute('aria-hidden', 'true');
    parent.appendChild(this.root);
  }

  /** Say `text`; '' takes the notice down. Cheap when it is the same: it is called every frame. */
  show(text: string): void {
    if (text === this.text) return;
    this.text = text;
    for (const readout of this.readouts) readout.textContent = text;
    this.root.hidden = text === '';
  }

  /** Place the readouts on a screen width×height CSS px, one per eye, `spacingPx` apart. */
  place(width: number, height: number, spacingPx: number): void {
    const key = `${width}:${height}:${Math.round(spacingPx)}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    this.readouts.forEach((readout, i) => {
      readout.style.left = `${width / 2 + (i === 0 ? -1 : 1) * (spacingPx / 2)}px`;
      readout.style.top = `${Math.round(height * 0.22)}px`;
      readout.style.maxWidth = `${Math.round(spacingPx * 0.9)}px`;
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
