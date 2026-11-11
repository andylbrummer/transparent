/**
 * Caves with a known depth (app/public/geo/deep-caves.json, from
 * tools/pipeline/generate_deep_caves.py; Wikidata, CC0): the rows, the
 * colours and which caves are named. Apart from three.js so the panel's
 * legend can use it.
 *
 * Depth is Wikidata's "vertical depth" (P4511), entrance to lowest point,
 * as the item states it: Wikidata and the caving literature do not always
 * agree on the newest survey.
 */

import type { GeoMarker } from '../../render/geo-markers';

/** [name, lat, lon, depth m, Wikipedia editions]. */
export type CaveRow = readonly [string, number, number, number, number];

export interface CaveData {
  readonly asOf: string;
  /** Deepest first. */
  readonly caves: readonly CaveRow[];
}

/** Depth bands, shallowest first: the lower bound of each, in metres. */
export const DEPTH_BANDS = [
  { from: 0, color: 0x7fb7d9, sizePx: 4 },
  { from: 100, color: 0x58d6c2, sizePx: 6 },
  { from: 300, color: 0xf2c14e, sizePx: 8 },
  { from: 1000, color: 0xff6a3d, sizePx: 11 },
] as const;

/** Caves this deep or deeper are named. */
export const NAMED_MIN_DEPTH_M = 500;

export function depthBand(depth: number): (typeof DEPTH_BANDS)[number] {
  let band: (typeof DEPTH_BANDS)[number] = DEPTH_BANDS[0];
  for (const candidate of DEPTH_BANDS) if (depth >= candidate.from) band = candidate;
  return band;
}

/** "Veryovkina Cave · 2,212 m deep". */
export function caveLabelText(row: CaveRow): string {
  return `${row[0]} · ${row[3].toLocaleString('en-US')} m deep`;
}

export function namedCaves(data: CaveData): CaveRow[] {
  return data.caves.filter((row) => row[3] >= NAMED_MIN_DEPTH_M);
}

export function caveMarkers(caves: readonly CaveRow[]): GeoMarker[] {
  // Deepest first in the file: drawn last, so on top.
  return [...caves].reverse().map((row) => {
    const band = depthBand(row[3]);
    return { lon: row[2], lat: row[1], shape: 'triangle', color: band.color, sizePx: band.sizePx, alpha: 0.95 };
  });
}
