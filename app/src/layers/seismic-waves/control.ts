/**
 * The playback control: which earthquake, play and pause, the scrubber,
 * the speed, and what the waves are doing where the user stands.
 *
 * Its own DOM and styles, shown while the layer is on. Like the page's
 * other controls it is hidden in Cardboard mode (body.stereo), where the
 * only input is the viewer's button.
 */

import { STEREO_BODY_CLASS } from '../../ui/cardboard';
import { PLAYBACK_SPANS_S, PLAYBACK_SPEEDS, formatClock, formatDuration } from '../../ui/timeline';

const STYLE_ID = 'seismic-playback-style';

const CSS = `
  .seismic-playback {
    position: fixed;
    /* Under the layers panel when that is open. */
    z-index: 1;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(env(safe-area-inset-bottom) + 62px);
    width: min(460px, calc(100vw - 16px));
    box-sizing: border-box;
    padding: 6px 10px 8px;
    font: 13px/1.35 system-ui, -apple-system, sans-serif;
    color: #e8ecff;
    /* Nearly solid: place names drawn under it must not read through the readout. */
    background: rgba(12, 14, 32, 0.95);
    border: 1px solid rgba(160, 180, 255, 0.35);
    border-radius: 14px;
  }
  .seismic-playback[hidden],
  body.${STEREO_BODY_CLASS} .seismic-playback {
    display: none;
  }
  .seismic-playback__row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .seismic-playback select,
  .seismic-playback button {
    min-height: 44px;
    box-sizing: border-box;
    font: inherit;
    color: #e8ecff;
    background: rgba(40, 46, 86, 0.9);
    border: 1px solid rgba(160, 180, 255, 0.35);
    border-radius: 10px;
  }
  .seismic-playback select {
    min-width: 0;
    padding: 0 6px;
  }
  .seismic-playback__event {
    flex: 1 1 auto;
  }
  .seismic-playback__speed,
  .seismic-playback__span {
    flex: 0 0 auto;
  }
  .seismic-playback__play {
    flex: 0 0 44px;
    width: 44px;
    padding: 0;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
  }
  .seismic-playback__scrub {
    flex: 1 1 auto;
    min-width: 0;
    height: 44px;
    margin: 0;
    accent-color: #9fdcff;
  }
  .seismic-playback__clock {
    flex: 0 0 auto;
    min-width: 6.2em;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: #9fdcff;
  }
  .seismic-playback :focus-visible {
    outline: 2px solid #9fdcff;
    outline-offset: 2px;
  }
  .seismic-playback__origin,
  .seismic-playback__timetable {
    font-size: 11px;
    color: rgba(232, 236, 255, 0.68);
    font-variant-numeric: tabular-nums;
  }
  .seismic-playback__next {
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .seismic-playback__next b {
    font-weight: 600;
    color: #9fdcff;
  }
  .seismic-playback__felt {
    min-height: 1.35em;
    font-weight: 600;
    color: #ffe08a;
  }
`;

export interface PlaybackHandlers {
  onSelect(key: string): void;
  onToggle(): void;
  onSeek(elapsedS: number): void;
  onSpeed(compression: number): void;
  onSpan(spanS: number): void;
}

/** Everything the control shows, as text: it only writes what has changed. */
export interface PlaybackView {
  readonly playing: boolean;
  readonly elapsedS: number;
  readonly spanS: number;
  readonly speed: number;
  /** "M9.1 · 29 km deep · 11 Mar 2011, 05:46:24 UTC". */
  readonly origin: string;
  /** "Here, 91.5° away". */
  readonly hereTitle: string;
  readonly hereNext: string;
  readonly hereTimetable: string;
  readonly antipodeNext: string;
  readonly antipodeTimetable: string;
  /** The "felt here" line; empty when nothing is passing. */
  readonly felt: string;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function spanLabel(seconds: number): string {
  return seconds >= 3600 ? `${seconds / 3600} h` : `${seconds / 60} min`;
}

export class PlaybackControl {
  readonly root: HTMLElement;
  private readonly eventSelect: HTMLSelectElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly spanSelect: HTMLSelectElement;
  private readonly playButton: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly clock: HTMLElement;
  private readonly origin: HTMLElement;
  private readonly hereNext: HTMLElement;
  private readonly hereTimetable: HTMLElement;
  private readonly antipodeNext: HTMLElement;
  private readonly antipodeTimetable: HTMLElement;
  private readonly felt: HTMLElement;
  private readonly texts = new Map<HTMLElement, string>();
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // The page's arrow keys turn the view; in here they move the scrubber and the menus.
    event.stopPropagation();
  };

  constructor(parent: HTMLElement, handlers: PlaybackHandlers) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = element('section', 'seismic-playback', parent);
    this.root.setAttribute('aria-label', 'Seismic wave playback');
    this.root.hidden = true;
    this.root.addEventListener('keydown', this.onKeyDown);

    const top = element('div', 'seismic-playback__row', this.root);
    this.eventSelect = element('select', 'seismic-playback__event', top);
    this.eventSelect.setAttribute('aria-label', 'Earthquake');
    this.eventSelect.addEventListener('change', () => handlers.onSelect(this.eventSelect.value));
    this.speedSelect = element('select', 'seismic-playback__speed', top);
    this.speedSelect.setAttribute('aria-label', 'Playback speed');
    for (const speed of PLAYBACK_SPEEDS) {
      const option = element('option', '', this.speedSelect);
      option.value = String(speed);
      option.textContent = `${speed}×`;
    }
    this.speedSelect.addEventListener('change', () => handlers.onSpeed(Number(this.speedSelect.value)));
    this.spanSelect = element('select', 'seismic-playback__span', top);
    this.spanSelect.setAttribute('aria-label', 'Length of the timeline');
    for (const span of PLAYBACK_SPANS_S) {
      const option = element('option', '', this.spanSelect);
      option.value = String(span);
      option.textContent = spanLabel(span);
    }
    this.spanSelect.addEventListener('change', () => handlers.onSpan(Number(this.spanSelect.value)));

    const transport = element('div', 'seismic-playback__row', this.root);
    this.playButton = element('button', 'seismic-playback__play', transport);
    this.playButton.type = 'button';
    this.playButton.addEventListener('click', () => handlers.onToggle());
    this.scrub = element('input', 'seismic-playback__scrub', transport);
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.step = '1';
    this.scrub.setAttribute('aria-label', 'Time since the earthquake');
    this.scrub.addEventListener('input', () => handlers.onSeek(Number(this.scrub.value)));
    this.clock = element('div', 'seismic-playback__clock', transport);

    this.origin = element('div', 'seismic-playback__origin', this.root);
    this.hereNext = element('div', 'seismic-playback__next', this.root);
    this.hereTimetable = element('div', 'seismic-playback__timetable', this.root);
    this.antipodeNext = element('div', 'seismic-playback__next', this.root);
    this.antipodeTimetable = element('div', 'seismic-playback__timetable', this.root);
    this.felt = element('div', 'seismic-playback__felt', this.root);
    // Announced, politely: this is the moment the layer is for.
    this.felt.setAttribute('role', 'status');
    this.felt.setAttribute('aria-live', 'polite');
  }

  /** Fill the picker. The selection is kept if it is still on offer. */
  setEvents(events: readonly { readonly key: string; readonly label: string }[], selectedKey: string): void {
    this.eventSelect.replaceChildren();
    for (const event of events) {
      const option = element('option', '', this.eventSelect);
      option.value = event.key;
      option.textContent = event.label;
    }
    this.eventSelect.value = selectedKey;
  }

  private setText(node: HTMLElement, text: string): void {
    if (this.texts.get(node) === text) return;
    this.texts.set(node, text);
    node.textContent = text;
  }

  update(view: PlaybackView): void {
    const playLabel = view.playing ? 'Pause' : 'Play';
    if (this.playButton.getAttribute('aria-label') !== playLabel) {
      this.playButton.setAttribute('aria-label', playLabel);
      this.playButton.title = playLabel;
      this.playButton.textContent = view.playing ? '❚❚' : '▶';
    }
    if (this.scrub.max !== String(view.spanS)) this.scrub.max = String(view.spanS);
    const whole = String(Math.round(view.elapsedS));
    if (this.scrub.value !== whole) {
      this.scrub.value = whole;
      this.scrub.setAttribute('aria-valuetext', `${formatDuration(view.elapsedS)} after the earthquake`);
    }
    if (this.speedSelect.value !== String(view.speed)) this.speedSelect.value = String(view.speed);
    if (this.spanSelect.value !== String(view.spanS)) this.spanSelect.value = String(view.spanS);
    this.setText(this.clock, `T+ ${formatClock(view.elapsedS)}`);
    this.setText(this.origin, view.origin);
    this.setText(this.hereNext, `${view.hereTitle}: ${view.hereNext}`);
    this.setText(this.hereTimetable, view.hereTimetable);
    this.setText(this.antipodeNext, `Antipode: ${view.antipodeNext}`);
    this.setText(this.antipodeTimetable, view.antipodeTimetable);
    this.setText(this.felt, view.felt);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }
}
