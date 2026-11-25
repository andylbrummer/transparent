/**
 * The time-slices of the northern ice sheets (app/public/geo/ice-sheets.json,
 * from tools/pipeline/generate_ice_sheets_through_time.py) and how the
 * control names them. Position 0 on the control is the present, 1 the
 * youngest slice, and so on back to 3.6 million years ago: the slices are
 * irregular in time, so the control steps through them, not through years.
 */

import { millionsText } from '../ice-age/ice-age';

export interface IceSheetSlice {
  readonly id: string;
  /** "MIS 6", "30,000 years ago", "Last Glacial Maximum". */
  readonly name: string;
  readonly youngKa: number;
  readonly oldKa: number;
  /** Drawn at its warmest moment rather than its largest ice. */
  readonly warmPeak: boolean;
  readonly file: string;
  readonly areaKm2: number;
}

export interface IceSheetsData {
  readonly width: number;
  readonly height: number;
  readonly slices: readonly IceSheetSlice[];
}

export function sliceAt(data: IceSheetsData, position: number): IceSheetSlice | null {
  const index = Math.round(position);
  if (index <= 0) return null;
  return data.slices[Math.min(index, data.slices.length) - 1];
}

/** "30 ka", "2.6 Ma". */
export function formatKa(ka: number): string {
  return ka >= 1000 ? `${String(Number((ka / 1000).toPrecision(3)))} Ma` : `${String(ka)} ka`;
}

/** Names that are only the age itself; the control already shows that. */
const isJustAnAge = (slice: IceSheetSlice): boolean => slice.name.endsWith('years ago');

/** The age as shown, oldest first as on a timescale: "190–132 ka". */
export function sliceText(slice: IceSheetSlice | null): string {
  if (!slice) return 'today';
  if (slice.youngKa === slice.oldKa) return formatKa(slice.oldKa);
  const old = formatKa(slice.oldKa);
  const young = formatKa(slice.youngKa);
  // One unit for both ends when they share it.
  return old.slice(-2) === young.slice(-2) ? `${old.slice(0, -3)}–${young}` : `${old}–${young}`;
}

const years = (ka: number): string => `${Math.round(ka * 1000).toLocaleString('en-US')}`;

export function sliceSpoken(slice: IceSheetSlice | null): string {
  if (!slice) return 'the present';
  const span = slice.youngKa === slice.oldKa ? `${years(slice.oldKa)} years ago` : `${years(slice.oldKa)} to ${years(slice.youngKa)} years ago`;
  return isJustAnAge(slice) ? span : `${slice.name}, ${span}`;
}

export function sliceDescription(slice: IceSheetSlice | null): string {
  if (!slice) return '';
  const what = slice.warmPeak ? 'peak warmth' : 'largest extent';
  return isJustAnAge(slice) ? what : `${slice.name} · ${what}`;
}

export function sliceStatus(slice: IceSheetSlice | null): string {
  if (!slice) return 'today: of these ice sheets only Greenland’s is left';
  const name = isJustAnAge(slice) ? sliceText(slice) : slice.name;
  return `${name} · ice ${millionsText(slice.areaKm2)} · best estimate`;
}

/** What the present is called where a slice is asked for by id: in `?ice=` and in the layer's `slice` setting. */
export const TODAY = 'today';

/** The control's position for a slice id (TODAY for the present); null for an id the data lack. */
export function positionOf(data: IceSheetsData, id: string): number | null {
  if (id === TODAY) return 0;
  const index = data.slices.findIndex((slice) => slice.id === id);
  return index < 0 ? null : index + 1;
}

/** The slice `?ice=<id>` names (TODAY for the present), else the Last Glacial Maximum: where the control opens. */
export function sliceFromLocation(search: string, data: IceSheetsData): string {
  const id = new URLSearchParams(search).get('ice');
  return id !== null && positionOf(data, id) !== null ? id : data.slices[0].id;
}

/** Where the control opens, as a position. */
export function positionFromLocation(search: string, data: IceSheetsData): number {
  return positionOf(data, sliceFromLocation(search, data))!;
}
