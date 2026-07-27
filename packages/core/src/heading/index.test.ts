import { describe, it, expect } from 'vitest';
import {
  evaluateHeadingSamples,
  nextFixState,
  DEFAULT_FIX_CONFIG,
} from './index';

describe('evaluateHeadingSamples', () => {
  it('accepts clean stream with 3 similar samples', () => {
    const samples = [
      { heading: 45, timestamp: 0 },
      { heading: 46, timestamp: 500 },
      { heading: 44, timestamp: 1000 },
    ];
    const result = evaluateHeadingSamples(samples);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.heading).toBe(45);
    }
  });

  it('rejects high-variance stream (magnetic interference)', () => {
    const samples = [
      { heading: 0, timestamp: 0 },
      { heading: 90, timestamp: 500 },
      { heading: 180, timestamp: 1000 },
    ];
    const result = evaluateHeadingSamples(samples);
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('high_variance');
    }
  });

  it('rejects moving-device stream (high variance)', () => {
    const samples = [
      { heading: 0, timestamp: 0 },
      { heading: 30, timestamp: 500 },
      { heading: 60, timestamp: 1000 },
    ];
    const result = evaluateHeadingSamples(samples);
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('device_moving');
    }
  });

  it('rejects insufficient samples', () => {
    const samples = [{ heading: 45, timestamp: 0 }];
    const result = evaluateHeadingSamples(samples);
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('insufficient_samples');
    }
  });

  it('handles circular wrap-around (355°, 5°, 0°)', () => {
    const samples = [
      { heading: 355, timestamp: 0 },
      { heading: 5, timestamp: 500 },
      { heading: 0, timestamp: 1000 },
    ];
    const result = evaluateHeadingSamples(samples);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      // Clustered on north: a numeric sort would wrongly pick 5, since it
      // orders these as [0, 5, 355]. The circular median is 0.
      expect(result.heading).toBeCloseTo(0, 6);
    }
  });

  it('accepts within spread threshold', () => {
    const samples = [
      { heading: 0, timestamp: 0 },
      { heading: 14, timestamp: 500 },
      { heading: 7, timestamp: 1000 },
    ];
    const result = evaluateHeadingSamples(samples);
    expect(result.status).toBe('ok');
  });

  it('rejects at spread threshold + 1', () => {
    const samples = [
      { heading: 0, timestamp: 0 },
      { heading: 16, timestamp: 500 },
      { heading: 8, timestamp: 1000 },
    ];
    const result = evaluateHeadingSamples(samples);
    expect(result.status).toBe('reject');
    if (result.status === 'reject') {
      expect(result.reason).toBe('high_variance');
    }
  });
});

describe('nextFixState', () => {
  it('resolves when accuracy ≤ 20 m', () => {
    const state = nextFixState(
      { phase: 'acquiring', accuracy: null },
      { accuracy: 15 },
      false,
      DEFAULT_FIX_CONFIG
    );
    expect(state.phase).toBe('resolved');
    if (state.phase === 'resolved') {
      expect(state.accuracy).toBe(15);
      expect(state.accepted).toBe(false);
    }
  });

  it('stays acquiring when accuracy > 20 m', () => {
    const state = nextFixState(
      { phase: 'acquiring', accuracy: null },
      { accuracy: 80 },
      false,
      DEFAULT_FIX_CONFIG
    );
    expect(state.phase).toBe('acquiring');
    if (state.phase === 'acquiring') {
      expect(state.accuracy).toBe(80);
    }
  });

  it('resolves early on user accept', () => {
    const state = nextFixState(
      { phase: 'acquiring', accuracy: 35 },
      { accuracy: 35 },
      true,
      DEFAULT_FIX_CONFIG
    );
    expect(state.phase).toBe('resolved');
    if (state.phase === 'resolved') {
      expect(state.accuracy).toBe(35);
      expect(state.accepted).toBe(true);
    }
  });

  it('tracks accuracy sequence 80→35→15', () => {
    let state: ReturnType<typeof nextFixState> = { phase: 'acquiring', accuracy: null };
    state = nextFixState(state, { accuracy: 80 }, false);
    expect(state.phase).toBe('acquiring');
    if (state.phase === 'acquiring') expect(state.accuracy).toBe(80);

    state = nextFixState(state, { accuracy: 35 }, false);
    expect(state.phase).toBe('acquiring');
    if (state.phase === 'acquiring') expect(state.accuracy).toBe(35);

    state = nextFixState(state, { accuracy: 15 }, false);
    expect(state.phase).toBe('resolved');
    if (state.phase === 'resolved') {
      expect(state.accuracy).toBe(15);
      expect(state.accepted).toBe(false);
    }
  });

  it('preserves denied state', () => {
    const state = nextFixState(
      { phase: 'denied' },
      { accuracy: 10 },
      false
    );
    expect(state.phase).toBe('denied');
  });

  it('preserves unavailable state', () => {
    const state = nextFixState(
      { phase: 'unavailable' },
      { accuracy: 10 },
      false
    );
    expect(state.phase).toBe('unavailable');
  });
});
