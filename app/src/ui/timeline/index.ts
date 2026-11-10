/**
 * Playback of one earthquake: the state behind the play button, the
 * scrubber and the speed choice of the seismic wave control.
 *
 * Time here is seconds since the earthquake's origin, on a clock of its
 * own: it has nothing to do with the app clock (which places the Sun and
 * the satellites), so playing the Tōhoku earthquake does not send the sky
 * back to 2011. Underneath is the core package's playback clock, which
 * maps wall time to simulation time at a compression ("60×": a minute of
 * wave travel per second watched).
 */

import {
  DEFAULT_CLOCK,
  loadEvents,
  seekClock,
  setCompression,
  tickClock,
  type ClockState,
  type EventRecord,
} from '@transparent-earth/core';

/** Compressions offered; the spec's default is 60×. */
export const PLAYBACK_SPEEDS = [30, 60, 120, 600] as const;
export const DEFAULT_PLAYBACK_SPEED = 60;

/**
 * How much time the scrubber covers, seconds. Body waves are done within
 * half an hour; an hour sees the surface waves two thirds of the way to
 * the antipode; three hours sees the Rayleigh wave all the way round.
 */
export const PLAYBACK_SPANS_S = [1800, 3600, 10800] as const;
export const DEFAULT_PLAYBACK_SPAN_S = 3600;

/** A frame longer than this (a hidden tab coming back) advances playback by no more. */
const MAX_TICK_MS = 250;

export interface PlaybackState {
  /** The core clock; its simulation time is the origin plus the elapsed time. */
  readonly clock: ClockState;
  readonly event: EventRecord | null;
  readonly spanS: number;
}

export const DEFAULT_PLAYBACK: PlaybackState = {
  clock: { ...DEFAULT_CLOCK, compression: DEFAULT_PLAYBACK_SPEED },
  event: null,
  spanS: DEFAULT_PLAYBACK_SPAN_S,
};

function originMs(state: PlaybackState): number {
  return state.event ? Date.parse(state.event.time) : 0;
}

/** Seconds since the earthquake. */
export function elapsedS(state: PlaybackState): number {
  return (state.clock.simTimeMs - originMs(state)) / 1000;
}

export function isPlaying(state: PlaybackState): boolean {
  return state.clock.running;
}

export function playbackSpeed(state: PlaybackState): number {
  return state.clock.compression;
}

/** Choose an earthquake: back to its origin, playing or paused as asked. */
export function selectEvent(state: PlaybackState, event: EventRecord, play: boolean): PlaybackState {
  const clock = seekClock(loadEvents({ ...state.clock, running: play }, [event]), Date.parse(event.time));
  return { ...state, event, clock };
}

/** Move to a time since the origin, held within the scrubber's span. */
export function seekElapsed(state: PlaybackState, seconds: number): PlaybackState {
  const clamped = Math.min(Math.max(seconds, 0), state.spanS);
  return { ...state, clock: seekClock(state.clock, originMs(state) + clamped * 1000) };
}

/** Advance by a frame of wall time. Playback stops at the end of the span. */
export function tickPlayback(state: PlaybackState, deltaWallMs: number): PlaybackState {
  if (!state.clock.running || !state.event) return state;
  const clock = tickClock(state.clock, Math.min(Math.max(deltaWallMs, 0), MAX_TICK_MS));
  const endMs = originMs(state) + state.spanS * 1000;
  if (clock.simTimeMs < endMs) return { ...state, clock };
  return { ...state, clock: { ...seekClock(clock, endMs), running: false } };
}

/** Play or pause; play from the end starts over. */
export function togglePlayback(state: PlaybackState): PlaybackState {
  if (!state.event) return state;
  if (state.clock.running) return { ...state, clock: { ...state.clock, running: false } };
  const restarted = elapsedS(state) >= state.spanS ? seekElapsed(state, 0) : state;
  return { ...restarted, clock: { ...restarted.clock, running: true } };
}

export function setSpeed(state: PlaybackState, compression: number): PlaybackState {
  return { ...state, clock: setCompression(state.clock, compression) };
}

/** Change what the scrubber covers; a time beyond the new span is pulled back to its end. */
export function setSpan(state: PlaybackState, spanS: number): PlaybackState {
  const next = { ...state, spanS };
  return elapsedS(next) > spanS ? seekElapsed(next, spanS) : next;
}

/** "42 s", "11 min 42 s", "2 h 05 min": a duration as a person says it. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
  const minutes = Math.round(total / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "11:42", "1:05:09": a time since the origin as a clock shows it. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
