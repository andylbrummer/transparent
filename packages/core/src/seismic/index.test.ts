import { describe, it, expect } from 'vitest';
import {
  buildQueryUrl,
  normalizeEvent,
  DEFAULT_CLOCK,
  tickClock,
  seekClock,
  setCompression,
  togglePlay,
  loadEvents,
} from './index';

describe('buildQueryUrl', () => {
  it('builds basic query', () => {
    const url = buildQueryUrl('https://example.com', {
      startTime: '2024-01-01',
      endTime: '2024-01-02',
    });
    expect(url).toContain('format=geojson');
    expect(url).toContain('starttime=2024-01-01');
    expect(url).toContain('endtime=2024-01-02');
  });

  it('includes magnitude bounds', () => {
    const url = buildQueryUrl('https://example.com', {
      startTime: '2024-01-01',
      endTime: '2024-01-02',
      minMagnitude: 5,
      maxMagnitude: 7,
    });
    expect(url).toContain('minmagnitude=5');
    expect(url).toContain('maxmagnitude=7');
  });
});

describe('normalizeEvent', () => {
  it('normalizes a valid USGS feature', () => {
    const feature = {
      id: 'us7000abc',
      properties: {
        time: 1704067200000, // USGS: epoch ms
        mag: 6.5,
        place: 'Test Location',
      },
      geometry: {
        coordinates: [120.5, 35.2, 15], // USGS: depth in km
      },
    };
    const event = normalizeEvent(feature);
    expect(event).not.toBeNull();
    expect(event?.id).toBe('us7000abc');
    expect(event?.lat).toBe(35.2);
    expect(event?.lon).toBe(120.5);
    expect(event?.depthKm).toBe(15);
    expect(event?.time).toBe('2024-01-01T00:00:00.000Z');
    expect(event?.mag).toBe(6.5);
    expect(event?.name).toBe('Test Location');
  });

  it('handles missing place', () => {
    const feature = {
      id: 'test1',
      properties: { time: 1704067200000, mag: 5.0 },
      geometry: { coordinates: [0, 0, 0] },
    };
    const event = normalizeEvent(feature);
    expect(event?.name).toBe('Unknown location');
  });

  it('returns null for invalid data', () => {
    const event = normalizeEvent({});
    expect(event).toBeNull();
  });
});

describe('playback clock', () => {
  it('ticks forward when running', () => {
    const state = { ...DEFAULT_CLOCK, running: true, compression: 60 };
    const next = tickClock(state, 1000); // 1s wall
    expect(next.simTimeMs).toBe(60000); // 60s sim
  });

  it('does not tick when paused', () => {
    const state = { ...DEFAULT_CLOCK, running: false };
    const next = tickClock(state, 1000);
    expect(next.simTimeMs).toBe(0);
  });

  it('seek is idempotent', () => {
    const state = seekClock(DEFAULT_CLOCK, 3600000);
    const again = seekClock(state, 3600000);
    expect(again.simTimeMs).toBe(3600000);
  });

  it('compression change preserves sim-time', () => {
    const state = { ...DEFAULT_CLOCK, simTimeMs: 3600000 };
    const next = setCompression(state, 120);
    expect(next.simTimeMs).toBe(3600000);
    expect(next.compression).toBe(120);
  });

  it('toggles play/pause', () => {
    const state = togglePlay(DEFAULT_CLOCK);
    expect(state.running).toBe(true);
    const again = togglePlay(state);
    expect(again.running).toBe(false);
  });

  it('culls to max 8 active events', () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      time: `2024-01-0${(i % 9) + 1}T00:00:00Z`,
      lat: 0,
      lon: 0,
      depthKm: 10,
      mag: 5,
      name: `Event ${i}`,
    }));
    const state = loadEvents(DEFAULT_CLOCK, events);
    expect(state.activeEvents.length).toBeLessThanOrEqual(8);
  });
});
