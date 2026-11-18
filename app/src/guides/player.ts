/**
 * The guide player: a state machine that plays a guide's steps in order
 * (spec/guides.md §5). It fires each cue when the step's clock passes it,
 * and moves on when the narration is over and the step's gate is met.
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
}

/** What a narrated step plays: its clock and its captions. */
export interface StepMedia {
  readonly clock: StepClock;
  readonly captions: readonly CaptionCue[];
}

export type Narration = Extract<Step, { narration: unknown }>['narration'];

export interface PlayerDeps {
  readonly view: Pick<ViewControl, 'perform' | 'restore' | 'awaitedGaze' | 'stopAwaitingGaze' | 'borrow'>;
  /** A narrated step's audio and captions, ready to play from its start. Rejects with an Error that says why not. */
  loadNarration(guide: Guide, narration: Narration): Promise<StepMedia>;
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

export interface Player {
  /** Borrow the view and play `guide` from its first step. */
  start(guide: Guide): void;
  /** The user says go on: meets the gate the guide is waiting at. */
  goOn(): void;
  /** Stop the narration and the step's clock with it. An ease under way finishes; the view stays as it is. */
  pause(): void;
  /** Go on from where pause() stopped. */
  resume(): void;
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

/** The step under way, once its media is in. */
interface StepPlay {
  readonly clock: StepClock;
  readonly captions: readonly CaptionCue[];
  /** The same clock, for a silence: update moves it on. Null for a narration, which keeps its own time. */
  readonly silence: SilenceClock | null;
  /** The next cue to fire. */
  nextCue: number;
}

/** What the player is doing with the guide; null when it has none. */
type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'playing'; readonly step: StepPlay }
  | { readonly kind: 'waiting'; readonly gate: 'gaze' | 'continue'; waitedMs: number }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ended' };

/** The guide being played and the view it has borrowed. */
interface Session {
  readonly guide: Guide;
  readonly borrow: { end(): void };
  chapterIndex: number;
  stepIndex: number;
  phase: Phase;
  /** Looks performed whose promise has not settled: an ease under way. A gaze gate waits for them. */
  unsettledLooks: number;
  /** The clock last played, so exit, an error or the end can stop it. */
  clock: StepClock | null;
  /** pause() has stopped the guide: only while a step loads, plays or waits. */
  paused: boolean;
}

export function createPlayer(deps: PlayerDeps): Player {
  let session: Session | null = null;
  // Every start and exit begins a new run. A promise from an earlier run settles into nothing: its guide is gone.
  let run = 0;

  /** Load step `stepIndex` of chapter `chapterIndex`, then play it. */
  function enter(current: Session, chapterIndex: number, stepIndex: number): void {
    const { guide } = current;
    const thisRun = run;
    const step = guide.chapters[chapterIndex].steps[stepIndex];
    current.chapterIndex = chapterIndex;
    current.stepIndex = stepIndex;
    const loading: Phase = { kind: 'loading' };
    current.phase = loading;
    // Both may wait on the network, so both start now and are waited for together.
    let silenceClock: SilenceClock | null = null;
    let media: Promise<StepMedia>;
    if ('narration' in step) media = deps.loadNarration(guide, step.narration);
    else {
      silenceClock = silence(step.silenceS);
      media = Promise.resolve({ clock: silenceClock, captions: [] });
    }
    // A chapter starts from its whole scene. A later step goes on from the cues before it, which are in the view already.
    const restoring = stepIndex === 0;
    const scene: Promise<ActionOutcome> = restoring ? deps.view.restore(foldTo(guide, chapterIndex, 0, 0)) : Promise.resolve({ ok: true });
    // Only while this load is still what the player waits on: an exit, or a cue of the step before that has failed since, leaves it.
    const stillLoading = (): boolean => thisRun === run && current.phase === loading;
    Promise.all([media, scene]).then(
      ([loaded, outcome]) => {
        if (!stillLoading()) return;
        if (!outcome.ok) return fail(current, chapterIndex, stepIndex, outcome.message);
        // The scene was folded at the step's start, so its cues at 0 are in the view already.
        let nextCue = 0;
        if (restoring) while (nextCue < step.cues.length && step.cues[nextCue].at <= 0) nextCue++;
        current.clock = loaded.clock;
        // Paused while it loaded, as leaving the tab does: it waits at its start, silent, for resume.
        if (!current.paused) loaded.clock.play();
        current.phase = { kind: 'playing', step: { clock: loaded.clock, captions: loaded.captions, silence: silenceClock, nextCue } };
      },
      (error: unknown) => {
        if (stillLoading()) fail(current, chapterIndex, stepIndex, reason(error));
      }
    );
  }

  /** Fire the step's cues due by `tS`, in order, each once. */
  function fireDue(current: Session, step: StepPlay, cues: readonly Cue[], tS: number): void {
    while (step.nextCue < cues.length && cues[step.nextCue].at <= tS) fire(current, cues[step.nextCue++]);
  }

  /** Perform a cue and go on without waiting: an ease can outlast the time to the next cue. */
  function fire(current: Session, cue: Cue): void {
    const thisRun = run;
    // Named in an error as the step the cue is in, which the guide may have left by the time it fails.
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

  /** The step after the one `current` is at, or the end of the guide. */
  function next(current: Session): void {
    const { guide, chapterIndex, stepIndex } = current;
    if (stepIndex + 1 < guide.chapters[chapterIndex].steps.length) return enter(current, chapterIndex, stepIndex + 1);
    if (chapterIndex + 1 < guide.chapters.length) return enter(current, chapterIndex + 1, 0);
    current.clock?.pause();
    current.paused = false;
    current.phase = { kind: 'ended' };
  }

  /**
   * Halt the guide where it is, the borrow kept until exit. The first failure is the one reported: what fails after
   * it, such as a cue already sent, is most likely its consequence.
   */
  function fail(current: Session, chapterIndex: number, stepIndex: number, why: string): void {
    if (current.phase.kind === 'error') return;
    const chapter = current.guide.chapters[chapterIndex];
    current.clock?.pause();
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
      const { clock } = phase.step;
      phase.step.silence?.advance(deltaMs);
      const failure = clock.failure();
      if (failure !== null) return fail(current, current.chapterIndex, current.stepIndex, failure);
      fireDue(current, phase.step, step.cues, clock.timeS());
      if (!clock.isOver()) return;
      // Every cue left, since only the clock knows when the step ends (foldTo takes them all past the end too).
      fireDue(current, phase.step, step.cues, Infinity);
      if (step.advance === 'auto' || (step.advance === 'gaze' && looksDone(current))) return next(current);
      current.phase = { kind: 'waiting', gate: step.advance, waitedMs: 0 };
    } else if (phase.kind === 'waiting') {
      if (phase.gate === 'gaze' && looksDone(current)) return next(current);
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
        return { ...at, kind: 'playing', paused, tS: phase.step.clock.timeS(), captions: phase.step.captions };
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
      run++;
      const borrow = deps.view.borrow();
      session = { guide, borrow, chapterIndex: 0, stepIndex: 0, phase: { kind: 'loading' }, unsettledLooks: 0, clock: null, paused: false };
      enter(session, 0, 0);
    },
    goOn() {
      const current = session;
      if (current?.phase.kind !== 'waiting') throw new Error('the guide is not waiting to go on');
      // The user gave up looking: the look's field of view is not applied.
      if (current.phase.gate === 'gaze') deps.view.stopAwaitingGaze();
      next(current);
    },
    pause() {
      const current = session;
      const kind = current?.phase.kind;
      if (!current || current.paused || (kind !== 'loading' && kind !== 'playing' && kind !== 'waiting')) {
        throw new Error('the guide cannot be paused now');
      }
      current.paused = true;
      // Only a playing step's clock runs: a waiting one is over, and a loading one has not started.
      if (current.phase.kind === 'playing') current.phase.step.clock.pause();
    },
    resume() {
      const current = session;
      if (!current?.paused) throw new Error('the guide is not paused');
      current.paused = false;
      if (current.phase.kind === 'playing') current.phase.step.clock.play();
    },
    exit() {
      const current = session;
      if (!current) throw new Error('no guide is playing');
      run++;
      session = null;
      current.clock?.pause();
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
  let elapsedMs = 0;
  let playing = false;
  // Seconds from the summed milliseconds, not summed seconds, so a whole number of frames lands on the length exactly.
  return {
    timeS: () => Math.min(lengthS, elapsedMs / 1000),
    isOver: () => elapsedMs / 1000 >= lengthS,
    failure: () => null,
    play() {
      playing = true;
    },
    pause() {
      playing = false;
    },
    advance(deltaMs) {
      if (playing) elapsedMs += deltaMs;
    },
  };
}
