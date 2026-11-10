/**
 * HiPS: an all-sky survey cut into HEALPix tiles, each a 512-pixel image
 * of one pixel of the tiling, at every order from the whole sky in 12
 * tiles down to the survey's own resolution (IVOA HiPS 1.0, Fernique et
 * al. 2017). This is the arithmetic of which tiles a view needs; the
 * drawing is in survey.ts.
 */

import { healpixAncestorWindow, healpixPixelsInDisc, type HealpixWindow } from '@transparent-earth/core';

/** Tiles are this many pixels on a side. */
export const HIPS_TILE_PX = 512;
/** Mean angular width of an order-0 HEALPix pixel, radians: sqrt(4π / 12). */
const ORDER0_WIDTH_RAD = Math.sqrt(Math.PI / 3);
/** A tile may be stretched this far before the next order is fetched: sharper costs four times the tiles. */
const MAX_UPSCALE = 1.25;

export interface HipsTile {
  readonly order: number;
  readonly ipix: number;
}

export const tileKey = (tile: HipsTile): string => `${tile.order}/${tile.ipix}`;

/** `{base}/Norder{k}/Dir{10000 ⌊n/10000⌋}/Npix{n}.{ext}`, as the standard lays tiles out. */
export function tileUrl(base: string, tile: HipsTile, extension: string): string {
  return `${base.replace(/\/$/, '')}/Norder${tile.order}/Dir${Math.floor(tile.ipix / 10000) * 10000}/Npix${tile.ipix}.${extension}`;
}

/**
 * The order whose tiles, drawn at `pxPerRad` screen pixels per radian,
 * show about one image pixel per screen pixel, within what the survey has.
 */
export function targetOrder(pxPerRad: number, minOrder: number, maxOrder: number): number {
  const tilePx = ORDER0_WIDTH_RAD * pxPerRad;
  const order = Math.ceil(Math.log2(tilePx / (HIPS_TILE_PX * MAX_UPSCALE)));
  return Math.max(minOrder, Math.min(maxOrder, order));
}

/** Half the angle across the view's diagonal, radians, for a vertical field of `fovDeg` and a width/height `aspect`. */
export function viewRadiusRad(fovDeg: number, aspect: number): number {
  return Math.atan(Math.tan((fovDeg * Math.PI) / 360) * Math.hypot(1, aspect));
}

/** The tiles of `order` a view needs, nearest its centre first, at most `limit`. */
export function tilesForView(order: number, direction: readonly [number, number, number], radiusRad: number, limit: number): HipsTile[] {
  return healpixPixelsInDisc(order, direction, Math.min(radiusRad, Math.PI), limit).map((ipix) => ({ order, ipix }));
}

/**
 * Where an image's pixels are on its tile. HEALPix counts (u, v) from the
 * pixel's south corner, u toward the east corner and v toward the west
 * one; a HiPS image has v running along its rows from the left and u
 * down its columns from the top - found by where catalogue stars fall on
 * real tiles (tools/pipeline/test_hips_orientation.py).
 */
export function tileImageXy(u: number, v: number): [number, number] {
  return [v, u];
}

export interface TileSource {
  /** The tile whose image is drawn. */
  readonly tile: HipsTile;
  /** The part of that image the wanted tile covers. */
  readonly window: HealpixWindow;
}

/**
 * What to draw for a wanted tile: its own image if `has` it, else the
 * nearest ancestor's, cut to the wanted tile's footprint, so the sky is
 * never blank while the sharper image loads. Null when nothing is held.
 */
export function bestSource(tile: HipsTile, minOrder: number, has: (tile: HipsTile) => boolean): TileSource | null {
  for (let order = tile.order; order >= minOrder; order--) {
    const window = healpixAncestorWindow(tile.order, tile.ipix, order);
    const candidate = { order, ipix: window.ipix };
    if (has(candidate)) return { tile: candidate, window };
  }
  return null;
}

/** How finely a tile's curved outline is followed: segments per side. Big tiles bend most. */
export function tileSegments(order: number): number {
  if (order <= 1) return 16;
  if (order <= 3) return 8;
  if (order <= 5) return 4;
  return 2;
}
