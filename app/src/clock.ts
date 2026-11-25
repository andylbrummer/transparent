/**
 * The app clock. Wall time, unless the page was opened with
 * ?time=<ISO 8601>: then that instant, running forward at the real rate -
 * so a screenshot or a check against an almanac can pin the sky.
 *
 * Underneath is the core package's playback clock, the one the seismic
 * timeline runs on, so the two map wall time to simulated time with the
 * same arithmetic. The timeline keeps a clock of its own all the same
 * (ui/timeline/index.ts says why).
 */

import { DEFAULT_CLOCK, simTimeAfter, type ClockState } from '@transparent-earth/core/seismic';

export interface AppClock {
  now(): Date;
  /** True when ?time= pinned the start. */
  readonly pinned: boolean;
}

export function createClock(search: string, wallNow: () => number = Date.now): AppClock {
  const requested = new URLSearchParams(search).get('time');
  const start = requested === null ? NaN : Date.parse(requested);
  if (Number.isNaN(start) && requested !== null) console.error(`ignoring unreadable ?time=${requested}`);
  const pinned = !Number.isNaN(start);
  const openedAt = wallNow();
  // Real time from the instant asked for, or from now: no events, so the state is all arithmetic.
  const state: ClockState = { ...DEFAULT_CLOCK, running: true, compression: 1, wallTimeMs: openedAt, simTimeMs: pinned ? start : openedAt };
  // Read, not ticked: a tick builds a state, and the clock is read several times a frame.
  return { now: () => new Date(simTimeAfter(state, wallNow() - state.wallTimeMs)), pinned };
}
