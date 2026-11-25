/**
 * The app clock. Wall time, unless the page was opened with
 * ?time=<ISO 8601>: then that instant, running forward at the real rate -
 * so a screenshot or a check against an almanac can pin the sky. A guide
 * can then set it, run it fast or stop it, and put it back live.
 *
 * Underneath is the core package's playback clock, the one the seismic
 * timeline runs on, so the two map wall time to simulated time with the
 * same arithmetic. The timeline keeps a clock of its own all the same
 * (ui/timeline/index.ts says why).
 */

import { DEFAULT_CLOCK, simTimeAfter, type ClockState } from '@transparent-earth/core/seismic';

/** How the clock stood when saved: enough to go on as though nothing had changed it since. */
export interface ClockSave {
  readonly state: ClockState;
  readonly rate: number;
  readonly untilMs: number | null;
  readonly live: boolean;
}

export interface AppClock {
  now(): Date;
  /** True when ?time= pinned the start. */
  readonly pinned: boolean;
  /** Following the wall clock: real time from now. Not after ?time=, nor once set, until goLive. */
  isLive(): boolean;
  /** Simulated seconds per real second, as last set: 1 is real time, 0 stands still, below 0 runs back. */
  rate(): number;
  /** Jump to `atMs`, running on at the rate it had. Any stop set with setRate is dropped. */
  set(atMs: number): void;
  /** Run at `rate` from where it is now; with `untilMs`, stop there, for good. */
  setRate(rate: number, untilMs?: number): void;
  /** Back to wall time at the real rate. */
  goLive(): void;
  /** What the clock would read live, now: wall time. To check a setting against before making it. */
  liveMs(): number;
  /**
   * Stand still while held, and on release run on from where it stood, at the rate and toward the stop it had: a
   * paused guide's time-lapse waits for it. Set and setRate still take effect while held.
   */
  hold(held: boolean): void;
  save(): ClockSave;
  /** Go on from a save as though nothing had changed the clock since: a run carries on, the wall time between included. */
  restore(saved: ClockSave): void;
}

export function createClock(search: string, wallNow: () => number = Date.now): AppClock {
  const requested = new URLSearchParams(search).get('time');
  const start = requested === null ? NaN : Date.parse(requested);
  if (Number.isNaN(start) && requested !== null) console.error(`ignoring unreadable ?time=${requested}`);
  const pinned = !Number.isNaN(start);
  const openedAt = wallNow();
  // Real time from the instant asked for, or from now: no events, so the state is all arithmetic.
  let state: ClockState = { ...DEFAULT_CLOCK, running: true, compression: 1, wallTimeMs: openedAt, simTimeMs: pinned ? start : openedAt };
  let rate = 1;
  let untilMs: number | null = null;
  let live = !pinned;
  let held = false;

  /** Where the simulation stands at wall time `wall`: read, not ticked, since a tick builds a state and the clock is read several times a frame. */
  function simAt(wall: number): number {
    const sim = simTimeAfter(state, wall - state.wallTimeMs);
    if (untilMs === null || (rate > 0 ? sim < untilMs : sim > untilMs)) return sim;
    return untilMs;
  }

  /** Start the run afresh at `simMs`, now, from the rate, stop and hold as they are. */
  function anchor(simMs: number): void {
    const wall = wallNow();
    // Past the stop is the stop, for good: the run is over, and what is left is a clock standing still there.
    if (untilMs !== null && simMs === untilMs) {
      rate = 0;
      untilMs = null;
    }
    state = { ...state, simTimeMs: simMs, wallTimeMs: wall, compression: rate, running: rate !== 0 && !held };
  }

  function finite(name: string, value: number): void {
    if (!Number.isFinite(value)) throw new RangeError(`clock ${name} ${value} is not a finite number`);
  }

  return {
    now() {
      const wall = wallNow();
      const sim = simAt(wall);
      // Reaching the stop stops the clock there once; every read until then is arithmetic only.
      if (untilMs !== null && sim === untilMs) anchor(sim);
      return new Date(sim);
    },
    pinned,
    isLive: () => live,
    rate: () => rate,
    set(atMs) {
      finite('instant', atMs);
      untilMs = null;
      live = false;
      anchor(atMs);
    },
    setRate(next, until) {
      finite('rate', next);
      if (until !== undefined) finite('stop', until);
      const sim = simAt(wallNow());
      if (until !== undefined && (next > 0 ? until <= sim : next < 0 ? until >= sim : true)) {
        throw new RangeError(`clock stop ${new Date(until).toISOString()} is not ahead at rate ${next}`);
      }
      // Clear the old stop first, so reaching it now does not count as reaching the new one.
      untilMs = null;
      rate = next;
      live = live && next === 1;
      anchor(sim);
      untilMs = until ?? null;
    },
    goLive() {
      rate = 1;
      untilMs = null;
      live = true;
      anchor(wallNow());
    },
    liveMs: () => wallNow(),
    hold(next) {
      const sim = simAt(wallNow());
      held = next;
      anchor(sim);
    },
    save: () => ({ state, rate, untilMs, live }),
    restore(saved) {
      ({ state, rate, untilMs, live } = saved);
      // Read through the saved run, then start afresh from there, so a hold now still holds.
      anchor(simAt(wallNow()));
    },
  };
}
