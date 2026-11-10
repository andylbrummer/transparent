/**
 * Live space weather from NOAA's Space Weather Prediction Center, and the
 * models driven by it. Pure parsing and arithmetic, plus the fetch that
 * falls back to the baked snapshot (app/public/space/space-weather.json,
 * tools/pipeline/generate_space_weather_snapshot.py).
 *
 * SWPC's JSON is public domain, sent with CORS headers and a 60 s cache
 * lifetime; the products here change every one to five minutes and are
 * asked for every few minutes, only while their layer is switched on.
 */

import { timeoutSignal } from '../sun/feed';
import type { LayerContext, StatusTone } from '../types';

export const SWPC = 'https://services.swpc.noaa.gov';
export const SOLAR_WIND_PATH = '/products/geospace/propagated-solar-wind-1-hour.json';
export const KP_PATH = '/products/noaa-planetary-k-index.json';
export const OVATION_PATH = '/json/ovation_aurora_latest.json';
export const HEMI_POWER_PATH = '/text/aurora-nowcast-hemi-power.txt';
const TIMEOUT_MS = 20000;
/** Readings further than this from the app clock are not "now": the chip says when they are from. */
export const CURRENT_WINDOW_MS = 3 * 3600 * 1000;

/** The solar wind arriving at the Earth: SWPC's measurements at L1, carried forward to the bow shock. */
export interface SolarWind {
  /** When the measured plasma reaches the Earth, ms. */
  readonly timeMs: number;
  readonly speedKmS: number;
  /** Protons per cm³. */
  readonly densityCm3: number;
  /** North-south component of the interplanetary magnetic field (GSM), nT. */
  readonly bzNt: number;
}

export interface SpaceWeatherSnapshot {
  readonly solarWind: { readonly time: string; readonly speedKmS: number; readonly densityCm3: number; readonly bzNt: number };
  readonly kp: { readonly time: string; readonly kp: number } | null;
  readonly aurora: {
    readonly observed: string;
    readonly forecast: string;
    readonly hemisphericPowerGw: { readonly north: number; readonly south: number } | null;
  };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** SWPC time tags come with and without a zone; all are UTC. */
export function parseSwpcTime(tag: unknown): number {
  if (typeof tag !== 'string') return NaN;
  const iso = tag.replace(' ', 'T').replace('_', 'T');
  return Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

/**
 * The newest solar wind of propagated-solar-wind-1-hour.json: the mean of
 * the last ten minutes with all three readings, so one noisy minute does
 * not move the magnetopause. Null if the feed holds no complete reading.
 */
export function parseSolarWind(json: unknown): SolarWind | null {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return null;
  const header = json[0] as unknown[];
  const column = (name: string): number => header.indexOf(name);
  const iSpeed = column('speed');
  const iDensity = column('density');
  const iBz = column('bz');
  const iArrival = column('propagated_time_tag');
  const iTime = column('time_tag');
  if (iSpeed < 0 || iDensity < 0 || iBz < 0 || iTime < 0) return null;
  const rows: SolarWind[] = [];
  for (let i = json.length - 1; i >= 1 && rows.length < 10; i--) {
    const row = json[i] as unknown[];
    if (!Array.isArray(row)) continue;
    const arrival = parseSwpcTime(row[iArrival]);
    const timeMs = Number.isFinite(arrival) ? arrival : parseSwpcTime(row[iTime]);
    const speedKmS = row[iSpeed];
    const densityCm3 = row[iDensity];
    const bzNt = row[iBz];
    if (!Number.isFinite(timeMs) || !finite(speedKmS) || !finite(densityCm3) || !finite(bzNt)) continue;
    // Fill values and instrument glitches: outside anything the solar wind does.
    if (speedKmS < 150 || speedKmS > 3000 || densityCm3 <= 0 || densityCm3 > 300 || Math.abs(bzNt) > 200) continue;
    rows.push({ timeMs, speedKmS, densityCm3, bzNt });
  }
  if (rows.length === 0) return null;
  const mean = (pick: (row: SolarWind) => number): number => rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
  return { timeMs: rows[0].timeMs, speedKmS: mean((r) => r.speedKmS), densityCm3: mean((r) => r.densityCm3), bzNt: mean((r) => r.bzNt) };
}

/**
 * Dynamic pressure of the solar wind, nPa, from proton density (cm⁻³) and
 * speed (km/s): ρv² with 4% helium by number, the factor 1.94e-6 of
 * Tsyganenko's Geopack.
 */
export function dynamicPressureNPa(densityCm3: number, speedKmS: number): number {
  return 1.94e-6 * densityCm3 * speedKmS * speedKmS;
}

export interface Magnetopause {
  /** Distance of the nose, on the line to the Sun, Earth radii. */
  readonly r0: number;
  /** Flaring of the tail. */
  readonly alpha: number;
}

/**
 * The magnetopause of Shue et al. (1998), "Magnetopause location under
 * extreme solar wind conditions", J. Geophys. Res. 103, 17691,
 * doi:10.1029/98JA01103: a surface of revolution about the Earth-Sun line,
 * r = r0 (2 / (1 + cos θ))^α, fitted to spacecraft crossings as a function
 * of the IMF's Bz (nT) and the wind's dynamic pressure (nPa).
 */
export function shueMagnetopause(bzNt: number, pressureNPa: number): Magnetopause {
  return {
    r0: (10.22 + 1.29 * Math.tanh(0.184 * (bzNt + 8.14))) * pressureNPa ** (-1 / 6.6),
    alpha: (0.58 - 0.007 * bzNt) * (1 + 0.024 * Math.log(pressureNPa)),
  };
}

/** Distance of the Shue surface, Earth radii, at angle `theta` (radians) from the direction of the Sun. */
export function shueRadius(model: Magnetopause, theta: number): number {
  return model.r0 * (2 / (1 + Math.cos(theta))) ** model.alpha;
}

/** The newest planetary K index of noaa-planetary-k-index.json. */
export function parseKp(json: unknown): { timeMs: number; kp: number } | null {
  if (!Array.isArray(json)) return null;
  for (let i = json.length - 1; i >= 0; i--) {
    const row = json[i] as unknown;
    // Rows are objects now; the feed used to be a table with a header row.
    const record = Array.isArray(row) ? { time_tag: row[0] as unknown, Kp: Number(row[1]) } : (row as { time_tag?: unknown; Kp?: unknown });
    const timeMs = parseSwpcTime(record?.time_tag);
    const kp = typeof record?.Kp === 'string' ? Number(record.Kp) : record?.Kp;
    if (Number.isFinite(timeMs) && finite(kp) && kp >= 0 && kp <= 9) return { timeMs, kp };
  }
  return null;
}

/** The last line of aurora-nowcast-hemi-power.txt: gigawatts falling on each polar region. */
export function parseHemisphericPower(text: string): { north: number; south: number } | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
  const fields = lines[lines.length - 1]?.trim().split(/\s+/);
  if (!fields || fields.length < 4) return null;
  const north = Number(fields[2]);
  const south = Number(fields[3]);
  return Number.isFinite(north) && Number.isFinite(south) ? { north, south } : null;
}

export async function fetchSwpcJson(context: LayerContext, path: string): Promise<unknown> {
  const { signal, cancel } = timeoutSignal(TIMEOUT_MS);
  try {
    return await context.fetchJson<unknown>(SWPC + path, { signal });
  } finally {
    cancel();
  }
}

export async function fetchSwpcText(path: string): Promise<string> {
  const { signal, cancel } = timeoutSignal(TIMEOUT_MS);
  try {
    const response = await fetch(SWPC + path, { signal });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return await response.text();
  } finally {
    cancel();
  }
}

let snapshotPromise: Promise<SpaceWeatherSnapshot> | null = null;

export function loadSpaceWeatherSnapshot(context: LayerContext): Promise<SpaceWeatherSnapshot> {
  snapshotPromise ??= context.fetchJson<SpaceWeatherSnapshot>(context.assetUrl('space/space-weather.json')).catch((error: unknown) => {
    snapshotPromise = null;
    throw error;
  });
  return snapshotPromise;
}

const clock = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const day = (ms: number, year = false): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: year ? 'numeric' : undefined, timeZone: 'UTC' });

/** The chip for a reading: live with its time; from when, if not now; or the snapshot. */
export function readingStatus(what: string, timeMs: number, fromNetwork: boolean, clockMs: number, detail = ''): { text: string; tone: StatusTone } {
  const tail = detail === '' ? '' : ` · ${detail}`;
  if (!fromNetwork) return { text: `offline · ${what} of ${day(timeMs, true)}${tail}`, tone: 'stale' };
  if (Math.abs(timeMs - clockMs) > CURRENT_WINDOW_MS) return { text: `${what} of ${day(timeMs)} ${clock(timeMs)} UTC${tail}`, tone: 'stale' };
  return { text: `live · ${clock(timeMs)} UTC${tail}`, tone: 'live' };
}
