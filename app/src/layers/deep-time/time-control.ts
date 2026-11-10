/**
 * The deep-time control: a slider with step and play buttons that picks
 * an age - millions of years for the continents, thousands for the ice.
 *
 * Deep time is its own state. The app clock (the sky, the weather, the
 * live feeds) stays at now; this only moves the layers that own a
 * control. Each such layer makes one TimeControl; they stack in one dock
 * at the bottom centre of the screen, above the HUD line and above any
 * other control that has claimed the bottom edge, so two of them - or one
 * of these and another layer's playback bar - never overlap.
 *
 * Everything the control needs is made here: its elements, its styles
 * (injected once), its keyboard handling. Buttons and the slider's thumb
 * are 44 CSS px targets. The dock is hidden in Cardboard stereo, where
 * there is nothing to touch.
 */

export interface TimeControlSpec {
  /** Unique among controls; becomes part of element ids. */
  readonly id: string;
  /** What the control moves, e.g. "Continents through time": its accessible name. */
  readonly title: string;
  /** The oldest value; the youngest is always 0, the present. */
  readonly max: number;
  /** Slider and arrow-key step. */
  readonly step: number;
  /** What the older / younger buttons move by. */
  readonly buttonStep: number;
  /** Units per second while playing; play always runs toward the present. */
  readonly playRate: number;
  /** Where play starts from when pressed at the present. Default: max. */
  readonly playFrom?: number;
  /** "152 Ma": the value as shown. */
  format(value: number): string;
  /** "152 million years ago": the value as read out. */
  formatSpoken(value: number): string;
  /** "Late Jurassic": what the value is called, or ''. */
  describe(value: number): string;
  /** CSS colour of the chip beside the name, or null for none. */
  swatch?(value: number): string | null;
  /** CSS background for the slider's track, oldest on the left. */
  readonly trackBackground?: string;
}

const DOCK_ID = 'deep-time-dock';
const STYLE_ID = 'deep-time-control-style';
/** Gap kept between the dock and whatever it sits above, CSS px. */
const DOCK_GAP_PX = 6;
const RELAYOUT_MS = 500;

const STYLE = `
#${DOCK_ID} {
  position: fixed;
  left: 50%;
  bottom: 44px;
  transform: translateX(-50%);
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(520px, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  /* Only the controls themselves take touches; the gaps let drags through to the view. */
  pointer-events: none;
}
body.stereo #${DOCK_ID} { display: none; }
.time-control {
  pointer-events: auto;
  box-sizing: border-box;
  padding: 6px 8px 4px;
  border: 1px solid rgba(160, 180, 255, 0.25);
  border-radius: 10px;
  background: rgba(5, 5, 16, 0.82);
  color: #e8ecff;
  font: 13px/1.3 system-ui, -apple-system, sans-serif;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
}
.time-control[hidden] { display: none; }
.time-control__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 18px;
  white-space: nowrap;
}
.time-control__chip {
  flex: none;
  align-self: center;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.time-control__chip[hidden] { display: none; }
.time-control__value {
  flex: none;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
}
.time-control__name {
  flex: none;
  color: #cfd8ff;
}
.time-control__note {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  font-size: 12px;
  color: #ffd98a;
}
.time-control__row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.time-control button {
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #e8ecff;
  font: inherit;
  cursor: pointer;
}
.time-control button svg {
  display: block;
  margin: auto;
  width: 20px;
  height: 20px;
  fill: currentColor;
}
.time-control button:hover { background: rgba(159, 220, 255, 0.12); }
.time-control button:active { background: rgba(159, 220, 255, 0.25); }
.time-control button:disabled { color: rgba(232, 236, 255, 0.3); cursor: default; background: transparent; }
.time-control button:focus-visible,
.time-control input[type='range']:focus-visible {
  outline: 2px solid #9fdcff;
  outline-offset: -2px;
}
.time-control input[type='range'] {
  flex: 1 1 0;
  min-width: 0;
  height: 44px;
  margin: 0 6px 0 4px;
  background: transparent;
  cursor: pointer;
  border-radius: 8px;
  -webkit-appearance: none;
  appearance: none;
}
.time-control input[type='range']::-webkit-slider-runnable-track {
  height: 10px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: var(--time-control-track, rgba(159, 220, 255, 0.3));
}
.time-control input[type='range']::-moz-range-track {
  height: 10px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: var(--time-control-track, rgba(159, 220, 255, 0.3));
}
.time-control input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 30px;
  margin-top: -11px;
  border-radius: 5px;
  border: 2px solid #050510;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
}
.time-control input[type='range']::-moz-range-thumb {
  width: 10px;
  height: 26px;
  border-radius: 5px;
  border: 2px solid #050510;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
}
.time-control__ends {
  display: flex;
  justify-content: space-between;
  /* Under the slider only: past the three 44 px buttons and their gaps. */
  margin: -9px 8px 0 142px;
  font-size: 10px;
  color: rgba(232, 236, 255, 0.6);
  pointer-events: none;
}
`;

const ICONS = {
  older: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6 10l6.5 6V4z"/><rect x="13.5" y="4" width="2" height="12"/></svg>',
  younger: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4 14 10l-6.5 6V4z"/><rect x="4.5" y="4" width="2" height="12"/></svg>',
  play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3.6" height="12"/><rect x="11.4" y="4" width="3.6" height="12"/></svg>',
} as const;

/** `value` held to [0, max] and to whole steps. */
export function snapValue(value: number, step: number, max: number): number {
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(0, snapped));
}

/**
 * The value after `deltaMs` of play: toward the present at `rate` units per
 * second, stopping on it. A frame that took seconds (a backgrounded tab)
 * counts as a tenth of one, so play never leaps on return.
 */
export function advancePlay(value: number, deltaMs: number, rate: number): number {
  return Math.max(0, value - (rate * Math.min(deltaMs, 100)) / 1000);
}

/** The rectangle of something else that sits on the bottom edge. */
export interface Obstacle {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * How far above the bottom edge the dock's own bottom must sit to clear
 * the HUD and every obstacle that overlaps its span: CSS px.
 */
export function dockBottomPx(viewportHeight: number, dockLeft: number, dockRight: number, obstacles: readonly Obstacle[]): number {
  let top = viewportHeight;
  for (const o of obstacles) {
    if (o.right <= dockLeft || o.left >= dockRight) continue;
    top = Math.min(top, o.top);
  }
  return Math.max(0, viewportHeight - top) + DOCK_GAP_PX;
}

let dockUsers = 0;
let relayoutTimer: number | null = null;

/**
 * What already holds the bottom edge: the HUD line, and any other fixed
 * control a layer has put there (the seismic playback bar, say). Found by
 * looking, not by name, so neither side has to know the other.
 */
function bottomObstacles(dock: HTMLElement): Obstacle[] {
  const found: Obstacle[] = [];
  const height = window.innerHeight;
  const candidates: Element[] = [...document.body.children];
  const container = document.getElementById('canvas-container');
  if (container) candidates.push(...container.children);
  for (const element of candidates) {
    if (element === dock || !(element instanceof HTMLElement) || element instanceof HTMLCanvasElement) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (style.position !== 'fixed' && style.position !== 'absolute') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // Something on the bottom edge and no taller than a control: not a panel, not a full-screen overlay.
    if (rect.bottom < height - 4 || rect.height > height * 0.35) continue;
    // The HUD lets touches through but its text must stay readable; anything else only counts if it takes touches.
    if (element.id !== 'hud' && style.pointerEvents === 'none') continue;
    found.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
  }
  return found;
}

function relayoutDock(): void {
  const dock = document.getElementById(DOCK_ID);
  if (!dock) return;
  const rect = dock.getBoundingClientRect();
  const bottom = dockBottomPx(window.innerHeight, rect.left, rect.right, bottomObstacles(dock));
  const value = `${Math.round(bottom)}px`;
  if (dock.style.bottom !== value) dock.style.bottom = value;
}

function acquireDock(): HTMLElement {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  let dock = document.getElementById(DOCK_ID);
  if (!dock) {
    dock = document.createElement('div');
    dock.id = DOCK_ID;
    document.body.appendChild(dock);
  }
  dockUsers += 1;
  if (relayoutTimer === null) {
    // The HUD's height changes with its text and other controls come and go; a slow poll follows both.
    relayoutTimer = window.setInterval(relayoutDock, RELAYOUT_MS);
    window.addEventListener('resize', relayoutDock);
  }
  return dock;
}

function releaseDock(): void {
  dockUsers -= 1;
  if (dockUsers > 0) return;
  if (relayoutTimer !== null) {
    window.clearInterval(relayoutTimer);
    relayoutTimer = null;
    window.removeEventListener('resize', relayoutDock);
  }
  document.getElementById(DOCK_ID)?.remove();
}

export class TimeControl {
  private readonly root: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly valueText: HTMLElement;
  private readonly nameText: HTMLElement;
  private readonly noteText: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly playButton: HTMLButtonElement;
  private readonly olderButton: HTMLButtonElement;
  private readonly youngerButton: HTMLButtonElement;
  private current: number;
  private playing = false;
  private shownText = '';
  private readonly listeners: ((value: number) => void)[] = [];

  constructor(
    private readonly spec: TimeControlSpec,
    initial = 0
  ) {
    const dock = acquireDock();
    this.current = Math.min(spec.max, Math.max(0, initial));

    const root = document.createElement('section');
    root.className = 'time-control';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', spec.title);
    root.hidden = true;
    if (spec.trackBackground) root.style.setProperty('--time-control-track', spec.trackBackground);

    const head = document.createElement('div');
    head.className = 'time-control__head';
    this.chip = document.createElement('span');
    this.chip.className = 'time-control__chip';
    this.chip.setAttribute('aria-hidden', 'true');
    this.valueText = document.createElement('span');
    this.valueText.className = 'time-control__value';
    this.nameText = document.createElement('span');
    this.nameText.className = 'time-control__name';
    this.noteText = document.createElement('span');
    this.noteText.className = 'time-control__note';
    head.append(this.chip, this.valueText, this.nameText, this.noteText);

    const row = document.createElement('div');
    row.className = 'time-control__row';
    this.olderButton = this.button(ICONS.older, `Back ${spec.formatSpoken(spec.buttonStep).replace(/ ago$/, '')}`, () => {
      this.pause();
      this.setValue(snapValue(this.current + spec.buttonStep, spec.buttonStep, spec.max));
    });
    this.playButton = this.button(ICONS.play, 'Play toward the present', () => this.togglePlay());
    this.youngerButton = this.button(ICONS.younger, `Forward ${spec.formatSpoken(spec.buttonStep).replace(/ ago$/, '')}`, () => {
      this.pause();
      this.setValue(snapValue(this.current - spec.buttonStep, spec.buttonStep, spec.max));
    });

    // The slider runs oldest on the left to today on the right, so its value is the age negated.
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `time-control-${spec.id}`;
    slider.min = String(-spec.max);
    slider.max = '0';
    slider.step = String(spec.step);
    slider.setAttribute('aria-label', `${spec.title}: age`);
    slider.addEventListener('input', () => {
      this.pause();
      this.setValue(-Number(slider.value));
    });
    // A drag on the slider must not also orbit the view under it.
    for (const type of ['pointerdown', 'touchstart', 'mousedown', 'wheel'] as const) {
      root.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
    }
    this.slider = slider;
    row.append(this.olderButton, this.playButton, this.youngerButton, slider);

    const ends = document.createElement('div');
    ends.className = 'time-control__ends';
    ends.setAttribute('aria-hidden', 'true');
    const oldest = document.createElement('span');
    oldest.textContent = spec.format(spec.max);
    const youngest = document.createElement('span');
    youngest.textContent = 'today';
    ends.append(oldest, youngest);

    root.append(head, row, ends);
    dock.appendChild(root);
    this.root = root;
    this.render();
  }

  private button(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = icon;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', onClick);
    return button;
  }

  get value(): number {
    return this.current;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Called with the new value whenever it changes, by hand or by play. */
  onChange(listener: (value: number) => void): void {
    this.listeners.push(listener);
  }

  setValue(value: number): void {
    const next = Math.min(this.spec.max, Math.max(0, value));
    if (next === this.current) return;
    this.current = next;
    this.render();
    for (const listener of this.listeners) listener(next);
  }

  /** A line at the right of the header - where the user's own ground was, say. Empty clears it. */
  setNote(text: string): void {
    if (this.noteText.textContent !== text) {
      this.noteText.textContent = text;
      this.noteText.title = text;
    }
  }

  setVisible(visible: boolean): void {
    if (!visible) this.pause();
    this.root.hidden = !visible;
    relayoutDock();
  }

  togglePlay(): void {
    if (this.playing) {
      this.pause();
      return;
    }
    if (this.current <= 0) this.setValue(this.spec.playFrom ?? this.spec.max);
    this.playing = true;
    this.renderPlayButton();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    // Rest on a value the slider can hold.
    this.setValue(snapValue(this.current, this.spec.step, this.spec.max));
    this.renderPlayButton();
  }

  /** Advance play by one frame; the owning layer calls this from its update. */
  tick(deltaMs: number): void {
    if (!this.playing) return;
    this.setValue(advancePlay(this.current, deltaMs, this.spec.playRate));
    if (this.current <= 0) this.pause();
  }

  private renderPlayButton(): void {
    const label = this.playing ? 'Pause' : 'Play toward the present';
    this.playButton.innerHTML = this.playing ? ICONS.pause : ICONS.play;
    this.playButton.setAttribute('aria-label', label);
    this.playButton.title = label;
  }

  private render(): void {
    const value = this.current;
    // While playing the value passes through fractions; the text only changes when what it says does.
    const text = this.spec.format(value);
    const name = this.spec.describe(value);
    const key = `${text}|${name}`;
    if (key !== this.shownText) {
      this.shownText = key;
      this.valueText.textContent = text;
      this.nameText.textContent = name;
      const colour = this.spec.swatch?.(value) ?? null;
      this.chip.hidden = colour === null;
      if (colour !== null) this.chip.style.background = colour;
      this.slider.setAttribute('aria-valuetext', name ? `${this.spec.formatSpoken(value)}, ${name}` : this.spec.formatSpoken(value));
    }
    const sliderValue = String(-snapValue(value, this.spec.step, this.spec.max));
    if (this.slider.value !== sliderValue) this.slider.value = sliderValue;
    this.olderButton.disabled = value >= this.spec.max;
    this.youngerButton.disabled = value <= 0;
  }

  dispose(): void {
    this.pause();
    this.listeners.length = 0;
    this.root.remove();
    releaseDock();
  }
}
