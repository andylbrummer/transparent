/**
 * Tropical cyclones under way, from GDACS - the Global Disaster Alert and
 * Coordination System of the European Commission and the United Nations.
 * GDACS re-publishes every warning centre's advisories in one shape for the
 * whole world: NHC and CPHC for the Atlantic and the eastern and central
 * Pacific, JTWC for the rest, WMO regional centres where they are quicker.
 *
 * NHC's own CurrentStorms.json would be the first choice for its basins but
 * sends no CORS header, so a browser cannot read it; GDACS's API does
 * (access-control-allow-origin: *), covers every basin, and keeps its
 * archive, so a clock pinned in the past gets the storms of that week.
 *
 * Three kinds of request:
 *   the list   every cyclone with an advisory in a window of days;
 *   a timeline per storm: each advisory's position and wind, then the
 *              forecast points of the latest advisory;
 *   a geometry per storm still under way, for the forecast's cone of
 *              uncertainty (a 300 kB answer - asked only when a storm has
 *              a new advisory).
 * A storm is fetched again only when its advisory number has moved on.
 */

const API = 'https://www.gdacs.org/gdacsapi/api';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** How far back a storm's last advisory may lie and its track still be shown. */
export const LOOKBACK_DAYS = 10;
/** GDACS gives winds in metres per second. */
const KT_PER_MS = 3600 / 1852;

export interface TrackPoint {
  /** Epoch ms of the advisory, or of the instant forecast. */
  readonly timeMs: number;
  readonly lon: number;
  readonly lat: number;
  /** Sustained wind as the advisory gives it, knots. */
  readonly windKt: number;
  /** A point of the latest advisory's forecast, not an observed position. */
  readonly forecast: boolean;
}

export interface LiveStorm {
  /** GDACS event id. */
  readonly id: number;
  /** GDACS episode: goes up with each advisory. */
  readonly episode: number;
  readonly name: string;
  /** The warning centre GDACS took the advisories from: "NOAA", "JTWC", "RSMC"… */
  readonly source: string;
  /** Advisories in time order, then the forecast in time order. */
  readonly points: readonly TrackPoint[];
  /**
   * The forecast's cone of uncertainty: closed rings of [lon, lat] - one,
   * or the two halves of a cone GDACS has cut at the date line - or null.
   */
  readonly cone: readonly (readonly (readonly [number, number])[])[] | null;
}

export interface ListedStorm {
  readonly id: number;
  readonly episode: number;
  readonly name: string;
  readonly source: string;
  /** Time of the latest advisory. */
  readonly toMs: number;
  /** When GDACS last touched the event. */
  readonly modifiedMs: number;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Every cyclone with an advisory in the LOOKBACK_DAYS up to `nowMs`. */
export function listUrl(nowMs: number): string {
  return (
    `${API}/events/geteventlist/SEARCH?eventlist=TC&fromdate=${day(nowMs - LOOKBACK_DAYS * DAY_MS)}` +
    `&todate=${day(nowMs + DAY_MS)}&alertlevel=Green;Orange;Red`
  );
}

export function episodeUrl(storm: { id: number; episode: number }): string {
  return `${API}/events/getepisodedata?eventtype=TC&eventid=${storm.id}&episodeid=${storm.episode}`;
}

export function geometryUrl(storm: { id: number; episode: number }): string {
  return `${API}/polygons/getgeometry?eventtype=TC&eventid=${storm.id}&episodeid=${storm.episode}`;
}

/** GDACS writes UTC without saying so: "2026-11-10T03:35:03". */
export function parseIsoUtc(text: unknown): number {
  if (typeof text !== 'string') return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A timeline's advisory time, UTC: "10 Nov 2026 00:00", or in GDACS's
 * older archive "11/3/2013 6:00:00 AM" (month first).
 */
export function parseAdvisoryTime(text: unknown): number {
  if (typeof text !== 'string') return NaN;
  const named = /^(\d{1,2}) (\w{3}) (\d{4}) (\d{1,2}):(\d{2})$/.exec(text.trim());
  if (named) {
    const month = MONTHS.indexOf(named[2]);
    return month < 0 ? NaN : Date.UTC(Number(named[3]), month, Number(named[1]), Number(named[4]), Number(named[5]));
  }
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(text.trim());
  if (!numeric) return NaN;
  const hour = (Number(numeric[4]) % 12) + (numeric[7] === 'PM' ? 12 : 0);
  return Date.UTC(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2]), hour, Number(numeric[5]), Number(numeric[6]));
}

/**
 * "CEMPAKA-26" → "Cempaka", "THREE-C-26" → "Three-C"; a storm known only
 * by a number ("02-20262027-27") is "TC 02-20262027".
 */
export function stormName(eventName: string): string {
  const bare = eventName.trim().replace(/-\d{2}$/, '');
  if (bare === '') return 'Unnamed';
  if (/^\d/.test(bare)) return `TC ${bare}`;
  return bare
    .split('-')
    .map((part) => (part.length > 1 ? part[0] + part.slice(1).toLowerCase() : part))
    .join('-');
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const features = (json: unknown): Json[] => (isObject(json) && Array.isArray(json.features) ? json.features.filter(isObject) : []);

/** The storms of a list answer, latest advisory first. Throws if it is not a feature collection. */
export function parseEventList(json: unknown): ListedStorm[] {
  if (!isObject(json) || !Array.isArray(json.features)) throw new Error('GDACS list: not a feature collection');
  const storms: ListedStorm[] = [];
  for (const feature of features(json)) {
    const p = feature.properties;
    if (!isObject(p) || p.eventtype !== 'TC') continue;
    const id = Number(p.eventid);
    const episode = Number(p.episodeid);
    const toMs = parseIsoUtc(p.todate);
    if (!Number.isFinite(id) || !Number.isFinite(episode) || Number.isNaN(toMs)) continue;
    const modifiedMs = parseIsoUtc(p.datemodified);
    storms.push({
      id,
      episode,
      name: stormName(String(p.eventname ?? '')),
      source: String(p.source ?? ''),
      toMs,
      modifiedMs: Number.isNaN(modifiedMs) ? toMs : modifiedMs,
    });
  }
  return storms.sort((a, b) => b.toMs - a.toMs);
}

/** Where an episode answer says its timeline is; null if it has none. */
export function timelineUrlOf(json: unknown): string | null {
  const impacts = isObject(json) && isObject(json.properties) ? json.properties.impacts : null;
  if (!Array.isArray(impacts)) return null;
  for (const impact of impacts) {
    const url = isObject(impact) && isObject(impact.resource) ? impact.resource.timeline : null;
    if (typeof url === 'string' && url.startsWith(`${API}/`)) return url;
  }
  return null;
}

/** The advisories of a timeline answer, then its forecast, each in time order. */
export function parseTimeline(json: unknown): TrackPoint[] {
  const items = isObject(json) && isObject(json.channel) ? json.channel.item : null;
  if (!Array.isArray(items)) throw new Error('GDACS timeline: no items');
  const points: TrackPoint[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    const timeMs = parseAdvisoryTime(item.advisory_datetime);
    const lon = Number(item.longitude);
    const lat = Number(item.latitude);
    const wind = Number(item.wind_speed);
    if (Number.isNaN(timeMs) || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    points.push({
      timeMs,
      lon: lon > 180 || lon < -180 ? ((((lon + 180) % 360) + 360) % 360) - 180 : lon,
      lat,
      windKt: Number.isFinite(wind) ? Math.round((wind * KT_PER_MS) / 5) * 5 : 0,
      forecast: String(item.actual).toLowerCase() !== 'true',
    });
  }
  const inOrder = (a: TrackPoint, b: TrackPoint): number => a.timeMs - b.timeMs;
  const observed = points.filter((p) => !p.forecast).sort(inOrder);
  const last = observed.length > 0 ? observed[observed.length - 1].timeMs : -Infinity;
  // A forecast for an hour already observed is superseded.
  const forecast = points.filter((p) => p.forecast && p.timeMs > last).sort(inOrder);
  return [...observed, ...forecast];
}

function readRing(ring: unknown): [number, number][] | null {
  if (!Array.isArray(ring)) return null;
  const out: [number, number][] = [];
  for (const vertex of ring) {
    if (Array.isArray(vertex) && Number.isFinite(vertex[0]) && Number.isFinite(vertex[1])) out.push([Number(vertex[0]), Number(vertex[1])]);
  }
  return out.length >= 4 ? out : null;
}

/** The cone of uncertainty in a geometry answer: its outer ring or rings, or null. */
export function parseCone(json: unknown): [number, number][][] | null {
  for (const feature of features(json)) {
    const p = feature.properties;
    const g = feature.geometry;
    if (!isObject(p) || p.Class !== 'Poly_Cones' || !isObject(g) || !Array.isArray(g.coordinates)) continue;
    const polygons: unknown[] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const rings = polygons
      .map((polygon) => readRing(Array.isArray(polygon) ? polygon[0] : null))
      .filter((ring): ring is [number, number][] => ring !== null);
    if (rings.length > 0) return rings;
  }
  return null;
}

/** Where the storms on screen came from. */
export type LiveSource = 'live' | 'cache' | 'snapshot' | 'none';

export interface LiveData {
  readonly source: LiveSource;
  readonly storms: readonly LiveStorm[];
  /** When GDACS last changed any of them, epoch ms; for a snapshot, when it was baked. */
  readonly dataMs: number | null;
  /** Storms GDACS listed whose details could not be read this time. */
  readonly missing: number;
}

/** What the loader needs from the outside world, so tests can stand in for it. */
export interface LiveIo {
  /** GET and parse a GDACS answer; rejects on failure or timeout. */
  fetchJson(url: string): Promise<unknown>;
  /** GET and parse the baked snapshot; rejects if absent. */
  fetchSnapshot(): Promise<unknown>;
  readCache(): string | null;
  writeCache(value: string): void;
  reportError(message: string, error: unknown): void;
}

interface Stored {
  readonly dataMs: number | null;
  readonly storms: readonly LiveStorm[];
}

function isStorm(value: unknown): value is LiveStorm {
  return isObject(value) && typeof value.id === 'number' && typeof value.episode === 'number' && Array.isArray(value.points);
}

/** A cache entry or the baked snapshot (which says `generated` where the cache says `dataMs`). */
export function parseStored(json: unknown): Stored | null {
  if (!isObject(json) || !Array.isArray(json.storms)) return null;
  const generated = typeof json.generated === 'string' ? Date.parse(json.generated) : NaN;
  const dataMs = typeof json.dataMs === 'number' ? json.dataMs : Number.isNaN(generated) ? null : generated;
  return { dataMs, storms: json.storms.filter(isStorm) };
}

/** A storm whose latest advisory is this recent may still have a forecast worth its cone. */
const CONE_WINDOW_MS = 48 * HOUR_MS;
/** The list is asked for at most this many storms' details: the world has never had more at once. */
const MAX_STORMS = 24;

async function loadStorm(io: LiveIo, listed: ListedStorm, nowMs: number): Promise<LiveStorm> {
  const timelineUrl = timelineUrlOf(await io.fetchJson(episodeUrl(listed)));
  if (!timelineUrl) throw new Error(`GDACS: ${listed.name} has no timeline`);
  const points = parseTimeline(await io.fetchJson(timelineUrl));
  if (points.length === 0) throw new Error(`GDACS: ${listed.name} has an empty timeline`);
  let cone: [number, number][][] | null = null;
  if (points.some((p) => p.forecast) && Math.abs(nowMs - listed.toMs) <= CONE_WINDOW_MS) {
    try {
      cone = parseCone(await io.fetchJson(geometryUrl(listed)));
    } catch (error) {
      // The track and forecast stand without it.
      io.reportError(`tropical cyclones: no cone for ${listed.name}`, error);
    }
  }
  return { id: listed.id, episode: listed.episode, name: listed.name, source: listed.source, points, cone };
}

/**
 * Ask GDACS for the storms around `nowMs`; failing that, fall back to the
 * newest of what is kept: `held` (what the layer already shows), the
 * cache, the baked snapshot. Storms already held at the same advisory are
 * not fetched again.
 */
export async function loadLive(io: LiveIo, nowMs: number, held: LiveData | null = null): Promise<LiveData> {
  const cached = parseStored(safeJson(io.readCache()));
  try {
    const listed = parseEventList(await io.fetchJson(listUrl(nowMs))).slice(0, MAX_STORMS);
    const known = new Map<string, LiveStorm>();
    for (const storm of [...(cached?.storms ?? []), ...(held?.storms ?? [])]) known.set(`${storm.id}/${storm.episode}`, storm);
    let missing = 0;
    const storms: LiveStorm[] = [];
    await Promise.all(
      listed.map(async (entry) => {
        const have = known.get(`${entry.id}/${entry.episode}`);
        if (have) {
          storms.push({ ...have, name: entry.name });
          return;
        }
        try {
          storms.push(await loadStorm(io, entry, nowMs));
        } catch (error) {
          missing++;
          io.reportError(`tropical cyclones: no details for ${entry.name}`, error);
        }
      })
    );
    if (listed.length > 0 && storms.length === 0) throw new Error('GDACS: no storm could be read');
    storms.sort((a, b) => a.id - b.id);
    const data: LiveData = {
      source: 'live',
      storms,
      dataMs: listed.length > 0 ? Math.max(...listed.map((s) => s.modifiedMs)) : null,
      missing,
    };
    try {
      io.writeCache(JSON.stringify({ dataMs: data.dataMs, storms: data.storms } satisfies Stored));
    } catch (error) {
      // A full or forbidden localStorage only costs the offline fallback.
      io.reportError('tropical cyclones: could not cache the storms', error);
    }
    return data;
  } catch (error) {
    io.reportError('tropical cyclones: GDACS unavailable', error);
  }

  const candidates: LiveData[] = [];
  if (held && held.source !== 'none') candidates.push({ ...held, source: held.source === 'live' ? 'cache' : held.source });
  if (cached) candidates.push({ source: 'cache', ...cached, missing: 0 });
  try {
    const snapshot = parseStored(await io.fetchSnapshot());
    if (snapshot) candidates.push({ source: 'snapshot', ...snapshot, missing: 0 });
  } catch (error) {
    io.reportError('tropical cyclones: no baked snapshot', error);
  }
  // The one whose storms lie nearest the clock: a cache filled at another pinned time is no use.
  const distance = (data: LiveData): number => {
    const times = data.storms.flatMap((s) => s.points.filter((p) => !p.forecast).map((p) => Math.abs(p.timeMs - nowMs)));
    return times.length > 0 ? Math.min(...times) : Infinity;
  };
  candidates.sort((a, b) => distance(a) - distance(b));
  return candidates[0] ?? { source: 'none', storms: [], dataMs: null, missing: 0 };
}

function safeJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
