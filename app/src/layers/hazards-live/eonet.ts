/**
 * NASA EONET (Earth Observatory Natural Event Tracker) v3 as the app reads
 * it: two queries, each event reduced to one marker, and the
 * live-then-fallback loading the recent earthquakes use.
 *
 * Asking EONET for everything "open" returns thousands of wildfires nobody
 * closed, so the questions are split:
 *
 *   ongoing  open volcanoes, icebergs and severe storms - things that last
 *   recent   every other category over the past RECENT_DAYS days, open or
 *            closed - fires and floods, which come and go daily
 *
 * tools/pipeline/generate_hazards_snapshot.py asks the same two and bakes
 * the answer, in the reduced form below, as the offline fallback.
 */

import type { StatusTone } from '../types';

export const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
export const RECENT_DAYS = 14;
/** The same strings as QUERIES in tools/pipeline/generate_hazards_snapshot.py (its test checks). */
export const EONET_QUERIES: readonly string[] = [
  'status=open&category=volcanoes,seaLakeIce,severeStorms',
  'status=all&days=14&category=wildfires,floods,drought,dustHaze,landslides,snow,tempExtremes,waterColor,manmade,earthquakes',
];
export const SNAPSHOT_PATH = 'geo/hazards-snapshot.json';
export const CACHE_KEY = 'transparent-earth.hazards-live';
/** EONET's sources report daily at best; twice an hour keeps up with any of them. */
export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/** One event as one marker: where it was last reported. */
export interface HazardEvent {
  readonly id: string;
  readonly title: string;
  /** EONET category id: 'wildfires', 'volcanoes', 'seaLakeIce', 'severeStorms', 'floods', ... */
  readonly category: string;
  readonly lon: number;
  readonly lat: number;
  /** First and latest report, ISO UTC. */
  readonly first: string;
  readonly date: string;
  /** When EONET closed the event, or null while it goes on. */
  readonly closed: string | null;
  /** Latest magnitude and its unit as EONET gives them: 'hectare', 'acres', 'kts', 'NM^2'. */
  readonly mag: number | null;
  readonly unit: string | null;
  /** EONET's id of the source: 'GDACS', 'IRWIN', 'SIVolcano', 'NATICE', 'JTWC', ... */
  readonly from: string | null;
}

interface RawGeometry {
  readonly type?: unknown;
  readonly coordinates?: unknown;
  readonly date?: unknown;
  readonly magnitudeValue?: unknown;
  readonly magnitudeUnit?: unknown;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** [lon, lat] of a Point, or of the middle of a Polygon's bounding box; null for anything else. */
export function geometryPosition(geometry: RawGeometry): [number, number] | null {
  const c = geometry.coordinates;
  if (geometry.type === 'Point' && Array.isArray(c) && isNumber(c[0]) && isNumber(c[1])) return [c[0], c[1]];
  if (geometry.type === 'Polygon' && Array.isArray(c) && Array.isArray(c[0])) {
    const ring = (c[0] as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && isNumber(p[0]) && isNumber(p[1]));
    if (ring.length === 0) return null;
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  }
  return null;
}

/** One EONET event as a marker, or null if it has no usable place, date or category. */
export function reduceEvent(raw: unknown): HazardEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const event = raw as Record<string, unknown>;
  const categories = event.categories as { id?: unknown }[] | undefined;
  const category = Array.isArray(categories) ? categories[0]?.id : undefined;
  if (typeof event.id !== 'string' || typeof event.title !== 'string' || typeof category !== 'string') return null;
  const geometries = (Array.isArray(event.geometry) ? (event.geometry as RawGeometry[]) : [])
    .filter((g) => typeof g.date === 'string' && !Number.isNaN(Date.parse(g.date)) && geometryPosition(g) !== null)
    .sort((a, b) => Date.parse(a.date as string) - Date.parse(b.date as string));
  if (geometries.length === 0) return null;
  const latest = geometries[geometries.length - 1];
  const [lon, lat] = geometryPosition(latest) as [number, number];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const sources = event.sources as { id?: unknown }[] | undefined;
  const from = Array.isArray(sources) ? sources[0]?.id : undefined;
  return {
    id: event.id,
    title: event.title,
    category,
    lon,
    lat,
    first: geometries[0].date as string,
    date: latest.date as string,
    closed: typeof event.closed === 'string' ? event.closed : null,
    mag: isNumber(latest.magnitudeValue) ? latest.magnitudeValue : null,
    unit: typeof latest.magnitudeUnit === 'string' ? latest.magnitudeUnit : null,
    from: typeof from === 'string' ? from : null,
  };
}

/** The events of several EONET answers, each once, latest report first. Throws on an answer without an event list. */
export function reduceAnswers(answers: readonly unknown[]): HazardEvent[] {
  const byId = new Map<string, HazardEvent>();
  for (const answer of answers) {
    const events = (answer as { events?: unknown } | null)?.events;
    if (!Array.isArray(events)) throw new Error('EONET answer has no event list');
    for (const raw of events) {
      const event = reduceEvent(raw);
      if (event) byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
}

export type HazardSource = 'live' | 'cache' | 'snapshot' | 'none';

export interface HazardData {
  readonly source: HazardSource;
  readonly events: readonly HazardEvent[];
  /** When the list was fetched from EONET (it carries no build time of its own), epoch ms. */
  readonly fetchedMs: number | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

/** "9 Nov 2026", UTC. */
export function utcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function utcTime(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** The chip for a state of the data. Never calls a fallback live. */
export function hazardStatus(data: HazardData): { text: string; tone: StatusTone } {
  const when = data.fetchedMs;
  const count = `${data.events.length} events`;
  switch (data.source) {
    case 'live':
      return { text: when === null ? `live · ${count}` : `live · ${count} · ${utcTime(when)}`, tone: 'live' };
    case 'cache':
      return { text: when === null ? 'offline · last fetched list' : `offline · list of ${utcDate(when)} ${utcTime(when)}`, tone: 'stale' };
    case 'snapshot':
      return { text: when === null ? 'offline · snapshot' : `offline · snapshot ${utcDate(when)}`, tone: 'stale' };
    case 'none':
      return { text: 'no data · EONET unreachable', tone: 'error' };
  }
}

/** What the loader needs from the outside world, so tests can stand in for it. */
export interface HazardIo {
  /** GET and parse one EONET query; rejects on failure or timeout. */
  fetchQuery(query: string): Promise<unknown>;
  /** GET and parse the baked snapshot; rejects if absent. */
  fetchSnapshot(): Promise<unknown>;
  readCache(): string | null;
  writeCache(value: string): void;
  /** Wall-clock now, epoch ms: stamps what was just fetched. */
  wallNow(): number;
  reportError(message: string, error: unknown): void;
}

interface Stored {
  readonly fetchedMs: number | null;
  readonly events: readonly HazardEvent[];
}

function parseStored(value: unknown): Stored | null {
  const stored = value as { fetchedMs?: unknown; generated?: unknown; events?: unknown } | null;
  if (!stored || !Array.isArray(stored.events) || stored.events.length === 0) return null;
  const generated = typeof stored.generated === 'string' ? Date.parse(stored.generated) : NaN;
  const fetchedMs = isNumber(stored.fetchedMs) ? stored.fetchedMs : Number.isNaN(generated) ? null : generated;
  return { fetchedMs, events: stored.events as HazardEvent[] };
}

/**
 * Ask EONET; failing that, fall back to the newest of what is kept: `held`
 * (what the layer already shows), the cache, the baked snapshot.
 */
export async function loadHazards(io: HazardIo, held: HazardData | null = null): Promise<HazardData> {
  try {
    const answers = await Promise.all(EONET_QUERIES.map((query) => io.fetchQuery(query)));
    const data: HazardData = { source: 'live', events: reduceAnswers(answers), fetchedMs: io.wallNow() };
    try {
      io.writeCache(JSON.stringify({ fetchedMs: data.fetchedMs, events: data.events } satisfies Stored));
    } catch (error) {
      // A full or forbidden localStorage only costs the offline fallback.
      io.reportError('natural events: could not cache the list', error);
    }
    return data;
  } catch (error) {
    io.reportError('natural events: EONET unavailable', error);
  }

  const candidates: HazardData[] = [];
  if (held && held.source !== 'none') candidates.push({ ...held, source: held.source === 'live' ? 'cache' : held.source });
  try {
    const text = io.readCache();
    const cached = text === null ? null : parseStored(JSON.parse(text));
    if (cached) candidates.push({ source: 'cache', ...cached });
  } catch {
    // An unreadable cache is no cache.
  }
  try {
    const snapshot = parseStored(await io.fetchSnapshot());
    if (snapshot) candidates.push({ source: 'snapshot', ...snapshot });
  } catch (error) {
    io.reportError('natural events: no baked snapshot', error);
  }
  candidates.sort((a, b) => (b.fetchedMs ?? 0) - (a.fetchedMs ?? 0));
  return candidates[0] ?? { source: 'none', events: [], fetchedMs: null };
}
