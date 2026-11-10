/**
 * Live data with an honest fallback.
 *
 * A live product is fetched in two steps: ask the provider which time is
 * its newest (small), then download that time's data (large) - unless the
 * browser already holds it. When the network fails, the layer shows the
 * newest thing it can still reach, and its chip says which that is:
 *
 *   live      fetched from the provider, valid at about the app's time
 *   latest    fetched, but the provider's newest is far from the app's time
 *             (a pinned ?time= the provider keeps no archive for)
 *   cached    the provider cannot be reached; shown from the last download
 *   snapshot  nor is there a download; shown from the snapshot baked into
 *             the app (tools/pipeline/generate_weather_snapshot.py)
 *
 * Only the first is toned 'live'. Nothing is ever shown without its date.
 */

import type { StatusTone } from '../types';

export type Origin = 'live' | 'cached' | 'snapshot';

export interface Product<T> {
  readonly value: T;
  readonly validTime: Date;
  readonly origin: Origin;
  /** The provider's identity for this data; null for the baked snapshot. */
  readonly tag: string | null;
}

export interface ProductSource<T> {
  /** Key under which the last download is kept. */
  readonly storeKey: string;
  /** Which data is newest for the instant `now`: an identity for it and its valid time. */
  latest(now: Date): Promise<{ tag: string; validTime: Date }>;
  /** Download the data `latest` named. */
  download(tag: string): Promise<Blob>;
  decode(blob: Blob): Promise<T>;
  /** The snapshot baked into the app. */
  snapshot(): Promise<{ value: T; validTime: Date }>;
}

export interface StoredProduct {
  readonly blob: Blob;
  readonly tag: string;
  readonly validTime: Date;
}

/** Keeps each product's last download across visits. */
export interface ProductStore {
  get(key: string): Promise<StoredProduct | null>;
  put(key: string, product: StoredProduct): Promise<void>;
}

export const NO_STORE: ProductStore = {
  get: async () => null,
  put: async () => undefined,
};

const TAG_HEADER = 'x-product-tag';
const TIME_HEADER = 'x-product-valid-time';

/**
 * The Cache API as a product store: one entry per product, replaced on each
 * new download, so it never grows. Absent (insecure origin, private mode
 * quirks) or failing, it degrades to no store - a cache must not break a layer.
 */
export function cacheStore(cacheName = 'transparent-earth-weather-v1', storage: CacheStorage | undefined = globalThis.caches): ProductStore {
  if (!storage) return NO_STORE;
  const url = (key: string): string => `/__weather-cache__/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      try {
        const response = await (await storage.open(cacheName)).match(url(key));
        const tag = response?.headers.get(TAG_HEADER);
        const time = Date.parse(response?.headers.get(TIME_HEADER) ?? '');
        if (!response || !tag || Number.isNaN(time)) return null;
        return { blob: await response.blob(), tag, validTime: new Date(time) };
      } catch {
        return null;
      }
    },
    async put(key, product) {
      try {
        const headers = { [TAG_HEADER]: product.tag, [TIME_HEADER]: product.validTime.toISOString() };
        await (await storage.open(cacheName)).put(url(key), new Response(await product.blob.arrayBuffer(), { headers }));
      } catch {
        // Quota or a storage error: the layer already has its data.
      }
    },
  };
}

/** The provider's newest data is what the caller already shows. */
export const UNCHANGED = Symbol('unchanged');

/**
 * The newest data that can be had: live, else the last download, else the
 * snapshot. Rejects only when all three fail. `shownTag` is the live data
 * the caller already has: when the provider has nothing newer, the answer
 * is UNCHANGED and nothing is downloaded or decoded.
 */
export async function loadProduct<T>(
  source: ProductSource<T>,
  now: Date,
  store: ProductStore,
  shownTag: string | null = null
): Promise<Product<T> | typeof UNCHANGED> {
  let stored: StoredProduct | null = null;
  try {
    const { tag, validTime } = await source.latest(now);
    if (tag === shownTag) return UNCHANGED;
    stored = await store.get(source.storeKey);
    if (stored && stored.tag === tag) {
      return { value: await source.decode(stored.blob), validTime, origin: 'live', tag };
    }
    const blob = await source.download(tag);
    const value = await source.decode(blob);
    // Stored only once it has decoded: a broken download must not become the fallback.
    await store.put(source.storeKey, { blob, tag, validTime });
    return { value, validTime, origin: 'live', tag };
  } catch (liveError) {
    stored ??= await store.get(source.storeKey);
    if (stored) {
      try {
        return { value: await source.decode(stored.blob), validTime: stored.validTime, origin: 'cached', tag: stored.tag };
      } catch {
        // Fall through to the snapshot.
      }
    }
    try {
      const snapshot = await source.snapshot();
      return { ...snapshot, origin: 'snapshot', tag: null };
    } catch (snapshotError) {
      throw new AggregateError([liveError, snapshotError], `${source.storeKey}: no live data and no snapshot`);
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "9 Nov 2026" */
export function formatUtcDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "9 Nov 23:00 UTC" */
export function formatUtcTime(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC`;
}

export interface StatusOptions {
  /** How far the data's valid time may be from the app's time and still count as live. */
  readonly freshMs: number;
  /** True for products dated by day: the chip then shows no time of day. */
  readonly daily?: boolean;
}

/** The chip for a product: where it came from and when it is valid. */
export function productStatus(
  product: Pick<Product<unknown>, 'validTime' | 'origin'>,
  now: Date,
  options: StatusOptions
): { text: string; tone: StatusTone } {
  const when = options.daily ? formatUtcDate(product.validTime) : formatUtcTime(product.validTime);
  if (product.origin === 'snapshot') {
    return { text: `offline · snapshot ${formatUtcDate(product.validTime)}`, tone: 'stale' };
  }
  if (product.origin === 'cached') return { text: `offline · cached ${when}`, tone: 'stale' };
  const fresh = Math.abs(now.getTime() - product.validTime.getTime()) <= options.freshMs;
  return fresh ? { text: `live · ${when}`, tone: 'live' } : { text: `latest · ${when}`, tone: 'stale' };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 25_000;

/** GET that rejects on a non-2xx status or after `timeoutMs`. */
export async function fetchOk(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export interface WatcherOptions<T> extends StatusOptions {
  /** Wall-clock interval between checks for newer data. */
  readonly refreshMs: number;
  onProduct(product: Product<T>): void;
  setStatus(text: string | null, tone?: StatusTone): void;
  now(): Date;
  /** Wall clock in milliseconds; performance.now by default. */
  readonly wallMs?: () => number;
}

/**
 * Keeps one product current while its layer is showing: loads it, hands it
 * to the layer, keeps the chip true, and looks again every `refreshMs`.
 * A refresh that can only find something older than what is showing changes
 * the chip - the provider is unreachable - but not the picture.
 */
export class ProductWatcher<T> {
  private current: Product<T> | null = null;
  private loading = false;
  private lastAttemptMs = -Infinity;
  private stopped = false;
  private readonly wallMs: () => number;

  constructor(
    private readonly source: ProductSource<T>,
    private readonly store: ProductStore,
    private readonly options: WatcherOptions<T>
  ) {
    this.wallMs = options.wallMs ?? (() => performance.now());
  }

  /** The first load: rejects when there is nothing at all to show. */
  async start(): Promise<void> {
    await this.load(true);
  }

  /** Call every frame while visible: cheap unless a refresh is due. */
  tick(): void {
    if (this.loading || this.stopped || this.wallMs() - this.lastAttemptMs < this.options.refreshMs) return;
    void this.load(false);
  }

  stop(): void {
    this.stopped = true;
  }

  private async load(first: boolean): Promise<void> {
    this.loading = true;
    this.lastAttemptMs = this.wallMs();
    try {
      const shown = this.current;
      const product = await loadProduct(this.source, this.options.now(), this.store, shown?.origin === 'live' ? shown.tag : null);
      if (this.stopped) return;
      if (product === UNCHANGED) {
        // Still the provider's newest; only the chip's age may have changed.
      } else if (shown && product.origin !== 'live' && product.validTime <= shown.validTime) {
        // Nothing newer to be had: keep the picture, own up to its age.
        this.current = { ...shown, origin: shown.origin === 'snapshot' ? 'snapshot' : 'cached' };
      } else {
        this.current = product;
        this.options.onProduct(product);
      }
      this.report();
    } catch (error) {
      if (first) throw error;
      console.error(`${this.source.storeKey}: refresh failed`, error);
    } finally {
      this.loading = false;
    }
  }

  private report(): void {
    if (!this.current) return;
    const { text, tone } = productStatus(this.current, this.options.now(), this.options);
    this.options.setStatus(text, tone);
  }
}

/** Decode an image file into something a texture can hold. */
export async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
