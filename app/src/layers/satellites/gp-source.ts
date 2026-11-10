/**
 * Where element sets come from, and how seldom CelesTrak is asked.
 *
 * CelesTrak looks for new GP data once every two hours and, since March
 * 2026, enforces one download per update: a second request for the same
 * group gets an HTTP 403 until the data changes, and an address that keeps
 * asking is firewalled. So:
 *
 * - a group is fetched only when its switch is first turned on;
 * - what comes back is kept in the Cache API and used for REFRESH_MS;
 * - the time of every attempt, good or bad, is written down before the
 *   request goes out, and nothing is asked again within MIN_INTERVAL_MS
 *   of it - a refusal or a timeout is never retried sooner;
 * - whenever the network is not used or does not answer, an older cached
 *   copy or the baked snapshot (app/public/space/gp/) is shown, and the
 *   chip says which.
 *
 * Element sets describe the orbit near their epoch. If the app clock is
 * pinned (?time=) nearer to the snapshot's epoch than to the present, the
 * snapshot is the better data and the network is not asked at all.
 */

import type { LayerContext } from '../types';
import { GP_CSV_FIRST_COLUMN } from './orbit-math';

export const CELESTRAK_GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';
/** CelesTrak's own update interval: never ask for a group twice within it. */
export const MIN_INTERVAL_MS = 2 * 3600 * 1000;
/** A cached copy this fresh is used without asking. The catalogue itself changes two or three times a day. */
export const REFRESH_MS = 3 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 45000;
const CACHE_NAME = 'transparent-earth-celestrak-v1';
const ATTEMPT_KEY = 'transparent-earth:celestrak-attempt:';
const FETCHED_AT_HEADER = 'x-fetched-at';

/** app/public/space/gp/manifest.json, written by tools/pipeline/generate_satellites_snapshot.py. */
export interface GpManifest {
  readonly groups: Readonly<Record<string, { readonly fetched: string; readonly count: number; readonly epochMedian: string }>>;
}

export interface GpSet {
  readonly group: string;
  readonly text: string;
  /** 'live': from CelesTrak within REFRESH_MS. 'cached': an older copy of theirs. 'baked': the app's snapshot. */
  readonly origin: 'live' | 'cached' | 'baked';
  /** When CelesTrak (or the pipeline, for the snapshot) was asked, ms. */
  readonly fetchedMs: number;
}

export type GpDecision = 'baked' | 'cache' | 'fetch';

/**
 * What to do for a group. `wallMs` is the real present (cache ages are
 * wall time whatever the app clock says), `clockMs` the app clock.
 */
export function decideGpSource(state: {
  readonly wallMs: number;
  readonly clockMs: number;
  readonly bakedEpochMs: number;
  readonly cachedAtMs: number | null;
  readonly lastAttemptMs: number | null;
}): GpDecision {
  const { wallMs, clockMs, bakedEpochMs, cachedAtMs, lastAttemptMs } = state;
  if (Math.abs(clockMs - bakedEpochMs) < Math.abs(clockMs - wallMs)) return 'baked';
  if (cachedAtMs !== null && wallMs - cachedAtMs < REFRESH_MS) return 'cache';
  // An attempt stamped in the future is a clock that was set back: wait it out rather than trust it.
  if (lastAttemptMs !== null && wallMs - lastAttemptMs < MIN_INTERVAL_MS) return cachedAtMs !== null ? 'cache' : 'baked';
  return 'fetch';
}

function readAttempt(group: string): number | null {
  try {
    const value = Number(localStorage.getItem(ATTEMPT_KEY + group));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeAttempt(group: string, wallMs: number): boolean {
  try {
    localStorage.setItem(ATTEMPT_KEY + group, String(wallMs));
    return true;
  } catch {
    return false;
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    return 'caches' in globalThis ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

const groupUrl = (group: string): string => `${CELESTRAK_GP_URL}?GROUP=${encodeURIComponent(group)}&FORMAT=csv`;

async function readCached(cache: Cache | null, group: string): Promise<{ text: string; fetchedMs: number } | null> {
  if (!cache) return null;
  try {
    const response = await cache.match(groupUrl(group));
    if (!response) return null;
    const fetchedMs = Number(response.headers.get(FETCHED_AT_HEADER));
    const text = await response.text();
    return Number.isFinite(fetchedMs) && fetchedMs > 0 && text.startsWith(GP_CSV_FIRST_COLUMN) ? { text, fetchedMs } : null;
  } catch {
    return null;
  }
}

async function fetchLive(group: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(groupUrl(group), { signal: controller.signal });
    const text = await response.text();
    // A refusal is prose explaining itself; pass its first words on to the console.
    if (!response.ok || !text.startsWith(GP_CSV_FIRST_COLUMN)) throw new Error(`CelesTrak ${group}: HTTP ${response.status}: ${text.slice(0, 160)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

let manifestPromise: Promise<GpManifest> | null = null;

export function loadManifest(context: LayerContext): Promise<GpManifest> {
  manifestPromise ??= context.fetchJson<GpManifest>(context.assetUrl('space/gp/manifest.json')).catch((error: unknown) => {
    manifestPromise = null;
    throw error;
  });
  return manifestPromise;
}

async function loadBaked(context: LayerContext, group: string, manifest: GpManifest): Promise<GpSet> {
  const response = await fetch(context.assetUrl(`space/gp/${group}.csv`));
  if (!response.ok) throw new Error(`space/gp/${group}.csv: HTTP ${response.status}`);
  return { group, text: await response.text(), origin: 'baked', fetchedMs: Date.parse(manifest.groups[group].fetched) };
}

const inFlight = new Map<string, Promise<GpSet>>();

/** The element sets of one CelesTrak group, from the best source the policy above allows. */
export function loadGpGroup(context: LayerContext, group: string): Promise<GpSet> {
  const running = inFlight.get(group);
  if (running) return running;
  const promise = resolveGroup(context, group).finally(() => inFlight.delete(group));
  inFlight.set(group, promise);
  return promise;
}

async function resolveGroup(context: LayerContext, group: string): Promise<GpSet> {
  const manifest = await loadManifest(context);
  const baked = manifest.groups[group];
  if (!baked) throw new Error(`no snapshot of the ${group} group`);
  const cache = await openCache();
  const cached = await readCached(cache, group);
  // Cache ages and the two-hour rule are about the real present, whatever the app clock shows.
  const wallMs = Date.now();
  const decision = decideGpSource({
    wallMs,
    clockMs: context.now().getTime(),
    bakedEpochMs: Date.parse(baked.epochMedian),
    cachedAtMs: cached?.fetchedMs ?? null,
    lastAttemptMs: readAttempt(group),
  });
  if (decision === 'cache' && cached) {
    return { group, text: cached.text, origin: wallMs - cached.fetchedMs < REFRESH_MS ? 'live' : 'cached', fetchedMs: cached.fetchedMs };
  }
  // Without somewhere to write the attempt down, the two-hour rule cannot be kept across reloads: do not ask.
  if (decision === 'fetch' && writeAttempt(group, wallMs)) {
    try {
      const text = await fetchLive(group);
      if (cache) {
        await cache
          .put(groupUrl(group), new Response(text, { headers: { 'content-type': 'text/plain', [FETCHED_AT_HEADER]: String(wallMs) } }))
          .catch(() => undefined);
      }
      return { group, text, origin: 'live', fetchedMs: wallMs };
    } catch (error) {
      console.error(`${group}: live element sets unavailable, not asking again for two hours`, error);
      if (cached) return { group, text: cached.text, origin: 'cached', fetchedMs: cached.fetchedMs };
    }
  }
  return loadBaked(context, group, manifest);
}
