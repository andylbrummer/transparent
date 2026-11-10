/**
 * Where each weather layer's data comes from: the live endpoint and the
 * baked snapshot behind it. See docs/data-sources/weather.md for why these
 * providers and not others.
 */

import { gibsDomainUrl, gibsTime, latestInDomain, parseTimeDomain, wmsGlobeUrl } from './gibs';
import { canvasBlob, composeGlobe, type TiledProduct } from './gibs-tiles';
import { assertGfsGrid, decodeSnapshotGrids, gfsSource, type GfsGrid, type GfsSnapshotMeta } from './gfs';
import { decodeImage, fetchOk, type FetchLike, type ProductSource } from './live';

/** What tools/pipeline/generate_weather_snapshot.py writes as snapshot.json. */
export interface WeatherSnapshot {
  readonly generated: string;
  readonly clouds: { readonly file: string; readonly validTime: string };
  readonly precipitation: { readonly file: string; readonly validTime: string };
  readonly gfs: GfsSnapshotMeta & Record<GfsSnapshotField, { readonly file: string; readonly scale: number }>;
  readonly nightLights: { readonly file: string; readonly year: number };
}

export type GfsSnapshotField = 'wind-10m' | 'wind-250hpa' | 'temperature';

/** What a source needs from the app: baked files and the network. */
export interface SourceContext {
  assetUrl(path: string): string;
  readonly fetchImpl?: FetchLike;
}

const SNAPSHOT_DIR = 'weather/';

async function fetchSnapshot(context: SourceContext): Promise<WeatherSnapshot> {
  const response = await fetchOk(context.assetUrl(`${SNAPSHOT_DIR}snapshot.json`), {}, undefined, context.fetchImpl);
  return (await response.json()) as WeatherSnapshot;
}

async function fetchAsset(context: SourceContext, file: string): Promise<Response> {
  return fetchOk(context.assetUrl(SNAPSHOT_DIR + file), {}, undefined, context.fetchImpl);
}

function parseTime(text: string): Date {
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new Error(`unreadable time "${text}"`);
  return new Date(ms);
}

// --- clouds ------------------------------------------------------------------

export const NOWCOAST_WMS = 'https://nowcoast.noaa.gov/geoserver/satellite/wms';
export const CLOUD_LAYER = 'global_longwave_imagery_mosaic';
/** The mosaic stops at these latitudes: beyond them a geostationary satellite sees only the limb. */
export const CLOUD_LATITUDE_LIMIT_DEG = 72.7;

/** How far before the oldest listed time still counts as asking for that time. */
const LISTED_SPAN_SLACK_MS = 3_600_000;

export const IMAGE_WIDTH = 2048;
export const IMAGE_HEIGHT = 1024;

/** The times a WMS layer offers, from the capabilities document's time dimension. */
export function parseWmsTimes(capabilitiesXml: string, layer: string): Date[] {
  const at = capabilitiesXml.indexOf(`<Name>${layer}</Name>`);
  if (at < 0) throw new Error(`WMS capabilities list no layer "${layer}"`);
  // The layer's own block ends where the next layer's name begins.
  const next = capabilitiesXml.indexOf('<Layer', at);
  const block = capabilitiesXml.slice(at, next < 0 ? undefined : next);
  const dimension = /<Dimension name="time"[^>]*>([^<]+)<\/Dimension>/.exec(block);
  if (!dimension) throw new Error(`WMS layer "${layer}" lists no times`);
  return dimension[1].split(',').map((text) => parseTime(text.trim()));
}

/**
 * The listed time to show at the instant `at`: the nearest one - or, when
 * `at` is before everything listed (a clock pinned to the past, for which
 * the service keeps nothing), simply the newest there is.
 */
export function nearestTime(times: readonly Date[], at: Date): Date {
  if (times.length === 0) throw new Error('no times to choose from');
  const distance = (time: Date): number => Math.abs(time.getTime() - at.getTime());
  const nearest = times.reduce((best, time) => (distance(time) < distance(best) ? time : best));
  const newest = times.reduce((best, time) => (time > best ? time : best));
  return distance(nearest) > LISTED_SPAN_SLACK_MS && at < nearest ? newest : nearest;
}

/**
 * NOAA/NESDIS GMGSI: one infrared image of the whole Earth between about
 * 73°S and 73°N, stitched hourly from the geostationary ring (GOES East
 * and West, Meteosat, Himawari). nowCOAST keeps only the last few hours.
 */
export function cloudSource(context: SourceContext): ProductSource<HTMLImageElement> {
  return {
    storeKey: 'clouds',
    async latest(now) {
      const response = await fetchOk(`${NOWCOAST_WMS}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`, {}, undefined, context.fetchImpl);
      const time = nearestTime(parseWmsTimes(await response.text(), CLOUD_LAYER), now);
      return { tag: gibsTime(time, false), validTime: time };
    },
    async download(tag) {
      const url = wmsGlobeUrl(NOWCOAST_WMS, CLOUD_LAYER, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, format: 'jpeg', time: tag });
      return (await fetchOk(url, {}, undefined, context.fetchImpl)).blob();
    },
    decode: decodeImage,
    async snapshot() {
      const meta = (await fetchSnapshot(context)).clouds;
      const blob = await (await fetchAsset(context, meta.file)).blob();
      return { value: await decodeImage(blob), validTime: parseTime(meta.validTime) };
    },
  };
}

// --- precipitation -------------------------------------------------------------

export const PRECIPITATION_LAYER = 'IMERG_Precipitation_Rate_30min';
/** As GIBS's WMTS capabilities list it (2026-11-10). */
export const PRECIPITATION_TILES: TiledProduct = { layer: PRECIPITATION_LAYER, matrixSet: '2km', ext: 'png' };

/**
 * NASA GPM IMERG: rain and snow rate over the whole globe every half hour,
 * merged from the constellation's microwave and infrared sensors. GIBS
 * publishes the early run some five hours after the fact and keeps all of
 * it back to 1998, so a pinned time gets that time's rain.
 */
export function precipitationSource(context: SourceContext): ProductSource<HTMLImageElement> {
  return {
    storeKey: 'precipitation',
    async latest(now) {
      const response = await fetchOk(gibsDomainUrl(PRECIPITATION_LAYER), {}, undefined, context.fetchImpl);
      const latest = latestInDomain(parseTimeDomain(await response.text()), now);
      if (!latest) throw new Error(`${PRECIPITATION_LAYER} has nothing at or before ${now.toISOString()}`);
      return { tag: gibsTime(latest.time, latest.daily), validTime: latest.time };
    },
    async download(tag) {
      // From map tiles, not GIBS's WMS, which has been seen to hang; kept lossless so the colours match the legend.
      return canvasBlob(await composeGlobe(PRECIPITATION_TILES, tag, IMAGE_WIDTH, context.fetchImpl), 'image/png');
    },
    decode: decodeImage,
    async snapshot() {
      const meta = (await fetchSnapshot(context)).precipitation;
      const blob = await (await fetchAsset(context, meta.file)).blob();
      return { value: await decodeImage(blob), validTime: parseTime(meta.validTime) };
    },
  };
}

// --- GFS fields ----------------------------------------------------------------

/** Inventory keys of the fields behind each GFS-driven layer, in the order the snapshot files hold them. */
export const GFS_FIELDS: Record<GfsSnapshotField, readonly string[]> = {
  'wind-10m': ['UGRD:10 m above ground', 'VGRD:10 m above ground'],
  'wind-250hpa': ['UGRD:250 mb', 'VGRD:250 mb'],
  temperature: ['TMP:2 m above ground'],
};

const KELVIN = 273.15;

/** One GFS-driven layer's fields: winds in m/s, temperature in °C (live or baked alike). */
export function gfsFieldSource(context: SourceContext, name: GfsSnapshotField): ProductSource<GfsGrid[]> {
  const fields = GFS_FIELDS[name];
  const source = gfsSource({
    storeKey: `gfs-${name}`,
    fields,
    fetchImpl: context.fetchImpl,
    async snapshot() {
      const { gfs } = await fetchSnapshot(context);
      assertGfsGrid(gfs.grid);
      const bytes = await (await fetchAsset(context, gfs[name].file)).arrayBuffer();
      return { value: decodeSnapshotGrids(bytes, fields.length, gfs[name].scale), validTime: parseTime(gfs.validTime) };
    },
  });
  if (name !== 'temperature') return source;
  return {
    ...source,
    // GRIB carries kelvin; the snapshot was baked in °C.
    decode: async (blob) => (await source.decode(blob)).map((grid) => grid.map((kelvin) => kelvin - KELVIN)),
  };
}
