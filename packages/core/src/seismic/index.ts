/**
 * Seismic catalog client and playback clock.
 * Pure functions — no browser APIs (IDB, fetch) here.
 */

export interface EventRecord {
  readonly id: string;
  readonly time: string;     // ISO 8601
  readonly lat: number;
  readonly lon: number;
  readonly depthKm: number;
  readonly mag: number;
  readonly name: string;
}

export interface CatalogQuery {
  readonly startTime: string;
  readonly endTime: string;
  readonly minMagnitude?: number;
  readonly maxMagnitude?: number;
  readonly minLatitude?: number;
  readonly maxLatitude?: number;
  readonly minLongitude?: number;
  readonly maxLongitude?: number;
}

/**
 * Build USGS FDSN GeoJSON query URL from a CatalogQuery.
 */
export function buildQueryUrl(baseUrl: string, query: CatalogQuery): string {
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: query.startTime,
    endtime: query.endTime,
  });

  if (query.minMagnitude !== undefined) params.set('minmagnitude', String(query.minMagnitude));
  if (query.maxMagnitude !== undefined) params.set('maxmagnitude', String(query.maxMagnitude));
  if (query.minLatitude !== undefined) params.set('minlatitude', String(query.minLatitude));
  if (query.maxLatitude !== undefined) params.set('maxlatitude', String(query.maxLatitude));
  if (query.minLongitude !== undefined) params.set('minlongitude', String(query.minLongitude));
  if (query.maxLongitude !== undefined) params.set('maxlongitude', String(query.maxLongitude));

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Normalize a USGS GeoJSON feature into an EventRecord.
 *
 * Returns null unless every field that positions the event is genuinely
 * present. A substituted coordinate or magnitude would render a phantom
 * quake at 0°N 0°E rather than surfacing the bad record, so missing data
 * rejects the feature outright.
 *
 * `place` is the one exception: it is a display label, not geometry, so a
 * missing one falls back without discarding an otherwise valid event.
 */
export function normalizeEvent(feature: unknown): EventRecord | null {
  if (typeof feature !== 'object' || feature === null) return null;

  const f = feature as Record<string, unknown>;
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const geom = (f.geometry ?? {}) as Record<string, unknown>;
  const coords = Array.isArray(geom.coordinates) ? (geom.coordinates as unknown[]) : [];

  const rawId = f.id ?? props.code;
  if (rawId === undefined || rawId === null || String(rawId) === '') return null;

  // USGS reports origin time as epoch milliseconds.
  const timeMs = toFiniteNumber(props.time);
  if (timeMs === null) return null;

  const lon = toFiniteNumber(coords[0]);
  const lat = toFiniteNumber(coords[1]);
  const depth = toFiniteNumber(coords[2]);
  const mag = toFiniteNumber(props.mag);

  if (lon === null || lat === null || depth === null || mag === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return {
    id: String(rawId),
    time: new Date(timeMs).toISOString(),
    lat,
    lon,
    depthKm: depth, // USGS reports depth in kilometres
    mag,
    name: String(props.place ?? 'Unknown location'),
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Playback clock: maps wall time to simulation time.
 */
export interface ClockState {
  readonly running: boolean;
  readonly wallTimeMs: number;      // current wall timestamp
  readonly simTimeMs: number;       // current simulation timestamp
  readonly compression: number;     // sim seconds per wall second (1 = real-time)
  readonly activeEvents: readonly EventRecord[];
}

export const DEFAULT_CLOCK: ClockState = {
  running: false,
  wallTimeMs: 0,
  simTimeMs: 0,
  compression: 60, // 1s wall = 1min sim
  activeEvents: [],
};

/**
 * Advance the clock by a wall-time delta.
 */
export function tickClock(state: ClockState, deltaWallMs: number): ClockState {
  if (!state.running) return state;

  const deltaSimMs = deltaWallMs * state.compression;
  const newSimTime = state.simTimeMs + deltaSimMs;

  // Cull active events: keep only those whose origin time is within the sim window
  const windowStart = newSimTime - 86400000; // 24h window
  const culled = state.activeEvents
    .filter((e) => new Date(e.time).getTime() >= windowStart)
    .slice(-8); // keep last 8

  return {
    ...state,
    wallTimeMs: state.wallTimeMs + deltaWallMs,
    simTimeMs: newSimTime,
    activeEvents: culled,
  };
}

/**
 * Seek the clock to a specific simulation time.
 */
export function seekClock(state: ClockState, targetSimTimeMs: number): ClockState {
  return {
    ...state,
    simTimeMs: targetSimTimeMs,
  };
}

/**
 * Set the compression ratio.
 * Preserves the current simulation time position.
 */
export function setCompression(state: ClockState, compression: number): ClockState {
  return {
    ...state,
    compression: Math.max(1, compression),
  };
}

/**
 * Toggle play/pause.
 */
export function togglePlay(state: ClockState): ClockState {
  return { ...state, running: !state.running };
}

/**
 * Load events into the clock's active window.
 */
export function loadEvents(state: ClockState, events: readonly EventRecord[]): ClockState {
  const sorted = [...events].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );
  return {
    ...state,
    activeEvents: sorted.slice(-8),
  };
}
