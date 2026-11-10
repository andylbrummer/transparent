/**
 * Natural events in progress, live from NASA EONET (./eonet.ts): fires,
 * eruptions, storms, floods and icebergs as one symbol each where they
 * were last reported.
 *
 * When EONET cannot be reached the layer says so and shows the best it
 * has: its last answer (kept in localStorage), else the snapshot baked
 * into the app (tools/pipeline/generate_hazards_snapshot.py) - either one
 * under a 'stale' chip naming its date - else nothing, under 'error'.
 *
 * Everything dated is read against the app clock: an event whose latest
 * report is later than the clock is hidden (with ?time= pinned in the past
 * the list is shown as far as it was then known), ages in the labels count
 * from the clock, and fires and floods fade as their last report ages.
 * EONET's own "closed" date is not used for that: its GDACS-fed fires and
 * floods are closed the day they are opened, which says nothing of the fire.
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import {
  CACHE_KEY,
  EONET_URL,
  REFRESH_INTERVAL_MS,
  SNAPSHOT_PATH,
  hazardStatus,
  RECENT_DAYS,
  loadHazards,
  type HazardData,
  type HazardEvent,
  type HazardIo,
} from './eonet';
import { HAZARD_CATEGORIES, OTHER_HAZARD, type HazardCategory } from './layer';

/** The two answers together are under a megabyte; EONET takes a second or two. */
const FETCH_TIMEOUT_MS = 30_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HECTARES_PER_ACRE = 0.404686;
/** What a fire or flood last reported RECENT_DAYS ago keeps of its opacity. */
export const OLDEST_ALPHA = 0.45;
/** Kinds asked for as "open": shown at full strength however old their last report. */
const ONGOING = ['volcanoes', 'seaLakeIce', 'severeStorms'];
/** Labels per kind: every storm and eruption, the largest or latest of the rest. */
export const LABEL_LIMITS: Readonly<Record<string, number>> = {
  severeStorms: 12,
  volcanoes: 40,
  wildfires: 8,
  floods: 6,
  seaLakeIce: 6,
};
const OTHER_LABEL_LIMIT = 6;
/** Ages in the labels are in hours and days: ten minutes between rewrites is exact enough. */
const LABEL_INTERVAL_MS = 10 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function categoryOf(event: HazardEvent): HazardCategory {
  return HAZARD_CATEGORIES.find((c) => c.ids.includes(event.category)) ?? OTHER_HAZARD;
}

/** The events whose latest report is at or before `nowMs`. */
export function eventsBy(events: readonly HazardEvent[], nowMs: number): HazardEvent[] {
  return events.filter((e) => Date.parse(e.date) <= nowMs);
}

/** Opacity: full for what is in progress; fires and floods fade over the fortnight since their last report. */
export function hazardAlpha(event: HazardEvent, nowMs: number): number {
  if (ONGOING.includes(event.category)) return 1;
  const age = Math.min(Math.max((nowMs - Date.parse(event.date)) / (RECENT_DAYS * DAY_MS), 0), 1);
  return 1 - (1 - OLDEST_ALPHA) * age;
}

/** Burnt area in hectares, whichever unit the source reported; null if it gave none. */
export function fireHectares(event: HazardEvent): number | null {
  if (event.mag === null) return null;
  if (event.unit === 'hectare') return event.mag;
  if (event.unit === 'acres') return event.mag * HECTARES_PER_ACRE;
  return null;
}

/** Symbol size, CSS px. Fires by area (5.5 at 100 ha, 12.5 at 100,000), icebergs by area, the rest fixed per kind. */
export function hazardSizePx(event: HazardEvent): number {
  switch (event.category) {
    case 'wildfires': {
      const hectares = fireHectares(event);
      return hectares === null ? 5.5 : Math.min(Math.max(5.5 + (7 / 3) * Math.log10(hectares / 100), 5.5), 12.5);
    }
    case 'volcanoes':
      return 12;
    case 'severeStorms':
      return 15;
    case 'floods':
      return 10;
    case 'seaLakeIce':
      return event.mag === null ? 7 : Math.min(Math.max(7 + 2.5 * Math.log10(event.mag / 10), 7), 12);
    default:
      return 9;
  }
}

/** "just now", "5 h ago", "3 d ago": whole units, rounded down. */
export function ageText(ageMs: number): string {
  if (ageMs < HOUR_MS) return 'just now';
  if (ageMs < 2 * DAY_MS) return `${Math.floor(ageMs / HOUR_MS)} h ago`;
  return `${Math.floor(ageMs / DAY_MS)} d ago`;
}

/** "Jun 2026", UTC. */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * GDACS titles end in its event number ("Wildfire in China 1033270") and the
 * Smithsonian's say "Volcano" under a volcano's symbol: neither is for a map.
 */
export function cleanTitle(title: string): string {
  return title.replace(/\s+\d{5,}$/, '').replace(/ Volcano(?=,|$)/, '');
}

/** The magnitude with its unit as the source gave it: "5,123 ha", "683 acres", "35 kt", "90 nmi²". */
export function magnitudeText(event: HazardEvent): string | null {
  if (event.mag === null || event.unit === null) return null;
  const value = Math.round(event.mag).toLocaleString('en-US');
  const unit: Record<string, string> = { hectare: 'ha', acres: 'acres', kts: 'kt', 'NM^2': 'nmi²' };
  return `${value} ${unit[event.unit] ?? event.unit}`;
}

/**
 * "▲ Fuego, Guatemala · since Jan 2002", "● Wildfire in Australia · 5,123 ha · 2 d ago",
 * "◯ Tropical Storm Pena · 35 kt · 5 h ago".
 */
export function hazardLabelText(event: HazardEvent, nowMs: number): string {
  const parts = [cleanTitle(event.title)];
  const magnitude = magnitudeText(event);
  if (magnitude) parts.push(magnitude);
  if (event.category === 'volcanoes') parts.push(`since ${monthYear(event.first)}`);
  else parts.push(ageText(nowMs - Date.parse(event.date)));
  return `${categoryOf(event).symbol} ${parts.join(' · ')}`;
}

/**
 * The events to label, most important first: storms, eruptions, then the
 * largest fires, the latest floods, the largest icebergs, the rest - each
 * kind up to its limit.
 */
export function pickLabelled(events: readonly HazardEvent[]): HazardEvent[] {
  const order = ['severeStorms', 'volcanoes', 'wildfires', 'floods', 'seaLakeIce'];
  const weight = (e: HazardEvent): number =>
    e.category === 'wildfires' ? (fireHectares(e) ?? 0) : e.category === 'seaLakeIce' ? (e.mag ?? 0) : Date.parse(e.date);
  const picked: HazardEvent[] = [];
  for (const category of order) {
    const of = events.filter((e) => e.category === category).sort((a, b) => weight(b) - weight(a));
    picked.push(...of.slice(0, LABEL_LIMITS[category]));
  }
  const others = events.filter((e) => !order.includes(e.category)).sort((a, b) => weight(b) - weight(a));
  picked.push(...others.slice(0, OTHER_LABEL_LIMIT));
  return picked;
}

export function hazardMarkers(events: readonly HazardEvent[], nowMs: number): GeoMarker[] {
  // The rarer kinds go on last, over the crowd of fires; within a kind, large under small.
  const rank = (e: HazardEvent): number => {
    const index = HAZARD_CATEGORIES.indexOf(categoryOf(e));
    return index < 0 ? HAZARD_CATEGORIES.length : index;
  };
  const drawOrder = [0, 5, 3, 4, 1, 2];
  return [...events]
    .sort((a, b) => drawOrder.indexOf(rank(a)) - drawOrder.indexOf(rank(b)) || hazardSizePx(b) - hazardSizePx(a))
    .map((e) => {
      const category = categoryOf(e);
      return {
        lon: e.lon,
        lat: e.lat,
        shape: category.shape,
        color: category.color,
        sizePx: hazardSizePx(e),
        alpha: hazardAlpha(e, nowMs),
      };
    });
}

function browserIo(context: LayerContext): HazardIo {
  return {
    fetchQuery: (query) => context.fetchJson<unknown>(`${EONET_URL}?${query}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    fetchSnapshot: () => context.fetchJson<unknown>(context.assetUrl(SNAPSHOT_PATH)),
    readCache: () => {
      try {
        return localStorage.getItem(CACHE_KEY);
      } catch {
        return null;
      }
    },
    writeCache: (value) => localStorage.setItem(CACHE_KEY, value),
    // Wall time on purpose: it stamps a download, it dates no event.
    wallNow: () => Date.now(),
    reportError: (message, error) => console.error(message, error),
  };
}

export async function createHazardsLayer(context: LayerContext): Promise<LayerInstance> {
  const io = browserIo(context);
  const markers = new GeoMarkers('hazards-live', context.skyUniforms.uPixelRatio);
  context.earthRoot.add(markers.object);

  let data: HazardData = { source: 'none', events: [], fetchedMs: null };
  let labels: LabelGroup | null = null;
  let labelSlot = NaN;
  let visible = false;
  let disposed = false;
  let refreshing = false;
  let lastAttemptMs = -Infinity;

  const rebuild = (nowMs: number): void => {
    const current = eventsBy(data.events, nowMs);
    labelSlot = Math.floor(nowMs / LABEL_INTERVAL_MS);
    markers.setMarkers(hazardMarkers(current, nowMs));
    labels?.remove();
    const group: GroupLabel[] = pickLabelled(current).map((event, i) => ({
      text: hazardLabelText(event, nowMs),
      priority: i,
      position: ecefAtAltitude(event.lon, event.lat, 0, new THREE.Vector3()),
    }));
    labels = context.addLabels({
      // What is happening now goes ahead of the standing volcano names.
      rank: LABEL_KIND_ORDER.indexOf('quake') - 0.45,
      style: { fontPx: 11, color: '#ffe3d2', bold: true, offsetYPx: 14 },
      frame: 'earth',
      labels: group,
    });
    labels.setVisible(visible);
  };

  const refresh = async (): Promise<void> => {
    if (refreshing || disposed) return;
    refreshing = true;
    lastAttemptMs = performance.now();
    try {
      const next = await loadHazards(io, data);
      if (disposed) return;
      data = next;
      rebuild(context.now().getTime());
      const status = hazardStatus(data);
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
      // A new slot: the ages have moved on, and a pinned or stepped clock may have changed what is known.
      if (Math.floor(nowMs / LABEL_INTERVAL_MS) !== labelSlot) rebuild(nowMs);
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      labels?.remove();
      markers.dispose();
    },
  };
}
