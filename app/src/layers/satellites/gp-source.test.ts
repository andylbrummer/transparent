import { describe, expect, it } from 'vitest';
import { MIN_INTERVAL_MS, REFRESH_MS, decideGpSource } from './gp-source';

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);
const BAKED = Date.UTC(2026, 10, 9, 12);
const live = { wallMs: NOW, clockMs: NOW, bakedEpochMs: BAKED, cachedAtMs: null, lastAttemptMs: null };

describe('decideGpSource', () => {
  it('asks CelesTrak the first time', () => {
    expect(decideGpSource(live)).toBe('fetch');
  });

  it('uses a fresh cached copy without asking', () => {
    expect(decideGpSource({ ...live, cachedAtMs: NOW - HOUR, lastAttemptMs: NOW - HOUR })).toBe('cache');
    expect(decideGpSource({ ...live, cachedAtMs: NOW - REFRESH_MS + 1, lastAttemptMs: null })).toBe('cache');
  });

  it('asks again once the copy has aged and two hours have passed since the last attempt', () => {
    expect(decideGpSource({ ...live, cachedAtMs: NOW - REFRESH_MS - 1, lastAttemptMs: NOW - REFRESH_MS - 1 })).toBe('fetch');
  });

  it('never asks twice within CelesTrak’s two hours, whatever happened to the first request', () => {
    // A refusal or a timeout leaves an attempt and no copy: the snapshot serves until the two hours are up.
    expect(decideGpSource({ ...live, lastAttemptMs: NOW - 60 * 1000 })).toBe('baked');
    expect(decideGpSource({ ...live, lastAttemptMs: NOW - MIN_INTERVAL_MS + 1 })).toBe('baked');
    expect(decideGpSource({ ...live, lastAttemptMs: NOW - MIN_INTERVAL_MS })).toBe('fetch');
    // An old copy and a recent failed attempt: the old copy.
    expect(decideGpSource({ ...live, cachedAtMs: NOW - 10 * HOUR, lastAttemptMs: NOW - HOUR })).toBe('cache');
    // An attempt stamped in the future (the clock was set back) still counts.
    expect(decideGpSource({ ...live, lastAttemptMs: NOW + 5 * HOUR })).toBe('baked');
  });

  it('takes the snapshot when the clock is pinned nearer its epoch than the present', () => {
    expect(decideGpSource({ ...live, clockMs: BAKED + 6 * HOUR })).toBe('baked');
    expect(decideGpSource({ ...live, clockMs: BAKED - 400 * 24 * HOUR, cachedAtMs: NOW - HOUR })).toBe('baked');
    // Pinned, but nearer today than the snapshot: live elements are the better ones.
    expect(decideGpSource({ ...live, clockMs: NOW - 2 * 24 * HOUR })).toBe('fetch');
  });
});
