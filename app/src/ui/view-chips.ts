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
  readonly clock: Pick<AppClock, 'isLive' | 'rate' | 'pinned'>;
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
  update(simMs: number): void {
    const place = this.deps.standing.place();
    if (place !== this.shownPlace) {
      this.shownPlace = place;
      const text = chipPlace(place);
      this.placeChip.hidden = text === null;
      if (text !== null) this.placeChip.textContent = text;
    }

    const { clock } = this.deps;
    if (clock.isLive()) {
      this.timeChip.hidden = true;
      this.shownMinute = NaN;
      return;
    }
    const minute = Math.floor(simMs / MINUTE_MS);
    const rate = clock.rate();
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
  }

  dispose(): void {
    this.root.remove();
  }
}
