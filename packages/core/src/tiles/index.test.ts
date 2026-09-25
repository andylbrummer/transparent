import { describe, it, expect } from 'vitest';
import {
  tileKeyString,
  expandTileUrl,
  nextRetryDelay,
  isTerminalFailure,
  TileLruCache,
  cacheStorageKey,
  aggregateStatus,
  createTileStreamerState,
  startTileFetch,
  tileFetchSuccess,
  tileFetchFailure,
  canRetry,
  getTileState,
  GIBS_CLOUD_PROVIDER,
  RAINVIEWER_PROVIDER,
  expandTimePlaceholder,
  buildTileUrl,
  tilesForViewport,
  DEFAULT_RETRY_POLICY,
} from './index';

describe('tileKeyString', () => {
  it('formats a tile key', () => {
    expect(tileKeyString({ z: 3, x: 2, y: 1 })).toBe('3/2/1');
  });
});

describe('expandTileUrl', () => {
  it('substitutes z, x, y', () => {
    const url = expandTileUrl('https://example.com/{z}/{x}/{y}.png', { z: 5, x: 10, y: 20 });
    expect(url).toBe('https://example.com/5/10/20.png');
  });

  it('substitutes TMS {-y}', () => {
    const url = expandTileUrl('https://example.com/{z}/{x}/{-y}.png', { z: 2, x: 1, y: 1 });
    // TMS y = (1<<2)-1-1 = 4-1-1 = 2
    expect(url).toBe('https://example.com/2/1/2.png');
  });

  it('handles multiple occurrences', () => {
    const url = expandTileUrl('{z}/{z}/{x}/{y}', { z: 1, x: 0, y: 0 });
    expect(url).toBe('1/1/0/0');
  });
});

describe('nextRetryDelay', () => {
  it('doubles each attempt', () => {
    expect(nextRetryDelay(DEFAULT_RETRY_POLICY, 1)).toBe(1000);
    expect(nextRetryDelay(DEFAULT_RETRY_POLICY, 2)).toBe(2000);
    expect(nextRetryDelay(DEFAULT_RETRY_POLICY, 3)).toBe(4000);
  });

  it('caps at maxDelayMs', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 20000, backoffMultiplier: 2 };
    expect(nextRetryDelay(policy, 3)).toBe(30000); // capped
  });
});

describe('isTerminalFailure', () => {
  it('returns true for terminal failed state', () => {
    const state = { kind: 'failed' as const, attempt: 3, terminal: true, lastError: 'err', timestamp: 0 };
    expect(isTerminalFailure(state)).toBe(true);
  });

  it('returns false for non-terminal failed state', () => {
    const state = { kind: 'failed' as const, attempt: 1, terminal: false, lastError: 'err', timestamp: 0 };
    expect(isTerminalFailure(state)).toBe(false);
  });

  it('returns false for loaded state', () => {
    const state = { kind: 'loaded' as const, blob: new ArrayBuffer(0), timestamp: 0 };
    expect(isTerminalFailure(state)).toBe(false);
  });
});

describe('TileLruCache', () => {
  it('stores and retrieves a tile', () => {
    const cache = new TileLruCache(4);
    const buf = new ArrayBuffer(8);
    cache.set({ z: 1, x: 0, y: 0 }, buf);
    expect(cache.get({ z: 1, x: 0, y: 0 })).toBe(buf);
  });

  it('evicts oldest when over capacity', () => {
    const cache = new TileLruCache(2);
    cache.set({ z: 1, x: 0, y: 0 }, new ArrayBuffer(1));
    cache.set({ z: 1, x: 1, y: 0 }, new ArrayBuffer(2));
    cache.set({ z: 1, x: 2, y: 0 }, new ArrayBuffer(3));
    expect(cache.get({ z: 1, x: 0, y: 0 })).toBeUndefined();
    expect(cache.get({ z: 1, x: 1, y: 0 })).toBeDefined();
    expect(cache.get({ z: 1, x: 2, y: 0 })).toBeDefined();
  });

  it('moves accessed entry to front', () => {
    const cache = new TileLruCache(2);
    cache.set({ z: 1, x: 0, y: 0 }, new ArrayBuffer(1));
    cache.set({ z: 1, x: 1, y: 0 }, new ArrayBuffer(2));
    // Access first entry — it becomes most-recently used
    cache.get({ z: 1, x: 0, y: 0 });
    // Add third entry — second should be evicted
    cache.set({ z: 1, x: 2, y: 0 }, new ArrayBuffer(3));
    expect(cache.get({ z: 1, x: 0, y: 0 })).toBeDefined();
    expect(cache.get({ z: 1, x: 1, y: 0 })).toBeUndefined();
  });

  it('reports size correctly', () => {
    const cache = new TileLruCache(10);
    expect(cache.size()).toBe(0);
    cache.set({ z: 1, x: 0, y: 0 }, new ArrayBuffer(1));
    expect(cache.size()).toBe(1);
  });

  it('returns keys in LRU order', () => {
    const cache = new TileLruCache(3);
    cache.set({ z: 1, x: 0, y: 0 }, new ArrayBuffer(1));
    cache.set({ z: 1, x: 1, y: 0 }, new ArrayBuffer(2));
    const keys = cache.keys();
    expect(keys.length).toBe(2);
    expect(keys[0]).toEqual({ z: 1, x: 0, y: 0 });
    expect(keys[1]).toEqual({ z: 1, x: 1, y: 0 });
  });
});

describe('cacheStorageKey', () => {
  it('includes provider name and tile key', () => {
    const key = cacheStorageKey('gibs', { z: 3, x: 2, y: 1 });
    expect(key).toBe('tiles/gibs/3/2/1');
  });
});

describe('aggregateStatus', () => {
  it('returns online when all online', () => {
    expect(aggregateStatus(['online', 'online'])).toBe('online');
  });

  it('returns degraded when any degraded', () => {
    expect(aggregateStatus(['online', 'degraded'])).toBe('degraded');
  });

  it('returns degraded when any offline', () => {
    expect(aggregateStatus(['online', 'offline'])).toBe('degraded');
  });

  it('returns offline when all offline', () => {
    expect(aggregateStatus(['offline', 'offline'])).toBe('offline');
  });
});

describe('createTileStreamerState', () => {
  it('creates with online status', () => {
    const state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    expect(state.provider.name).toBe('gibs-clouds');
    expect(state.status).toBe('online');
    expect(state.cache.size()).toBe(0);
  });
});

describe('startTileFetch', () => {
  it('sets tile to loading with attempt 1', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    state = startTileFetch(state, { z: 1, x: 0, y: 0 });
    const tile = state.pending.get('1/0/0');
    expect(tile?.kind).toBe('loading');
    expect((tile as { attempt: number }).attempt).toBe(1);
  });

  it('increments attempt on re-fetch', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    state = startTileFetch(state, { z: 1, x: 0, y: 0 });
    state = startTileFetch(state, { z: 1, x: 0, y: 0 });
    const tile = state.pending.get('1/0/0');
    expect((tile as { attempt: number }).attempt).toBe(2);
  });
});

describe('tileFetchSuccess', () => {
  it('stores buffer in cache and marks loaded', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    const buf = new ArrayBuffer(16);
    state = tileFetchSuccess(state, { z: 1, x: 0, y: 0 }, buf);
    expect(state.cache.get({ z: 1, x: 0, y: 0 })).toBe(buf);
    expect(getTileState(state, { z: 1, x: 0, y: 0 }).kind).toBe('loaded');
    expect(state.status).toBe('online');
  });

  it('holds loaded buffers only in the bounded cache', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER, 1);
    state = tileFetchSuccess(state, { z: 1, x: 0, y: 0 }, new ArrayBuffer(16));
    state = tileFetchSuccess(state, { z: 1, x: 1, y: 0 }, new ArrayBuffer(16));
    expect(state.pending.size).toBe(0);
    // Evicted from the cache, so it must be fetchable again rather than
    // reported loaded from a stale copy.
    expect(getTileState(state, { z: 1, x: 0, y: 0 }).kind).toBe('idle');
  });
});

describe('tileFetchFailure', () => {
  it('marks non-terminal on first failure', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    state = tileFetchFailure(state, { z: 1, x: 0, y: 0 }, 'network error');
    const tile = state.pending.get('1/0/0');
    expect(tile?.kind).toBe('failed');
    expect((tile as { terminal: boolean }).terminal).toBe(false);
    expect(state.status).toBe('degraded');
  });

  it('marks terminal after max attempts', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER, 128, {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 1,
    });
    state = startTileFetch(state, { z: 1, x: 0, y: 0 });
    state = tileFetchFailure(state, { z: 1, x: 0, y: 0 }, 'network error');
    const tile = state.pending.get('1/0/0');
    expect((tile as { terminal: boolean }).terminal).toBe(true);
    expect(state.status).toBe('offline');
    expect(state.offlineSince).not.toBeNull();
  });
});

describe('retry sequence', () => {
  it('goes terminal after maxAttempts fetch/fail cycles', () => {
    const key = { z: 1, x: 0, y: 0 };
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER, 128, {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 3,
    });
    for (let i = 1; i <= 3; i++) {
      state = startTileFetch(state, key);
      state = tileFetchFailure(state, key, 'network error');
      expect(canRetry(state, key)).toBe(i < 3);
    }
    expect(canRetry(state, key)).toBe(false);
    expect(state.status).toBe('offline');
  });
});

describe('canRetry', () => {
  it('returns true for non-terminal failed tile', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    state = tileFetchFailure(state, { z: 1, x: 0, y: 0 }, 'err');
    expect(canRetry(state, { z: 1, x: 0, y: 0 })).toBe(true);
  });

  it('returns false for terminal failed tile', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER, 128, {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 1,
    });
    state = startTileFetch(state, { z: 1, x: 0, y: 0 });
    state = tileFetchFailure(state, { z: 1, x: 0, y: 0 }, 'err');
    expect(canRetry(state, { z: 1, x: 0, y: 0 })).toBe(false);
  });
});

describe('getTileState', () => {
  it('returns loaded from cache', () => {
    let state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    const buf = new ArrayBuffer(8);
    state = tileFetchSuccess(state, { z: 1, x: 0, y: 0 }, buf);
    const tile = getTileState(state, { z: 1, x: 0, y: 0 });
    expect(tile.kind).toBe('loaded');
  });

  it('returns idle for unknown tile', () => {
    const state = createTileStreamerState(GIBS_CLOUD_PROVIDER);
    const tile = getTileState(state, { z: 99, x: 99, y: 99 });
    expect(tile.kind).toBe('idle');
  });
});

describe('expandTimePlaceholder', () => {
  it('replaces {time} with given string', () => {
    const url = expandTimePlaceholder('https://example.com/{time}/tile.png', '2024-06-15');
    expect(url).toBe('https://example.com/2024-06-15/tile.png');
  });
});

describe('buildTileUrl', () => {
  it('builds GIBS cloud URL', () => {
    const url = buildTileUrl(GIBS_CLOUD_PROVIDER, { z: 3, x: 2, y: 1 }, '2024-06-15');
    expect(url).toContain('2024-06-15');
    expect(url).toContain('3/1/2.jpg');
  });

  it('builds RainViewer URL', () => {
    const url = buildTileUrl(RAINVIEWER_PROVIDER, { z: 5, x: 10, y: 20 }, '1718400000');
    expect(url).toContain('1718400000');
    expect(url).toContain('5/10/20');
  });
});

describe('tilesForViewport', () => {
  it('returns at least one tile for global zoom 0', () => {
    const tiles = tilesForViewport(0, 90, -90, 180, -180);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles[0].z).toBe(0);
  });

  it('returns multiple tiles for zoomed viewport', () => {
    const tiles = tilesForViewport(3, 45, 35, -95, -105); // Texas-ish
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.z === 3)).toBe(true);
  });

  it('clamps zoom to valid range', () => {
    const tiles = tilesForViewport(-1, 0, 0, 0, 0);
    expect(tiles[0].z).toBe(0);
  });

  it('clamps coordinates to tile bounds', () => {
    const tiles = tilesForViewport(2, 90, -90, 180, -180);
    expect(tiles.every((t) => t.x >= 0 && t.y >= 0)).toBe(true);
  });
});
