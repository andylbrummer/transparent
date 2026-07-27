import { describe, it, expect } from 'vitest';
import {
  computePIsochronDistance,
  computeSIsochronDistance,
  computeSurfaceWaveRadius,
  isInPShadowZone,
  NOTABLE_EVENTS,
} from './wavefronts';

describe('computePIsochronDistance', () => {
  it('returns null before event time', () => {
    const result = computePIsochronDistance({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 0,
      eventTimeMs: 1000,
    });
    expect(result).toBeNull();
  });

  it('returns increasing distance over time', () => {
    const result1 = computePIsochronDistance({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 60_000, // 1 min sim
      eventTimeMs: 0,
    });
    const result2 = computePIsochronDistance({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 120_000, // 2 min sim
      eventTimeMs: 0,
    });
    expect(result1).toBeGreaterThan(0);
    expect(result2).toBeGreaterThan(result1!);
  });

  it('caps at 180 degrees', () => {
    const result = computePIsochronDistance({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 10_000_000, // very long time
      eventTimeMs: 0,
    });
    expect(result).toBe(180);
  });
});

describe('computeSIsochronDistance', () => {
  it('returns null in core shadow zone (>104°)', () => {
    const result = computeSIsochronDistance({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 3_000_000, // long enough to reach shadow (>~200s at 4.5km/s)
      eventTimeMs: 0,
    });
    expect(result).toBeNull();
  });

  it('returns distance before shadow zone', () => {
    const result = computeSIsochronDistance({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 60_000, // 1 min
      eventTimeMs: 0,
    });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(104);
  });
});

describe('computeSurfaceWaveRadius', () => {
  it('returns null before event time', () => {
    const result = computeSurfaceWaveRadius({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 0,
      eventTimeMs: 1000,
    });
    expect(result).toBeNull();
  });

  it('amplitude decays with distance', () => {
    const result1 = computeSurfaceWaveRadius({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 60_000,
      eventTimeMs: 0,
    });
    const result2 = computeSurfaceWaveRadius({
      event: NOTABLE_EVENTS[0],
      simTimeMs: 120_000,
      eventTimeMs: 0,
    });
    expect(result1!.amplitude).toBeGreaterThan(result2!.amplitude);
  });
});

describe('isInPShadowZone', () => {
  it('returns true for point in shadow zone', () => {
    const result = isInPShadowZone(0, 0, 0, 120);
    expect(result).toBe(true);
  });

  it('returns false for point outside shadow zone', () => {
    const result = isInPShadowZone(0, 0, 0, 50);
    expect(result).toBe(false);
  });
});

describe('NOTABLE_EVENTS', () => {
  it('contains Tōhoku 2011', () => {
    const event = NOTABLE_EVENTS.find((e) => e.id === 'toff2011');
    expect(event).toBeDefined();
    expect(event?.mag).toBe(9.1);
  });

  it('contains 3 events', () => {
    expect(NOTABLE_EVENTS.length).toBe(3);
  });
});
