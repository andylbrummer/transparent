/**
 * NOAA's Global Forecast System, straight from NOAA's open-data bucket.
 *
 * Each 1° forecast file is ~40 MB of GRIB2 holding ~700 fields; beside it
 * sits a text inventory (.idx) giving every field's byte offset. The app
 * reads the inventory and fetches only the fields it draws - about 50-80 kB
 * each - with HTTP range requests. No key, no rate limit, public domain.
 *
 * A run starts every six hours (00, 06, 12, 18 UTC) and reaches the bucket
 * some four hours later; its files step three hours through the forecast.
 * The app takes the newest run that has a file for the time it wants.
 */

import { decodeGrib2, splitGribMessages } from './grib2';
import { fetchOk, type FetchLike, type ProductSource } from './live';

export const GFS_BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';

const HOUR_MS = 3_600_000;
const CYCLE_HOURS = 6;
const STEP_HOURS = 3;
/** The 1° files run this far ahead at a three-hour step. */
const MAX_FORECAST_HOURS = 384;
/** A run's first files reach the bucket about this long after its nominal start. */
const PUBLICATION_DELAY_HOURS = 3.5;
/** Runs to try, newest first, should a run be late. */
const RUNS_TO_TRY = 4;

/** GFS's own 1° grid: 181 rows from 90°N to 90°S, 360 columns from 0°E eastward. */
export const GFS_NI = 360;
export const GFS_NJ = 181;

/** One field on the GFS 1° grid, row-major from the north-west corner at 0°E. */
export type GfsGrid = Float32Array;

export interface GfsRun {
  readonly cycle: Date;
  readonly forecastHours: number;
}

const two = (n: number): string => String(n).padStart(2, '0');

export function gfsFileUrl(run: GfsRun): string {
  const c = run.cycle;
  const day = `${c.getUTCFullYear()}${two(c.getUTCMonth() + 1)}${two(c.getUTCDate())}`;
  const hour = two(c.getUTCHours());
  return `${GFS_BUCKET}/gfs.${day}/${hour}/atmos/gfs.t${hour}z.pgrb2.1p00.f${String(run.forecastHours).padStart(3, '0')}`;
}

export function runValidTime(run: GfsRun): Date {
  return new Date(run.cycle.getTime() + run.forecastHours * HOUR_MS);
}

/** "2026-11-09T18Z+006": names one file of one run. */
export function runTag(run: GfsRun): string {
  return `${run.cycle.toISOString().slice(0, 13)}Z+${String(run.forecastHours).padStart(3, '0')}`;
}

/**
 * The files that could serve the instant `now`, best first: the newest run
 * likely to be published by then, at the forecast hour nearest `now`, then
 * each older run at the hour that reaches the same instant. Starting from
 * the run that should exist, not the one just begun, spares a request that
 * would only come back 404.
 */
export function candidateRuns(now: Date, count: number = RUNS_TO_TRY): GfsRun[] {
  const cycleMs = CYCLE_HOURS * HOUR_MS;
  const newest = Math.floor((now.getTime() - PUBLICATION_DELAY_HOURS * HOUR_MS) / cycleMs) * cycleMs;
  const runs: GfsRun[] = [];
  for (let i = 0; i < count; i++) {
    const cycle = newest - i * cycleMs;
    const forecastHours = Math.round((now.getTime() - cycle) / HOUR_MS / STEP_HOURS) * STEP_HOURS;
    if (forecastHours <= MAX_FORECAST_HOURS) runs.push({ cycle: new Date(cycle), forecastHours });
  }
  return runs;
}

export interface ByteRange {
  readonly start: number;
  /** Inclusive. */
  readonly end: number;
}

/**
 * A wgrib2 inventory, `n:offset:d=YYYYMMDDHH:VAR:level:forecast:` per
 * line, as "VAR:level" → byte range. A field ends where the next begins;
 * the file's last field, whose end the inventory does not give, is left out.
 */
export function parseInventory(text: string): Map<string, ByteRange> {
  const rows = text
    .split('\n')
    .map((line) => line.split(':'))
    .filter((row) => row.length >= 5 && /^\d+$/.test(row[1]));
  const ranges = new Map<string, ByteRange>();
  for (let i = 0; i + 1 < rows.length; i++) {
    const key = `${rows[i][3]}:${rows[i][4]}`;
    if (!ranges.has(key)) ranges.set(key, { start: Number(rows[i][1]), end: Number(rows[i + 1][1]) - 1 });
  }
  return ranges;
}

export interface GfsSnapshotMeta {
  readonly validTime: string;
  readonly grid: { readonly ni: number; readonly nj: number; readonly latFirst: number; readonly latStep: number; readonly lonFirst: number; readonly lonStep: number };
}

/** A baked field file: `fields` int8 grids one after another, value = byte × scale. */
export function decodeSnapshotGrids(bytes: ArrayBuffer, fields: number, scale: number): GfsGrid[] {
  const size = GFS_NI * GFS_NJ;
  if (bytes.byteLength !== fields * size) throw new Error(`snapshot grid is ${bytes.byteLength} bytes, not ${fields * size}`);
  const raw = new Int8Array(bytes);
  return Array.from({ length: fields }, (_unused, f) => {
    const grid = new Float32Array(size);
    for (let i = 0; i < size; i++) grid[i] = raw[f * size + i] * scale;
    return grid;
  });
}

export function assertGfsGrid(grid: GfsSnapshotMeta['grid']): void {
  const { ni, nj, latFirst, latStep, lonFirst, lonStep } = grid;
  if (ni !== GFS_NI || nj !== GFS_NJ || latFirst !== 90 || latStep !== -1 || lonFirst !== 0 || lonStep !== 1) {
    throw new Error(`not the GFS 1° grid: ${ni}×${nj} from ${latFirst}°, ${lonFirst}°`);
  }
}

export interface GfsSourceOptions {
  readonly storeKey: string;
  /** Inventory keys of the fields wanted, e.g. "UGRD:10 m above ground". */
  readonly fields: readonly string[];
  /** The baked fallback: the same fields, in the same order. */
  snapshot(): Promise<{ value: GfsGrid[]; validTime: Date }>;
  readonly fetchImpl?: FetchLike;
}

/** Inventories in flight or fetched, by URL: the wind and temperature layers want the same one. */
const inventoryTexts = new Map<string, Promise<string>>();

function fetchInventory(url: string, fetchImpl: FetchLike): Promise<string> {
  let text = inventoryTexts.get(url);
  if (!text) {
    text = fetchOk(url, {}, undefined, fetchImpl).then((response) => response.text());
    // A file's inventory never changes once it exists; a failure is not remembered.
    text.catch(() => inventoryTexts.delete(url));
    if (inventoryTexts.size >= 4) inventoryTexts.delete(inventoryTexts.keys().next().value as string);
    inventoryTexts.set(url, text);
  }
  return text;
}

/** The named fields of the newest GFS file for the app's time. */
export function gfsSource(options: GfsSourceOptions): ProductSource<GfsGrid[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  // The inventory read by latest(), kept for the download that follows it.
  const inventories = new Map<string, { run: GfsRun; ranges: Map<string, ByteRange> }>();
  return {
    storeKey: options.storeKey,
    async latest(now) {
      let lastError: unknown = new Error('no GFS run to try');
      for (const run of candidateRuns(now)) {
        let ranges: Map<string, ByteRange>;
        try {
          ranges = parseInventory(await fetchInventory(`${gfsFileUrl(run)}.idx`, fetchImpl));
        } catch (error) {
          // Not on the bucket yet (HTTP 404): the run before it will be.
          lastError = error;
          continue;
        }
        // An older run would lack it too: fail now, and never fetch the wrong bytes.
        for (const field of options.fields) {
          if (!ranges.has(field)) throw new Error(`GFS inventory has no "${field}"`);
        }
        inventories.clear();
        inventories.set(runTag(run), { run, ranges });
        return { tag: runTag(run), validTime: runValidTime(run) };
      }
      throw lastError;
    },
    async download(tag) {
      const inventory = inventories.get(tag);
      if (!inventory) throw new Error(`no inventory for GFS ${tag}`);
      const url = gfsFileUrl(inventory.run);
      const parts = await Promise.all(
        options.fields.map(async (field) => {
          const range = inventory.ranges.get(field) as ByteRange;
          const response = await fetchOk(url, { headers: { Range: `bytes=${range.start}-${range.end}` } }, undefined, fetchImpl);
          const bytes = await response.arrayBuffer();
          // A server that ignores Range would hand over the whole 40 MB file as a 200.
          if (bytes.byteLength !== range.end - range.start + 1) throw new Error(`GFS ${field}: got ${bytes.byteLength} bytes`);
          return bytes;
        })
      );
      return new Blob(parts);
    },
    async decode(blob) {
      const messages = splitGribMessages(new Uint8Array(await blob.arrayBuffer()));
      if (messages.length !== options.fields.length) throw new Error(`expected ${options.fields.length} GFS fields, got ${messages.length}`);
      return messages.map((message) => {
        const field = decodeGrib2(message);
        assertGfsGrid(field);
        return field.values;
      });
    },
    snapshot: options.snapshot,
  };
}
