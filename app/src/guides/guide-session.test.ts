import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ActionOutcome, AwaitedGaze } from '../view/actions';
import { DOWN, EXAMPLE_GUIDE } from './example-guide.testdata';
import { deferred, FakeAudio } from './fake-audio.testdata';
import type { Guide } from './format';
import { CAPTIONS_STORAGE_KEY, createGuideSession, type GuideClips, type GuideSessionDeps } from './guide-session';
import type { HotspotSource } from './hotspot-field';
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

/** EXAMPLE_GUIDE with its second step a silence: no narration, so no captions and nothing to fetch for it. */
const SILENT_SECOND: Guide = {
  ...EXAMPLE_GUIDE,
  chapters: [
    {
      ...EXAMPLE_GUIDE.chapters[0],
      steps: EXAMPLE_GUIDE.chapters[0].steps.map((step, i) =>
        i === 1 ? { id: step.id, silenceS: 2, cues: step.cues, advance: step.advance } : step
      ),
    },
  ],
};
/** The first step's captions for the transcript: two cues, one of two lines, one with an escape that reads as markup. */
const LOOK_DOWN_VTT = 'WEBVTT\n\n00:00.000 --> 00:01.000\nStraight down,\nthrough the Earth.\n\n00:01.000 --> 00:02.000\n&lt;b&gt;Not&lt;/b&gt; markup.\n';
const SHELLS_VTT = 'WEBVTT\n\n00:00.000 --> 00:02.000\nThe shells.\n';

/** localStorage's two calls, over a Map. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string): string | null => items.get(key) ?? null,
    setItem(key: string, value: string): void {
      items.set(key, value);
    },
  };
}

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
function setup(options: { guide?: Guide; files?: Partial<Files>; storage?: GuideSessionDeps['storage']; clips?: GuideClips } = {}) {
  const files: Files = { ...filesOf(options.guide ?? EXAMPLE_GUIDE), ...(options.files as Files) };
  const audio = new FakeAudio();
  const fetched: string[] = [];
  const events: string[] = [];
  const captionCalls: unknown[][] = [];
  const world = { borrows: 0, ends: 0, restores: 0, stops: 0, awaited: null as AwaitedGaze | null, labels: 'ready' as ReturnType<GuideSessionDeps['labels']> };
  const ok = (): Promise<ActionOutcome> => Promise.resolve({ ok: true });
  let blobs = 0;
  const storage = options.storage ?? memoryStorage();
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
          hold() {},
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
    storage,
    clips: options.clips,
  });
  disposals.push(() => session.dispose());
  return { session, audio, files, fetched, events, captionCalls, world, storage };
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
const transcript = (): HTMLElement => parent.querySelector<HTMLElement>('.transcript')!;
/** What the transcript shows, a paragraph at a time, with each paragraph's language. */
const transcriptText = (): [string, string][] => [...transcript().querySelectorAll('p')].map((p) => [p.lang, p.textContent!]);

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
      captionsShown: true,
      transcriptOpen: false,
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

  it('shows captions at first, and turns them off and on again at Captions, remembering the switch', async () => {
    const t = setup();
    await startPlaying(t);
    expect(t.session.getGuide().captionsShown).toBe(true);
    expect(t.captionCalls.at(-2)).toEqual(['setCues', { cues: parseVtt(VTT), lang: 'en' }]);
    button(bar, 'Captions')!.click();
    expect(t.captionCalls.at(-1)).toEqual(['setCues', null]);
    expect(t.storage.getItem(CAPTIONS_STORAGE_KEY)).toBe('off');
    expect(t.session.getGuide().captionsShown).toBe(false);
    const calls = t.captionCalls.length;
    t.session.update(16);
    expect(t.captionCalls.length).toBe(calls);
    expect(button(bar, 'Captions')!.getAttribute('aria-pressed')).toBe('false');
    button(bar, 'Captions')!.click();
    expect(t.captionCalls.slice(calls)).toEqual([
      ['setCues', { cues: parseVtt(VTT), lang: 'en' }],
      ['update', 0],
    ]);
    expect(t.storage.getItem(CAPTIONS_STORAGE_KEY)).toBe('on');
    t.session.update(16);
    expect(button(bar, 'Captions')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('starts with captions off on a later visit, once they were turned off', async () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    await startPlaying(first);
    button(bar, 'Captions')!.click();
    first.session.dispose();
    const later = setup({ storage });
    expect(later.session.getGuide().captionsShown).toBe(false);
    await startPlaying(later);
    expect(later.captionCalls).toEqual([]);
  });

  it('keeps captions on, and the switch working, where storage cannot be read or written', async () => {
    const denied = (): never => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const t = setup({ storage: { getItem: denied, setItem: denied } });
    await startPlaying(t);
    expect(t.session.getGuide().captionsShown).toBe(true);
    button(bar, 'Captions')!.click();
    expect(t.session.getGuide().captionsShown).toBe(false);
    expect(t.captionCalls.at(-1)).toEqual(['setCues', null]);
  });

  it('opens the step’s text at Text, a paragraph for each caption in the guide’s language, as text, and takes the focus there', async () => {
    const t = setup({ files: { [file('audio/01-look-down.vtt')]: () => new Response(LOOK_DOWN_VTT) } });
    await startPlaying(t);
    button(bar, 'Text')!.click();
    expect(visible(transcript())).toBe(true);
    expect(transcript().tagName).toBe('SECTION');
    expect(transcript().getAttribute('aria-label')).toBe('Transcript');
    // Read when the user goes there, never over the narration.
    expect(transcript().getAttribute('role')).toBeNull();
    expect(transcript().getAttribute('aria-live')).toBeNull();
    expect(transcriptText()).toEqual([
      ['en', 'Straight down, through the Earth.'],
      ['en', '<b>Not</b> markup.'],
    ]);
    expect(transcript().querySelector('b')).toBeNull();
    expect(document.activeElement).toBe(transcript());
    expect(t.session.getGuide().transcriptOpen).toBe(true);
    t.session.update(16);
    expect(button(bar, 'Text')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the transcript on the current step: still there while the guide waits, then loading, then the next step’s text', async () => {
    const t = setup({ guide: AT_CONTINUE, files: { [file('audio/02-shells.vtt')]: () => new Response(SHELLS_VTT) } });
    await startPlaying(t);
    button(bar, 'Text')!.click();
    expect(transcriptText()).toEqual([['en', 'Look down.']]);
    t.audio.ended = true;
    t.session.update(16);
    expect(t.session.getGuide().state).toBe('waiting');
    expect(transcriptText()).toEqual([['en', 'Look down.']]);
    t.audio.ended = false;
    button(bar, 'Next')!.click();
    t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ state: 'loading', stepIndex: 1 });
    expect(transcriptText()).toEqual([['', 'Loading…']]);
    await settle();
    t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ state: 'playing', stepIndex: 1 });
    expect(transcriptText()).toEqual([['en', 'The shells.']]);
  });

  it('says so in the transcript of a step with no narration', async () => {
    const t = setup({ guide: SILENT_SECOND });
    await startPlaying(t, { chapterIndex: 0, stepIndex: 1 });
    button(bar, 'Text')!.click();
    expect(transcriptText()).toEqual([['', 'This step has no narration.']]);
  });

  it('closes the transcript at Close, giving the focus back to Text', async () => {
    const t = setup();
    await startPlaying(t);
    button(bar, 'Text')!.click();
    button(transcript, 'Close')!.click();
    expect(visible(transcript())).toBe(false);
    expect(document.activeElement).toBe(button(bar, 'Text'));
    expect(t.session.getGuide()).toMatchObject({ state: 'playing', transcriptOpen: false });
  });

  it('takes the captions down while the transcript is open, and puts them back as it closes', async () => {
    const t = setup();
    await startPlaying(t);
    button(bar, 'Text')!.click();
    expect(t.captionCalls.at(-1)).toEqual(['setCues', null]);
    const calls = t.captionCalls.length;
    t.session.update(16);
    expect(t.captionCalls.length).toBe(calls);
    // The switch is still on: the transcript only covers for the plate.
    expect(t.session.getGuide().captionsShown).toBe(true);
    button(transcript, 'Close')!.click();
    expect(t.captionCalls.slice(calls)).toEqual([
      ['setCues', { cues: parseVtt(VTT), lang: 'en' }],
      ['update', 0],
    ]);
  });

  it('leaves the captions down as the transcript closes while they are off', async () => {
    const t = setup();
    await startPlaying(t);
    button(bar, 'Captions')!.click();
    button(bar, 'Text')!.click();
    const calls = t.captionCalls.length;
    button(transcript, 'Close')!.click();
    t.session.update(16);
    expect(t.captionCalls.length).toBe(calls);
  });

  it('closes only the transcript at the first Escape, and leaves at the second', async () => {
    const t = setup();
    await startPlaying(t);
    button(bar, 'Text')!.click();
    expect(t.session.onKey('Escape')).toBe(true);
    expect(visible(transcript())).toBe(false);
    expect(document.activeElement).toBe(button(bar, 'Text'));
    expect(t.session.getGuide().state).toBe('playing');
    expect(t.session.onKey('Escape')).toBe(true);
    expect(t.session.getGuide().state).toBe('idle');
  });

  it('closes the transcript at Leave', async () => {
    const t = setup();
    await startPlaying(t);
    button(bar, 'Text')!.click();
    button(bar, 'Leave')!.click();
    expect(visible(transcript())).toBe(false);
    expect(t.session.getGuide().transcriptOpen).toBe(false);
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
    expect(parent.querySelector('.play-bar, .guide-card, .transcript')).toBeNull();
  });

  describe('in Cardboard', () => {
    /** AT_CONTINUE played to its gate. */
    async function atContinue(): Promise<Setup> {
      const t = setup({ guide: AT_CONTINUE });
      await startPlaying(t);
      t.audio.ended = true;
      t.session.update(16);
      expect(t.session.getGuide().state).toBe('waiting');
      return t;
    }

    it('takes nothing with no guide playing', () => {
      const t = setup();
      expect(t.session.onViewerInput('tap')).toBe(false);
      expect(t.session.onViewerInput('nod')).toBe(false);
      expect(t.session.stereoNotice()).toBe('');
    });

    it('pauses and resumes at a tap, and says how to resume', async () => {
      const t = setup();
      await startPlaying(t);
      expect(t.session.stereoNotice()).toBe('');
      expect(t.session.onViewerInput('tap')).toBe(true);
      expect(t.session.getGuide().paused).toBe(true);
      expect(t.session.stereoNotice()).toBe('Paused · tap to resume');
      expect(t.session.onViewerInput('tap')).toBe(true);
      expect(t.session.getGuide().paused).toBe(false);
    });

    it('lets a nod pass while the narration plays: a head nods without meaning to', async () => {
      const t = setup();
      await startPlaying(t);
      expect(t.session.onViewerInput('nod')).toBe(false);
      expect(t.session.getGuide()).toMatchObject({ state: 'playing', paused: false });
    });

    it.each(['tap', 'nod'] as const)('goes on at a continue step at a %s', async (input) => {
      const t = await atContinue();
      expect(t.session.stereoNotice()).toBe('Tap or nod to go on');
      expect(t.session.onViewerInput(input)).toBe(true);
      expect(t.session.getGuide()).toMatchObject({ state: 'loading', stepIndex: 1 });
    });

    it('retries a step that failed at a tap', async () => {
      const t = setup();
      await halt(t);
      t.session.update(16);
      expect(t.session.stereoNotice()).toBe('This step could not be played · tap to try again');
      t.files[LOOK_DOWN_AUDIO] = filesOf(EXAMPLE_GUIDE)[LOOK_DOWN_AUDIO];
      expect(t.session.onViewerInput('tap')).toBe(true);
      expect(t.session.getGuide().state).toBe('loading');
    });

    it('says whether narration is heard: playing, not paused', async () => {
      const t = setup();
      expect(t.session.isNarrating()).toBe(false);
      await startPlaying(t);
      expect(t.session.isNarrating()).toBe(true);
      t.session.onViewerInput('tap');
      expect(t.session.isNarrating()).toBe(false);
    });

    it('says when it is paused, for the pause card', async () => {
      const t = setup();
      await startPlaying(t);
      expect(t.session.paused()).toBe(false);
      t.session.onViewerInput('tap');
      expect(t.session.paused()).toBe(true);
    });

    it.each([
      ['resume', 0],
      ['next', 1],
    ] as const)('on the pause card, %s plays on, not paused', async (choice, stepIndex) => {
      const t = setup();
      await startPlaying(t);
      t.session.onViewerInput('tap');
      t.session.choosePauseCard(choice);
      expect(t.session.getGuide()).toMatchObject({ paused: false, stepIndex });
    });

    it('on the pause card, Leave leaves the guide', async () => {
      const t = setup();
      await startPlaying(t);
      t.session.onViewerInput('tap');
      t.session.choosePauseCard('leave');
      expect(t.session.getGuide().state).toBe('idle');
    });

    it('takes no pause-card choice when not paused', async () => {
      const t = setup();
      await startPlaying(t);
      t.session.choosePauseCard('next');
      expect(t.session.getGuide()).toMatchObject({ state: 'playing', stepIndex: 0 });
    });

    it('plays again from the end at a tap', async () => {
      const t = setup();
      await end(t);
      t.session.update(16);
      expect(t.session.stereoNotice()).toBe('The end · tap to play again');
      expect(t.session.onViewerInput('tap')).toBe(true);
      expect(t.session.getGuide()).toMatchObject({ state: 'loading', chapterIndex: 0, stepIndex: 0 });
    });
  });
});

describe('spoken guide commands', () => {
  it('does nothing with no guide open', () => {
    expect(setup().session.onVoice('pause')).toBeNull();
  });

  it('pauses, and resumes from the pause', async () => {
    const t = setup();
    await startPlaying(t);
    expect(t.session.onVoice('resume')).toBe('Playing.');
    expect(t.session.onVoice('pause')).toBe('Paused.');
    expect(t.session.onVoice('pause')).toBe('Already paused.');
    expect(t.session.getGuide().paused).toBe(true);
    expect(t.session.onVoice('resume')).toBe('Going on.');
    expect(t.session.getGuide().paused).toBe(false);
  });

  it('steps on and back, and plays on from a pause', async () => {
    const t = setup();
    await startPlaying(t);
    t.session.onVoice('pause');
    expect(t.session.onVoice('next')).toBe('Next.');
    expect(t.session.getGuide()).toMatchObject({ stepIndex: 1, paused: false });
    expect(t.session.onVoice('back')).toBe('Back.');
    expect(t.session.getGuide()).toMatchObject({ stepIndex: 0, paused: false });
  });

  it('stops the guide', async () => {
    const t = setup();
    await startPlaying(t);
    expect(t.session.onVoice('stop')).toBe('Guide stopped.');
    expect(t.session.getGuide().state).toBe('idle');
  });

  it('plays a guide by id without the card’s Start, once it is fetched', async () => {
    const t = setup();
    t.session.play(ID);
    expect(t.session.getGuide().card).toBe('fetching');
    await settle();
    t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ card: 'closed', state: 'playing', stepIndex: 0 });
  });

  it('waits for the map’s names before it plays', async () => {
    const t = setup();
    t.world.labels = 'loading';
    t.session.play(ID);
    await settle();
    t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ card: 'ready', state: 'idle' });
    t.world.labels = 'ready';
    t.session.update(16);
    expect(t.session.getGuide().state).toBe('loading');
  });

  it('leaves the guide playing for the one asked for', async () => {
    const t = setup();
    await startPlaying(t, LAST_STEP);
    t.session.play(ID);
    await settle();
    t.session.update(16);
    expect(t.session.getGuide()).toMatchObject({ state: 'playing', stepIndex: 0 });
  });
});

describe('the guide and its clips', () => {
  const CREDIT = EXAMPLE_GUIDE.credits[0];
  const hotspot = (id: string) => ({ id, title: id, anchor: DOWN, clip: { kind: 'image', src: `images/${id}.webp`, alt: id, caption: id, credit: CREDIT } }) as const;
  /** EXAMPLE_GUIDE with a hotspot on its first step and one on its last. */
  const WITH_HOTSPOTS: Guide = {
    ...EXAMPLE_GUIDE,
    chapters: [
      {
        ...EXAMPLE_GUIDE.chapters[0],
        steps: EXAMPLE_GUIDE.chapters[0].steps.map((step, i) => (i === 0 ? { ...step, hotspots: [hotspot('a')] } : i === 2 ? { ...step, hotspots: [hotspot('c')] } : step)),
      },
    ],
  };
  /** Fake clips: `open` is what isOpen says; every source shown, as its ids and a file's URL. */
  function clips() {
    const fake = { open: false, unlocks: 0, shown: [] as ([string[], string] | null)[] };
    const deps: GuideClips = {
      unlock: () => void fake.unlocks++,
      isOpen: () => fake.open,
      showHotspots: (source: HotspotSource | null) => fake.shown.push(source && [source.hotspots.map((h) => h.id), source.fileUrl('images/a.webp')]),
    };
    return { fake, deps };
  }

  it('shows a step’s hotspots from that step to the end of its chapter, and takes them down on leaving', async () => {
    const c = clips();
    const t = setup({ guide: WITH_HOTSPOTS, clips: c.deps });
    await startPlaying(t);
    expect(c.fake.unlocks).toBe(1);
    expect(c.fake.shown).toEqual([[['a'], file('images/a.webp')]]);
    button(bar, 'Next')!.click();
    await settle();
    t.session.update(16);
    button(bar, 'Next')!.click();
    await settle();
    t.session.update(16);
    expect(t.session.getGuide().stepIndex).toBe(2);
    expect(c.fake.shown.at(-1)).toEqual([['a', 'c'], file('images/a.webp')]);
    t.session.onKey('Escape');
    expect(c.fake.shown.at(-1)).toBeNull();
  });

  it('waits while a clip is open, its captions down, and goes on when it closes', async () => {
    const c = clips();
    const t = setup({ guide: WITH_HOTSPOTS, clips: c.deps });
    await startPlaying(t);
    c.fake.open = true;
    t.session.update(16);
    expect(t.session.getGuide().paused).toBe(true);
    expect(t.captionCalls.at(-1)).toEqual(['setCues', null]);
    c.fake.open = false;
    t.session.update(16);
    expect(t.session.getGuide().paused).toBe(false);
  });

  it('stays paused after a clip when the user had paused it first', async () => {
    const c = clips();
    const t = setup({ guide: WITH_HOTSPOTS, clips: c.deps });
    await startPlaying(t);
    t.session.onKey(' ');
    c.fake.open = true;
    t.session.update(16);
    c.fake.open = false;
    t.session.update(16);
    expect(t.session.getGuide().paused).toBe(true);
  });
});
