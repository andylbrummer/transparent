/**
 * The world's major mineral deposits (app/public/geo/mineral-deposits.json,
 * from tools/pipeline/generate_mineral_deposits.py; USGS Open-File Report
 * 2005-1294): what the rows hold, how each group is coloured, and which
 * are named. Apart from three.js so the panel's legend can use it.
 *
 * The file has no tonnages, so nothing is sized and the named ones are a
 * hand-picked list of widely known deposits, not the largest: each is
 * held to the file by tools/pipeline/test_mineral_deposits.py.
 */

import type { GeoMarker } from '../../render/geo-markers';

export type DepositGroup = 'precious' | 'base' | 'steel' | 'aluminium' | 'critical' | 'gems' | 'industrial';

/** [name, country, lat, lon, group, commodities as compiled, geological setting]. */
export type DepositRow = readonly [string, string, number, number, DepositGroup, string, string];

export interface DepositData {
  readonly groups: readonly DepositGroup[];
  readonly deposits: readonly DepositRow[];
}

export const DEPOSIT_COLORS: Readonly<Record<DepositGroup, number>> = {
  precious: 0xffd34d,
  base: 0xe8834a,
  steel: 0x9fb0c8,
  aluminium: 0xc77dff,
  critical: 0x5fe0b0,
  gems: 0xff6fcf,
  industrial: 0xeee6d2,
};

export const DEPOSIT_GROUP_NAMES: Readonly<Record<DepositGroup, string>> = {
  precious: 'gold, silver, platinum',
  base: 'copper, lead, zinc, nickel',
  steel: 'iron and steel metals',
  aluminium: 'bauxite',
  critical: 'lithium, rare earths, tin, titanium…',
  gems: 'diamonds and gems',
  industrial: 'phosphate, potash, salt…',
};

/** Named where there is room: [name, a word the commodities must include, for names the file uses twice]. */
export const FEATURED_DEPOSITS: readonly (readonly [string, string?])[] = [
  ['La Escondida'],
  ['Chuquicamata'],
  ['Grasberg'],
  ['Kiruna'],
  ['Olympic Dam'],
  ['Muruntau'],
  ['Bayan Obo', 'Rare earth'],
  ['Carajas'],
  ['Bingham Canyon', 'molybdenum'],
  ['Kalgoorlie'],
  ['Western Bushveld'],
];

export const DEPOSIT_SIZE_PX = 5;
export const FEATURED_SIZE_PX = 8;

export function featuredRows(data: DepositData): DepositRow[] {
  return FEATURED_DEPOSITS.flatMap(([name, word]) => {
    const row = data.deposits.find((r) => r[0] === name && (word === undefined || r[5].includes(word)));
    return row ? [row] : [];
  });
}

/** "Kiruna · Iron · Sweden". */
export function depositLabelText(row: DepositRow): string {
  return `${row[0]} · ${row[5]} · ${row[1]}`;
}

export function depositMarkers(rows: readonly DepositRow[], featured: readonly DepositRow[]): GeoMarker[] {
  const big = new Set(featured);
  return rows.map((row) => ({
    lon: row[3],
    lat: row[2],
    shape: 'disc',
    color: DEPOSIT_COLORS[row[4]],
    sizePx: big.has(row) ? FEATURED_SIZE_PX : DEPOSIT_SIZE_PX,
    alpha: 0.95,
  }));
}

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** One band per group, in the file's order. */
export function depositLegend(groups: readonly DepositGroup[]): string {
  const step = 100 / groups.length;
  return `linear-gradient(to right, ${groups.map((g, i) => `${hex(DEPOSIT_COLORS[g])} ${String(i * step)}% ${String((i + 1) * step)}%`).join(', ')})`;
}
