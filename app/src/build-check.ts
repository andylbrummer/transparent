/**
 * A page left open across a deploy keeps running the build it loaded, but
 * the site serves only the newest build's files: the old build's code
 * chunks are gone (404). Every layer that page had not loaded yet then
 * fails to load. So when a layer fails, the page asks the site which
 * build it serves now, and if that is not the one running, reloads onto
 * it - once per build, so a stale cached page cannot loop.
 */

export const RELOADED_FOR_STORAGE_KEY = 'transparent-earth.reloaded-for-build';

/** The page's entry script, as written in its HTML; null if it names none. */
export function entryScriptOf(html: string): string | null {
  return /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/.exec(html)?.[1] ?? null;
}

export type BuildCheck = 'current' | 'reloading' | 'stale-after-reload';

export interface BuildCheckOptions {
  /** URL of the running entry script (main.ts's import.meta.url). */
  readonly runningEntryUrl: string;
  /** URL of the site's page, which names the entry script it serves now. */
  readonly pageUrl: string;
  fetchPage(url: string): Promise<string>;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  reload(): void;
}

/** Reload onto the build the site serves now if it is not the one running. */
export async function reloadIfRedeployed(options: BuildCheckOptions): Promise<BuildCheck> {
  const html = await options.fetchPage(options.pageUrl);
  const src = entryScriptOf(html);
  if (src === null) throw new Error(`build check: ${options.pageUrl} names no entry script`);
  const served = new URL(src, options.pageUrl).pathname;
  if (served === new URL(options.runningEntryUrl).pathname) return 'current';
  // Already reloaded for this build and still running the old one: the browser served a cached page.
  if (options.storage.getItem(RELOADED_FOR_STORAGE_KEY) === served) return 'stale-after-reload';
  options.storage.setItem(RELOADED_FOR_STORAGE_KEY, served);
  options.reload();
  return 'reloading';
}
