/**
 * Which patches of sky a sparse survey covers, as HEALPix cells at one
 * order (baked by tools/pipeline/generate_closeup_coverage.py from each
 * survey's coverage map). Webb's NIRCam survey covers about two square
 * degrees: a tile is asked for only where it touches a cell,
 * and the cells mark where there is something to zoom into.
 */

import { healpixPixelPoint } from '@transparent-earth/core';
import type { StatusTone } from '../types';
import type { HipsTile } from './hips';

/** Sorted, unique cells from their differences, the first counted from zero. */
export function decodeCells(deltas: readonly number[]): number[] {
  const cells: number[] = [];
  let cell = -1;
  for (const delta of deltas) {
    if (!(delta > 0) && !(cells.length === 0 && delta === 0)) throw new Error('cells must be strictly increasing');
    cell = cells.length === 0 ? delta : cell + delta;
    cells.push(cell);
  }
  return cells;
}

/** Which tiles a survey has. */
export interface TileCoverage {
  /** Whether the survey has tile `ipix` of `order`: no other tile is asked for. */
  touches(order: number, ipix: number): boolean;
  /**
   * Where it has none: true, the deepest coarser tile it has is drawn there (a survey written whole to one order
   * and deeper only in places); false, nothing is (a survey of scattered patches).
   */
  readonly coarserOutside: boolean;
}

/**
 * The tile fetched to draw `tile`: itself where the survey has it; else, for a survey that draws coarser tiles where
 * it has no deep one, the deepest coarser tile it has; else none.
 */
export function tileToFetch(tile: HipsTile, coverage: TileCoverage | null, minOrder: number): HipsTile | null {
  if (!coverage || coverage.touches(tile.order, tile.ipix)) return tile;
  if (!coverage.coarserOutside) return null;
  for (let order = tile.order - 1; order >= minOrder; order--) {
    // Division, not shifts: deep pixel numbers pass 2^31.
    const ipix = Math.floor(tile.ipix / 4 ** (tile.order - order));
    if (coverage.touches(order, ipix)) return { order, ipix };
  }
  return null;
}

export class Coverage implements TileCoverage {
  readonly coarserOutside = false;
  private readonly cells: ReadonlySet<number>;
  /** Per coarser order, every pixel holding at least one cell. */
  private readonly coarser: readonly ReadonlySet<number>[];

  constructor(
    readonly order: number,
    private readonly list: readonly number[]
  ) {
    this.cells = new Set(list);
    const coarser: Set<number>[] = [];
    for (let o = 0; o < order; o++) {
      const step = 4 ** (order - o);
      coarser.push(new Set(list.map((cell) => Math.floor(cell / step))));
    }
    this.coarser = coarser;
  }

  /** Whether the pixel `ipix` of `order` holds or lies in a covered cell. Division, not shifts: deep pixel numbers pass 2^31. */
  touches(order: number, ipix: number): boolean {
    if (order < this.order) return this.coarser[order].has(ipix);
    return this.cells.has(Math.floor(ipix / 4 ** (order - this.order)));
  }

  /** Unit ICRS directions of the cells' centres, xyz per cell. */
  centres(): Float32Array {
    const out = new Float32Array(this.list.length * 3);
    this.list.forEach((cell, i) => out.set(healpixPixelPoint(this.order, cell, 0.5, 0.5), 3 * i));
    return out;
  }
}

/**
 * How strongly the patches are marked at a field of view: fully when looking wide, where a patch is a pixel or two,
 * fading out between 8° and 1°, where it is a sizeable part of the screen and the marker would only hide it.
 */
export function markerOpacity(fovDeg: number): number {
  const t = Math.min(1, Math.max(0, (Math.log(fovDeg) - Math.log(1)) / (Math.log(8) - Math.log(1))));
  return t * t * (3 - 2 * t);
}

export interface FieldStatus {
  readonly text: string | null;
  readonly tone: StatusTone;
}

/**
 * One chip for a survey drawn from several fields, each from its own tile server, in order: tiles missing in any
 * field; any field loading; any field with no connection (a field with nothing in view is quiet, so this shows when
 * the field in view is offline); else quiet.
 */
export function mergeStatuses(statuses: readonly FieldStatus[]): FieldStatus {
  const has = (text: string): FieldStatus | undefined => statuses.find((status) => status.text === text);
  return has('some tiles missing') ?? has('loading…') ?? has('no connection') ?? { text: null, tone: 'info' };
}

/** What generate_closeup_coverage.py writes. */
export interface CloseupsFile {
  readonly generated: string;
  readonly order: number;
  readonly frame: string;
  readonly surveys: Readonly<Record<string, { readonly hips: string; readonly mocOrder: number; readonly areaDeg2: number; readonly cells: number; readonly deltas: readonly number[] }>>;
}

export function parseCloseups(file: CloseupsFile): Map<string, Coverage> {
  if (file.frame !== 'icrs') throw new Error(`coverage must be in icrs, not ${file.frame}`);
  const out = new Map<string, Coverage>();
  for (const [name, survey] of Object.entries(file.surveys)) {
    const cells = decodeCells(survey.deltas);
    if (cells.length !== survey.cells) throw new Error(`${name}: ${cells.length} cells where the file says ${survey.cells}`);
    out.set(name, new Coverage(file.order, cells));
  }
  return out;
}

/** What generate_milkyway_enhanced.py writes beside its tiles. */
export interface DeepTilesFile {
  readonly wholeSkyOrder: number;
  /** Per order beyond wholeSkyOrder, the tiles written. */
  readonly tiles: Readonly<Record<string, readonly number[]>>;
}

/** A survey with every tile to `wholeSkyOrder`, and deeper only where listed: close-ups of a few objects. */
export class DeepTiles implements TileCoverage {
  readonly coarserOutside = true;
  private readonly byOrder: ReadonlyMap<number, ReadonlySet<number>>;

  constructor(readonly wholeSkyOrder: number, tiles: Readonly<Record<string, readonly number[]>>) {
    this.byOrder = new Map(Object.entries(tiles).map(([order, pixels]) => [Number(order), new Set(pixels)]));
    for (const order of this.byOrder.keys()) {
      if (!(order > wholeSkyOrder)) throw new Error(`deep tiles listed at order ${order}, not beyond the whole sky's ${wholeSkyOrder}`);
    }
  }

  static parse(file: DeepTilesFile): DeepTiles {
    return new DeepTiles(file.wholeSkyOrder, file.tiles);
  }

  touches(order: number, ipix: number): boolean {
    return order <= this.wholeSkyOrder || (this.byOrder.get(order)?.has(ipix) ?? false);
  }

  /** The deepest order listed anywhere. */
  get maxOrder(): number {
    return Math.max(this.wholeSkyOrder, ...this.byOrder.keys());
  }
}
