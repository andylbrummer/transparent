/**
 * Whole-globe pictures from NASA GIBS map tiles (WMTS) rather than from its
 * WMS endpoint. The WMS server draws each globe on request and has been
 * seen to hang without answering; the tiles are static files behind a CDN,
 * cached for days, and fail fast when they fail. The globe is put together
 * here: every tile of one level drawn onto one equirectangular canvas.
 *
 * GIBS's geographic grid is the same for every tile matrix set: a level-0
 * tile of 512 pixels spans 288°, halving each level, starting at 180°W, 90°N.
 * The sets differ only in how deep they go (2km to level 5, 250m to level 8),
 * far deeper than a whole-globe picture needs.
 */

import { GIBS_WMTS } from './gibs';
import { fetchOk, type FetchLike } from './live';

export const GIBS_TILE_PX = 512;
const LEVEL0_SPAN_DEG = 288;

export const tileSpanDeg = (level: number): number => LEVEL0_SPAN_DEG / 2 ** level;

/** A product as its tiles are named: which layer, which tile matrix set, which file type. */
export interface TiledProduct {
  readonly layer: string;
  readonly matrixSet: '2km' | '1km' | '500m' | '250m';
  readonly ext: 'jpeg' | 'png';
}

export interface TileIndex {
  readonly row: number;
  readonly col: number;
}

export function gibsTileUrl(product: TiledProduct, time: string | null, level: number, tile: TileIndex): string {
  const base = GIBS_WMTS.replace(/\/wmts\.cgi$/, '');
  const when = time === null ? '' : `${time}/`;
  return `${base}/${product.layer}/default/${when}${product.matrixSet}/${level}/${tile.row}/${tile.col}.${product.ext}`;
}

/** The coarsest level holding at least `width` pixels round the globe. */
export function globeTileLevel(width: number): number {
  const pxRound = (level: number): number => (360 / tileSpanDeg(level)) * GIBS_TILE_PX;
  let level = 0;
  while (pxRound(level) < width) level++;
  return level;
}

export interface PlacedTile extends TileIndex {
  /** Where the tile goes on the output canvas, and its side there, in pixels. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export interface GlobeTilePlan {
  readonly level: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly PlacedTile[];
}

/**
 * Every tile of the level that starts on the globe, placed on a `width` by
 * `width / 2` canvas. Tiles overhanging the date line or the south pole are
 * clipped by the canvas.
 */
export function globeTilePlan(width: number): GlobeTilePlan {
  const level = globeTileLevel(width);
  const span = tileSpanDeg(level);
  const size = (span / 360) * width;
  const tiles: PlacedTile[] = [];
  for (let row = 0; row * span < 180; row++) {
    for (let col = 0; col * span < 360; col++) tiles.push({ row, col, x: col * size, y: row * size, size });
  }
  return { level, width, height: width / 2, tiles };
}

/** A tile that fails to load fails the whole picture: a globe with a hole in it is not shown. */
export async function composeGlobe(product: TiledProduct, time: string | null, width: number, fetchImpl?: FetchLike): Promise<HTMLCanvasElement> {
  const plan = globeTilePlan(width);
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas to compose the globe on');
  const images = await Promise.all(
    plan.tiles.map(async (tile) => {
      const response = await fetchOk(gibsTileUrl(product, time, plan.level, tile), {}, undefined, fetchImpl);
      return { tile, image: await createImageBitmap(await response.blob()) };
    })
  );
  context.imageSmoothingQuality = 'high';
  for (const { tile, image } of images) {
    context.drawImage(image, tile.x, tile.y, tile.size, tile.size);
    image.close();
  }
  return canvas;
}

/** A canvas as a file to keep: JPEG for photographs, PNG for data whose colours must stay exact. */
export function canvasBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png' | 'image/webp', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas would not encode'))), type, quality);
  });
}
