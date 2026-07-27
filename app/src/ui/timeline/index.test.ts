import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIMELINE,
  selectPreset,
  togglePlayback,
  seek,
  setSpeed,
  filterByMagnitude,
  filterByDateRange,
} from './index';

describe('selectPreset', () => {
  it('selects Tōhoku 2011', () => {
    const state = selectPreset(DEFAULT_TIMELINE, 'toff2011');
    expect(state.selectedEvent?.id).toBe('toff2011');
    expect(state.selectedEvent?.mag).toBe(9.1);
  });

  it('returns unchanged for unknown preset', () => {
    const state = selectPreset(DEFAULT_TIMELINE, 'unknown');
    expect(state.selectedEvent).toBeNull();
  });
});

describe('togglePlayback', () => {
  it('toggles play state', () => {
    const state = togglePlayback(DEFAULT_TIMELINE);
    expect(state.playing).toBe(true);
    const again = togglePlayback(state);
    expect(again.playing).toBe(false);
  });
});

describe('seek', () => {
  it('clamps to bounds', () => {
    const state = seek(DEFAULT_TIMELINE, -1000);
    expect(state.currentTimeMs).toBe(DEFAULT_TIMELINE.startTimeMs);
  });
});

describe('setSpeed', () => {
  it('sets compression', () => {
    const state = setSpeed(DEFAULT_TIMELINE, 120);
    expect(state.compression).toBe(120);
  });

  it('clamps to minimum 1', () => {
    const state = setSpeed(DEFAULT_TIMELINE, 0);
    expect(state.compression).toBe(1);
  });
});

describe('filterByMagnitude', () => {
  it('filters events by magnitude', () => {
    const events = [
      { id: 'e1', mag: 5.0, time: '2024-01-01T00:00:00Z', lat: 0, lon: 0, depthKm: 10, name: 'E1' },
      { id: 'e2', mag: 7.0, time: '2024-01-01T00:00:00Z', lat: 0, lon: 0, depthKm: 10, name: 'E2' },
      { id: 'e3', mag: 4.0, time: '2024-01-01T00:00:00Z', lat: 0, lon: 0, depthKm: 10, name: 'E3' },
    ];
    const filtered = filterByMagnitude(events, 5);
    expect(filtered.length).toBe(2);
    expect(filtered[0].id).toBe('e1');
    expect(filtered[1].id).toBe('e2');
  });
});

describe('filterByDateRange', () => {
  it('filters events by date range', () => {
    const events = [
      { id: 'e1', mag: 5.0, time: '2024-01-01T00:00:00Z', lat: 0, lon: 0, depthKm: 10, name: 'E1' },
      { id: 'e2', mag: 5.0, time: '2024-06-01T00:00:00Z', lat: 0, lon: 0, depthKm: 10, name: 'E2' },
    ];
    const start = new Date('2024-01-01').getTime();
    const end = new Date('2024-03-01').getTime();
    const filtered = filterByDateRange(events, start, end);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('e1');
  });
});
