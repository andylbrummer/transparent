/**
 * Scientific ocean drilling (app/public/geo/drill-holes.json, from
 * tools/pipeline/generate_drill_holes.py; IODP's Drilled Holes table):
 * the rows, the colours and which holes are named. Apart from three.js
 * so the panel's legend can use it.
 *
 * Holes are not sized by depth: the table's penetration column means
 * different things on different cruises (see the pipeline script).
 */

import type { GeoMarker } from '../../render/geo-markers';

/** Bit mask of the programmes that cored a hole. */
export const DSDP = 1;
export const ODP = 2;
export const IODP = 4;

/** [name, lat, lon, programmes, cruises]. */
export type HoleRow = readonly [string, number, number, number, number];

export interface HoleData {
  readonly rows: number;
  /** Most-visited first. */
  readonly holes: readonly HoleRow[];
}

/** Coloured by the programme that first cored the hole. */
export const PROGRAMME_COLORS = { dsdp: 0xffb347, odp: 0x58c4ff, iodp: 0xb4f05a } as const;

/** Holes worked on this many cruises or more are named. */
export const REVISITED_MIN_CRUISES = 3;
export const HOLE_SIZE_PX = 4;
export const REVISITED_SIZE_PX = 8;

export function firstProgramme(mask: number): keyof typeof PROGRAMME_COLORS {
  if (mask & DSDP) return 'dsdp';
  if (mask & ODP) return 'odp';
  return 'iodp';
}

export function programmeNames(mask: number): string {
  return [mask & DSDP ? 'DSDP' : '', mask & ODP ? 'ODP' : '', mask & IODP ? 'IODP' : ''].filter(Boolean).join(', ');
}

/** "Hole 504B · 9 cruises · DSDP, ODP, IODP". */
export function holeLabelText(row: HoleRow): string {
  return `Hole ${row[0]} · ${String(row[4])} cruises · ${programmeNames(row[3])}`;
}

export function revisitedHoles(data: HoleData): HoleRow[] {
  return data.holes.filter((row) => row[4] >= REVISITED_MIN_CRUISES);
}

export function holeMarkers(holes: readonly HoleRow[]): GeoMarker[] {
  // Most-visited first in the file: drawn last, so on top.
  return [...holes].reverse().map((row) => ({
    lon: row[2],
    lat: row[1],
    shape: row[4] >= REVISITED_MIN_CRUISES ? 'ring' : 'disc',
    color: PROGRAMME_COLORS[firstProgramme(row[3])],
    sizePx: row[4] >= REVISITED_MIN_CRUISES ? REVISITED_SIZE_PX : HOLE_SIZE_PX,
    alpha: 0.9,
  }));
}
