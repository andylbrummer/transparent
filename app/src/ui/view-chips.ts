/**
 * The place and time chips: what says the view is not the user's own. The
 * place chip shows while the view stands somewhere other than here, the
 * time chip while the clock is not live (spec/guides.md §7). A view of
 * another place or time that did not say so would pass for this one.
 *
 * Read every frame; the text is built again only when what it says has
 * changed, which for the time is once a simulated minute.
 */

import type { AppClock } from '../clock';
import type { Place } from '../view/actions';
import type { StandingPlace } from '../view/standing-place';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUTE_MS = 60_000;
/** In Cardboard, where the chips stand in the view, the place shows this long after the view moves there (spec/guides.md §5). */
export const STEREO_PLACE_MS = 4000;

/** "11 Mar 2011 05:46 UTC": UTC, so the same guide reads the same everywhere, and the month in words, so no one reads it day-first or month-first. */
export function chipTime(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** What the place chip says, or null where it shows nothing. */
export function chipPlace(place: Place): string | null {
  switch (place.kind) {
    case 'here':
      return null;
    case 'antipode':
      return 'The far side of the Earth';
    case 'at':
      return place.name;
  }
}

export interface ViewChipsDeps {
  readonly standing: Pick<StandingPlace, 'place'>;
  readonly clock: Pick<AppClock, 'isLive' | 'pace' | 'pinned'>;
  /** Whether a guide is open: then the clock is the guide's, and the chip says so. */
  readonly guideOpen: () => boolean;
}

export class ViewChips {
  private readonly root: HTMLDivElement;
  private readonly placeChip: HTMLDivElement;
  private readonly timeChip: HTMLDivElement;
  private visible = true;
  // What the chips show now, to tell whether a frame changes it.
  private shownPlace: Place | null = null;
  private shownMinute = NaN;
  private shownRate = NaN;
  private shownSource: string | null = null;
  /** What each chip says, null when it is down, and when the place last changed: for the viewer's line. */
  private placeText: string | null = null;
  private timeText: string | null = null;
  private placeChangedMs = Number.NEGATIVE_INFINITY;
  // The viewer's line as last built, and what it was built from.
  private line = '';
  private lineHadPlace = false;
  private lineTime: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly deps: ViewChipsDeps,
  ) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'view-chips';
    this.placeChip = doc.createElement('div');
    this.placeChip.className = 'view-chip view-chip--place';
    this.timeChip = doc.createElement('div');
    this.timeChip.className = 'view-chip view-chip--time';
    this.placeChip.hidden = true;
    this.timeChip.hidden = true;
    this.root.append(this.placeChip, this.timeChip);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.hidden = !visible;
  }

  /** `simMs`: the clock's time this frame, read once by the frame, so the chips build no Date of their own. */
  update(simMs: number, wallMs = 0): void {
    const place = this.deps.standing.place();
    if (place !== this.shownPlace) {
      this.shownPlace = place;
      const text = chipPlace(place);
      this.placeChip.hidden = text === null;
      if (text !== null) this.placeChip.textContent = text;
      this.placeText = text;
      this.placeChangedMs = wallMs;
    }

    const { clock } = this.deps;
    if (clock.isLive()) {
      this.timeChip.hidden = true;
      this.timeText = null;
      this.shownMinute = NaN;
      return;
    }
    const minute = Math.floor(simMs / MINUTE_MS);
    // The pace, not the rate set: in Cardboard a fast run is slowed, and the chip says how fast it really goes.
    const rate = clock.pace();
    // Who set the clock: a guide, or the link the page was opened with. Anything else set it for the user, who knows.
    const source = this.deps.guideOpen() ? 'guide' : clock.pinned ? 'link' : null;
    if (minute === this.shownMinute && rate === this.shownRate && source === this.shownSource) return;
    this.shownMinute = minute;
    this.shownRate = rate;
    this.shownSource = source;
    let text = chipTime(simMs);
    if (rate === 0) text += ' · stopped';
    else if (rate !== 1) text += ` · ${rate.toLocaleString('en')}×`;
    if (source !== null) text += ` · ${source}`;
    this.timeChip.textContent = text;
    this.timeChip.hidden = false;
    this.timeText = text;
  }

  /**
   * What the chips say in Cardboard, as one line for a per-eye readout: the place for STEREO_PLACE_MS after the view
   * moves there, and the time while the clock is not live; '' for nothing. After update, with the same wall time.
   * Built again only when it changes, as it is read every frame.
   */
  stereoLine(wallMs: number): string {
    const hasPlace = this.placeText !== null && wallMs - this.placeChangedMs < STEREO_PLACE_MS;
    if (hasPlace === this.lineHadPlace && this.timeText === this.lineTime) return this.line;
    this.lineHadPlace = hasPlace;
    this.lineTime = this.timeText;
    const parts = [hasPlace ? this.placeText : null, this.timeText].filter((part): part is string => part !== null);
    this.line = parts.join(' · ');
    return this.line;
  }

  dispose(): void {
    this.root.remove();
  }
}
