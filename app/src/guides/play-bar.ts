import type { PlayerState } from './player';

/** How long a step may load before the bar says so. */
export const LOADING_NOTICE_MS = 1000;

export interface PlayBarActions {
  pauseOrResume(): void;
  next(): void;
  back(): void;
  repeat(): void;
  /** The user gives up looking, at the bar's offer. */
  goOn(): void;
  retry(): void;
  playAgain(): void;
  leave(): void;
  toggleCaptions(): void;
  toggleTranscript(): void;
}

/** What the bar's switches show: whether captions are on, and whether the step's transcript is open. */
export interface PlayBarSwitches {
  readonly captions: boolean;
  readonly transcript: boolean;
}

export type Control = 'back' | 'repeat' | 'pauseOrResume' | 'next' | 'toggleCaptions' | 'toggleTranscript' | 'leave';
const CONTROLS: readonly Control[] = ['toggleCaptions', 'toggleTranscript', 'back', 'repeat', 'pauseOrResume', 'next', 'leave'];

/** The button the status line offers, by its label: what pressing it does. */
type Offer = 'Retry' | 'Play again' | 'Can’t find it? Continue';

/** Everything the bar shows, so a frame that shows the same leaves the page alone. */
interface Shown {
  readonly title: string;
  readonly where: string;
  readonly enabled: Readonly<Record<Control, boolean>>;
  readonly pauseLabel: 'Pause' | 'Resume';
  readonly switches: PlayBarSwitches;
  readonly notice: string;
  /** Beneath the notice, small: what exactly went wrong, for whoever reports it. */
  readonly detail: string;
  readonly offer: Offer | null;
}

/** Which controls do anything in each state: the player throws on the rest. The switches are the page's, never the player's. */
const ENABLED: Readonly<Record<Exclude<PlayerState['kind'], 'idle'>, Readonly<Record<Control, boolean>>>> = {
  loading: { back: true, repeat: false, pauseOrResume: true, next: true, toggleCaptions: true, toggleTranscript: true, leave: true },
  playing: { back: true, repeat: true, pauseOrResume: true, next: true, toggleCaptions: true, toggleTranscript: true, leave: true },
  waiting: { back: true, repeat: true, pauseOrResume: true, next: true, toggleCaptions: true, toggleTranscript: true, leave: true },
  error: { back: false, repeat: false, pauseOrResume: false, next: false, toggleCaptions: true, toggleTranscript: true, leave: true },
  ended: { back: true, repeat: false, pauseOrResume: false, next: false, toggleCaptions: true, toggleTranscript: true, leave: true },
};

/** Whether a control does anything in `state`: its button is enabled, and its key, if it has one, is taken. */
export function controlEnabled(state: PlayerState, control: Control): boolean {
  return state.kind !== 'idle' && ENABLED[state.kind][control];
}

/**
 * The guide's controls and its status, along the foot of the page. It shows what it is given and passes
 * on what is pressed: which player call a press becomes is the caller's.
 *
 * Every press calls its action inside the click itself, never later: a Retry or a Play again has to reach unlock()
 * while the browser still counts the tap.
 */
export class PlayBar {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly where: HTMLElement;
  private readonly controls: Readonly<Record<Control, HTMLButtonElement>>;
  private readonly message: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly offerButton: HTMLButtonElement;
  /** What the bar shows; null while hidden. */
  private shown: Shown | null = null;
  /** The step that has been loading, as chapter/step, and for how long; null when none is. */
  private loadingStep: string | null = null;
  private loadingMs = 0;

  constructor(
    parent: HTMLElement,
    private readonly actions: PlayBarActions
  ) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'play-bar';
    this.root.hidden = true;

    // The heading row: the guide and the step on the left, the two switches on the right, so the controls keep one row.
    const heading = doc.createElement('div');
    heading.className = 'play-bar__heading';
    const titles = doc.createElement('div');
    titles.className = 'play-bar__titles';
    this.title = doc.createElement('p');
    this.title.className = 'play-bar__title';
    this.where = doc.createElement('p');
    this.where.className = 'play-bar__where';
    titles.append(this.title, this.where);
    const switches = doc.createElement('div');
    switches.className = 'play-bar__switches';
    heading.append(titles, switches);

    const row = doc.createElement('div');
    row.className = 'play-bar__controls';
    const control = (into: HTMLElement, name: Control, label: string, ariaLabel?: string): HTMLButtonElement => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
      button.addEventListener('click', () => this.actions[name]());
      into.appendChild(button);
      return button;
    };
    this.controls = {
      toggleCaptions: control(switches, 'toggleCaptions', 'Captions'),
      toggleTranscript: control(switches, 'toggleTranscript', 'Text', 'Transcript'),
      back: control(row, 'back', 'Back'),
      repeat: control(row, 'repeat', '−10 s', 'Back 10 seconds'),
      pauseOrResume: control(row, 'pauseOrResume', 'Pause'),
      next: control(row, 'next', 'Next'),
      leave: control(row, 'leave', 'Leave'),
    };

    // A live region: what the guide waits for, and what went wrong, are said as they change. The message scrolls on
    // its own beside the offer, so a long one keeps its first sentence on top and never scrolls Retry out of reach.
    const status = doc.createElement('div');
    status.className = 'play-bar__status';
    status.setAttribute('role', 'status');
    this.message = doc.createElement('div');
    this.message.className = 'play-bar__message';
    this.message.hidden = true;
    this.notice = doc.createElement('span');
    this.detail = doc.createElement('p');
    this.detail.className = 'play-bar__detail';
    this.detail.hidden = true;
    this.message.append(this.notice, this.detail);
    this.offerButton = doc.createElement('button');
    this.offerButton.type = 'button';
    this.offerButton.hidden = true;
    this.offerButton.addEventListener('click', () => this.pressOffer());
    status.append(this.message, this.offerButton);

    this.root.append(heading, row, status);
    parent.appendChild(this.root);
  }

  /** Once a frame, with the player's state: hidden while idle. `deltaMs` times the loading notice; the bar keeps no timer. */
  update(state: PlayerState, deltaMs: number, switches: PlayBarSwitches): void {
    const loadingStep = state.kind === 'loading' ? `${state.chapterIndex}/${state.stepIndex}` : null;
    if (loadingStep !== this.loadingStep) {
      this.loadingStep = loadingStep;
      this.loadingMs = 0;
    }
    if (loadingStep !== null) this.loadingMs += deltaMs;
    this.show(state.kind === 'idle' ? null : this.shownFor(state, switches));
  }

  /** Give a control the focus: where it goes back to when what the control opened closes. */
  focus(control: Control): void {
    this.controls[control].focus();
  }

  dispose(): void {
    this.root.remove();
    this.root.ownerDocument.body.classList.remove('guide-open');
  }

  private shownFor(state: Exclude<PlayerState, { kind: 'idle' }>, switches: PlayBarSwitches): Shown {
    const chapter = state.guide.chapters[state.chapterIndex];
    const paused = 'paused' in state && state.paused;
    let notice = '';
    let detail = '';
    let offer: Offer | null = null;
    // Paused says so above all: nothing moves until resume, whatever the step was doing.
    if (paused) notice = 'Paused';
    else if (state.kind === 'loading' && this.loadingMs >= LOADING_NOTICE_MS) notice = 'Loading…';
    else if (state.kind === 'waiting' && state.gate === 'continue') notice = 'Next to go on';
    else if (state.kind === 'waiting' && state.offerContinue) offer = 'Can’t find it? Continue';
    else if (state.kind === 'error') {
      // The player's message names files and errors; the user first reads what it means for them.
      notice = 'This step could not be played.';
      detail = state.message;
      offer = 'Retry';
    } else if (state.kind === 'ended') {
      notice = 'The end';
      offer = 'Play again';
    }
    return {
      title: state.guide.title,
      where: `${chapter.title} · ${state.stepIndex + 1}/${chapter.steps.length}`,
      enabled: ENABLED[state.kind],
      pauseLabel: paused ? 'Resume' : 'Pause',
      switches,
      notice,
      detail,
      offer,
    };
  }

  /** Write what differs from what is shown, and only that. */
  private show(next: Shown | null): void {
    const was = this.shown;
    this.shown = next;
    if (next === null) {
      if (was === null) return;
      this.root.hidden = true;
      this.root.ownerDocument.body.classList.remove('guide-open');
      return;
    }
    if (was === null) {
      this.root.hidden = false;
      this.root.ownerDocument.body.classList.add('guide-open');
    }
    if (next.title !== was?.title) this.title.textContent = next.title;
    if (next.where !== was?.where) this.where.textContent = next.where;
    for (const name of CONTROLS) {
      if (next.enabled[name] !== was?.enabled[name]) this.controls[name].disabled = !next.enabled[name];
    }
    if (next.pauseLabel !== was?.pauseLabel) this.controls.pauseOrResume.textContent = next.pauseLabel;
    if (next.switches.captions !== was?.switches.captions) this.controls.toggleCaptions.setAttribute('aria-pressed', String(next.switches.captions));
    if (next.switches.transcript !== was?.switches.transcript) this.controls.toggleTranscript.setAttribute('aria-expanded', String(next.switches.transcript));
    if (next.notice !== was?.notice) {
      this.notice.textContent = next.notice;
      // Out of the row when there is nothing to say, so an offer alone stands in the middle.
      this.message.hidden = next.notice === '';
    }
    if (next.detail !== was?.detail) {
      this.detail.textContent = next.detail;
      this.detail.hidden = next.detail === '';
    }
    if (next.offer !== was?.offer) {
      this.offerButton.hidden = next.offer === null;
      this.offerButton.textContent = next.offer ?? '';
    }
  }

  private pressOffer(): void {
    switch (this.shown?.offer) {
      case 'Retry':
        return this.actions.retry();
      case 'Play again':
        return this.actions.playAgain();
      case 'Can’t find it? Continue':
        return this.actions.goOn();
    }
  }
}
