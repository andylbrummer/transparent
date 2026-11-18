import { captionAt, type CaptionCue } from './vtt';

/**
 * The narration's captions, drawn near the foot of the view: the cue for
 * the time it is given, on a dark plate.
 *
 * Not a live region (spec/guides.md §11): a screen reader would speak it
 * over the narration that is saying the same words. The transcript is the
 * reader's way to the text.
 *
 * One eye only, for now: Cardboard and AR hide it.
 */
export class CaptionOverlay {
  private readonly root: HTMLElement;
  private readonly plate: HTMLElement;
  private cues: readonly CaptionCue[] = [];
  /** The cue on the plate, so a frame that shows the same one leaves the page alone. */
  private shown: CaptionCue | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'captions';
    this.plate = document.createElement('p');
    this.plate.className = 'captions__plate';
    this.plate.style.display = 'none';
    this.root.appendChild(this.plate);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  /** The captions of the step now playing, in the guide's language (a BCP 47 tag); null for none. Takes the shown caption down. */
  setCues(captions: { readonly cues: readonly CaptionCue[]; readonly lang: string } | null): void {
    this.cues = captions?.cues ?? [];
    if (captions) this.plate.lang = captions.lang;
    else this.plate.removeAttribute('lang');
    this.show(null);
  }

  /** Show the caption for `tS`, seconds into the narration; none in a gap. */
  update(tS: number): void {
    this.show(captionAt(this.cues, tS));
  }

  dispose(): void {
    this.root.remove();
  }

  private show(cue: CaptionCue | null): void {
    if (cue === this.shown) return;
    this.shown = cue;
    // textContent, never markup: the text comes from a pull request. pre-line in the CSS keeps the author's breaks.
    this.plate.textContent = cue ? cue.lines.join('\n') : '';
    this.plate.style.display = cue ? '' : 'none';
  }
}
