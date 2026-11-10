/**
 * The Earth as two weather satellites see it now: GOES East and GOES West
 * GeoColor from NASA GIBS, a new picture every ten minutes.
 *
 * GIBS serves it as map tiles (WMTS), not as one image, so the picture of
 * the globe is put together here: each satellite's tiles drawn onto one
 * equirectangular canvas, the two joined midway between them. Everything
 * the satellites cannot see - Europe, Africa, most of Asia - stays
 * transparent, and the base map shows there.
 *
 * GeoColor (NOAA/CIRA) is true colour by day. By night it is infrared
 * cloud over a fixed picture of city lights: the lights are not live.
 */

import { GIBS_WMTS, gibsTime, latestInDomain, parseTimeDomain } from './gibs';
import { decodeImage, fetchOk, type FetchLike, type ProductSource } from './live';

export interface GeoSatellite {
  readonly id: 'west' | 'east';
  readonly name: string;
  readonly layer: string;
  /** Longitude it stands over, degrees east. */
  readonly longitude: number;
}

/** West first: it is drawn first, and East laid over it east of the seam. */
export const GEO_SATELLITES: readonly GeoSatellite[] = [
  { id: 'west', name: 'GOES West', layer: 'GOES-West_ABI_GeoColor', longitude: -137.2 },
  { id: 'east', name: 'GOES East', layer: 'GOES-East_ABI_GeoColor', longitude: -75.2 },
];

export const GEO_TILE_MATRIX_SET = '1km';
export const GEO_TILE_PX = 512;
/** GIBS's geographic tiling: one tile of level 0 spans 288°, halving each level; the grid starts at 180°W, 90°N. */
const LEVEL0_SPAN_DEG = 288;
/** How far round the planet from under a satellite its picture is asked for: the limb is at 81.3°. */
const REACH_DEG = 82;
/** The two pictures are joined midway between the satellites, cross-faded over this many degrees. */
export const SEAM_LONGITUDE = (GEO_SATELLITES[0].longitude + GEO_SATELLITES[1].longitude) / 2;
export const SEAM_FEATHER_DEG = 8;
const TEN_MINUTES_MS = 600_000;
const DAY_MS = 86_400_000;

export const tileSpanDeg = (level: number): number => LEVEL0_SPAN_DEG / 2 ** level;

/** Size of the whole-globe canvas at a tile level: 360° by 180° at the tiles' own scale. */
export function geoCanvasSize(level: number): { width: number; height: number } {
  const pxPerDeg = GEO_TILE_PX / tileSpanDeg(level);
  return { width: Math.round(360 * pxPerDeg), height: Math.round(180 * pxPerDeg) };
}

export interface GeoTile {
  readonly row: number;
  readonly col: number;
}

/** The tiles of `level` that hold any of a satellite's view: every row, and the columns within reach of its longitude. */
export function geoTiles(level: number, satelliteLongitude: number): GeoTile[] {
  const span = tileSpanDeg(level);
  const columns = Math.ceil(360 / span);
  const rows = Math.ceil(180 / span);
  const wanted = new Set<number>();
  // Walk the reach in steps smaller than a tile, wrapping at the date line.
  for (let offset = -REACH_DEG; offset <= REACH_DEG; offset += Math.min(span / 2, 1)) {
    const lon = ((((satelliteLongitude + offset + 180) % 360) + 360) % 360) - 180;
    wanted.add(Math.min(columns - 1, Math.floor((lon + 180) / span)));
  }
  const tiles: GeoTile[] = [];
  for (let row = 0; row < rows; row++) for (const col of [...wanted].sort((a, b) => a - b)) tiles.push({ row, col });
  return tiles;
}

export function geoTileUrl(layer: string, time: string, level: number, tile: GeoTile): string {
  return `${GIBS_WMTS.replace(/\/wmts\.cgi$/, '')}/${layer}/default/${time}/${GEO_TILE_MATRIX_SET}/${level}/${tile.row}/${tile.col}.png`;
}

/** The product's times in the day up to `now`: a few hundred bytes, where the whole domain is half a megabyte. */
export function geoDomainUrl(layer: string, now: Date): string {
  const end = new Date(Math.ceil(now.getTime() / TEN_MINUTES_MS) * TEN_MINUTES_MS);
  const start = new Date(end.getTime() - DAY_MS);
  return `${GIBS_WMTS}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=DescribeDomains&LAYER=${layer}&TIME=${gibsTime(start, false)}/${gibsTime(end, false)}`;
}

export interface GeoTag {
  readonly level: number;
  /** Each satellite's time as GIBS writes it; absent when it has no picture. */
  readonly times: Partial<Record<GeoSatellite['id'], string>>;
}

export function encodeGeoTag(tag: GeoTag): string {
  return [`z${tag.level}`, ...GEO_SATELLITES.filter((s) => tag.times[s.id]).map((s) => `${s.id}=${tag.times[s.id]}`)].join('|');
}

export function parseGeoTag(text: string): GeoTag {
  const [level, ...parts] = text.split('|');
  const match = /^z(\d+)$/.exec(level);
  if (!match) throw new Error(`unreadable tag "${text}"`);
  const times: Partial<Record<GeoSatellite['id'], string>> = {};
  for (const part of parts) {
    const [id, time] = part.split('=');
    if ((id !== 'west' && id !== 'east') || !time) throw new Error(`unreadable tag "${text}"`);
    times[id] = time;
  }
  return { level: Number(match[1]), times };
}

/** Canvas x of a longitude. */
export function canvasX(longitude: number, width: number): number {
  return ((longitude + 180) / 360) * width;
}

/** What a source needs from the app: baked files and the network. */
export interface GeoSourceContext {
  assetUrl(path: string): string;
  readonly fetchImpl?: FetchLike;
}

/** What tools/pipeline/generate_earth_now_snapshot.py writes beside its picture. */
export interface EarthNowSnapshot {
  readonly file: string;
  readonly validTime: string;
  readonly times: Record<string, string>;
}

type Drawable = ImageBitmap | HTMLImageElement;

async function loadTiles(layer: string, time: string, level: number, longitude: number, fetchImpl?: FetchLike): Promise<{ tile: GeoTile; image: Drawable }[]> {
  return Promise.all(
    geoTiles(level, longitude).map(async (tile) => {
      const response = await fetchOk(geoTileUrl(layer, time, level, tile), {}, undefined, fetchImpl);
      return { tile, image: await createImageBitmap(await response.blob()) };
    })
  );
}

function newCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas');
  return { canvas, context };
}

/** Both satellites' tiles as one picture of the globe, longitude −180..180 left to right, north up. */
async function compose(tag: GeoTag, fetchImpl?: FetchLike): Promise<Blob> {
  const { width, height } = geoCanvasSize(tag.level);
  const whole = newCanvas(width, height);
  const present = GEO_SATELLITES.filter((satellite) => tag.times[satellite.id]);
  const loaded = await Promise.all(
    present.map(async (satellite) => ({
      satellite,
      tiles: await loadTiles(satellite.layer, tag.times[satellite.id]!, tag.level, satellite.longitude, fetchImpl),
    }))
  );
  for (const { satellite, tiles } of loaded) {
    const layer = satellite.id === 'east' && present.length > 1 ? newCanvas(width, height) : whole;
    for (const { tile, image } of tiles) layer.context.drawImage(image, tile.col * GEO_TILE_PX, tile.row * GEO_TILE_PX);
    if (layer !== whole) {
      // East is laid over West from the seam eastward, faded in across the feather.
      const x0 = canvasX(SEAM_LONGITUDE - SEAM_FEATHER_DEG / 2, width);
      const x1 = canvasX(SEAM_LONGITUDE + SEAM_FEATHER_DEG / 2, width);
      const fade = layer.context.createLinearGradient(x0, 0, x1, 0);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      layer.context.globalCompositeOperation = 'destination-in';
      layer.context.fillStyle = fade;
      layer.context.fillRect(0, 0, width, height);
      whole.context.drawImage(layer.canvas, 0, 0);
    }
    for (const { image } of tiles) if ('close' in image) image.close();
  }
  return new Promise((resolve, reject) => {
    // WebP keeps the transparency at a tenth of a PNG's size; a browser that cannot write it gives a PNG.
    whole.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas would not encode'))), 'image/webp', 0.9);
  });
}

/**
 * GOES East and West GeoColor, composed. `level` is the tile level: 1 is
 * 1280 pixels round the globe and about 1.3 MB to fetch, 2 is 2560 and
 * about 4.5 MB.
 */
export function geoColorSource(context: GeoSourceContext, level: number): ProductSource<HTMLImageElement> {
  return {
    storeKey: `earth-now-z${level}`,
    async latest(now) {
      const answers = await Promise.allSettled(
        GEO_SATELLITES.map(async (satellite) => {
          const response = await fetchOk(geoDomainUrl(satellite.layer, now), {}, undefined, context.fetchImpl);
          const latest = latestInDomain(parseTimeDomain(await response.text()), now);
          if (!latest) throw new Error(`${satellite.layer} has nothing in the day before ${now.toISOString()}`);
          return { id: satellite.id, time: latest.time };
        })
      );
      const times: GeoTag['times'] = {};
      let oldest: Date | null = null;
      for (const answer of answers) {
        if (answer.status !== 'fulfilled') continue;
        times[answer.value.id] = gibsTime(answer.value.time, false);
        if (!oldest || answer.value.time < oldest) oldest = answer.value.time;
      }
      // One satellite alone is still a picture; neither is a failure.
      if (!oldest) throw new AggregateError(answers.map((answer) => (answer as PromiseRejectedResult).reason), 'no GOES picture to be had');
      return { tag: encodeGeoTag({ level, times }), validTime: oldest };
    },
    download: (tag) => compose(parseGeoTag(tag), context.fetchImpl),
    decode: decodeImage,
    async snapshot() {
      const meta = (await (await fetchOk(context.assetUrl('weather/earth-now.json'), {}, undefined, context.fetchImpl)).json()) as EarthNowSnapshot;
      const blob = await (await fetchOk(context.assetUrl(`weather/${meta.file}`), {}, undefined, context.fetchImpl)).blob();
      const time = Date.parse(meta.validTime);
      if (Number.isNaN(time)) throw new Error(`unreadable time "${meta.validTime}"`);
      return { value: await decodeImage(blob), validTime: new Date(time) };
    },
  };
}
