/**
 * Tile streaming engine for WMTS/XYZ raster tiles.
 * Pure functions — no DOM or Three.js imports here.
 *
 * Features:
 * - LRU cache (RAM + CacheStorage keying)
 * - Exponential-backoff retry with terminal failure
 * - Tile URL templating for multiple providers
 * - Offline state surfacing (feeds UI offline chip)
 */

/** Unique key for a tile in the cache. */
export interface TileKey {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export function tileKeyString(k: TileKey): string {
  return `${k.z}/${k.x}/${k.y}`;
}

/** Tile fetch state machine. */
export type TileState =
  | { kind: 'idle' }
  | { kind: 'loading'; attempt: number }
  | { kind: 'loaded'; blob: ArrayBuffer; timestamp: number }
  | { kind: 'failed'; attempt: number; terminal: boolean; lastError: string; timestamp: number };

/** Provider-specific tile URL template. */
export interface TileProvider {
  readonly name: string;
  readonly template: string; // e.g. "https://gibs.earthdata.nasa.gov/wmts/.../{z}/{x}/{y}.png"
  readonly attribution: string;
  readonly maxZoom: number;
  readonly minZoom: number;
  readonly tileSize: number;
}

/**
 * Substitute {z}, {x}, {y}, {-y} (TMS y) into a URL template.
 */
export function expandTileUrl(template: string, key: TileKey): string {
  const tmsY = (1 << key.z) - 1 - key.y;
  return template
    .replace(/{z}/g, String(key.z))
    .replace(/{x}/g, String(key.x))
    .replace(/{y}/g, String(key.y))
    .replace(/{-y}/g, String(tmsY));
}

/** Retry policy configuration. */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/** Compute the next retry delay for a given attempt (1-based). */
export function nextRetryDelay(policy: RetryPolicy, attempt: number): number {
  const delay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

/** Determine whether a failure is terminal (no more retries). */
export function isTerminalFailure(state: TileState): boolean {
  return state.kind === 'failed' && state.terminal;
}

/** RAM LRU cache entry. */
interface LruEntry {
  key: TileKey;
  buffer: ArrayBuffer;
  timestamp: number;
}

/** Simple in-memory LRU cache for tile buffers. */
export class TileLruCache {
  private entries = new Map<string, LruEntry>();

  constructor(private maxEntries: number) {}

  get(key: TileKey): ArrayBuffer | undefined {
    const s = tileKeyString(key);
    const entry = this.entries.get(s);
    if (entry) {
      // Move to front (most recently used)
      this.entries.delete(s);
      this.entries.set(s, { ...entry, timestamp: Date.now() });
      return entry.buffer;
    }
    return undefined;
  }

  set(key: TileKey, buffer: ArrayBuffer): void {
    const s = tileKeyString(key);
    if (this.entries.has(s)) {
      this.entries.delete(s);
    } else if (this.entries.size >= this.maxEntries) {
      // Evict least recently used (oldest)
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(s, { key, buffer, timestamp: Date.now() });
  }

  has(key: TileKey): boolean {
    return this.entries.has(tileKeyString(key));
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Return keys in LRU order (oldest first). */
  keys(): TileKey[] {
    return Array.from(this.entries.values()).map((e) => e.key);
  }
}

/** CacheStorage key for a tile provider. */
export function cacheStorageKey(providerName: string, key: TileKey): string {
  return `tiles/${providerName}/${tileKeyString(key)}`;
}

/** Offline / online status for a provider. */
export type ProviderStatus = 'online' | 'degraded' | 'offline';

/** Aggregate status across all active providers. */
export function aggregateStatus(statuses: ProviderStatus[]): ProviderStatus {
  if (statuses.every((s) => s === 'offline')) return 'offline';
  if (statuses.some((s) => s === 'offline' || s === 'degraded')) return 'degraded';
  return 'online';
}

/** Tile streamer state snapshot. */
export interface TileStreamerState {
  readonly provider: TileProvider;
  readonly cache: TileLruCache;
  readonly retryPolicy: RetryPolicy;
  /** In-flight and failed tiles. Loaded tiles live only in `cache`. */
  readonly pending: ReadonlyMap<string, TileState>;
  readonly status: ProviderStatus;
  readonly offlineSince: number | null; // timestamp or null
}

/** Create a fresh tile streamer state for a provider. */
export function createTileStreamerState(
  provider: TileProvider,
  cacheSize = 128,
  retryPolicy = DEFAULT_RETRY_POLICY
): TileStreamerState {
  return {
    provider,
    cache: new TileLruCache(cacheSize),
    retryPolicy,
    pending: new Map(),
    status: 'online',
    offlineSince: null,
  };
}

/** Attempt number of the tile's latest fetch, or 0 if it has none. */
function lastAttempt(tile: TileState | undefined): number {
  return tile?.kind === 'loading' || tile?.kind === 'failed' ? tile.attempt : 0;
}

/** Transition a tile to loading state. A retry after a failure counts on. */
export function startTileFetch(
  state: TileStreamerState,
  key: TileKey
): TileStreamerState {
  const s = tileKeyString(key);
  const attempt = lastAttempt(state.pending.get(s)) + 1;
  const nextPending = new Map(state.pending);
  nextPending.set(s, { kind: 'loading', attempt });
  return { ...state, pending: nextPending };
}

/**
 * Record a successful tile fetch. The buffer goes to the LRU cache only;
 * keeping it in `pending` too would hold every tile ever loaded and defeat
 * the cache's bound.
 */
export function tileFetchSuccess(
  state: TileStreamerState,
  key: TileKey,
  buffer: ArrayBuffer
): TileStreamerState {
  state.cache.set(key, buffer);
  const nextPending = new Map(state.pending);
  nextPending.delete(tileKeyString(key));
  return {
    ...state,
    pending: nextPending,
    status: 'online',
    offlineSince: null,
  };
}

/** Record a failed tile fetch. */
export function tileFetchFailure(
  state: TileStreamerState,
  key: TileKey,
  error: string
): TileStreamerState {
  const s = tileKeyString(key);
  const attempt = Math.max(1, lastAttempt(state.pending.get(s)));
  const terminal = attempt >= state.retryPolicy.maxAttempts;
  const nextPending = new Map(state.pending);
  nextPending.set(s, {
    kind: 'failed',
    attempt,
    terminal,
    lastError: error,
    timestamp: Date.now(),
  });

  const now = Date.now();
  const offlineSince = terminal ? (state.offlineSince ?? now) : state.offlineSince;
  const status: ProviderStatus = terminal ? 'offline' : 'degraded';

  return { ...state, pending: nextPending, status, offlineSince };
}

/** Check if a tile is currently in a retryable failed state. */
export function canRetry(state: TileStreamerState, key: TileKey): boolean {
  const s = tileKeyString(key);
  const tile = state.pending.get(s);
  if (!tile || tile.kind !== 'failed') return false;
  return !tile.terminal;
}

/** Get the current tile state (checking cache first). */
export function getTileState(
  state: TileStreamerState,
  key: TileKey
): TileState {
  const cached = state.cache.get(key);
  if (cached) {
    return { kind: 'loaded', blob: cached, timestamp: Date.now() };
  }
  return state.pending.get(tileKeyString(key)) ?? { kind: 'idle' };
}

/** Predefined providers. */
export const GIBS_CLOUD_PROVIDER: TileProvider = {
  name: 'gibs-clouds',
  template:
    'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/' +
    'MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/{z}/{y}/{x}.jpg',
  attribution: 'NASA GIBS / MODIS Terra',
  maxZoom: 8,
  minZoom: 1,
  tileSize: 256,
};

export const RAINVIEWER_PROVIDER: TileProvider = {
  name: 'rainviewer-precip',
  template: 'https://tilecache.rainviewer.com/v2/radar/{time}/{z}/{x}/{y}/2/1_1.png',
  attribution: 'RainViewer.com',
  maxZoom: 12,
  minZoom: 1,
  tileSize: 256,
};

/** Substitute {time} placeholder with an ISO timestamp (YYYY-MM-DD). */
export function expandTimePlaceholder(template: string, time: string): string {
  return template.replace(/{time}/g, time);
}

/** Build a full tile URL for a provider with time substitution. */
export function buildTileUrl(provider: TileProvider, key: TileKey, time = '2024-01-01'): string {
  const withTime = expandTimePlaceholder(provider.template, time);
  return expandTileUrl(withTime, key);
}

/** Compute the set of tile keys needed for a viewport. */
export function tilesForViewport(
  zoom: number,
  north: number,
  south: number,
  east: number,
  west: number
): TileKey[] {
  const z = Math.max(0, Math.min(20, Math.floor(zoom)));
  const n = 1 << z;

  const latToY = (lat: number): number => {
    const latRad = (lat * Math.PI) / 180;
    return Math.floor((n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2);
  };

  const lonToX = (lon: number): number => {
    return Math.floor(((lon + 180) / 360) * n);
  };

  const minX = Math.max(0, lonToX(west));
  const maxX = Math.min(n - 1, lonToX(east));
  const minY = Math.max(0, latToY(north));
  const maxY = Math.min(n - 1, latToY(south));

  const keys: TileKey[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      keys.push({ z, x, y });
    }
  }
  return keys;
}
