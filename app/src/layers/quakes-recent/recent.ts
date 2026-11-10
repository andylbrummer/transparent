/**
 * Earthquakes of the past days, live from the USGS real-time feeds.
 *
 * Two feeds are read and merged: M4.5+ of the past 30 days, which is
 * complete worldwide, and M2.5+ of the past 7 days, which adds the small
 * events that dense networks (mostly in the US) locate. USGS rebuilds
 * them every minute; the app asks every five (spec/seismic.md).
 *
 * When USGS cannot be reached the layer says so and shows the best it
 * has: the last answer it got (kept in localStorage), else the snapshot
 * baked into the app (tools/pipeline/generate_quake_sets.py) - either one
 * under a 'stale' chip naming its date - else nothing, under 'error'.
 *
 * Ages are taken from the app clock, so with ?time= pinned in the past the
 * layer shows the feed as of that instant: later earthquakes are hidden.
 */

import * as THREE from 'three';
import { mergeEvents, parseEventCollection, usgsFeedUrl, type EventRecord, type UsgsFeedName } from '@transparent-earth/core';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import { QuakeMarkers, type QuakeMarker } from '../../render/quake-markers';
import { quakePointSizePx } from '../../render/quakes';
import type { LayerContext, LayerInstance, StatusTone } from '../types';

/** Widest first; a later feed's copy of an event replaces an earlier one. */
export const RECENT_FEEDS: readonly UsgsFeedName[] = ['4.5_month', '2.5_week'];
export const SNAPSHOT_PATH = 'geo/quakes-recent-snapshot.json';
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
export const CACHE_KEY = 'transparent-earth.quakes-recent';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
/** Earthquakes this recent ripple (spec: "recent events pulse"). */
export const PULSE_WINDOW_MS = DAY_MS;
const FEED_SPAN_MS = 30 * DAY_MS;

/** How many of the largest, and of the latest, get a label. */
export const LABELLED_LARGEST = 8;
export const LABELLED_LATEST = 4;
/** The latest are picked among events at least this big: smaller ones are local detail. */
const LATEST_MIN_MAGNITUDE = 4.5;

/** Ring diameter, CSS px: about twice the catalogue's dot and never tiny (M2.5 5 px, M6 9.5 px, M8 17 px). */
export function recentRingSizePx(magnitude: number): number {
  return 4 + 2.2 * quakePointSizePx(magnitude);
}

/** "just now", "12 min ago", "3 h ago", "2 d ago": whole units, rounded down. */
export function ageText(ageMs: number): string {
  if (ageMs < 60000) return 'just now';
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / 60000)} min ago`;
  if (ageMs < 2 * DAY_MS) return `${Math.floor(ageMs / HOUR_MS)} h ago`;
  return `${Math.floor(ageMs / DAY_MS)} d ago`;
}

/** "M6.1 · 35 km · 3 h ago". */
export function recentLabelText(event: EventRecord, nowMs: number): string {
  const depthKm = Math.max(0, Math.round(event.depthKm));
  return `M${event.mag.toFixed(1)} · ${depthKm} km · ${ageText(nowMs - Date.parse(event.time))}`;
}

/**
 * The events to label: the largest and the latest that have happened by
 * `nowMs`, each once, the largest first.
 */
export function pickLabelled(events: readonly EventRecord[], nowMs: number): EventRecord[] {
  const past = events.filter((e) => Date.parse(e.time) <= nowMs);
  const bySize = [...past].sort((a, b) => b.mag - a.mag || Date.parse(b.time) - Date.parse(a.time));
  const byTime = past
    .filter((e) => e.mag >= LATEST_MIN_MAGNITUDE)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const picked = new Set<EventRecord>([...bySize.slice(0, LABELLED_LARGEST), ...byTime.slice(0, LABELLED_LATEST)]);
  return bySize.filter((e) => picked.has(e));
}

export function toMarkers(events: readonly EventRecord[]): QuakeMarker[] {
  return events.map((e) => ({ lon: e.lon, lat: e.lat, depthKm: e.depthKm, mag: e.mag, timeMs: Date.parse(e.time) }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

/** "9 Nov 2026", UTC. */
export function utcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14:32 UTC". */
export function utcTime(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** Where the events on screen came from. */
export type RecentSource = 'live' | 'cache' | 'snapshot' | 'none';

export interface RecentData {
  readonly source: RecentSource;
  readonly events: readonly EventRecord[];
  /** When USGS built the data (the feeds' metadata.generated), epoch ms. */
  readonly generatedMs: number | null;
}

/** The chip for a state of the data. Never calls a fallback live. */
export function recentStatus(data: RecentData): { text: string; tone: StatusTone } {
  const when = data.generatedMs;
  switch (data.source) {
    case 'live':
      return { text: when === null ? 'live' : `live · ${utcTime(when)}`, tone: 'live' };
    case 'cache':
      return { text: when === null ? 'offline · last fetched data' : `offline · data of ${utcDate(when)} ${utcTime(when)}`, tone: 'stale' };
    case 'snapshot':
      return { text: when === null ? 'offline · snapshot' : `offline · snapshot ${utcDate(when)}`, tone: 'stale' };
    case 'none':
      return { text: 'no data · USGS unreachable', tone: 'error' };
  }
}

/** What the loader needs from the outside world, so tests can stand in for it. */
export interface RecentIo {
  /** GET and parse one of the USGS feeds; rejects on failure or timeout. */
  fetchFeed(feed: UsgsFeedName): Promise<unknown>;
  /** GET and parse the baked snapshot; rejects if absent. */
  fetchSnapshot(): Promise<unknown>;
  readCache(): string | null;
  writeCache(value: string): void;
  reportError(message: string, error: unknown): void;
}

interface CacheEntry {
  readonly generatedMs: number | null;
  readonly events: readonly EventRecord[];
}

function parseCache(text: string | null): CacheEntry | null {
  if (text === null) return null;
  try {
    const entry = JSON.parse(text) as Partial<CacheEntry>;
    if (!Array.isArray(entry.events) || entry.events.length === 0) return null;
    return { generatedMs: typeof entry.generatedMs === 'number' ? entry.generatedMs : null, events: entry.events };
  } catch {
    return null;
  }
}

/**
 * Fetch the feeds; failing that, fall back to the newest of what is kept:
 * `held` (what the layer already shows), the cache, the baked snapshot.
 */
export async function loadRecent(io: RecentIo, held: RecentData | null = null): Promise<RecentData> {
  try {
    const collections = (await Promise.all(RECENT_FEEDS.map((feed) => io.fetchFeed(feed)))).map((json) =>
      parseEventCollection(json)
    );
    const generated = collections.map((c) => c.generatedMs).filter((ms): ms is number => ms !== null);
    const data: RecentData = {
      source: 'live',
      events: mergeEvents(...collections.map((c) => c.events)),
      generatedMs: generated.length > 0 ? Math.max(...generated) : null,
    };
    try {
      io.writeCache(JSON.stringify({ generatedMs: data.generatedMs, events: data.events } satisfies CacheEntry));
    } catch (error) {
      // A full or forbidden localStorage only costs the offline fallback.
      io.reportError('recent earthquakes: could not cache the feeds', error);
    }
    return data;
  } catch (error) {
    io.reportError('recent earthquakes: USGS feeds unavailable', error);
  }

  const candidates: RecentData[] = [];
  if (held && held.source !== 'none') candidates.push({ ...held, source: held.source === 'live' ? 'cache' : held.source });
  const cached = parseCache(io.readCache());
  if (cached) candidates.push({ source: 'cache', ...cached });
  try {
    const snapshot = parseEventCollection(await io.fetchSnapshot());
    candidates.push({ source: 'snapshot', events: snapshot.events, generatedMs: snapshot.generatedMs });
  } catch (error) {
    io.reportError('recent earthquakes: no baked snapshot', error);
  }
  candidates.sort((a, b) => (b.generatedMs ?? 0) - (a.generatedMs ?? 0));
  return candidates[0] ?? { source: 'none', events: [], generatedMs: null };
}

/** The loader's IO in the browser. Exported for the seismic wave playback, which offers the latest large event from the same feeds and cache. */
export function browserIo(context: Pick<LayerContext, 'fetchJson' | 'assetUrl'>): RecentIo {
  return {
    fetchFeed: (feed) => context.fetchJson<unknown>(usgsFeedUrl(feed), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    fetchSnapshot: () => context.fetchJson<unknown>(context.assetUrl(SNAPSHOT_PATH)),
    readCache: () => {
      try {
        return localStorage.getItem(CACHE_KEY);
      } catch {
        return null;
      }
    },
    writeCache: (value) => localStorage.setItem(CACHE_KEY, value),
    reportError: (message, error) => console.error(message, error),
  };
}

export async function createRecentQuakesLayer(context: LayerContext): Promise<LayerInstance> {
  const io = browserIo(context);
  const markers = new QuakeMarkers({
    name: 'quakes-recent',
    sizePx: recentRingSizePx,
    pulseWindowS: PULSE_WINDOW_MS / 1000,
    fadeOverS: FEED_SPAN_MS / 1000,
    oldestAlpha: 0.45,
    ringWidthPx: 1.5,
    pixelRatio: context.skyUniforms.uPixelRatio,
  });
  context.earthRoot.add(markers.object);

  let data: RecentData = { source: 'none', events: [], generatedMs: null };
  let labels: LabelGroup | null = null;
  let labelMinute = NaN;
  let visible = false;
  let disposed = false;
  let refreshing = false;
  let lastAttemptMs = -Infinity;

  const rebuildLabels = (nowMs: number): void => {
    labels?.remove();
    const picked = pickLabelled(data.events, nowMs);
    const group: GroupLabel[] = picked.map((event, i) => ({
      text: recentLabelText(event, nowMs),
      priority: i,
      position: ecefAtDepth(event.lon, event.lat, Math.max(0, event.depthKm), new THREE.Vector3()),
    }));
    labels = context.addLabels({
      // Just ahead of the catalogue's M8+ names: what happened this week wins the spot.
      rank: LABEL_KIND_ORDER.indexOf('quake') - 0.5,
      style: { fontPx: 11, color: '#ffffff', bold: true, offsetYPx: 15 },
      frame: 'earth',
      labels: group,
    });
    labels.setVisible(visible);
    labelMinute = Math.floor(nowMs / 60000);
  };

  const refresh = async (): Promise<void> => {
    if (refreshing || disposed) return;
    refreshing = true;
    lastAttemptMs = performance.now();
    try {
      const next = await loadRecent(io, data);
      if (disposed) return;
      data = next;
      markers.setMarkers(toMarkers(data.events));
      rebuildLabels(context.now().getTime());
      const status = recentStatus(data);
      context.setStatus(status.text, status.tone);
    } finally {
      refreshing = false;
    }
  };

  await refresh();
  // Wall time, not the app clock: this paces requests, it dates nothing.
  const timer = setInterval(() => {
    if (visible) void refresh();
  }, REFRESH_INTERVAL_MS);

  return {
    setVisible(next) {
      visible = next;
      markers.object.visible = next;
      labels?.setVisible(next);
      // Back on after a while off: do not show old news until the next tick.
      if (next && performance.now() - lastAttemptMs > REFRESH_INTERVAL_MS) void refresh();
    },
    update(frame) {
      const nowMs = frame.date.getTime();
      markers.update(nowMs, frame.deltaMs);
      // The ages in the labels move on by the minute.
      if (Math.floor(nowMs / 60000) !== labelMinute) rebuildLabels(nowMs);
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      labels?.remove();
      markers.dispose();
    },
  };
}
