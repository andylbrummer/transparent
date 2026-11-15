import { describe, it, expect, vi } from 'vitest';
import { RELOADED_FOR_STORAGE_KEY, entryScriptOf, reloadIfRedeployed, type BuildCheckOptions } from './build-check';

const page = (entry: string): string =>
  `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script></head><body></body></html>`;

function options(servedEntry: string, saved: string | null = null) {
  const stored = new Map<string, string>(saved === null ? [] : [[RELOADED_FOR_STORAGE_KEY, saved]]);
  const reload = vi.fn();
  const fetchPage = vi.fn(async () => page(servedEntry));
  const opts: BuildCheckOptions = {
    runningEntryUrl: 'https://example.org/transparent/assets/index-OLD.js',
    pageUrl: 'https://example.org/transparent/',
    fetchPage,
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) },
    reload,
  };
  return { opts, reload, stored, fetchPage };
}

describe('entryScriptOf', () => {
  it('finds the module entry script, whatever attributes sit between', () => {
    expect(entryScriptOf(page('./assets/index-ABC.js'))).toBe('./assets/index-ABC.js');
    expect(entryScriptOf('<script type="module" src="/src/main.ts"></script>')).toBe('/src/main.ts');
    expect(entryScriptOf('<script src="analytics.js"></script>')).toBeNull();
  });
});

describe('reloadIfRedeployed', () => {
  it('stays when the site serves the build that is running', async () => {
    const { opts, reload, fetchPage } = options('./assets/index-OLD.js');
    expect(await reloadIfRedeployed(opts)).toBe('current');
    expect(fetchPage).toHaveBeenCalledWith('https://example.org/transparent/');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads onto a newer build, noting which', async () => {
    const { opts, reload, stored } = options('./assets/index-NEW.js');
    expect(await reloadIfRedeployed(opts)).toBe('reloading');
    expect(reload).toHaveBeenCalledOnce();
    expect(stored.get(RELOADED_FOR_STORAGE_KEY)).toBe('/transparent/assets/index-NEW.js');
  });

  it('does not reload twice for the same build: a cached page would loop', async () => {
    const { opts, reload } = options('./assets/index-NEW.js', '/transparent/assets/index-NEW.js');
    expect(await reloadIfRedeployed(opts)).toBe('stale-after-reload');
    expect(reload).not.toHaveBeenCalled();
  });

  it('fails loudly on a page with no entry script', async () => {
    const { opts } = options('');
    opts.fetchPage = async () => '<html></html>';
    await expect(reloadIfRedeployed(opts)).rejects.toThrow('names no entry script');
  });
});
