/**
 * Timeline UI component logic.
 * Scrubber, play/pause, speed controls, event presets.
 */

import { type EventRecord } from '@transparent-earth/core/seismic';
import { NOTABLE_EVENTS } from '../../render/seismic/wavefronts';

export interface TimelineState {
  readonly playing: boolean;
  readonly currentTimeMs: number;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly compression: number;
  readonly selectedEvent: EventRecord | null;
}

export const DEFAULT_TIMELINE: TimelineState = {
  playing: false,
  currentTimeMs: 0,
  startTimeMs: 0,
  endTimeMs: 86400000, // 24 hours
  compression: 60, // 1s wall = 1min sim
  selectedEvent: null,
};

/**
 * Select a notable event preset.
 */
export function selectPreset(state: TimelineState, eventId: string): TimelineState {
  const event = NOTABLE_EVENTS.find((e) => e.id === eventId);
  if (!event) return state;

  const eventTime = new Date(event.time).getTime();
  return {
    ...state,
    selectedEvent: event,
    currentTimeMs: eventTime,
    startTimeMs: eventTime - 3600000, // 1 hour before
    endTimeMs: eventTime + 86400000, // 24 hours after
  };
}

/**
 * Toggle play/pause.
 */
export function togglePlayback(state: TimelineState): TimelineState {
  return { ...state, playing: !state.playing };
}

/**
 * Seek to a specific time.
 */
export function seek(state: TimelineState, timeMs: number): TimelineState {
  const clamped = Math.max(state.startTimeMs, Math.min(state.endTimeMs, timeMs));
  return { ...state, currentTimeMs: clamped };
}

/**
 * Set playback speed (compression).
 */
export function setSpeed(state: TimelineState, compression: number): TimelineState {
  return { ...state, compression: Math.max(1, compression) };
}

/**
 * Filter events by magnitude.
 */
export function filterByMagnitude(events: readonly EventRecord[], minMag: number): readonly EventRecord[] {
  return events.filter((e) => e.mag >= minMag);
}

/**
 * Filter events by date range.
 */
export function filterByDateRange(
  events: readonly EventRecord[],
  startMs: number,
  endMs: number
): readonly EventRecord[] {
  return events.filter((e) => {
    const t = new Date(e.time).getTime();
    return t >= startMs && t <= endMs;
  });
}
