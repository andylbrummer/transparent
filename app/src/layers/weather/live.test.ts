import { describe, it, expect, vi } from 'vitest';
import {
  cacheStore,
  fetchOk,
  formatUtcDate,
  formatUtcTime,
  loadProduct,
  NO_STORE,
  productStatus,
  ProductWatcher,
  UNCHANGED,
  type Product,
  type ProductSource,
  type ProductStore,
  type StoredProduct,
} from './live';
import type { StatusTone } from '../types';

const T0 = new Date('2026-11-09T23:00:00Z');
const T1 = new Date('2026-11-10T00:00:00Z');
const NOW = new Date('2026-11-10T00:30:00Z');
const SNAPSHOT_TIME = new Date('2026-11-01T12:00:00Z');

/** A store holding blobs in memory, as text. */
function memoryStore(initial?: { key: string; text: string; tag: string; validTime: Date }): ProductStore & { entries: Map<string, StoredProduct> } {
  const entries = new Map<string, StoredProduct>();
  if (initial) entries.set(initial.key, { blob: new Blob([initial.text]), tag: initial.tag, validTime: initial.validTime });
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    put: async (key, product) => {
      entries.set(key, product);
    },
  };
}

interface FakeOptions {
  latest?: () => { tag: string; validTime: Date };
  download?: (tag: string) => string;
  snapshot?: boolean;
}

/** A source whose "data" is a line of text; decode refuses the word "broken". */
function fakeSource(options: FakeOptions = {}): ProductSource<string> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    storeKey: 'product',
    async latest() {
      calls.push('latest');
      if (!options.latest) throw new Error('offline');
      return options.latest();
    },
    async download(tag) {
      calls.push(`download ${tag}`);
      if (!options.download) throw new Error('offline');
      return new Blob([options.download(tag)]);
    },
    async decode(blob) {
      const text = await blob.text();
      if (text === 'broken') throw new Error('cannot decode');
      return text;
    },
    async snapshot() {
      calls.push('snapshot');
      if (options.snapshot === false) throw new Error('no snapshot');
      return { value: 'baked', validTime: SNAPSHOT_TIME };
    },
  };
}

const online: FakeOptions = { latest: () => ({ tag: 'T1', validTime: T1 }), download: (tag) => `data ${tag}` };

describe('loadProduct', () => {
  it('downloads the newest data and keeps it for next time', async () => {
    const source = fakeSource(online);
    const store = memoryStore();
    const product = await loadProduct(source, NOW, store);
    expect(product).toEqual({ value: 'data T1', validTime: T1, origin: 'live', tag: 'T1' });
    expect(source.calls).toEqual(['latest', 'download T1']);
    expect(store.entries.get('product')?.tag).toBe('T1');
  });

  it('does not download again what the browser already holds', async () => {
    const source = fakeSource(online);
    const store = memoryStore({ key: 'product', text: 'kept T1', tag: 'T1', validTime: T1 });
    const product = await loadProduct(source, NOW, store);
    // Still live: the provider confirmed this is its newest.
    expect(product).toMatchObject({ value: 'kept T1', origin: 'live' });
    expect(source.calls).toEqual(['latest']);
  });

  it('answers UNCHANGED when the caller already shows the newest', async () => {
    const source = fakeSource(online);
    expect(await loadProduct(source, NOW, memoryStore(), 'T1')).toBe(UNCHANGED);
    expect(source.calls).toEqual(['latest']);
  });

  it('replaces older stored data when the provider has newer', async () => {
    const store = memoryStore({ key: 'product', text: 'kept T0', tag: 'T0', validTime: T0 });
    const product = await loadProduct(fakeSource(online), NOW, store);
    expect(product).toMatchObject({ value: 'data T1', origin: 'live' });
    expect(store.entries.get('product')?.tag).toBe('T1');
  });

  it('falls back to the last download when the provider cannot be reached', async () => {
    const source = fakeSource();
    const store = memoryStore({ key: 'product', text: 'kept T0', tag: 'T0', validTime: T0 });
    expect(await loadProduct(source, NOW, store)).toEqual({ value: 'kept T0', validTime: T0, origin: 'cached', tag: 'T0' });
    expect(source.calls).toEqual(['latest']);
  });

  it('falls back to the last download when the download itself fails', async () => {
    const source = fakeSource({ latest: online.latest });
    const store = memoryStore({ key: 'product', text: 'kept T0', tag: 'T0', validTime: T0 });
    expect(await loadProduct(source, NOW, store)).toMatchObject({ value: 'kept T0', origin: 'cached' });
  });

  it('falls back to the baked snapshot when there is no download to fall back on', async () => {
    const source = fakeSource();
    expect(await loadProduct(source, NOW, memoryStore())).toEqual({ value: 'baked', validTime: SNAPSHOT_TIME, origin: 'snapshot', tag: null });
    expect(source.calls).toEqual(['latest', 'snapshot']);
  });

  it('never stores a download that does not decode, and falls back past it', async () => {
    const source = fakeSource({ latest: online.latest, download: () => 'broken' });
    const store = memoryStore();
    expect(await loadProduct(source, NOW, store)).toMatchObject({ origin: 'snapshot' });
    expect(store.entries.size).toBe(0);
  });

  it('skips a stored download that no longer decodes', async () => {
    const store = memoryStore({ key: 'product', text: 'broken', tag: 'T0', validTime: T0 });
    expect(await loadProduct(fakeSource(), NOW, store)).toMatchObject({ origin: 'snapshot' });
  });

  it('rejects, with both causes, only when nothing at all can be had', async () => {
    const failure = await loadProduct(fakeSource({ snapshot: false }), NOW, NO_STORE).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((e: Error) => e.message)).toEqual(['offline', 'no snapshot']);
  });
});

describe('productStatus', () => {
  const options = { freshMs: 4 * 3_600_000 };
  const status = (product: Pick<Product<unknown>, 'validTime' | 'origin'>, now: Date = NOW): { text: string; tone: StatusTone } =>
    productStatus(product, now, options);

  it('says live, with the valid time in UTC, for fresh data from the provider', () => {
    expect(status({ validTime: T0, origin: 'live' })).toEqual({ text: 'live · 9 Nov 23:00 UTC', tone: 'live' });
  });

  it('does not call data live when it is far from the time the app is showing', () => {
    // The clock pinned to last summer: the provider's newest is months off.
    expect(status({ validTime: T0, origin: 'live' }, new Date('2026-06-21T12:00:00Z'))).toEqual({ text: 'latest · 9 Nov 23:00 UTC', tone: 'stale' });
  });

  it('says offline and which copy for anything not from the provider', () => {
    expect(status({ validTime: T0, origin: 'cached' })).toEqual({ text: 'offline · cached 9 Nov 23:00 UTC', tone: 'stale' });
    expect(status({ validTime: SNAPSHOT_TIME, origin: 'snapshot' })).toEqual({ text: 'offline · snapshot 1 Nov 2026', tone: 'stale' });
  });

  it('shows a daily product by its date', () => {
    const daily = productStatus({ validTime: new Date('2026-11-08T00:00:00Z'), origin: 'live' }, NOW, { freshMs: 3 * 86_400_000, daily: true });
    expect(daily).toEqual({ text: 'live · 8 Nov 2026', tone: 'live' });
  });

  it('formats in UTC whatever the local zone', () => {
    expect(formatUtcTime(new Date('2026-01-01T00:05:00Z'))).toBe('1 Jan 00:05 UTC');
    expect(formatUtcDate(new Date('2026-12-31T23:59:59Z'))).toBe('31 Dec 2026');
  });
});

describe('fetchOk', () => {
  it('passes a 2xx response through', async () => {
    const response = await fetchOk('https://example.test/a', {}, 1000, async () => new Response('ok', { status: 206 }));
    expect(await response.text()).toBe('ok');
  });

  it('rejects a response that is not 2xx', async () => {
    await expect(fetchOk('https://example.test/a', {}, 1000, async () => new Response('', { status: 404 }))).rejects.toThrow('HTTP 404');
  });

  it('aborts a request that outlasts its timeout', async () => {
    const never = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(fetchOk('https://example.test/slow', {}, 5, never)).rejects.toThrow('aborted');
  });
});

describe('ProductWatcher', () => {
  function watch(source: ProductSource<string>, store: ProductStore = memoryStore()) {
    let wall = 0;
    const products: Product<string>[] = [];
    const statuses: [string | null, StatusTone | undefined][] = [];
    const watcher = new ProductWatcher(source, store, {
      refreshMs: 1000,
      freshMs: 4 * 3_600_000,
      now: () => NOW,
      wallMs: () => wall,
      onProduct: (product) => products.push(product),
      setStatus: (text, tone) => statuses.push([text, tone]),
    });
    return { watcher, products, statuses, advance: (ms: number) => (wall += ms) };
  }

  /** Let the watcher's background load settle. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('hands the layer its first product and sets the chip', async () => {
    const { watcher, products, statuses } = watch(fakeSource(online));
    await watcher.start();
    expect(products.map((p) => p.value)).toEqual(['data T1']);
    expect(statuses).toEqual([['live · 10 Nov 00:00 UTC', 'live']]);
  });

  it('rejects the first load when there is nothing to show', async () => {
    const { watcher } = watch(fakeSource({ snapshot: false }), NO_STORE);
    await expect(watcher.start()).rejects.toBeInstanceOf(AggregateError);
  });

  it('looks again only when the refresh interval has passed, and swaps in newer data', async () => {
    let newest = { tag: 'T0', validTime: T0 };
    const source = fakeSource({ latest: () => newest, download: (tag) => `data ${tag}` });
    const { watcher, products, advance } = watch(source);
    await watcher.start();
    advance(999);
    watcher.tick();
    await settle();
    expect(source.calls.filter((c) => c === 'latest')).toHaveLength(1);

    newest = { tag: 'T1', validTime: T1 };
    advance(1);
    watcher.tick();
    await settle();
    expect(products.map((p) => p.value)).toEqual(['data T0', 'data T1']);
  });

  it('leaves the picture alone when the provider has nothing newer', async () => {
    const source = fakeSource(online);
    const { watcher, products, advance } = watch(source);
    await watcher.start();
    advance(1000);
    watcher.tick();
    await settle();
    expect(products).toHaveLength(1);
    expect(source.calls).toEqual(['latest', 'download T1', 'latest']);
  });

  it('keeps the picture but owns up when a refresh finds the provider gone', async () => {
    let up = true;
    const source = fakeSource({
      latest: () => {
        if (!up) throw new Error('offline');
        return { tag: 'T1', validTime: T1 };
      },
      download: (tag) => `data ${tag}`,
    });
    const { watcher, products, statuses, advance } = watch(source);
    await watcher.start();
    up = false;
    advance(1000);
    watcher.tick();
    await settle();
    // Same picture: the stored copy is what is already showing.
    expect(products).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toEqual(['offline · cached 10 Nov 00:00 UTC', 'stale']);
  });

  it('stops looking once stopped', async () => {
    const source = fakeSource(online);
    const { watcher, advance } = watch(source);
    await watcher.start();
    watcher.stop();
    advance(5000);
    watcher.tick();
    await settle();
    expect(source.calls.filter((c) => c === 'latest')).toHaveLength(1);
  });
});

describe('cacheStore', () => {
  /** The slice of the Cache API the store uses. */
  function fakeCaches(): CacheStorage {
    const entries = new Map<string, Response>();
    const cache = {
      match: async (url: string) => entries.get(url)?.clone(),
      put: async (url: string, response: Response) => void entries.set(url, response),
    };
    return { open: async () => cache } as unknown as CacheStorage;
  }

  it('gives back what was put, with its tag and valid time', async () => {
    const store = cacheStore('test', fakeCaches());
    await store.put('clouds', { blob: new Blob(['pixels']), tag: '2026-11-09T23:00:00Z', validTime: T0 });
    const stored = await store.get('clouds');
    expect(stored?.tag).toBe('2026-11-09T23:00:00Z');
    expect(stored?.validTime).toEqual(T0);
    expect(await stored?.blob.text()).toBe('pixels');
    expect(await store.get('precipitation')).toBeNull();
  });

  it('is an empty store where the Cache API is missing or failing', async () => {
    expect(cacheStore('test', undefined)).toBe(NO_STORE);
    const failing = { open: vi.fn().mockRejectedValue(new Error('quota')) } as unknown as CacheStorage;
    const store = cacheStore('test', failing);
    await expect(store.put('clouds', { blob: new Blob(['x']), tag: 't', validTime: T0 })).resolves.toBeUndefined();
    expect(await store.get('clouds')).toBeNull();
  });
});
