import { captionAt, type CaptionCue } from './vtt';

/**
 * The narration's captions, drawn near the foot of the view: the cue for
 * the time it is given, on a dark plate.
 *
 * Not a live region (spec/guides.md §11): a screen reader would speak it
 * over the narration that is saying the same words. The transcript is the
 * reader's way to the text.
 *
 * In Cardboard there is one plate per eye, each under its eye's convergence spot so the two read as one, as the voice
 * readout does (voice-overlay.ts). AR hides it.
 */
export class CaptionOverlay {
  private readonly root: HTMLElement;
  /** The left eye's plate, which is the only one on one screen, and the right eye's copy. */
  private readonly plates: readonly HTMLElement[];
  private cues: readonly CaptionCue[] = [];
  /** The cue on the plate, so a frame that shows the same one leaves the page alone. */
  private shown: CaptionCue | null = null;
  private placedKey = '';

  /** `modifier` is a class beside `captions`: a clip's overlay sits higher than the narration's. */
  constructor(parent: HTMLElement, modifier?: string) {
    this.root = document.createElement('div');
    this.root.className = modifier ? `captions ${modifier}` : 'captions';
    this.plates = [0, 1].map(() => {
      const plate = document.createElement('p');
      plate.className = 'captions__plate';
      plate.style.display = 'none';
      this.root.appendChild(plate);
      return plate;
    });
    // The right eye's copy repeats the left, and is shown only in stereo.
    this.plates[1].setAttribute('aria-hidden', 'true');
    this.plates[1].hidden = true;
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  /** The captions of the step now playing, in the guide's language (a BCP 47 tag); null for none. Takes the shown caption down. */
  setCues(captions: { readonly cues: readonly CaptionCue[]; readonly lang: string } | null): void {
    this.cues = captions?.cues ?? [];
    for (const plate of this.plates) {
      if (captions) plate.lang = captions.lang;
      else plate.removeAttribute('lang');
    }
    this.show(null);
  }

  /** Show the caption for `tS`, seconds into the narration; none in a gap. */
  update(tS: number): void {
    this.show(captionAt(this.cues, tS));
  }

  /**
   * Place the plates on a screen width×height CSS px: one along the foot, or in stereo one per eye, `spacingPx` apart.
   * In stereo they stand just above the voice readout, which hangs from 70% of the height, so the two never cover
   * each other. Cheap when nothing changed: it is called every frame.
   */
  place(stereo: boolean, width: number, height: number, spacingPx: number): void {
    const key = `${stereo}:${width}:${height}:${Math.round(spacingPx)}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    this.root.classList.toggle('captions--stereo', stereo);
    this.plates[1].hidden = !stereo;
    const lefts = [width / 2 - spacingPx / 2, width / 2 + spacingPx / 2];
    this.plates.forEach((plate, i) => {
      plate.style.left = stereo ? `${lefts[i]}px` : '';
      plate.style.bottom = stereo ? `${Math.round(height * 0.32)}px` : '';
      plate.style.maxWidth = stereo ? `${Math.round(spacingPx * 0.9)}px` : '';
    });
  }

  dispose(): void {
    this.root.remove();
  }

  private show(cue: CaptionCue | null): void {
    if (cue === this.shown) return;
    this.shown = cue;
    // textContent, never markup: the text comes from a pull request. pre-line in the CSS keeps the author's breaks.
    for (const plate of this.plates) {
      plate.textContent = cue ? cue.lines.join('\n') : '';
      plate.style.display = cue ? '' : 'none';
    }
  }
}
