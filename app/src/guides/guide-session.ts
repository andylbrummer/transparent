/**
 * A guide from its link to its leaving (spec/guides.md §4, §5.3, §8.5): the player, the narration, the play bar and
 * the captions joined into one, so main.ts only hands it the page and calls it each frame.
 *
 * A guide never starts by itself. A browser plays no sound before a tap, so a link opens a card with the guide's
 * title, summary and Start, and the guide starts at the tap on Start. That tap, and Retry's and Play again's, unlock
 * the audio element before anything else happens in it.
 */

import type { CaptionOverlay } from './captions';
import type { Guide } from './format';
import { fetchGuide, guideFileUrl, type GuideLink } from './guide-files';
import { createNarration, type NarrationAudio, type NarrationDeps } from './narration';
import { PlayBar } from './play-bar';
import { createPlayer, type PlayerDeps, type PlayerState } from './player';
import type { CaptionCue } from './vtt';

export interface GuideSessionDeps {
  readonly parent: HTMLElement;
  readonly view: PlayerDeps['view'];
  /** The one audio element narration plays through. */
  readonly audio: NarrationAudio;
  /** As the browser's fetch. */
  fetch(url: string, init?: { signal: AbortSignal }): Promise<Response>;
  /** import.meta.env.BASE_URL. */
  readonly baseUrl: string;
  readonly objectUrl: NarrationDeps['objectUrl'];
  readonly captions: Pick<CaptionOverlay, 'setCues' | 'update'>;
  /** The map's names. A guide points at them, so it does not start before they are in. */
  labels(): 'loading' | 'ready' | 'failed';
}

/** What the browser harness reads of the guide. */
export interface GuideStatus {
  readonly id: string | null;
  readonly card: 'closed' | 'fetching' | 'ready' | 'failed';
  readonly state: PlayerState['kind'];
  readonly paused: boolean;
  readonly chapterIndex: number | null;
  readonly stepIndex: number | null;
  /** Seconds into the step, while it plays. */
  readonly tS: number | null;
  /** The card's or the player's error. */
  readonly message: string | null;
}

export interface GuideSession {
  /**
   * Fetch the guide and show its card; a link that could not be read shows its problem there instead. The guide
   * starts at the tap on Start: a browser plays no sound before a tap.
   */
  open(link: GuideLink | { readonly problem: string }): void;
  /** Once a frame, before ViewControl.update: moves the player on and shows where it is. */
  update(deltaMs: number): void;
  /** Pause if the guide is playing on: for the page being hidden, and for the browser stopping the sound. */
  pause(): void;
  getGuide(): GuideStatus;
  /** Leave the guide if one is open, then let go of the narration and the page. */
  dispose(): void;
}

/** Where a link starts the guide; null for its first step. */
type At = GuideLink['at'];

/** The card a link opens. A guide that starts closes it, so while it shows the player is idle. */
type Card =
  | { readonly kind: 'closed' }
  | { readonly kind: 'fetching'; readonly id: string }
  | { readonly kind: 'ready'; readonly guide: Guide; readonly at: At }
  /** `id` and `title` as far as they are known: a link that cannot be read names no guide. */
  | { readonly kind: 'failed'; readonly id: string | null; readonly title: string; readonly message: string };

const CLOSED: Card = { kind: 'closed' };

export function createGuideSession(deps: GuideSessionDeps): GuideSession {
  const { captions } = deps;
  const narration = createNarration({
    audio: deps.audio,
    fetch: (url, init) => deps.fetch(url, init),
    fileUrl: (guide, path) => guideFileUrl(deps.baseUrl, guide, path),
    objectUrl: deps.objectUrl,
    onInterrupted: () => pause(),
  });
  const player = createPlayer({ view: deps.view, loadNarration: narration.loadNarration, preloadNarration: narration.preload });

  let card: Card = CLOSED;
  // Every open and close is numbered: a guide.json that arrives after its card has gone, or after another open, is dropped.
  let opens = 0;
  /** The captions handed to the overlay, as the player's array for the step; null while none are. */
  let cuesSet: readonly CaptionCue[] | null = null;

  /**
   * Inside a tap, before anything else: the browser allows the element's first play only there. A refusal is not
   * reported here: the narration's own play then fails and halts the guide, and that error's Retry is a tap that
   * unlocks again.
   */
  const unlock = (): void => {
    narration.unlock().catch(() => {});
  };

  const bar = new PlayBar(deps.parent, {
    pauseOrResume: () => (isPaused(player.state()) ? player.resume() : pause()),
    // At a gate goOn() meets it; next() would jump and put the view in place afresh.
    next: () => (player.state().kind === 'waiting' ? player.goOn() : player.next()),
    back: () => player.back(),
    repeat: () => player.repeat(),
    goOn: () => player.goOn(),
    retry: () => {
      unlock();
      player.retry();
    },
    playAgain: () => {
      unlock();
      player.toChapter(0);
    },
    leave,
  });

  const guideCard = new GuideCard(deps.parent, {
    start() {
      if (card.kind !== 'ready') throw new Error('no guide is ready to start');
      unlock();
      player.start(card.guide, card.at ?? undefined);
      card = CLOSED;
      showCard();
    },
    close() {
      opens++;
      card = CLOSED;
      showCard();
    },
  });

  function pause(): void {
    const state = player.state();
    const playingOn = state.kind === 'loading' || state.kind === 'playing' || state.kind === 'waiting';
    if (playingOn && !state.paused) player.pause();
  }

  function leave(): void {
    player.exit();
    setCues(null);
  }

  function setCues(next: { readonly cues: readonly CaptionCue[]; readonly lang: string } | null): void {
    if ((next?.cues ?? null) === cuesSet) return;
    cuesSet = next?.cues ?? null;
    captions.setCues(next);
  }

  function showCaptions(state: PlayerState): void {
    if (state.kind !== 'playing') return setCues(null);
    setCues({ cues: state.captions, lang: state.guide.language });
    captions.update(state.tS);
  }

  function showCard(): void {
    switch (card.kind) {
      case 'closed':
        return guideCard.show(null);
      case 'fetching':
        return guideCard.show({ title: '', summary: '', note: 'Loading the guide…', start: 'none' });
      case 'failed':
        return guideCard.show({ title: card.title, summary: '', note: card.message, start: 'none' });
      case 'ready': {
        const labels = deps.labels();
        return guideCard.show({
          title: card.guide.title,
          summary: card.guide.summary,
          note: LABELS_NOTE[labels],
          start: labels === 'ready' ? 'enabled' : 'disabled',
        });
      }
    }
  }

  function open(link: GuideLink | { readonly problem: string }): void {
    if (card.kind !== 'closed' || player.state().kind !== 'idle') throw new Error('a guide is already open');
    const thisOpen = ++opens;
    if ('problem' in link) {
      card = { kind: 'failed', id: null, title: '', message: link.problem };
      return showCard();
    }
    const fetching = fetchGuide(deps, link.id);
    card = { kind: 'fetching', id: link.id };
    showCard();
    fetching.then(
      (guide) => {
        if (thisOpen !== opens) return;
        const { at } = link;
        card =
          at && guide.chapters[at.chapterIndex]?.steps[at.stepIndex] === undefined
            ? { kind: 'failed', id: guide.id, title: guide.title, message: `The guide has no step ${at.chapterIndex + 1}/${at.stepIndex + 1}.` }
            : { kind: 'ready', guide, at };
        showCard();
      },
      (error: unknown) => {
        if (thisOpen !== opens) return;
        card = { kind: 'failed', id: link.id, title: '', message: error instanceof Error ? error.message : String(error) };
        showCard();
      }
    );
  }

  function update(deltaMs: number): void {
    player.update(deltaMs);
    const state = player.state();
    bar.update(state, deltaMs);
    showCaptions(state);
    // The map's names may have come in, or failed, since the last frame.
    showCard();
  }

  function getGuide(): GuideStatus {
    const state = player.state();
    const at = state.kind === 'idle' ? null : state;
    return {
      id: at?.guide.id ?? cardId(card),
      card: card.kind,
      state: state.kind,
      paused: isPaused(state),
      chapterIndex: at?.chapterIndex ?? null,
      stepIndex: at?.stepIndex ?? null,
      tS: state.kind === 'playing' ? state.tS : null,
      message: state.kind === 'error' ? state.message : card.kind === 'failed' ? card.message : null,
    };
  }

  function dispose(): void {
    opens++;
    card = CLOSED;
    // The player first: a load cut off by the narration's dispose then rejects into a player that has left, not
    // into an error that names the browser's abort.
    if (player.state().kind !== 'idle') leave();
    narration.dispose();
    bar.dispose();
    guideCard.dispose();
  }

  return { open, update, pause, getGuide, dispose };
}

/** What the card says of the map's names while the guide waits for them. */
const LABELS_NOTE: Readonly<Record<ReturnType<GuideSessionDeps['labels']>, string>> = {
  loading: 'Loading the map…',
  ready: '',
  failed: 'The map failed to load, so the guide cannot start.',
};

const isPaused = (state: PlayerState): boolean => 'paused' in state && state.paused;

function cardId(card: Card): string | null {
  switch (card.kind) {
    case 'closed':
      return null;
    case 'ready':
      return card.guide.id;
    case 'fetching':
    case 'failed':
      return card.id;
  }
}

/** Everything the card shows, so a frame that shows the same leaves the page alone. Empty text is not shown. */
interface CardShown {
  readonly title: string;
  readonly summary: string;
  readonly note: string;
  readonly start: 'none' | 'disabled' | 'enabled';
}

/** The card's page: it shows what it is given and passes on what is pressed. */
class GuideCard {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly note: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  /** What the card shows; null while hidden. */
  private shown: CardShown | null = null;

  constructor(parent: HTMLElement, actions: { start(): void; close(): void }) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'guide-card';
    this.root.hidden = true;
    this.title = doc.createElement('h2');
    this.title.className = 'guide-card__title';
    this.summary = doc.createElement('p');
    this.summary.className = 'guide-card__summary';
    // A live region: the loading, the wait for the map and what went wrong are said as they change.
    this.note = doc.createElement('p');
    this.note.className = 'guide-card__note';
    this.note.setAttribute('role', 'status');
    const row = doc.createElement('div');
    row.className = 'guide-card__buttons';
    const button = (label: string, action: () => void): HTMLButtonElement => {
      const created = doc.createElement('button');
      created.type = 'button';
      created.textContent = label;
      // Called inside the click itself: Start has to reach unlock() while the browser still counts the tap.
      created.addEventListener('click', action);
      row.appendChild(created);
      return created;
    };
    this.startButton = button('Start', () => actions.start());
    button('Close', () => actions.close());
    this.root.append(this.title, this.summary, this.note, row);
    parent.appendChild(this.root);
  }

  /** Write what differs from what is shown, and only that. */
  show(next: CardShown | null): void {
    const was = this.shown;
    this.shown = next;
    if (next === null) {
      if (was !== null) this.root.hidden = true;
      return;
    }
    if (was === null) this.root.hidden = false;
    const text = (element: HTMLElement, value: string, before: string | undefined): void => {
      if (value === before) return;
      element.textContent = value;
      element.hidden = value === '';
    };
    text(this.title, next.title, was?.title);
    text(this.summary, next.summary, was?.summary);
    text(this.note, next.note, was?.note);
    if (next.start !== was?.start) {
      this.startButton.hidden = next.start === 'none';
      this.startButton.disabled = next.start !== 'enabled';
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
