/**
 * The guide player: a state machine that plays a guide's steps in order
 * (spec/guides.md §5). It fires each cue when the step's clock passes it,
 * and moves on when the narration is over and the step's gate is met.
 * Every move elsewhere in the guide is a jump: the view there is a fold of
 * the cues up to it (foldTo), put in place in one go, with no undo.
 *
 * Pure: no DOM, no audio, no fetch and no timers. The narration comes in
 * through loadNarration and the view goes out through ViewControl, so the
 * whole machine runs in tests against a fake clock. The only time it knows
 * is the step's clock and the frame time given to update.
 *
 * It never turns the view for someone holding the phone and never moves on
 * by itself past a gate: a look in a pose waits on the user, as
 * ViewControl does it.
 */

import type { ActionOutcome, ViewControl } from '../view/actions';
import { foldTo, type Cue, type Guide, type Step } from './format';
import type { CaptionCue } from './vtt';

/** A step's narration as a clock: the only time a step has (spec/guides.md §5.1). */
export interface StepClock {
  /** Seconds into the step. It stands still while paused and while the audio stalls. */
  timeS(): number;
  /** The narration has run to its end. */
  isOver(): boolean;
  /** Why it can no longer play, when the download or the decoder has failed; null while it can. */
  failure(): string | null;
  /** Run on from where it stands. Nothing once it is over: it does not start again. */
  play(): void;
  pause(): void;
  /** Jump to `tS`, clamped to the narration's length. isOver() is false again unless that is its end. */
  seek(tS: number): void;
}

/** What a narrated step plays: its clock and its captions. */
export interface StepMedia {
  readonly clock: StepClock;
  readonly captions: readonly CaptionCue[];
}

export type Narration = Extract<Step, { narration: unknown }>['narration'];

export interface PlayerDeps {
  readonly view: Pick<ViewControl, 'perform' | 'restore' | 'preload' | 'awaitedGaze' | 'stopAwaitingGaze' | 'borrow'>;
  /** A narrated step's audio and captions, ready to play from its start. Rejects with an Error that says why not. */
  loadNarration(guide: Guide, narration: Narration): Promise<StepMedia>;
  /** Fetch a narrated step's audio and captions ahead of need. It reports nothing: loadNarration will. */
  preloadNarration(guide: Guide, narration: Narration): void;
}

/** Where a guide is. */
export interface PlayerAt {
  readonly guide: Guide;
  readonly chapterIndex: number;
  readonly stepIndex: number;
}

/**
 * `paused`: pause() has stopped the guide. A flag rather than a state, since a guide can be paused while a step loads,
 * plays or waits, and goes on from there.
 */
export type PlayerState =
  | { readonly kind: 'idle' }
  /** The step's narration, or the layers of a chapter's scene, are on their way. */
  | (PlayerAt & { readonly kind: 'loading'; readonly paused: boolean })
  | (PlayerAt & { readonly kind: 'playing'; readonly paused: boolean; readonly tS: number; readonly captions: readonly CaptionCue[] })
  /** The narration is over and the step's gate is not yet met. `offerContinue`: the user has looked for 20 s; offer a way on. */
  | (PlayerAt & { readonly kind: 'waiting'; readonly paused: boolean; readonly gate: 'gaze' | 'continue'; readonly offerContinue: boolean })
  /** Halted. `message` names the step. */
  | (PlayerAt & { readonly kind: 'error'; readonly message: string })
  /** The last step is done; the guide's view stays until exit(). */
  | (PlayerAt & { readonly kind: 'ended' });

/** How long a gaze gate waits before the player offers a way on. */
export const CONTINUE_OFFER_MS = 20_000;
/** How far repeat() goes back. */
export const REPEAT_S = 10;

export interface Player {
  /** Borrow the view and play `guide` from its first step. */
  start(guide: Guide): void;
  /** The user says go on: meets the gate the guide is waiting at. */
  goOn(): void;
  /** Stop the narration and the step's clock with it. An ease under way finishes; the view stays as it is. */
  pause(): void;
  /** Go on from where pause() stopped. */
  resume(): void;
  /**
   * To the start of the next step; from the last step, to the guide's end. At a gate too it jumps, folding the view
   * afresh: goOn() is what meets the gate, so a Next button calls goOn() while the guide waits and next() otherwise.
   */
  next(): void;
  /** To the start of the step before; from the first step, to its own start. */
  back(): void;
  /** Back REPEAT_S within the step, no further than its start. */
  repeat(): void;
  /** To a chapter's first step. */
  toChapter(chapterIndex: number): void;
  /** From an error: the step it halted in, again from its start. */
  retry(): void;
  /** Leave the guide from any state: the view goes back as it was. */
  exit(): void;
  /** Once a frame, before ViewControl.update: fires the cues that are due and moves on when a step is done. */
  update(deltaMs: number): void;
  state(): PlayerState;
}

/** A silence's clock, moved on by the frame time while it plays, so it stops with the player. */
interface SilenceClock extends StepClock {
  advance(deltaMs: number): void;
}

/** A step's media once in. Kept while the guide stays in the step, so a jump within it does not load it again. */
interface LoadedStep extends StepMedia {
  /** The same clock, for a silence: update moves it on. Null for a narration, which keeps its own time. */
  readonly silence: SilenceClock | null;
}

/** What the player is doing with the guide; null when it has none. */
type Phase =
  | { readonly kind: 'loading' }
  /** `nextCue`: the next of the step's cues to fire. */
  | { readonly kind: 'playing'; readonly loaded: LoadedStep; nextCue: number }
  | { readonly kind: 'waiting'; readonly loaded: LoadedStep; readonly gate: 'gaze' | 'continue'; waitedMs: number }
  | { readonly kind: 'error'; readonly message: string }
  /** The last step's media, if it got as far as playing, for a jump back into it. */
  | { readonly kind: 'ended'; readonly loaded: LoadedStep | null };

type PhaseKind = Phase['kind'];

/** Where next(), back() and toChapter() may be called; next() not from the end, which it would go past. */
const MOVING: readonly PhaseKind[] = ['loading', 'playing', 'waiting', 'ended'];
const PLAYING_ON: readonly PhaseKind[] = ['loading', 'playing', 'waiting'];

/** The guide being played and the view it has borrowed. */
interface Session {
  readonly guide: Guide;
  readonly borrow: { end(): void };
  chapterIndex: number;
  stepIndex: number;
  phase: Phase;
  /** Looks performed whose promise has not settled: an ease under way. A gaze gate waits for them. */
  unsettledLooks: number;
  /** pause() has stopped the guide: only while a step loads, plays or waits. */
  paused: boolean;
}

/** The step's clock, where the phase has one: the clock to stop when the guide leaves it. */
const clockOf = (phase: Phase): StepClock | null => ('loaded' in phase ? (phase.loaded?.clock ?? null) : null);

export function createPlayer(deps: PlayerDeps): Player {
  let session: Session | null = null;
  // Every start, exit and jump begins a new run. A promise from an earlier run settles into nothing: what it was for is gone.
  let run = 0;

  /** The session, if the guide is in one of `kinds`; else `verb` cannot be done now. */
  function sessionIn(kinds: readonly PhaseKind[], verb: string): Session {
    if (!session || !kinds.includes(session.phase.kind)) throw new Error(`the guide cannot ${verb} now`);
    return session;
  }

  /** Drop whatever the step being left was still waiting for, so a late answer cannot halt or hold up what comes next. */
  function dropPending(current: Session): void {
    run++;
    current.unsettledLooks = 0;
  }

  /**
   * Put the view as the guide has it `tS` into step `stepIndex` of chapter `chapterIndex`, then play the step from
   * there. `playedOn`: the step before is done and this one follows it, as playing through does. Then what the step
   * before is still waiting for stays, and the view is not put in place but at a chapter's start: within a chapter
   * the step goes on from the cues before it.
   */
  function jump(current: Session, chapterIndex: number, stepIndex: number, tS: number, playedOn = false): void {
    const { guide, phase } = current;
    clockOf(phase)?.pause();
    if (!playedOn) dropPending(current);
    const thisRun = run;
    // The same step's media, if it is in hand: a jump within a step does not load it again.
    const inHand = 'loaded' in phase && chapterIndex === current.chapterIndex && stepIndex === current.stepIndex ? phase.loaded : null;
    const step = guide.chapters[chapterIndex].steps[stepIndex];
    current.chapterIndex = chapterIndex;
    current.stepIndex = stepIndex;
    const loading: Phase = { kind: 'loading' };
    current.phase = loading;
    // Both may wait on the network, so both start now and are waited for together.
    const media = inHand ? Promise.resolve(inHand) : load(guide, step);
    const restoring = !playedOn || stepIndex === 0;
    const scene: Promise<ActionOutcome> = restoring
      ? deps.view.restore(foldTo(guide, chapterIndex, stepIndex, tS))
      : Promise.resolve({ ok: true });
    // After the step's own load, never before. The narration keeps its latest load and its latest preload: asked
    // ahead first, the next step's files would push out this step's, fetched ahead a step ago, just as they are wanted.
    preloadAfter(current);
    // Only while this load is still what the player waits on: an exit, a jump, or a cue of the step before that has
    // failed since, leaves it.
    const stillLoading = (): boolean => thisRun === run && current.phase === loading;
    Promise.all([media, scene]).then(
      ([loaded, outcome]) => {
        if (!stillLoading()) return;
        if (!outcome.ok) return fail(current, chapterIndex, stepIndex, outcome.message);
        // The view put in place holds the cues up to tS already. Played on within a chapter, it holds none of this step's.
        let nextCue = 0;
        if (restoring) while (nextCue < step.cues.length && step.cues[nextCue].at <= tS) nextCue++;
        loaded.clock.seek(tS);
        // Paused while it loaded, as leaving the tab does: it waits where it is, silent, for resume.
        if (!current.paused) loaded.clock.play();
        current.phase = { kind: 'playing', loaded, nextCue };
      },
      (error: unknown) => {
        if (stillLoading()) fail(current, chapterIndex, stepIndex, reason(error));
      }
    );
  }

  /**
   * Start loading the step after the one `current` has just gone to, while this one plays: its narration, and the
   * layers of its chapter's scene when it opens a new chapter. Before the chapter is half done, as spec/guides.md
   * §8.6 has it, would take a count of the chapter's time; its last step is near enough.
   */
  function preloadAfter(current: Session): void {
    const after = stepAfter(current);
    if (!after) return;
    const { guide } = current;
    const step = guide.chapters[after.chapterIndex].steps[after.stepIndex];
    if ('narration' in step) deps.preloadNarration(guide, step.narration);
    // A head start only, so its outcome is not read: the chapter's own restore reports when the guide gets there.
    if (after.chapterIndex !== current.chapterIndex) deps.view.preload(foldTo(guide, after.chapterIndex, 0, 0)).catch(() => {});
  }

  /** A step's narration, or a silence the player times itself. */
  function load(guide: Guide, step: Step): Promise<LoadedStep> {
    if ('narration' in step) return deps.loadNarration(guide, step.narration).then((media) => ({ ...media, silence: null }));
    const clock = silence(step.silenceS);
    return Promise.resolve({ clock, captions: [], silence: clock });
  }

  /** Fire the playing step's cues due by `tS`, in order, each once. */
  function fireDue(current: Session, playing: { nextCue: number }, cues: readonly Cue[], tS: number): void {
    while (playing.nextCue < cues.length && cues[playing.nextCue].at <= tS) fire(current, cues[playing.nextCue++]);
  }

  /** Perform a cue and go on without waiting: an ease can outlast the time to the next cue. */
  function fire(current: Session, cue: Cue): void {
    const thisRun = run;
    // Named in an error as the step the cue is in, which the guide may have played on from by the time it fails.
    const { chapterIndex, stepIndex } = current;
    const look = cue.do === 'look';
    if (look) current.unsettledLooks++;
    const settled = (failure: string | null): void => {
      if (thisRun !== run) return;
      if (look) current.unsettledLooks--;
      if (failure !== null) fail(current, chapterIndex, stepIndex, failure);
    };
    deps.view.perform(cue).then(
      (outcome) => settled(outcome.ok ? null : outcome.message),
      (error: unknown) => settled(reason(error))
    );
  }

  /** A gaze gate: every look is done, its ease finished and, in a pose, the user turned to its target. */
  function looksDone(current: Session): boolean {
    return current.unsettledLooks === 0 && deps.view.awaitedGaze() === null;
  }

  /** The step after the one `current` is at; null from the last. */
  function stepAfter({ guide, chapterIndex, stepIndex }: Session): { chapterIndex: number; stepIndex: number } | null {
    if (stepIndex + 1 < guide.chapters[chapterIndex].steps.length) return { chapterIndex, stepIndex: stepIndex + 1 };
    if (chapterIndex + 1 < guide.chapters.length) return { chapterIndex: chapterIndex + 1, stepIndex: 0 };
    return null;
  }

  /** The step is over and its gate met: play on into the next, or end the guide. */
  function stepDone(current: Session): void {
    const after = stepAfter(current);
    if (after) jump(current, after.chapterIndex, after.stepIndex, 0, true);
    else end(current);
  }

  function end(current: Session): void {
    const { phase } = current;
    clockOf(phase)?.pause();
    current.paused = false;
    current.phase = { kind: 'ended', loaded: 'loaded' in phase ? phase.loaded : null };
  }

  /**
   * Halt the guide where it is, the borrow kept until exit. The first failure is the one reported: what fails after
   * it, such as a cue already sent, is most likely its consequence.
   */
  function fail(current: Session, chapterIndex: number, stepIndex: number, why: string): void {
    if (current.phase.kind === 'error') return;
    const chapter = current.guide.chapters[chapterIndex];
    clockOf(current.phase)?.pause();
    current.paused = false;
    current.phase = { kind: 'error', message: `${chapter.id}/${chapter.steps[stepIndex].id}: ${why}` };
  }

  function update(deltaMs: number): void {
    const current = session;
    // Paused, nothing moves: no cue, no silence, no count toward the offer, and no gate, so the guide cannot go on.
    if (!current || current.paused) return;
    const { phase } = current;
    if (phase.kind === 'playing') {
      const step = current.guide.chapters[current.chapterIndex].steps[current.stepIndex];
      const { clock, silence } = phase.loaded;
      silence?.advance(deltaMs);
      const failure = clock.failure();
      if (failure !== null) return fail(current, current.chapterIndex, current.stepIndex, failure);
      fireDue(current, phase, step.cues, clock.timeS());
      if (!clock.isOver()) return;
      // Every cue left, since only the clock knows when the step ends (foldTo takes them all past the end too).
      fireDue(current, phase, step.cues, Infinity);
      if (step.advance === 'auto' || (step.advance === 'gaze' && looksDone(current))) return stepDone(current);
      current.phase = { kind: 'waiting', loaded: phase.loaded, gate: step.advance, waitedMs: 0 };
    } else if (phase.kind === 'waiting') {
      if (phase.gate === 'gaze' && looksDone(current)) return stepDone(current);
      phase.waitedMs += deltaMs;
    }
  }

  function state(): PlayerState {
    if (!session) return { kind: 'idle' };
    const { guide, chapterIndex, stepIndex, phase, paused } = session;
    const at: PlayerAt = { guide, chapterIndex, stepIndex };
    switch (phase.kind) {
      case 'loading':
        return { ...at, kind: 'loading', paused };
      case 'playing':
        return { ...at, kind: 'playing', paused, tS: phase.loaded.clock.timeS(), captions: phase.loaded.captions };
      case 'waiting': {
        const offerContinue = phase.gate === 'gaze' && phase.waitedMs >= CONTINUE_OFFER_MS;
        return { ...at, kind: 'waiting', paused, gate: phase.gate, offerContinue };
      }
      case 'ended':
        return { ...at, kind: 'ended' };
      case 'error':
        return { ...at, kind: 'error', message: phase.message };
    }
  }

  return {
    start(guide) {
      if (session) throw new Error('a guide is already playing');
      const borrow = deps.view.borrow();
      session = { guide, borrow, chapterIndex: 0, stepIndex: 0, phase: { kind: 'loading' }, unsettledLooks: 0, paused: false };
      jump(session, 0, 0, 0);
    },
    goOn() {
      const current = session;
      if (current?.phase.kind !== 'waiting') throw new Error('the guide is not waiting to go on');
      // The user gave up looking: the look's field of view is not applied.
      if (current.phase.gate === 'gaze') deps.view.stopAwaitingGaze();
      stepDone(current);
    },
    pause() {
      const current = session;
      const kind = current?.phase.kind;
      if (!current || current.paused || (kind !== 'loading' && kind !== 'playing' && kind !== 'waiting')) {
        throw new Error('the guide cannot be paused now');
      }
      current.paused = true;
      // Only a playing step's clock runs: a waiting one is over, and a loading one has not started.
      if (current.phase.kind === 'playing') current.phase.loaded.clock.pause();
    },
    resume() {
      const current = session;
      if (!current?.paused) throw new Error('the guide is not paused');
      current.paused = false;
      if (current.phase.kind === 'playing') current.phase.loaded.clock.play();
    },
    next() {
      const current = sessionIn(PLAYING_ON, 'go to the next step');
      const after = stepAfter(current);
      if (after) return jump(current, after.chapterIndex, after.stepIndex, 0);
      dropPending(current);
      end(current);
    },
    back() {
      const current = sessionIn(MOVING, 'go back');
      const { guide, chapterIndex, stepIndex, phase } = current;
      // The end is the last step finished, so back from it is that step again.
      if (phase.kind === 'ended' || (chapterIndex === 0 && stepIndex === 0)) return jump(current, chapterIndex, stepIndex, 0);
      if (stepIndex > 0) return jump(current, chapterIndex, stepIndex - 1, 0);
      jump(current, chapterIndex - 1, guide.chapters[chapterIndex - 1].steps.length - 1, 0);
    },
    repeat() {
      const current = sessionIn(['playing', 'waiting'], 'repeat');
      // Both phases let through have the step's clock.
      const clock = clockOf(current.phase)!;
      jump(current, current.chapterIndex, current.stepIndex, Math.max(0, clock.timeS() - REPEAT_S));
    },
    toChapter(chapterIndex) {
      const current = sessionIn(MOVING, 'change chapter');
      const { guide } = current;
      if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= guide.chapters.length) {
        throw new RangeError(`guide ${guide.id} has no chapter ${chapterIndex}`);
      }
      jump(current, chapterIndex, 0, 0);
    },
    retry() {
      const current = sessionIn(['error'], 'retry');
      // The error phase holds no media, so the step loads again: what failed may well have been its narration.
      jump(current, current.chapterIndex, current.stepIndex, 0);
    },
    exit() {
      const current = session;
      if (!current) throw new Error('no guide is playing');
      run++;
      session = null;
      clockOf(current.phase)?.pause();
      deps.view.stopAwaitingGaze();
      current.borrow.end();
    },
    update,
    state,
  };
}

/** A failure's reason as the error shows it. */
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The clock of a silence `lengthS` seconds long. */
function silence(lengthS: number): SilenceClock {
  // Where the last seek put it, and the frame time summed since: seconds from summed milliseconds, not summed
  // seconds, so a whole number of frames lands on the length exactly.
  let fromS = 0;
  let elapsedMs = 0;
  let playing = false;
  const atS = (): number => fromS + elapsedMs / 1000;
  return {
    timeS: () => Math.min(lengthS, atS()),
    isOver: () => atS() >= lengthS,
    failure: () => null,
    play() {
      playing = true;
    },
    pause() {
      playing = false;
    },
    seek(tS) {
      fromS = Math.min(lengthS, Math.max(0, tS));
      elapsedMs = 0;
    },
    advance(deltaMs) {
      if (playing) elapsedMs += deltaMs;
    },
  };
}
