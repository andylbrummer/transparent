/**
 * A guide from its link to its leaving (spec/guides.md §4, §5.3, §8.5): the player, the narration, the play bar and
 * the captions joined into one, so main.ts only hands it the page and calls it each frame.
 *
 * A guide never starts by itself. A browser plays no sound before a tap, so a link opens a card with the guide's
 * title, summary and Start, and the guide starts at the tap on Start. That tap, and Retry's and Play again's, unlock
 * the audio element before anything else happens in it.
 *
 * Captions are on until the user turns them off, and the switch is remembered for the next visit (spec/guides.md §11).
 * The step's transcript is ordinary text, for a screen reader to read at its own pace: the caption overlay cannot be a
 * live region without talking over the narration.
 */

import type { CaptionOverlay } from './captions';
import type { Guide } from './format';
import { fetchGuide, guideFileUrl, type GuideLink } from './guide-files';
import { createNarration, type NarrationAudio, type NarrationDeps } from './narration';
import { controlEnabled, PlayBar, type Control, type PlayBarActions } from './play-bar';
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
  /** Where the captions switch is remembered: localStorage. */
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
}

/** The storage key of the captions switch: 'off' when the user turned captions off; anything else, or nothing, is on. */
export const CAPTIONS_STORAGE_KEY = 'guide-captions';

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
  /** The captions switch: on unless the user turned it off. */
  readonly captionsShown: boolean;
  readonly transcriptOpen: boolean;
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
  /**
   * What the guide says in Cardboard, where the play bar is hidden: what it is doing and what the viewer's button or
   * a nod would do there; '' for nothing.
   */
  stereoNotice(): string;
  /**
   * The viewer's button or a nod, in Cardboard, once the spyglass has passed on it (spec/guides.md §11): true when the
   * guide took it. A tap resumes, goes on at a gate, retries, plays again, or else pauses; a nod goes on at a
   * `continue` step and nothing else, since a head nods without meaning to.
   */
  onViewerInput(input: 'tap' | 'nod'): boolean;
  /** A key pressed on the page: true when the guide took it. Space pauses or resumes, N and B step, Escape leaves. */
  onKey(key: string): boolean;
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
  let captionsOn = captionsOnIn(deps.storage);
  let transcriptOpen = false;
  /** The captions of the step last played, kept while the guide waits or is paused there: what the transcript shows. */
  let heard: { readonly chapterIndex: number; readonly stepIndex: number; readonly cues: readonly CaptionCue[] } | null = null;

  /**
   * Inside a tap, before anything else: the browser allows the element's first play only there. A refusal is not
   * reported here: the narration's own play then fails and halts the guide, and that error's Retry is a tap that
   * unlocks again.
   */
  const unlock = (): void => {
    narration.unlock().catch(() => {});
  };

  // The bar's buttons and the keys alike: a key does what its button does.
  const controls: PlayBarActions = {
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
    toggleCaptions: () => {
      captionsOn = !captionsOn;
      rememberCaptions(deps.storage, captionsOn);
      showCaptions(player.state());
    },
    toggleTranscript: () => (transcriptOpen ? closeTranscript() : openTranscript()),
  };
  const bar = new PlayBar(deps.parent, controls);
  const transcript = new Transcript(deps.parent, () => closeTranscript());

  const guideCard = new GuideCard(deps.parent, {
    start() {
      if (card.kind !== 'ready') throw new Error('no guide is ready to start');
      unlock();
      player.start(card.guide, card.at ?? undefined);
      card = CLOSED;
      showCard();
    },
    close: closeCard,
  });

  function pause(): void {
    const state = player.state();
    const playingOn = state.kind === 'loading' || state.kind === 'playing' || state.kind === 'waiting';
    if (playingOn && !state.paused) player.pause();
  }

  function closeCard(): void {
    opens++;
    card = CLOSED;
    showCard();
  }

  function leave(): void {
    player.exit();
    setCues(null);
    transcriptOpen = false;
    transcript.show(null);
    heard = null;
  }

  /**
   * The transcript takes the focus as it opens, so a screen reader reads on from its start. It takes the captions
   * down too: the plate would say again what the transcript says.
   */
  function openTranscript(): void {
    transcriptOpen = true;
    const state = player.state();
    showTranscript(state);
    showCaptions(state);
    transcript.focus();
  }

  /** The focus goes back to the button that opened the transcript, and the captions come back if they are on. */
  function closeTranscript(): void {
    transcriptOpen = false;
    transcript.show(null);
    showCaptions(player.state());
    bar.focus('toggleTranscript');
  }

  function showTranscript(state: PlayerState): void {
    transcript.show(transcriptOpen && state.kind !== 'idle' ? transcriptFor(state) : null);
  }

  /** The current step's text, from its captions; a note where there is none, or none yet. */
  function transcriptFor(state: Exclude<PlayerState, { kind: 'idle' }>): TranscriptShown {
    const step = state.guide.chapters[state.chapterIndex].steps[state.stepIndex];
    if (!('narration' in step)) return { kind: 'note', note: 'This step has no narration.' };
    if (heard?.chapterIndex === state.chapterIndex && heard.stepIndex === state.stepIndex) {
      return { kind: 'text', cues: heard.cues, lang: state.guide.language };
    }
    return { kind: 'note', note: state.kind === 'loading' ? 'Loading…' : 'This step’s text did not load.' };
  }

  function setCues(next: { readonly cues: readonly CaptionCue[]; readonly lang: string } | null): void {
    if ((next?.cues ?? null) === cuesSet) return;
    cuesSet = next?.cues ?? null;
    captions.setCues(next);
  }

  function showCaptions(state: PlayerState): void {
    if (!captionsOn || transcriptOpen || state.kind !== 'playing') return setCues(null);
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
    if (state.kind === 'playing') heard = { chapterIndex: state.chapterIndex, stepIndex: state.stepIndex, cues: state.captions };
    bar.update(state, deltaMs, { captions: captionsOn, transcript: transcriptOpen });
    showCaptions(state);
    showTranscript(state);
    // The map's names may have come in, or failed, since the last frame.
    showCard();
  }

  function onKey(key: string): boolean {
    // Escape closes the transcript first; then it leaves at once, without asking, or closes the card the link opened.
    if (key === 'Escape') {
      if (transcriptOpen) closeTranscript();
      else if (player.state().kind !== 'idle') leave();
      else if (card.kind !== 'closed') closeCard();
      else return false;
      return true;
    }
    // A key whose button is disabled is not taken, so it reaches the look.
    const control = KEY_CONTROLS.get(key);
    if (control === undefined || !controlEnabled(player.state(), control)) return false;
    controls[control]();
    return true;
  }

  function stereoNotice(): string {
    const state = player.state();
    if (state.kind === 'idle') return '';
    if (isPaused(state)) return 'Paused · tap to resume';
    if (state.kind === 'waiting' && state.gate === 'continue') return 'Tap or nod to go on';
    if (state.kind === 'waiting' && state.offerContinue) return 'Can’t find it? Tap to go on';
    if (state.kind === 'error') return 'This step could not be played · tap to try again';
    if (state.kind === 'ended') return 'The end · tap to play again';
    // Loading…, once it has been long enough to say so.
    return bar.noticeText();
  }

  function onViewerInput(input: 'tap' | 'nod'): boolean {
    const state = player.state();
    if (state.kind === 'idle') return false;
    const paused = isPaused(state);
    const atGate = !paused && state.kind === 'waiting' && (state.gate === 'continue' || (input === 'tap' && state.offerContinue));
    if (atGate) player.goOn();
    else if (input === 'nod') return false;
    else if (paused) player.resume();
    else if (state.kind === 'error') controls.retry();
    else if (state.kind === 'ended') controls.playAgain();
    else pause();
    return true;
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
      captionsShown: captionsOn,
      transcriptOpen,
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
    transcript.dispose();
    guideCard.dispose();
  }

  return { open, update, pause, getGuide, stereoNotice, onViewerInput, onKey, dispose };
}

/** The play bar's control each key presses. Escape is not here: it closes the card as well as leaving. */
const KEY_CONTROLS: ReadonlyMap<string, Control> = new Map([
  [' ', 'pauseOrResume'],
  ['n', 'next'],
  ['N', 'next'],
  ['b', 'back'],
  ['B', 'back'],
]);

/** What the card says of the map's names while the guide waits for them. */
const LABELS_NOTE: Readonly<Record<ReturnType<GuideSessionDeps['labels']>, string>> = {
  loading: 'Loading the map…',
  ready: '',
  failed: 'The map failed to load, so the guide cannot start.',
};

const isPaused = (state: PlayerState): boolean => 'paused' in state && state.paused;

/** Whether captions are on, as the user left them. Storage that cannot be read, as in a private window, leaves them on. */
function captionsOnIn(storage: GuideSessionDeps['storage']): boolean {
  try {
    return storage.getItem(CAPTIONS_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function rememberCaptions(storage: GuideSessionDeps['storage'], on: boolean): void {
  try {
    storage.setItem(CAPTIONS_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage that cannot be written, as in a private window: the switch holds for this visit only.
  }
}

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

/** What the transcript shows: the step's text, a paragraph for each caption, or a note in its place. */
type TranscriptShown =
  | { readonly kind: 'text'; readonly cues: readonly CaptionCue[]; readonly lang: string }
  | { readonly kind: 'note'; readonly note: string };

const sameTranscript = (a: TranscriptShown, b: TranscriptShown): boolean =>
  a.kind === 'text' ? b.kind === 'text' && a.cues === b.cues && a.lang === b.lang : b.kind === 'note' && a.note === b.note;

/**
 * The step's transcript: ordinary text, selectable, and not a live region, so a screen reader reads it when the user
 * goes there and never over the narration. The text goes in as text, never as markup.
 */
class Transcript {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  /** What it shows; null while closed. */
  private shown: TranscriptShown | null = null;

  constructor(parent: HTMLElement, close: () => void) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('section');
    this.root.className = 'transcript';
    this.root.setAttribute('aria-label', 'Transcript');
    // Focusable, so opening it can take the focus there.
    this.root.tabIndex = -1;
    this.root.hidden = true;
    this.text = doc.createElement('div');
    this.text.className = 'transcript__text';
    const closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', close);
    this.root.append(this.text, closeButton);
    parent.appendChild(this.root);
  }

  /** Write it again only when what it shows has changed. */
  show(next: TranscriptShown | null): void {
    const was = this.shown;
    this.shown = next;
    if (next === null) {
      if (was !== null) this.root.hidden = true;
      return;
    }
    if (was === null) this.root.hidden = false;
    else if (sameTranscript(was, next)) return;
    const doc = this.root.ownerDocument;
    const paragraph = (text: string, lang: string | null): HTMLParagraphElement => {
      const created = doc.createElement('p');
      created.textContent = text;
      if (lang !== null) created.lang = lang;
      return created;
    };
    this.text.replaceChildren(
      ...(next.kind === 'note' ? [paragraph(next.note, null)] : next.cues.map((cue) => paragraph(cue.lines.join(' '), next.lang)))
    );
    this.text.scrollTop = 0;
  }

  focus(): void {
    this.root.focus();
  }

  dispose(): void {
    this.root.remove();
  }
}
