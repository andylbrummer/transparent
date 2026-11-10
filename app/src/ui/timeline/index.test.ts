import { describe, it, expect } from 'vitest';
import type { EventRecord } from '@transparent-earth/core';
import {
  DEFAULT_PLAYBACK,
  DEFAULT_PLAYBACK_SPEED,
  elapsedS,
  formatClock,
  formatDuration,
  isPlaying,
  playbackSpeed,
  seekElapsed,
  selectEvent,
  setSpan,
  setSpeed,
  tickPlayback,
  togglePlayback,
} from './index';

const TOHOKU: EventRecord = {
  id: 'official20110311054624120_30',
  time: '2011-03-11T05:46:24.120Z',
  lat: 38.297,
  lon: 142.373,
  depthKm: 29,
  mag: 9.1,
  name: 'Great Tohoku, Japan 2011',
};

describe('selectEvent', () => {
  it('starts at the origin, at the spec default of 60×', () => {
    const state = selectEvent(DEFAULT_PLAYBACK, TOHOKU, true);
    expect(elapsedS(state)).toBe(0);
    expect(isPlaying(state)).toBe(true);
    expect(playbackSpeed(state)).toBe(DEFAULT_PLAYBACK_SPEED);
    expect(state.clock.simTimeMs).toBe(Date.parse(TOHOKU.time));
    expect(state.clock.activeEvents).toEqual([TOHOKU]);
  });

  it('can start paused, and keeps the chosen speed across events', () => {
    const fast = setSpeed(DEFAULT_PLAYBACK, 600);
    const state = selectEvent(fast, TOHOKU, false);
    expect(isPlaying(state)).toBe(false);
    expect(playbackSpeed(state)).toBe(600);
  });
});

describe('tickPlayback', () => {
  it('turns a second watched into a minute of wave travel at 60×', () => {
    let state = selectEvent(DEFAULT_PLAYBACK, TOHOKU, true);
    for (let i = 0; i < 10; i++) state = tickPlayback(state, 100);
    expect(elapsedS(state)).toBeCloseTo(60, 9);
  });

  it('does nothing while paused or with no earthquake chosen', () => {
    const paused = selectEvent(DEFAULT_PLAYBACK, TOHOKU, false);
    expect(tickPlayback(paused, 100)).toBe(paused);
    expect(tickPlayback(DEFAULT_PLAYBACK, 100)).toBe(DEFAULT_PLAYBACK);
  });

  it('does not leap when a hidden tab comes back with one long frame', () => {
    const state = tickPlayback(selectEvent(DEFAULT_PLAYBACK, TOHOKU, true), 60000);
    expect(elapsedS(state)).toBeCloseTo(15, 9);
  });

  it('stops at the end of the span', () => {
    let state = seekElapsed(selectEvent(DEFAULT_PLAYBACK, TOHOKU, true), 3595);
    state = tickPlayback(state, 200);
    expect(elapsedS(state)).toBe(3600);
    expect(isPlaying(state)).toBe(false);
  });
});

describe('seekElapsed', () => {
  it('holds the time within the span', () => {
    const state = selectEvent(DEFAULT_PLAYBACK, TOHOKU, false);
    expect(elapsedS(seekElapsed(state, 1212))).toBe(1212);
    expect(elapsedS(seekElapsed(state, -5))).toBe(0);
    expect(elapsedS(seekElapsed(state, 99999))).toBe(3600);
  });
});

describe('togglePlayback', () => {
  it('pauses and resumes where it was', () => {
    const playing = seekElapsed(selectEvent(DEFAULT_PLAYBACK, TOHOKU, true), 600);
    const paused = togglePlayback(playing);
    expect(isPlaying(paused)).toBe(false);
    const resumed = togglePlayback(paused);
    expect(isPlaying(resumed)).toBe(true);
    expect(elapsedS(resumed)).toBe(600);
  });

  it('starts over when played from the end', () => {
    const ended = seekElapsed(selectEvent(DEFAULT_PLAYBACK, TOHOKU, false), 3600);
    const again = togglePlayback(ended);
    expect(isPlaying(again)).toBe(true);
    expect(elapsedS(again)).toBe(0);
  });

  it('has nothing to play without an earthquake', () => {
    expect(togglePlayback(DEFAULT_PLAYBACK)).toBe(DEFAULT_PLAYBACK);
  });
});

describe('setSpeed and setSpan', () => {
  it('changes speed without moving the time', () => {
    const state = setSpeed(seekElapsed(selectEvent(DEFAULT_PLAYBACK, TOHOKU, true), 300), 120);
    expect(playbackSpeed(state)).toBe(120);
    expect(elapsedS(state)).toBe(300);
    expect(elapsedS(tickPlayback(state, 100))).toBeCloseTo(312, 9);
  });

  it('pulls the time back inside a shorter span', () => {
    const long = seekElapsed(setSpan(selectEvent(DEFAULT_PLAYBACK, TOHOKU, false), 10800), 9000);
    expect(elapsedS(long)).toBe(9000);
    expect(elapsedS(setSpan(long, 1800))).toBe(1800);
  });
});

describe('formatting', () => {
  it('says a duration as a person would', () => {
    expect(formatDuration(42.4)).toBe('42 s');
    expect(formatDuration(702)).toBe('11 min 42 s');
    expect(formatDuration(60)).toBe('1 min 00 s');
    expect(formatDuration(7500)).toBe('2 h 05 min');
    expect(formatDuration(-3)).toBe('0 s');
  });

  it('shows a time since the origin as a clock', () => {
    expect(formatClock(702.9)).toBe('11:42');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(3909)).toBe('1:05:09');
  });
});
