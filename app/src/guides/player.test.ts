import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { ActionOutcome, AwaitedGaze, FoldedView, Target, ViewAction } from '../view/actions';
import { DOWN, EXAMPLE_GUIDE } from './example-guide.testdata';
import { deferred } from './fake-audio.testdata';
import { foldTo, type Guide } from './format';
import { CONTINUE_OFFER_MS, REPEAT_S, createPlayer, type Narration, type PlayerDeps, type StepClock, type StepMedia } from './player';
import type { CaptionCue } from './vtt';

const EAST: Target = { kind: 'horizon', azDeg: 90, altDeg: 0 };
const NORTH: Target = { kind: 'horizon', azDeg: 0, altDeg: 0 };
const narration = (name: string): Narration => ({ audio: `audio/${name}.m4a`, captions: `audio/${name}.vtt` });
const SPOKEN = narration('01-spoken');
const FIND = narration('03-find');
const ASK = narration('04-ask');

/** Two chapters. The first: a narration, then a silence, both auto. The second: a narration with a gaze gate, then one with a continue gate. */
const GUIDE: Guide = {
  ...EXAMPLE_GUIDE,
  id: 'two-chapters',
  chapters: [
    {
      id: 'first',
      title: 'First',
      scene: { preset: 'default', look: { target: DOWN, fovDeg: 60 } },
      steps: [
        {
          id: 'spoken',
          narration: SPOKEN,
          cues: [
            { at: 0, do: 'mark', target: EAST, text: 'East' },
            { at: 2, do: 'layers', on: ['aurora'] },
            { at: 4, do: 'mark', target: NORTH, text: 'North' },
            { at: 4, do: 'fov', fovDeg: 40 },
            { at: 9, do: 'mark', target: EAST, text: null },
          ],
          advance: 'auto',
        },
        {
          id: 'quiet',
          silenceS: 3,
          cues: [
            { at: 0, do: 'mark', target: NORTH, text: null },
            { at: 1.5, do: 'layers', off: ['aurora'] },
          ],
          advance: 'auto',
        },
      ],
    },
    {
      id: 'second',
      title: 'Second',
      scene: { layers: ['clouds'], look: { target: DOWN, fovDeg: 60 } },
      steps: [
        {
          id: 'find',
          narration: FIND,
          cues: [
            { at: 0, do: 'mark', target: NORTH, text: 'Here' },
            { at: 1, do: 'look', target: NORTH },
          ],
          advance: 'gaze',
        },
        { id: 'ask', narration: ASK, cues: [{ at: 0, do: 'mark', target: NORTH, text: null }], advance: 'continue' },
      ],
    },
  ],
};
const [FIRST, SECOND] = GUIDE.chapters;

/** One chapter of two steps that each wait for the user to find north. */
const TWO_GAZES: Guide = { ...GUIDE, chapters: [{ ...SECOND, steps: [SECOND.steps[0], { ...SECOND.steps[0], id: 'find-again' }] }] };

type Deferred<T> = ReturnType<typeof deferred<T>>;

/**
 * A narration clock the test sets: its time, whether it is over and why it failed. It counts its plays and pauses
 * and records each seek, which moves it there and makes it not over.
 */
function fakeClock() {
  const fake = { t: 0, over: false, failure: null as string | null, plays: 0, pauses: 0, seeks: [] as number[] };
  const clock: StepClock = {
    timeS: () => fake.t,
    isOver: () => fake.over,
    failure: () => fake.failure,
    play() {
      fake.plays++;
    },
    pause() {
      fake.pauses++;
    },
    seek(tS) {
      fake.seeks.push(tS);
      fake.t = tS;
      fake.over = false;
    },
  };
  return Object.assign(fake, { clock });
}
type FakeClock = ReturnType<typeof fakeClock>;

/**
 * A player over a view that records each perform, restore and preload and
 * hands back a promise the test settles, and a loadNarration that does the
 * same. Each narration fetched ahead is recorded. `view.awaited` is what
 * awaitedGaze answers.
 */
function setup() {
  const performed: { readonly action: ViewAction; readonly outcome: Deferred<ActionOutcome> }[] = [];
  const restored: { readonly view: FoldedView; readonly outcome: Deferred<ActionOutcome> }[] = [];
  const loads: { readonly guide: Guide; readonly narration: Narration; readonly media: Deferred<StepMedia> }[] = [];
  const preloaded: { readonly view: FoldedView; readonly outcome: Deferred<ActionOutcome> }[] = [];
  const preloadedNarrations: Narration[] = [];
  /** Each narration asked for, to load or to fetch ahead, in the order asked. */
  const asked: string[] = [];
  const counts = { borrows: 0, ends: 0, stops: 0, awaited: null as AwaitedGaze | null, holds: [] as boolean[] };
  const view: PlayerDeps['view'] = {
    perform(action) {
      const outcome = deferred<ActionOutcome>();
      performed.push({ action, outcome });
      return outcome.promise;
    },
    restore(folded) {
      const outcome = deferred<ActionOutcome>();
      restored.push({ view: folded, outcome });
      return outcome.promise;
    },
    preload(folded) {
      const outcome = deferred<ActionOutcome>();
      preloaded.push({ view: folded, outcome });
      return outcome.promise;
    },
    awaitedGaze: () => counts.awaited,
    stopAwaitingGaze() {
      counts.stops++;
    },
    borrow() {
      counts.borrows++;
      return {
        end() {
          counts.ends++;
        },
        hold(held: boolean) {
          counts.holds.push(held);
        },
      };
    },
  };
  const player = createPlayer({
    view,
    loadNarration(guide, narration) {
      const media = deferred<StepMedia>();
      asked.push(`load ${narration.audio}`);
      loads.push({ guide, narration, media });
      return media.promise;
    },
    preloadNarration(_, narration) {
      asked.push(`preload ${narration.audio}`);
      preloadedNarrations.push(narration);
    },
  });
  const actions = (): ViewAction[] => performed.map((p) => p.action);
  return { player, performed, restored, loads, preloaded, preloadedNarrations, asked, view: counts, actions };
}
type Setup = ReturnType<typeof setup>;

/** Lets every pending callback run, so a promise still pending after it is waiting on something. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const where = (guide: Guide, chapterIndex: number, stepIndex: number) => ({ guide, chapterIndex, stepIndex });

/** Start `guide` and play its first step on `clock`: its scene restored and its narration loaded. */
async function begin(t: Setup, guide: Guide = GUIDE, clock: FakeClock = fakeClock()): Promise<FakeClock> {
  t.player.start(guide);
  t.restored.at(-1)!.outcome.resolve({ ok: true });
  t.loads.at(-1)!.media.resolve({ clock: clock.clock, captions: [] });
  await settle();
  expect(t.player.state().kind).toBe('playing');
  return clock;
}

/** Play GUIDE through its first chapter into the second's first step, 'find', which plays on the clock returned. */
async function toFind(t: Setup): Promise<FakeClock> {
  const spoken = await begin(t);
  spoken.t = 10;
  spoken.over = true;
  t.player.update(16);
  await settle();
  t.player.update(3000);
  const find = fakeClock();
  t.restored.at(-1)!.outcome.resolve({ ok: true });
  t.loads.at(-1)!.media.resolve({ clock: find.clock, captions: [] });
  await settle();
  expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 0) });
  return find;
}

/** Play GUIDE on to 'ask', the last step, whose clock is returned. */
async function toAsk(t: Setup): Promise<FakeClock> {
  const find = await toFind(t);
  find.t = 5;
  find.over = true;
  t.player.update(16);
  t.performed.at(-1)!.outcome.resolve({ ok: true });
  await settle();
  t.player.update(16);
  const ask = fakeClock();
  t.loads.at(-1)!.media.resolve({ clock: ask.clock, captions: [] });
  await settle();
  expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 1) });
  return ask;
}

const aGaze: AwaitedGaze = { target: NORTH, name: null, direction: new THREE.Vector3(0, 1, 0), arriving: 0 };

describe('createPlayer', () => {
  it('borrows the view and loads the narration and the scene together, then plays', async () => {
    const t = setup();
    t.player.start(GUIDE);
    expect(t.view.borrows).toBe(1);
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 0, 0), paused: false });
    expect(t.restored.map((r) => r.view)).toEqual([foldTo(GUIDE, 0, 0, 0)]);
    // Asked for while the scene is still on its way, not after it.
    expect(t.loads.map((l) => [l.guide, l.narration])).toEqual([[GUIDE, SPOKEN]]);
    const clock = fakeClock();
    const captions: CaptionCue[] = [{ startS: 0, endS: 2, lines: ['Look down.'] }];
    t.loads[0].media.resolve({ clock: clock.clock, captions });
    await settle();
    expect(t.player.state().kind).toBe('loading');
    expect(clock.plays).toBe(0);
    t.restored[0].outcome.resolve({ ok: true });
    await settle();
    expect(clock.plays).toBe(1);
    expect(t.player.state()).toEqual({ kind: 'playing', ...where(GUIDE, 0, 0), paused: false, tS: 0, captions });
  });

  it('fires each cue once as the clock passes it, in order, without waiting for the one before to settle', async () => {
    const t = setup();
    const clock = await begin(t);
    const cues = FIRST.steps[0].cues;
    t.player.update(16);
    // The cue at 0 is in the scene restore has put in place already.
    expect(t.actions()).toEqual([]);
    clock.t = 1.99;
    t.player.update(16);
    expect(t.actions()).toEqual([]);
    clock.t = 2;
    t.player.update(16);
    expect(t.actions()).toEqual([cues[1]]);
    // That perform has not settled; a frame past two more cues fires both.
    clock.t = 5;
    t.player.update(16);
    expect(t.player.state()).toMatchObject({ kind: 'playing', tS: 5 });
    t.player.update(16);
    expect(t.actions()).toEqual([cues[1], cues[2], cues[3]]);
  });

  it('fires the cues at 0 of a later step in the chapter, and skips those of a chapter’s first step', async () => {
    const t = setup();
    const spoken = await begin(t);
    spoken.t = 10;
    spoken.over = true;
    t.player.update(16);
    await settle();
    t.player.update(0);
    expect(t.actions().at(-1)).toEqual(FIRST.steps[1].cues[0]);
    t.player.update(3000);
    const before = t.actions().length;
    t.restored.at(-1)!.outcome.resolve({ ok: true });
    t.loads.at(-1)!.media.resolve({ clock: fakeClock().clock, captions: [] });
    await settle();
    t.player.update(16);
    expect(t.actions().length).toBe(before);
  });

  it('moves on from an auto step as the narration ends: restoring only at a new chapter', async () => {
    const t = setup();
    const spoken = await begin(t);
    spoken.over = true;
    t.player.update(16);
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 0, 1), paused: false });
    await settle();
    expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 1) });
    expect(t.restored.length).toBe(1);
    t.player.update(3000);
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 0), paused: false });
    expect(t.restored.map((r) => r.view)).toEqual([foldTo(GUIDE, 0, 0, 0), foldTo(GUIDE, 1, 0, 0)]);
  });

  it('times a silence by the frames given to update, with no narration and no captions', async () => {
    const t = setup();
    const spoken = await begin(t);
    spoken.over = true;
    t.player.update(16);
    await settle();
    expect(t.loads.length).toBe(1);
    expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 1), tS: 0, captions: [] });
    const fired = t.actions().length;
    t.player.update(1000);
    expect(t.player.state()).toMatchObject({ tS: 1 });
    expect(t.actions().slice(fired)).toEqual([FIRST.steps[1].cues[0]]);
    t.player.update(500);
    expect(t.actions().slice(fired)).toEqual(FIRST.steps[1].cues);
    t.player.update(1499);
    expect(t.player.state()).toMatchObject({ kind: 'playing', tS: 2.999 });
    t.player.update(1);
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 0), paused: false });
  });

  it('fires every cue left when the narration ends before the clock reaches them, then moves on', async () => {
    const t = setup();
    const clock = await begin(t);
    clock.t = 8;
    clock.over = true;
    t.player.update(16);
    expect(t.actions()).toEqual(FIRST.steps[0].cues.slice(1));
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 0, 1), paused: false });
  });

  it('waits at a gaze gate for the look to settle and the user to turn to it, and not before the narration ends', async () => {
    const t = setup();
    const find = await toFind(t);
    // The gate is met, but the narration is not over.
    t.player.update(16);
    expect(t.player.state().kind).toBe('playing');
    find.t = 1;
    t.player.update(16);
    expect(t.actions().at(-1)).toEqual(SECOND.steps[0].cues[1]);
    find.over = true;
    t.player.update(16);
    expect(t.player.state()).toEqual({ kind: 'waiting', ...where(GUIDE, 1, 0), paused: false, gate: 'gaze', offerContinue: false });
    t.performed.at(-1)!.outcome.resolve({ ok: true });
    await settle();
    t.view.awaited = aGaze;
    t.player.update(16);
    expect(t.player.state().kind).toBe('waiting');
    t.view.awaited = null;
    t.player.update(16);
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: false });
  });

  it('waits at a gaze gate, in a pose, until the user has turned to the look', async () => {
    const t = setup();
    const find = await toFind(t);
    find.t = 5;
    find.over = true;
    t.view.awaited = aGaze;
    t.player.update(16);
    t.performed.at(-1)!.outcome.resolve({ ok: true, awaitingGaze: true });
    await settle();
    t.player.update(16);
    expect(t.player.state().kind).toBe('waiting');
    t.view.awaited = null;
    t.player.update(16);
    expect(t.player.state()).toMatchObject({ kind: 'loading', ...where(GUIDE, 1, 1) });
  });

  it('offers a way on after a gaze gate has waited 20 s, afresh at each gate', async () => {
    const t = setup();
    const find = await begin(t, TWO_GAZES);
    find.over = true;
    t.player.update(16);
    expect(t.player.state()).toMatchObject({ kind: 'waiting', gate: 'gaze', offerContinue: false });
    t.player.update(CONTINUE_OFFER_MS - 1);
    expect(t.player.state()).toMatchObject({ offerContinue: false });
    t.player.update(1);
    expect(t.player.state()).toMatchObject({ offerContinue: true });
    t.player.goOn();
    const again = fakeClock();
    t.loads.at(-1)!.media.resolve({ clock: again.clock, captions: [] });
    await settle();
    again.over = true;
    t.player.update(16);
    expect(t.player.state()).toEqual({ kind: 'waiting', ...where(TWO_GAZES, 0, 1), paused: false, gate: 'gaze', offerContinue: false });
    t.player.update(CONTINUE_OFFER_MS - 1);
    expect(t.player.state()).toMatchObject({ offerContinue: false });
    t.player.update(1);
    expect(t.player.state()).toMatchObject({ offerContinue: true });
  });

  it('goes on past a gaze gate when the user says so, giving up the look', async () => {
    const t = setup();
    const find = await toFind(t);
    find.t = 5;
    find.over = true;
    t.player.update(16);
    expect(t.player.state().kind).toBe('waiting');
    t.player.goOn();
    expect(t.view.stops).toBe(1);
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: false });
  });

  it('waits at a continue gate for the user alone, never offering a way on, and refuses go on unless waiting', async () => {
    const t = setup();
    const ask = await toAsk(t);
    expect(() => t.player.goOn()).toThrow(new Error('the guide is not waiting to go on'));
    ask.over = true;
    t.player.update(16);
    t.player.update(CONTINUE_OFFER_MS * 3);
    expect(t.player.state()).toEqual({ kind: 'waiting', ...where(GUIDE, 1, 1), paused: false, gate: 'continue', offerContinue: false });
    const stops = t.view.stops;
    t.player.goOn();
    expect(t.view.stops).toBe(stops);
    expect(t.player.state()).toEqual({ kind: 'ended', ...where(GUIDE, 1, 1) });
  });

  it('ends after the last step with its clock paused, keeping the view until exit', async () => {
    const t = setup();
    const ask = await toAsk(t);
    ask.over = true;
    t.player.update(16);
    t.player.goOn();
    expect(t.player.state()).toEqual({ kind: 'ended', ...where(GUIDE, 1, 1) });
    expect(ask.pauses).toBe(1);
    const fired = t.actions().length;
    t.player.update(1000);
    expect(t.player.state()).toEqual({ kind: 'ended', ...where(GUIDE, 1, 1) });
    expect(t.actions().length).toBe(fired);
    expect(t.view.ends).toBe(0);
    t.player.exit();
    expect(t.player.state()).toEqual({ kind: 'idle' });
    expect(t.view.ends).toBe(1);
  });

  it.each<[string, (t: Setup, clock: FakeClock) => Promise<void>, string]>([
    [
      'the narration fails to load',
      async (t) => {
        t.player.start(GUIDE);
        t.loads[0].media.reject(new Error('audio/01-spoken.m4a: 404'));
        await settle();
      },
      'first/spoken: audio/01-spoken.m4a: 404',
    ],
    [
      'the narration fails to load with no Error',
      async (t) => {
        t.player.start(GUIDE);
        t.loads[0].media.reject('gone');
        await settle();
      },
      'first/spoken: gone',
    ],
    [
      'the scene cannot be put in place',
      async (t, clock) => {
        t.player.start(GUIDE);
        t.loads[0].media.resolve({ clock: clock.clock, captions: [] });
        t.restored[0].outcome.resolve({ ok: false, code: 'unknown-layer', message: 'no layer switch shell-moho' });
        await settle();
      },
      'first/spoken: no layer switch shell-moho',
    ],
    [
      'a cue is refused',
      async (t, clock) => {
        await begin(t, GUIDE, clock);
        clock.t = 2;
        t.player.update(16);
        t.performed[0].outcome.resolve({ ok: false, code: 'layer-unavailable', message: 'layer failed to load: aurora' });
        await settle();
      },
      'first/spoken: layer failed to load: aurora',
    ],
    [
      'a cue throws',
      async (t, clock) => {
        await begin(t, GUIDE, clock);
        clock.t = 2;
        t.player.update(16);
        t.performed[0].outcome.reject(new Error('no lazy layer aurora'));
        await settle();
      },
      'first/spoken: no lazy layer aurora',
    ],
    [
      'the narration fails as it plays',
      async (t, clock) => {
        await begin(t, GUIDE, clock);
        clock.failure = 'the audio could not be decoded';
        t.player.update(16);
      },
      'first/spoken: the audio could not be decoded',
    ],
  ])('halts with the step named when %s', async (_, provoke, message) => {
    const t = setup();
    const clock = fakeClock();
    await provoke(t, clock);
    expect(t.player.state()).toEqual({ kind: 'error', ...where(GUIDE, 0, 0), message });
    // Paused if it was ever played.
    expect(clock.pauses).toBe(clock.plays);
    clock.t = 20;
    clock.over = true;
    const fired = t.actions().length;
    t.player.update(1000);
    expect(t.player.state()).toEqual({ kind: 'error', ...where(GUIDE, 0, 0), message });
    expect(t.actions().length).toBe(fired);
    expect(t.view.ends).toBe(0);
  });

  it('names the step a failed cue is in, though the guide has gone on, and keeps the first failure', async () => {
    const t = setup();
    const find = await toFind(t);
    find.t = 5;
    find.over = true;
    t.player.update(16);
    t.player.goOn();
    const look = t.performed.at(-1)!;
    expect(look.action).toEqual(SECOND.steps[0].cues[1]);
    look.outcome.resolve({ ok: false, code: 'target-unresolved', message: 'no position yet' });
    await settle();
    expect(t.player.state()).toEqual({ kind: 'error', ...where(GUIDE, 1, 1), message: 'second/find: no position yet' });
    // The step it went on to loads after all: it does not play over the error.
    const ask = fakeClock();
    t.loads.at(-1)!.media.resolve({ clock: ask.clock, captions: [] });
    t.performed[0].outcome.reject(new Error('later'));
    await settle();
    expect(ask.plays).toBe(0);
    expect(t.player.state()).toMatchObject({ kind: 'error', message: 'second/find: no position yet' });
  });

  it('leaves the guide from loading: what arrives after is dropped', async () => {
    const t = setup();
    t.player.start(GUIDE);
    t.player.exit();
    expect(t.player.state()).toEqual({ kind: 'idle' });
    expect(t.view.stops).toBe(1);
    expect(t.view.ends).toBe(1);
    const clock = fakeClock();
    t.loads[0].media.resolve({ clock: clock.clock, captions: [] });
    t.restored[0].outcome.resolve({ ok: true });
    await settle();
    expect(t.player.state()).toEqual({ kind: 'idle' });
    expect(clock.plays).toBe(0);
  });

  it('leaves the guide as it plays: its clock paused, and a cue that fails after changes nothing', async () => {
    const t = setup();
    const clock = await begin(t);
    clock.t = 2;
    t.player.update(16);
    t.player.exit();
    expect(clock.pauses).toBe(1);
    expect(t.view.ends).toBe(1);
    t.performed[0].outcome.resolve({ ok: false, code: 'layer-unavailable', message: 'layer failed to load: aurora' });
    await settle();
    expect(t.player.state()).toEqual({ kind: 'idle' });
  });

  it('plays one guide at a time, refuses exit when none plays, and plays again after exit', async () => {
    const t = setup();
    expect(() => t.player.exit()).toThrow(new Error('no guide is playing'));
    t.player.start(GUIDE);
    expect(() => t.player.start(GUIDE)).toThrow(new Error('a guide is already playing'));
    expect(t.view.borrows).toBe(1);
    t.player.exit();
    await begin(t, TWO_GAZES);
    expect(t.view.borrows).toBe(2);
    expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(TWO_GAZES, 0, 0) });
  });

  it('starts at the step it is given, the view folded to that step’s start', async () => {
    const t = setup();
    t.player.start(GUIDE, { chapterIndex: 1, stepIndex: 1 });
    expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: false });
    expect(t.restored.map((restore) => restore.view)).toEqual([foldTo(GUIDE, 1, 1, 0)]);
    expect(t.loads.map((load) => load.narration)).toEqual([ASK]);
    const ask = fakeClock();
    t.restored[0].outcome.resolve({ ok: true });
    t.loads[0].media.resolve({ clock: ask.clock, captions: [] });
    await settle();
    expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 1) });
    expect(ask.plays).toBe(1);
  });

  it.each([
    [2, 0],
    [1, 2],
    [-1, 0],
    [0, 0.5],
  ])('refuses to start at step %i/%s, which the guide does not have, before borrowing the view', (chapterIndex, stepIndex) => {
    const t = setup();
    expect(() => t.player.start(GUIDE, { chapterIndex, stepIndex })).toThrow(new Error(`the guide has no step ${chapterIndex}/${stepIndex}`));
    expect(t.view.borrows).toBe(0);
    expect(t.player.state()).toEqual({ kind: 'idle' });
  });

  it('counts only its own run’s looks at a gaze gate', async () => {
    const t = setup();
    const first = await begin(t, TWO_GAZES);
    first.t = 1;
    t.player.update(16);
    const oldLook = t.performed.at(-1)!;
    t.player.exit();

    const clock = await begin(t, TWO_GAZES);
    clock.t = 1;
    t.player.update(16);
    const look = t.performed.at(-1)!;
    expect(look).not.toBe(oldLook);
    // The old look settling takes nothing off the new run's count.
    oldLook.outcome.resolve({ ok: true });
    await settle();
    clock.over = true;
    t.player.update(16);
    expect(t.player.state().kind).toBe('waiting');
    look.outcome.resolve({ ok: true });
    await settle();
    t.player.update(16);
    expect(t.player.state()).toMatchObject({ kind: 'loading', ...where(TWO_GAZES, 0, 1) });
  });

  it('never counts a look still pending from a run that was left', async () => {
    const t = setup();
    const first = await begin(t, TWO_GAZES);
    first.t = 1;
    t.player.update(16);
    t.player.exit();
    const clock = await begin(t, TWO_GAZES);
    clock.over = true;
    t.player.update(16);
    t.performed.at(-1)!.outcome.resolve({ ok: true });
    await settle();
    t.player.update(16);
    expect(t.player.state()).toMatchObject({ kind: 'loading', ...where(TWO_GAZES, 0, 1) });
  });

  describe('pause', () => {
    it('stops the clock and the cues with it, and goes on from there on resume', async () => {
      const t = setup();
      const clock = await begin(t);
      t.player.pause();
      expect(clock.pauses).toBe(1);
      expect(t.player.state()).toMatchObject({ kind: 'playing', paused: true });
      // A clock that has run on regardless fires nothing while paused.
      clock.t = 5;
      t.player.update(16);
      expect(t.actions()).toEqual([]);
      t.player.resume();
      expect(clock.plays).toBe(2);
      expect(t.player.state()).toMatchObject({ kind: 'playing', paused: false });
      t.player.update(16);
      expect(t.actions()).toEqual(FIRST.steps[0].cues.slice(1, 4));
    });

    it('stops a silence: frames while paused do not count', async () => {
      const t = setup();
      const spoken = await begin(t);
      spoken.over = true;
      t.player.update(16);
      await settle();
      t.player.pause();
      t.player.update(5000);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 1), paused: true, tS: 0 });
      t.player.resume();
      t.player.update(1000);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 1), paused: false, tS: 1 });
    });

    it('holds a gate while paused: no going on and no count toward the offer, until resume', async () => {
      const t = setup();
      const find = await toFind(t);
      find.t = 5;
      find.over = true;
      t.player.update(16);
      t.player.pause();
      t.performed.at(-1)!.outcome.resolve({ ok: true });
      await settle();
      t.player.update(CONTINUE_OFFER_MS);
      expect(t.player.state()).toEqual({ kind: 'waiting', ...where(GUIDE, 1, 0), paused: true, gate: 'gaze', offerContinue: false });
      t.player.resume();
      t.player.update(16);
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: false });
    });

    it('lets a step paused as it loads arrive silent, and play on resume', async () => {
      const t = setup();
      t.player.start(GUIDE);
      t.player.pause();
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 0, 0), paused: true });
      const clock = fakeClock();
      t.restored[0].outcome.resolve({ ok: true });
      t.loads[0].media.resolve({ clock: clock.clock, captions: [] });
      await settle();
      expect(t.player.state()).toEqual({ kind: 'playing', ...where(GUIDE, 0, 0), paused: true, tS: 0, captions: [] });
      expect(clock.plays).toBe(0);
      t.player.resume();
      expect(clock.plays).toBe(1);
    });

    it('goes on from a paused gate when the user says so, the next step arriving paused', async () => {
      const t = setup();
      const find = await toFind(t);
      find.t = 5;
      find.over = true;
      t.player.update(16);
      t.player.pause();
      t.player.goOn();
      expect(t.view.stops).toBe(1);
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: true });
      const ask = fakeClock();
      t.loads.at(-1)!.media.resolve({ clock: ask.clock, captions: [] });
      await settle();
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 1), paused: true });
      expect(ask.plays).toBe(0);
    });

    it('refuses pause unless a step loads, plays or waits unpaused, and resume unless paused', async () => {
      const t = setup();
      expect(() => t.player.pause()).toThrow(new Error('the guide cannot be paused now'));
      expect(() => t.player.resume()).toThrow(new Error('the guide is not paused'));
      const clock = await begin(t);
      expect(() => t.player.resume()).toThrow(new Error('the guide is not paused'));
      t.player.pause();
      expect(() => t.player.pause()).toThrow(new Error('the guide cannot be paused now'));
      // A cue that fails while paused halts the guide, and the halt is not paused.
      clock.t = 2;
      t.player.resume();
      t.player.update(16);
      t.player.pause();
      t.performed[0].outcome.resolve({ ok: false, code: 'layer-unavailable', message: 'layer failed to load: aurora' });
      await settle();
      expect(t.player.state()).toEqual({ kind: 'error', ...where(GUIDE, 0, 0), message: 'first/spoken: layer failed to load: aurora' });
      expect(() => t.player.pause()).toThrow(new Error('the guide cannot be paused now'));
      expect(() => t.player.resume()).toThrow(new Error('the guide is not paused'));
      t.player.exit();

      const ask = await toAsk(t);
      ask.over = true;
      t.player.update(16);
      t.player.goOn();
      expect(t.player.state().kind).toBe('ended');
      expect(() => t.player.pause()).toThrow(new Error('the guide cannot be paused now'));
      expect(() => t.player.resume()).toThrow(new Error('the guide is not paused'));
    });

    it("holds the app clock while paused, and lets it go on resume or when the guide ends", async () => {
      const t = setup();
      await begin(t);
      t.player.pause();
      expect(t.view.holds).toEqual([true]);
      t.player.resume();
      expect(t.view.holds).toEqual([true, false]);
      t.player.pause();
      t.player.next();
      // Still paused after a jump, so still held.
      expect(t.view.holds).toEqual([true, false, true]);
      t.player.exit();
      // Ending the borrow lets go of the hold itself.
      expect(t.view.holds).toEqual([true, false, true]);
    });

    it('leaves a paused guide, and the next one starts unpaused', async () => {
      const t = setup();
      await begin(t);
      t.player.pause();
      t.player.exit();
      expect(t.player.state()).toEqual({ kind: 'idle' });
      t.player.start(GUIDE);
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 0, 0), paused: false });
    });
  });

  describe('jump', () => {
    /** Finish the jump just made: its restore, and its narration on `clock` when it loads one. */
    async function land(t: Setup, clock?: FakeClock): Promise<void> {
      t.restored.at(-1)!.outcome.resolve({ ok: true });
      if (clock) t.loads.at(-1)!.media.resolve({ clock: clock.clock, captions: [] });
      await settle();
    }

    it('goes to the next step’s start: the view folded there, its narration loaded and played from 0', async () => {
      const t = setup();
      const find = await toFind(t);
      find.t = 0.5;
      t.player.next();
      expect(find.pauses).toBe(1);
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: false });
      expect(t.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 1, 1, 0));
      expect(t.loads.at(-1)!.narration).toEqual(ASK);
      const ask = fakeClock();
      await land(t, ask);
      expect(ask.seeks).toEqual([0]);
      expect(ask.plays).toBe(1);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 1) });
      // Its cue at 0 is in the view restore put in place.
      const fired = t.actions().length;
      t.player.update(16);
      expect(t.actions().length).toBe(fired);
    });

    it('goes on to the next chapter, from the last step to the end, and no further', async () => {
      const t = setup();
      await begin(t);
      t.player.next();
      await land(t);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 1) });
      t.player.next();
      expect(t.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 1, 0, 0));
      await land(t, fakeClock());
      t.player.next();
      const ask = fakeClock();
      await land(t, ask);
      const restores = t.restored.length;
      t.player.next();
      expect(t.player.state()).toEqual({ kind: 'ended', ...where(GUIDE, 1, 1) });
      expect(ask.pauses).toBe(1);
      expect(t.restored.length).toBe(restores);
      expect(() => t.player.next()).toThrow(new Error('the guide cannot go to the next step now'));
    });

    it('goes back to the step before, across a chapter, to the first step’s own start, and from the end to the last step', async () => {
      const t = setup();
      const spoken = await begin(t);
      spoken.t = 3;
      t.player.back();
      expect(t.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 0, 0, 0));
      // The step's narration is in hand: no second load.
      expect(t.loads.length).toBe(1);
      await land(t);
      expect(spoken.seeks).toEqual([0, 0]);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 0) });

      const u = setup();
      await toFind(u);
      u.player.back();
      expect(u.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 0, 1), paused: false });
      expect(u.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 0, 1, 0));

      const v = setup();
      const ask = await toAsk(v);
      ask.over = true;
      v.player.update(16);
      v.player.goOn();
      const loads = v.loads.length;
      v.player.back();
      expect(v.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: false });
      expect(v.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 1, 1, 0));
      expect(v.loads.length).toBe(loads);
    });

    it('repeats the last 10 s, no further back than the start: cues before stay done and those after fire again', async () => {
      const t = setup();
      const clock = await begin(t);
      const cues = FIRST.steps[0].cues;
      clock.t = 12;
      t.player.update(16);
      expect(t.actions()).toEqual(cues.slice(1));
      t.player.repeat();
      expect(t.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 0, 0, 12 - REPEAT_S));
      expect(t.loads.length).toBe(1);
      await land(t);
      expect(clock.seeks.at(-1)).toBe(2);
      expect(t.player.state()).toMatchObject({ kind: 'playing', tS: 2 });
      t.player.update(16);
      expect(t.actions()).toEqual(cues.slice(1));
      clock.t = 12;
      t.player.update(16);
      expect(t.actions()).toEqual([...cues.slice(1), ...cues.slice(2)]);
      clock.t = 4;
      t.player.repeat();
      expect(t.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 0, 0, 0));
      await land(t);
      expect(clock.seeks.at(-1)).toBe(0);
    });

    it('repeats from a gate, playing again', async () => {
      const t = setup();
      const find = await toFind(t);
      find.t = 5;
      find.over = true;
      t.player.update(16);
      expect(t.player.state().kind).toBe('waiting');
      t.player.repeat();
      await land(t);
      expect(find.seeks.at(-1)).toBe(0);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 0), tS: 0 });
      expect(() => setup().player.repeat()).toThrow(new Error('the guide cannot repeat now'));
    });

    it('goes to a chapter’s first step, and refuses a chapter the guide does not have', async () => {
      const t = setup();
      expect(() => t.player.toChapter(1)).toThrow(new Error('the guide cannot change chapter now'));
      await begin(t);
      t.player.toChapter(1);
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 0), paused: false });
      expect(t.restored.at(-1)!.view).toEqual(foldTo(GUIDE, 1, 0, 0));
      for (const bad of [2, -1, 0.5, NaN]) {
        expect(() => t.player.toChapter(bad)).toThrow(new RangeError(`guide two-chapters has no chapter ${bad}`));
      }
    });

    it('retries the step an error halted in, loading its narration again', async () => {
      const t = setup();
      const clock = await begin(t);
      expect(() => t.player.retry()).toThrow(new Error('the guide cannot retry now'));
      clock.failure = 'the audio could not be decoded';
      t.player.update(16);
      expect(t.player.state().kind).toBe('error');
      t.player.retry();
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 0, 0), paused: false });
      expect(t.restored.map((r) => r.view)).toEqual([foldTo(GUIDE, 0, 0, 0), foldTo(GUIDE, 0, 0, 0)]);
      expect(t.loads.length).toBe(2);
      const again = fakeClock();
      await land(t, again);
      expect(again.plays).toBe(1);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 0) });
    });

    it('drops what the step it left was waiting for: a late refusal changes nothing, and an old look holds no gate', async () => {
      const t = setup();
      const find = await toFind(t);
      find.t = 1;
      t.player.update(16);
      const oldLook = t.performed.at(-1)!;
      t.player.repeat();
      await land(t);
      find.t = 5;
      t.player.update(16);
      const look = t.performed.at(-1)!;
      expect(look).not.toBe(oldLook);
      look.outcome.resolve({ ok: true });
      oldLook.outcome.resolve({ ok: false, code: 'target-unresolved', message: 'no position yet' });
      await settle();
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 0) });
      find.over = true;
      t.player.update(16);
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 1), paused: false });
    });

    it('keeps a paused guide paused through a jump: the step lands silent, its clock moved to the place', async () => {
      const t = setup();
      await begin(t);
      t.player.pause();
      t.player.toChapter(1);
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 0), paused: true });
      const find = fakeClock();
      await land(t, find);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 0), paused: true });
      expect(find.seeks).toEqual([0]);
      expect(find.plays).toBe(0);
    });

    it('lets the last of two jumps win: the first one’s load lands into nothing', async () => {
      const t = setup();
      t.player.start(GUIDE);
      t.player.toChapter(1);
      const first = fakeClock();
      t.restored[0].outcome.resolve({ ok: true });
      t.loads[0].media.resolve({ clock: first.clock, captions: [] });
      await settle();
      expect(t.player.state()).toEqual({ kind: 'loading', ...where(GUIDE, 1, 0), paused: false });
      expect(first.plays).toBe(0);
      const find = fakeClock();
      await land(t, find);
      expect(find.plays).toBe(1);
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 1, 0) });
    });

    it('halts naming the step it was going to when its view cannot be put in place', async () => {
      const t = setup();
      await begin(t);
      t.player.toChapter(1);
      t.loads.at(-1)!.media.resolve({ clock: fakeClock().clock, captions: [] });
      t.restored.at(-1)!.outcome.resolve({ ok: false, code: 'unknown-layer', message: 'no layer switch clouds' });
      await settle();
      expect(t.player.state()).toEqual({ kind: 'error', ...where(GUIDE, 1, 0), message: 'second/find: no layer switch clouds' });
    });
  });

  describe('preload', () => {
    /** Play GUIDE's first step through to its second, 'quiet', the first chapter's last. */
    async function toQuiet(t: Setup): Promise<void> {
      const spoken = await begin(t);
      spoken.t = 10;
      spoken.over = true;
      t.player.update(16);
      await settle();
      expect(t.player.state()).toMatchObject({ kind: 'playing', ...where(GUIDE, 0, 1) });
    }

    it('fetches the next step’s narration as a step starts, alongside its own, and nothing for a silence', () => {
      const t = setup();
      t.player.start({ ...GUIDE, chapters: [SECOND] });
      expect(t.loads.map((load) => load.narration)).toEqual([FIND]);
      expect(t.preloadedNarrations).toEqual([ASK]);
      const quietNext = setup();
      quietNext.player.start(GUIDE);
      expect(quietNext.loads.map((load) => load.narration)).toEqual([SPOKEN]);
      expect(quietNext.preloadedNarrations).toEqual([]);
    });

    it('loads the next chapter’s scene at a chapter’s last step, and not before', async () => {
      const t = setup();
      const spoken = await begin(t);
      expect(t.preloaded).toEqual([]);
      spoken.t = 10;
      spoken.over = true;
      t.player.update(16);
      expect(t.player.state()).toMatchObject({ kind: 'loading', ...where(GUIDE, 0, 1) });
      expect(t.preloaded.map((preload) => preload.view)).toEqual([foldTo(GUIDE, 1, 0, 0)]);
      expect(t.preloadedNarrations).toEqual([FIND]);
    });

    it('asks for a step’s own narration before the next step’s', () => {
      const t = setup();
      t.player.start({ ...GUIDE, chapters: [SECOND] });
      expect(t.asked).toEqual([`load ${FIND.audio}`, `preload ${ASK.audio}`]);
    });

    it('loads nothing ahead from the guide’s last step', async () => {
      const t = setup();
      await toAsk(t);
      // All from the steps before: 'find' asked for 'ask', and 'quiet' for the second chapter.
      expect(t.preloadedNarrations).toEqual([FIND, ASK]);
      expect(t.preloaded.length).toBe(1);
    });

    // An unhandled rejection would fail the run.
    it.each<[string, (outcome: Deferred<ActionOutcome>) => void]>([
      ['refused', (outcome) => outcome.resolve({ ok: false, code: 'layer-unavailable', message: 'layer failed to load: clouds' })],
      ['rejected', (outcome) => outcome.reject(new Error('no lazy layer clouds'))],
    ])('changes nothing when the scene loaded ahead is %s', async (_, settleWith) => {
      const t = setup();
      await toQuiet(t);
      const before = t.player.state();
      settleWith(t.preloaded[0].outcome);
      await settle();
      expect(t.player.state()).toEqual(before);
    });
  });
});
