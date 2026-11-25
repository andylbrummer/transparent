import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_GUIDE } from './example-guide.testdata';
import { LOADING_NOTICE_MS, PlayBar, type PlayBarActions, type PlayBarSwitches } from './play-bar';
import type { PlayerState } from './player';

const AT = { guide: EXAMPLE_GUIDE, chapterIndex: 0, stepIndex: 1 } as const;
const IDLE: PlayerState = { kind: 'idle' };
const LOADING: PlayerState = { ...AT, kind: 'loading', paused: false };
const PLAYING: PlayerState = { ...AT, kind: 'playing', paused: false, tS: 3, captions: [] };
const AT_CONTINUE: PlayerState = { ...AT, kind: 'waiting', paused: false, gate: 'continue', offerContinue: false };
const AT_GAZE: PlayerState = { ...AT, kind: 'waiting', paused: false, gate: 'gaze', offerContinue: false };
const AT_GAZE_OFFERED: PlayerState = { ...AT_GAZE, offerContinue: true };
const ERROR: PlayerState = { ...AT, kind: 'error', message: 'the-way-down/shells: audio/02-shells.m4a: HTTP 404' };
const ENDED: PlayerState = { ...AT, kind: 'ended' };
const SWITCHES: PlayBarSwitches = { captions: true, transcript: false };

let parent: HTMLElement;
let actions: { [K in keyof PlayBarActions]: ReturnType<typeof vi.fn> };
let bar: PlayBar;

const root = (): HTMLElement => parent.querySelector<HTMLElement>('.play-bar')!;
const status = (): HTMLElement => parent.querySelector<HTMLElement>('[role="status"]')!;
const detail = (): HTMLElement => parent.querySelector<HTMLElement>('.play-bar__detail')!;
/** A button of the bar by what it says, if it shows. */
const button = (label: string): HTMLButtonElement | undefined =>
  [...parent.querySelectorAll('button')].find((b) => !b.hidden && b.textContent === label);
const CONTROLS = ['Back', '−10 s', 'Pause', 'Next', 'Captions', 'Text', 'Leave'] as const;

beforeEach(() => {
  parent = document.createElement('div');
  document.body.appendChild(parent);
  actions = {
    pauseOrResume: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    repeat: vi.fn(),
    goOn: vi.fn(),
    retry: vi.fn(),
    playAgain: vi.fn(),
    leave: vi.fn(),
    toggleCaptions: vi.fn(),
    toggleTranscript: vi.fn(),
  };
  bar = new PlayBar(parent, actions);
});

afterEach(() => {
  bar.dispose();
  parent.remove();
});

describe('PlayBar', () => {
  it('hides while no guide is open, shows the guide and the step while one is, and lets go on dispose', () => {
    bar.update(IDLE, 16, SWITCHES);
    expect(root().hidden).toBe(true);
    expect(document.body.classList.contains('guide-open')).toBe(false);
    bar.update(PLAYING, 16, SWITCHES);
    expect(root().hidden).toBe(false);
    expect(document.body.classList.contains('guide-open')).toBe(true);
    expect(root().querySelector('.play-bar__title')!.textContent).toBe('Down through the Earth');
    expect(root().querySelector('.play-bar__where')!.textContent).toBe('The way down · 2/3');
    bar.update(IDLE, 16, SWITCHES);
    expect(root().hidden).toBe(true);
    expect(document.body.classList.contains('guide-open')).toBe(false);
    bar.update(PLAYING, 16, SWITCHES);
    bar.dispose();
    expect(parent.querySelector('.play-bar')).toBeNull();
    expect(document.body.classList.contains('guide-open')).toBe(false);
  });

  it.each<[string, PlayerState, readonly boolean[]]>([
    ['loading', LOADING, [true, false, true, true, true, true, true]],
    ['playing', PLAYING, [true, true, true, true, true, true, true]],
    ['waiting', AT_CONTINUE, [true, true, true, true, true, true, true]],
    ['halted', ERROR, [false, false, false, false, true, true, true]],
    ['ended', ENDED, [true, false, false, false, true, true, true]],
  ])('enables only what can be done while %s', (_, state, enabled) => {
    bar.update(state, 16, SWITCHES);
    expect(CONTROLS.map((label) => !button(label)!.disabled)).toEqual(enabled);
  });

  it('names its buttons for a screen reader as they read, the 10 s one and the transcript’s in words, all of type button', () => {
    bar.update(PLAYING, 16, SWITCHES);
    expect(button('−10 s')!.getAttribute('aria-label')).toBe('Back 10 seconds');
    expect(button('Text')!.getAttribute('aria-label')).toBe('Transcript');
    for (const b of parent.querySelectorAll('button')) expect(b.type).toBe('button');
  });

  it('passes on each press inside the click, once', () => {
    bar.update(PLAYING, 16, SWITCHES);
    const pressed: [string, keyof PlayBarActions][] = [
      ['Back', 'back'],
      ['−10 s', 'repeat'],
      ['Pause', 'pauseOrResume'],
      ['Next', 'next'],
      ['Captions', 'toggleCaptions'],
      ['Text', 'toggleTranscript'],
      ['Leave', 'leave'],
    ];
    for (const [label, action] of pressed) {
      button(label)!.click();
      expect(actions[action]).toHaveBeenCalledOnce();
    }
    for (const [state, label, action] of [
      [ERROR, 'Retry', 'retry'],
      [ENDED, 'Play again', 'playAgain'],
      [AT_GAZE_OFFERED, 'Can’t find it? Continue', 'goOn'],
    ] as const) {
      bar.update(state, 16, SWITCHES);
      button(label)!.click();
      expect(actions[action]).toHaveBeenCalledOnce();
    }
  });

  it.each<[string, PlayerState]>([
    ['playing', PLAYING],
    ['halted', ERROR],
  ])('says whether captions are on and the transcript open while %s', (_, state) => {
    bar.update(state, 16, { captions: true, transcript: false });
    expect(button('Captions')!.getAttribute('aria-pressed')).toBe('true');
    expect(button('Text')!.getAttribute('aria-expanded')).toBe('false');
    bar.update(state, 16, { captions: false, transcript: true });
    expect(button('Captions')!.getAttribute('aria-pressed')).toBe('false');
    expect(button('Text')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('puts the two switches in the heading row and keeps the controls to one row of five', () => {
    bar.update(PLAYING, 16, SWITCHES);
    const labels = (selector: string): string[] => [...root().querySelectorAll(`${selector} button`)].map((b) => b.textContent!);
    expect(labels('.play-bar__heading')).toEqual(['Captions', 'Text']);
    expect(labels('.play-bar__controls')).toEqual(['Back', '−10 s', 'Pause', 'Next', 'Leave']);
  });

  it('gives a control the focus', () => {
    bar.update(PLAYING, 16, SWITCHES);
    bar.focus('toggleTranscript');
    expect(document.activeElement).toBe(button('Text'));
  });

  it('says Pause while the guide runs and Resume while it is paused', () => {
    bar.update(PLAYING, 16, SWITCHES);
    expect(button('Pause')).toBeDefined();
    bar.update({ ...PLAYING, paused: true }, 16, SWITCHES);
    expect(button('Pause')).toBeUndefined();
    expect(button('Resume')).toBeDefined();
  });

  it('mentions loading only once a step has loaded for LOADING_NOTICE_MS, counting afresh for each step', () => {
    bar.update(LOADING, LOADING_NOTICE_MS - 1, SWITCHES);
    expect(status().textContent).toBe('');
    bar.update(LOADING, 1, SWITCHES);
    expect(status().textContent).toBe('Loading…');
    bar.update({ ...LOADING, stepIndex: 2 }, LOADING_NOTICE_MS - 1, SWITCHES);
    expect(status().textContent).toBe('');
    bar.update(PLAYING, 16, SWITCHES);
    bar.update(LOADING, LOADING_NOTICE_MS - 1, SWITCHES);
    expect(status().textContent).toBe('');
  });

  it.each<[string, PlayerState, string, string | null]>([
    ['playing', PLAYING, '', null],
    ['paused', { ...PLAYING, paused: true }, 'Paused', null],
    ['paused at a gate whose offer is up', { ...AT_GAZE_OFFERED, paused: true }, 'Paused', null],
    ['waiting for Next', AT_CONTINUE, 'Next to go on', null],
    ['waiting for the user to turn', AT_GAZE, '', null],
    ['waiting long for the user to turn', AT_GAZE_OFFERED, '', 'Can’t find it? Continue'],
    ['halted', ERROR, 'This step could not be played.the-way-down/shells: audio/02-shells.m4a: HTTP 404', 'Retry'],
    ['ended', ENDED, 'The end', 'Play again'],
  ])('says in its status line what the guide is doing: %s', (_, state, notice, offer) => {
    bar.update(state, 16, SWITCHES);
    const offered = [...status().querySelectorAll('button')].filter((b) => !b.hidden);
    expect(offered.map((b) => b.textContent)).toEqual(offer === null ? [] : [offer]);
    expect(status().textContent).toBe(notice + (offer ?? ''));
  });

  it('opens a halt with a plain sentence and puts the full message beneath it, in the status', () => {
    bar.update(ERROR, 16, SWITCHES);
    expect(status().querySelector('span')!.textContent).toBe('This step could not be played.');
    expect(status().contains(detail())).toBe(true);
    expect(detail().hidden).toBe(false);
    expect(detail().textContent).toBe('the-way-down/shells: audio/02-shells.m4a: HTTP 404');
    expect(status().contains(button('Retry')!)).toBe(true);
  });

  it('clears the message once a Retry has the step loading again', () => {
    bar.update(ERROR, 16, SWITCHES);
    bar.update(LOADING, 16, SWITCHES);
    expect(detail().hidden).toBe(true);
    expect(detail().textContent).toBe('');
  });

  it('takes an empty message out of the row, so an offer alone stands in the middle', () => {
    const message = (): HTMLElement => parent.querySelector<HTMLElement>('.play-bar__message')!;
    bar.update(AT_GAZE_OFFERED, 16, SWITCHES);
    expect(message().hidden).toBe(true);
    bar.update(ENDED, 16, SWITCHES);
    expect(message().hidden).toBe(false);
  });

  it.each<[string, PlayerState, PlayerState]>([
    ['playing on', PLAYING, { ...PLAYING, tS: 4 }],
    ['halted, with a message and an offer', ERROR, { ...ERROR }],
  ])('leaves the page alone while the state shows the same: %s', (_, first, again) => {
    const observer = new MutationObserver(() => {});
    observer.observe(parent, { subtree: true, childList: true, characterData: true, attributes: true });
    bar.update(first, 16, SWITCHES);
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    bar.update(again, 16, SWITCHES);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });
});
