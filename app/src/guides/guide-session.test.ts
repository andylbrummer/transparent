import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ActionOutcome, AwaitedGaze } from '../view/actions';
import { DOWN, EXAMPLE_GUIDE } from './example-guide.testdata';
import { deferred, FakeAudio } from './fake-audio.testdata';
import type { Guide } from './format';
import { createGuideSession, type GuideSessionDeps } from './guide-session';
import { parseVtt } from './vtt';

const ID = EXAMPLE_GUIDE.id;
const VTT = 'WEBVTT\n\n00:00.000 --> 00:02.000\nLook down.\n';
const file = (path: string): string => `/guides/${ID}/${path}`;
const GUIDE_JSON = file('guide.json');
const LOOK_DOWN_AUDIO = file('audio/01-look-down.m4a');
const DEEP_MANTLE_AUDIO = file('audio/03-deep-mantle.m4a');
const LAST_STEP = { chapterIndex: 0, stepIndex: 2 } as const;
const A_GAZE: AwaitedGaze = { target: DOWN, name: null, direction: new THREE.Vector3(0, -1, 0), arriving: 0 };
const REFUSED = new DOMException('play() failed because the user did not interact with the document first.', 'NotAllowedError');

/** EXAMPLE_GUIDE with its first step waiting for Next. */
const AT_CONTINUE: Guide = {
  ...EXAMPLE_GUIDE,
  chapters: [{ ...EXAMPLE_GUIDE.chapters[0], steps: EXAMPLE_GUIDE.chapters[0].steps.map((step, i) => (i === 0 ? { ...step, advance: 'continue' } : step)) }],
};

/** Each file a function of the fetch's signal, since a Response is read once: an Error is a fetch that rejects. */
type Files = Record<string, (signal: AbortSignal | undefined) => Response | Error | Promise<Response>>;

/** `guide`'s guide.json and every narration's audio and captions, as the site serves them. */
function filesOf(guide: Guide): Files {
  const files: Files = { [GUIDE_JSON]: () => new Response(JSON.stringify(guide)) };
  for (const step of guide.chapters.flatMap((chapter) => chapter.steps)) {
    if (!('narration' in step)) continue;
    files[file(step.narration.audio)] = () => new Response(`the sound of ${step.id}`);
    files[file(step.narration.captions)] = () => new Response(VTT);
  }
  return files;
}

let parent: HTMLElement;
const disposals: (() => void)[] = [];

beforeEach(() => {
  parent = document.createElement('div');
  document.body.appendChild(parent);
});

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  parent.remove();
});

/**
 * A session over the real player and narration, a fake audio element and a fetch serving `files`. The view answers
 * every action at once and counts its borrows, restores and stops; `world.awaited` is what awaitedGaze answers and
 * `world.labels` what labels() does. `events` has the borrow's end and each download's abort, in order.
 */
function setup(options: { guide?: Guide; files?: Partial<Files> } = {}) {
  const files: Files = { ...filesOf(options.guide ?? EXAMPLE_GUIDE), ...(options.files as Files) };
  const audio = new FakeAudio();
  const fetched: string[] = [];
  const events: string[] = [];
  const captionCalls: unknown[][] = [];
  const world = { borrows: 0, ends: 0, restores: 0, stops: 0, awaited: null as AwaitedGaze | null, labels: 'ready' as ReturnType<GuideSessionDeps['labels']> };
  const ok = (): Promise<ActionOutcome> => Promise.resolve({ ok: true });
  let blobs = 0;
  const session = createGuideSession({
    parent,
    view: {
      perform: ok,
      restore() {
        world.restores++;
        return ok();
      },
      preload: ok,
      awaitedGaze: () => world.awaited,
      stopAwaitingGaze() {
        world.stops++;
      },
      borrow() {
        world.borrows++;
        return {
          end() {
            world.ends++;
            events.push('borrow ended');
          },
        };
      },
    },
    audio,
    fetch(url, init) {
      fetched.push(url);
      if (init) {
        init.signal.addEventListener('abort', () => events.push(`aborted ${url}`));
      }
      const answer = files[url]?.(init?.signal) ?? new Error(`no file ${url}`);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    baseUrl: '/',
    objectUrl: { create: () => `blob:${++blobs}`, revoke() {} },
    captions: {
      setCues(captions) {
        captionCalls.push(['setCues', captions]);
      },
      update(tS) {
        captionCalls.push(['update', tS]);
      },
    },
    labels: () => world.labels,
  });
  disposals.push(() => session.dispose());
  return { session, audio, files, fetched, events, captionCalls, world };
}
type Setup = ReturnType<typeof setup>;

/** Lets every pending callback run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const visible = (element: HTMLElement): boolean => !element.hidden && !element.closest('[hidden]');
const card = (): HTMLElement => parent.querySelector<HTMLElement>('.guide-card')!;
const bar = (): HTMLElement => parent.querySelector<HTMLElement>('.play-bar')!;
/** A shown button of the card or the bar, by what it says. */
const button = (where: () => HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...where().querySelectorAll('button')].find((b) => visible(b) && b.textContent === label);
const cardButtons = (): string[] => [...card().querySelectorAll('button')].filter(visible).map((b) => b.textContent!);
/** What the card shows, its empty lines left out. */
const cardText = (): string[] =>
  [...card().querySelectorAll<HTMLElement>('h2, p')].filter((element) => visible(element)).map((element) => element.textContent!);
const note = (): HTMLElement => card().querySelector<HTMLElement>('[role="status"]')!;

/** Open the guide at `at` and tap Start once its card is ready: the first step is then loading. */
async function start(t: Setup, at: { chapterIndex: number; stepIndex: number } | null = null): Promise<void> {
  t.session.open({ id: ID, at });
  await settle();
  t.session.update(16);
  button(card, 'Start')!.click();
}

/** As start, then let the step load and play, and show it. */
async function startPlaying(t: Setup, at: { chapterIndex: number; stepIndex: number } | null = null): Promise<void> {
  await start(t, at);
  await settle();
  t.session.update(16);
  expect(t.session.getGuide().state).toBe('playing');
}

/** Start a guide whose first step's audio is not found: the guide halts on the error. */
async function halt(t: Setup): Promise<void> {
  t.files[LOOK_DOWN_AUDIO] = () => new Response('', { status: 404 });
  await start(t);
  await settle();
}

/** Play the last step and go on past it: the guide ends. */
async function end(t: Setup): Promise<void> {
  await startPlaying(t, LAST_STEP);
  button(bar, 'Next')!.click();
}

/** The browser refuses the sound the Start tap asked for: the next tap has to unlock the element again. */
async function refuseSound(t: Setup): Promise<void> {
  t.audio.plays[0].reject(REFUSED);
  await settle();
}

describe('createGuideSession', () => {
  it('fetches the guide behind a card, and lets it start once the map’s names are in', async () => {
    const t = setup();
    t.world.labels = 'loading';
    t.session.open({ id: ID, at: null });
    expect(visible(card())).toBe(true);
    expect(cardText()).toEqual(['Loading the guide…']);
    expect(cardButtons()).toEqual(['Close']);
    expect(t.session.getGuide()).toMatchObject({ id: ID, card: 'fetching', state: 'idle' });
    await settle();
    t.session.update(16);
    expect(cardText()).toEqual([EXAMPLE_GUIDE.title, EXAMPLE_GUIDE.summary, 'Loading the map…']);
    expect(button(card, 'Start')!.disabled).toBe(true);
    button(card, 'Start')!.click();
    expect(t.session.getGuide()).toMatchObject({ card: 'ready', state: 'idle' });
    expect(t.audio.plays).toEqual([]);
    t.world.labels = 'ready';
    t.session.update(16);
    expect(cardText()).toEqual([EXAMPLE_GUIDE.title, EXAMPLE_GUIDE.summary]);
    expect(cardButtons()).toEqual(['Start', 'Close']);
    expect(button(card, 'Start')!.disabled).toBe(false);
  });

  it('keeps Start disabled, and says why, when the map’s names failed to load', async () => {
    const t = setup();
    t.world.labels = 'failed';
    t.session.open({ id: ID, at: null });
    await settle();
    t.session.update(16);
    expect(note().textContent).toBe('The map failed to load, so the guide cannot start.');
    expect(button(card, 'Start')!.disabled).toBe(true);
  });

  it('shows a link and never plays it by itself, however long the card stays up', async () => {
    const t = setup();
    t.session.open({ id: ID, at: null });
    await settle();
    for (let frame = 0; frame < 600; frame++) t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ card: 'ready', state: 'idle' });
    expect(t.audio.plays).toEqual([]);
    expect(t.audio.srcs).toEqual([]);
    expect(t.fetched).toEqual([GUIDE_JSON]);
    expect(t.world.borrows).toBe(0);
  });

  it.each<[string, Partial<Files>, string]>([
    ['the guide is not found', { [GUIDE_JSON]: () => new Response('', { status: 404 }) }, `guides/${ID}/guide.json: HTTP 404`],
    [
      'the guide needs a newer app',
      { [GUIDE_JSON]: () => new Response(JSON.stringify({ ...EXAMPLE_GUIDE, formatVersion: 2 })) },
      'This guide needs a newer version of the app.',
    ],
  ])('says on the card when %s, with nothing to start', async (_, files, message) => {
    const t = setup({ files });
    t.session.open({ id: ID, at: null });
    await settle();
    t.session.update(16);
    expect(cardText()).toEqual([message]);
    expect(cardButtons()).toEqual(['Close']);
    expect(t.session.getGuide()).toMatchObject({ id: ID, card: 'failed', message });
  });

  it('shows the problem of a link it could not read, and fetches nothing', () => {
    const t = setup();
    t.session.open({ problem: 'The link does not name a guide.' });
    expect(cardText()).toEqual(['The link does not name a guide.']);
    expect(cardButtons()).toEqual(['Close']);
    expect(t.fetched).toEqual([]);
    expect(t.session.getGuide()).toMatchObject({ id: null, card: 'failed', message: 'The link does not name a guide.' });
  });

  it('says so when the link’s step is not in the guide, counting from 1 as the link does', async () => {
    const t = setup();
    t.session.open({ id: ID, at: { chapterIndex: 0, stepIndex: 5 } });
    await settle();
    expect(cardText()).toEqual([EXAMPLE_GUIDE.title, 'The guide has no step 1/6.']);
    expect(cardButtons()).toEqual(['Close']);
  });

  it('starts from the link’s step', async () => {
    const t = setup();
    await startPlaying(t, LAST_STEP);
    expect(t.session.getGuide()).toMatchObject({ chapterIndex: 0, stepIndex: 2 });
    expect(t.fetched).toContain(DEEP_MANTLE_AUDIO);
    expect(t.fetched).not.toContain(LOOK_DOWN_AUDIO);
  });

  it('closes the card at Close', async () => {
    const t = setup();
    t.session.open({ id: ID, at: null });
    await settle();
    button(card, 'Close')!.click();
    expect(visible(card())).toBe(false);
    expect(t.session.getGuide()).toMatchObject({ id: null, card: 'closed', state: 'idle' });
  });

  it('unlocks the sound inside the Start tap, then plays the guide in the play bar', async () => {
    const t = setup();
    t.session.open({ id: ID, at: null });
    await settle();
    t.session.update(16);
    button(card, 'Start')!.click();
    // As the click returns, nothing awaited: the silence asked to play inside the tap, and the guide on its way.
    expect(t.audio.plays.length).toBe(1);
    expect(t.session.getGuide()).toMatchObject({ card: 'closed', state: 'loading' });
    expect(visible(card())).toBe(false);
    await settle();
    t.session.update(16);
    expect(t.session.getGuide()).toEqual({
      id: ID,
      card: 'closed',
      state: 'playing',
      paused: false,
      chapterIndex: 0,
      stepIndex: 0,
      tS: 0,
      message: null,
    });
    expect(visible(bar())).toBe(true);
    expect(t.world.borrows).toBe(1);
  });

  it('refuses a second open while one is open or playing', async () => {
    const t = setup();
    t.session.open({ problem: 'The link does not name a guide.' });
    expect(() => t.session.open({ id: ID, at: null })).toThrow(new Error('a guide is already open'));
    button(card, 'Close')!.click();
    await startPlaying(t);
    expect(() => t.session.open({ id: ID, at: null })).toThrow(new Error('a guide is already open'));
  });

  it('drops a guide.json that arrives after its card was closed', async () => {
    const held = deferred<Response>();
    const t = setup({ files: { [GUIDE_JSON]: () => held.promise } });
    t.session.open({ id: ID, at: null });
    button(card, 'Close')!.click();
    held.resolve(new Response(JSON.stringify(EXAMPLE_GUIDE)));
    await settle();
    t.session.update(16);
    expect(visible(card())).toBe(false);
    expect(t.session.getGuide().card).toBe('closed');
  });

  it('drops a guide.json that arrives after another open, so the later card stands', async () => {
    const held = deferred<Response>();
    let asked = 0;
    const t = setup({ files: { [GUIDE_JSON]: () => (++asked === 1 ? held.promise : new Response(JSON.stringify(EXAMPLE_GUIDE))) } });
    t.session.open({ id: ID, at: null });
    button(card, 'Close')!.click();
    t.session.open({ id: ID, at: null });
    await settle();
    held.reject(new TypeError('Failed to fetch'));
    await settle();
    t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ card: 'ready', message: null });
    expect(cardButtons()).toEqual(['Start', 'Close']);
  });

  it('goes to the next step at Next while a step plays', async () => {
    const t = setup();
    await startPlaying(t);
    const restores = t.world.restores;
    button(bar, 'Next')!.click();
    expect(t.session.getGuide()).toMatchObject({ state: 'loading', stepIndex: 1 });
    // A jump: the view put in place for the step.
    expect(t.world.restores).toBe(restores + 1);
  });

  it('goes on at Next while the guide waits for it, playing on into the step after', async () => {
    const t = setup({ guide: AT_CONTINUE });
    await startPlaying(t);
    t.audio.ended = true;
    t.session.update(16);
    expect(t.session.getGuide().state).toBe('waiting');
    const restores = t.world.restores;
    button(bar, 'Next')!.click();
    expect(t.session.getGuide()).toMatchObject({ state: 'loading', stepIndex: 1 });
    // Played on within the chapter: the view goes on from the step before, not put in place afresh.
    expect(t.world.restores).toBe(restores);
  });

  it('pauses and resumes at the bar', async () => {
    const t = setup();
    await startPlaying(t);
    button(bar, 'Pause')!.click();
    expect(t.session.getGuide().paused).toBe(true);
    t.session.update(16);
    button(bar, 'Resume')!.click();
    expect(t.session.getGuide().paused).toBe(false);
  });

  it('unlocks the sound inside the Retry tap, then loads the step again', async () => {
    let found = false;
    const t = setup({ files: { [LOOK_DOWN_AUDIO]: () => (found ? new Response('the sound of look-down') : new Response('', { status: 404 })) } });
    await start(t);
    await refuseSound(t);
    t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ state: 'error', message: 'the-way-down/look-down: audio/01-look-down.m4a: HTTP 404' });
    found = true;
    const plays = t.audio.plays.length;
    button(bar, 'Retry')!.click();
    expect(t.audio.plays.length).toBe(plays + 1);
    expect(t.session.getGuide().state).toBe('loading');
    await settle();
    t.session.update(16);
    expect(t.session.getGuide().state).toBe('playing');
  });

  it('unlocks the sound inside the Play again tap, then plays from the start', async () => {
    const t = setup();
    await startPlaying(t, LAST_STEP);
    await refuseSound(t);
    button(bar, 'Next')!.click();
    t.session.update(16);
    expect(t.session.getGuide().state).toBe('ended');
    const plays = t.audio.plays.length;
    button(bar, 'Play again')!.click();
    expect(t.audio.plays.length).toBe(plays + 1);
    expect(t.session.getGuide()).toMatchObject({ state: 'loading', chapterIndex: 0, stepIndex: 0 });
  });

  it('leaves the pointer up at the end until Leave', async () => {
    const t = setup();
    await startPlaying(t, LAST_STEP);
    t.world.awaited = A_GAZE;
    button(bar, 'Next')!.click();
    for (let frame = 0; frame < 3; frame++) t.session.update(16);
    expect(t.session.getGuide().state).toBe('ended');
    expect(t.world.stops).toBe(0);
    button(bar, 'Leave')!.click();
    expect(t.world.stops).toBe(1);
  });

  it('pauses when the browser stops the narration', async () => {
    const t = setup();
    await startPlaying(t);
    t.audio.paused = true;
    t.audio.dispatchEvent(new Event('pause'));
    expect(t.session.getGuide().paused).toBe(true);
  });

  it.each<[string, (t: Setup) => Promise<void>]>([
    ['no guide is open', async () => {}],
    ['the guide has halted', halt],
    ['the guide has ended', end],
    [
      'the guide is paused already',
      async (t) => {
        await startPlaying(t);
        t.session.pause();
      },
    ],
  ])('does nothing at pause() when %s', async (_, reach) => {
    const t = setup();
    await reach(t);
    const before = t.session.getGuide();
    expect(() => t.session.pause()).not.toThrow();
    expect(t.session.getGuide()).toEqual(before);
  });

  it('hands the overlay each step’s captions once, in the guide’s language, and the time every frame', async () => {
    const t = setup();
    await startPlaying(t);
    t.audio.readyState = 1;
    t.audio.dispatchEvent(new Event('loadedmetadata'));
    t.audio.currentTime = 1.5;
    t.session.update(16);
    expect(t.captionCalls).toEqual([
      ['setCues', { cues: parseVtt(VTT), lang: 'en' }],
      ['update', 0],
      ['update', 1.5],
    ]);
  });

  it('takes the captions down while the guide waits, and between steps', async () => {
    const t = setup();
    await startPlaying(t);
    t.world.awaited = A_GAZE;
    t.audio.ended = true;
    t.session.update(16);
    expect(t.session.getGuide().state).toBe('waiting');
    expect(t.captionCalls.at(-1)).toEqual(['setCues', null]);
    t.session.update(16);
    expect(t.captionCalls.filter(([call]) => call === 'setCues')).toEqual([['setCues', { cues: parseVtt(VTT), lang: 'en' }], ['setCues', null]]);
  });

  it('gives the view back and takes the bar and the captions down at Leave', async () => {
    const t = setup();
    await startPlaying(t);
    button(bar, 'Leave')!.click();
    expect(t.session.getGuide()).toMatchObject({ id: null, state: 'idle' });
    expect(t.world.ends).toBe(1);
    expect(t.captionCalls.at(-1)).toEqual(['setCues', null]);
    t.session.update(16);
    expect(visible(bar())).toBe(false);
    expect(document.body.classList.contains('guide-open')).toBe(false);
  });

  it('pauses and resumes at Space', async () => {
    const t = setup();
    await startPlaying(t);
    expect(t.session.onKey(' ')).toBe(true);
    expect(t.session.getGuide().paused).toBe(true);
    expect(t.session.onKey(' ')).toBe(true);
    expect(t.session.getGuide().paused).toBe(false);
  });

  it.each(['n', 'N'])('goes to the next step at %s while a step plays, as Next does', async (key) => {
    const t = setup();
    await startPlaying(t);
    const restores = t.world.restores;
    expect(t.session.onKey(key)).toBe(true);
    expect(t.session.getGuide()).toMatchObject({ state: 'loading', stepIndex: 1 });
    expect(t.world.restores).toBe(restores + 1);
  });

  it('goes on at N while the guide waits for it, as Next does', async () => {
    const t = setup({ guide: AT_CONTINUE });
    await startPlaying(t);
    t.audio.ended = true;
    t.session.update(16);
    expect(t.session.getGuide().state).toBe('waiting');
    const restores = t.world.restores;
    expect(t.session.onKey('n')).toBe(true);
    expect(t.session.getGuide()).toMatchObject({ state: 'loading', stepIndex: 1 });
    expect(t.world.restores).toBe(restores);
  });

  it.each(['b', 'B'])('goes back a step at %s, as Back does', async (key) => {
    const t = setup();
    await startPlaying(t, LAST_STEP);
    expect(t.session.onKey(key)).toBe(true);
    expect(t.session.getGuide()).toMatchObject({ state: 'loading', stepIndex: 1 });
  });

  it('leaves the guide at Escape, at once, as Leave does', async () => {
    const t = setup();
    await startPlaying(t);
    expect(t.session.onKey('Escape')).toBe(true);
    expect(t.session.getGuide()).toMatchObject({ id: null, state: 'idle' });
    expect(t.world.ends).toBe(1);
    expect(t.captionCalls.at(-1)).toEqual(['setCues', null]);
  });

  it('closes the card at Escape, as Close does', async () => {
    const t = setup();
    t.session.open({ id: ID, at: null });
    await settle();
    t.session.update(16);
    expect(t.session.onKey('Escape')).toBe(true);
    expect(visible(card())).toBe(false);
    expect(t.session.getGuide()).toMatchObject({ id: null, card: 'closed', state: 'idle' });
  });

  it.each<[string, string, (t: Setup) => Promise<void>]>([
    [' ', 'the guide has halted', halt],
    ['n', 'the guide has halted', halt],
    [' ', 'the guide has ended', end],
    ['ArrowLeft', 'a step plays', (t) => startPlaying(t)],
    ['Enter', 'a step plays', (t) => startPlaying(t)],
  ])('leaves %j to the page when %s, its button disabled or the key not the guide’s', async (key, _, reach) => {
    const t = setup();
    await reach(t);
    const before = t.session.getGuide();
    expect(t.session.onKey(key)).toBe(false);
    expect(t.session.getGuide()).toEqual(before);
  });

  it.each([' ', 'n', 'b', 'Escape'])('leaves %j to the page when no guide is open', (key) => {
    const t = setup();
    expect(t.session.onKey(key)).toBe(false);
    expect(t.session.getGuide()).toMatchObject({ card: 'closed', state: 'idle' });
  });

  it('leaves the guide before cutting off its downloads at dispose, so no abort shows as an error', async () => {
    // A download that waits until it is aborted, as a browser's does.
    const untilAborted = (signal: AbortSignal | undefined): Promise<Response> =>
      new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
    const t = setup({ files: { [LOOK_DOWN_AUDIO]: untilAborted } });
    await start(t);
    await settle();
    expect(t.session.getGuide().state).toBe('loading');
    t.session.dispose();
    // The rest of the step's files, and the next step's fetched ahead, are in already: only this one was on its way.
    expect(t.events).toEqual(['borrow ended', `aborted ${LOOK_DOWN_AUDIO}`]);
    await settle();
    expect(t.session.getGuide()).toMatchObject({ state: 'idle', message: null });
    expect(parent.querySelector('.play-bar, .guide-card')).toBeNull();
  });
});
