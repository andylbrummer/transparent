/**
 * The magnetic field on the core's surface, 1900-2025: the baked epochs
 * (app/public/geo/core-field.json, from tools/pipeline/generate_core_field.py)
 * and how the control moves between them. The control counts years back
 * from the newest epoch; between two epochs the pictures are blended, as
 * IGRF itself is interpolated linearly in time.
 */

export interface CoreFieldEpoch {
  readonly year: number;
  readonly file: string;
  /** From 1945 the models are definitive (DGRF); before, less certain. */
  readonly definitive: boolean;
  /** Share of the core's southern half where the field points inward, as it does in the north. */
  readonly reversedSouth: number;
}

export interface CoreFieldData {
  readonly width: number;
  readonly height: number;
  readonly radiusKm: number;
  readonly scaleNt: number;
  readonly maxDegree: number;
  readonly epochs: readonly CoreFieldEpoch[];
}

export interface CoreFieldMoment {
  /** The year shown, fractional between epochs. */
  readonly year: number;
  readonly older: CoreFieldEpoch;
  readonly newer: CoreFieldEpoch;
  /** 0 shows `older`, 1 `newer`. */
  readonly mix: number;
}

export const newestYear = (data: CoreFieldData): number => data.epochs[data.epochs.length - 1].year;
export const yearsSpanned = (data: CoreFieldData): number => newestYear(data) - data.epochs[0].year;

/** The moment `position` years before the newest epoch, clamped to the epochs there are. */
export function momentAt(data: CoreFieldData, position: number): CoreFieldMoment {
  const year = Math.min(newestYear(data), Math.max(data.epochs[0].year, newestYear(data) - position));
  let i = 0;
  while (i < data.epochs.length - 2 && data.epochs[i + 1].year <= year) i++;
  const older = data.epochs[i];
  const newer = data.epochs[i + 1];
  return { year, older, newer, mix: (year - older.year) / (newer.year - older.year) };
}

export const yearText = (moment: CoreFieldMoment): string => String(Math.round(moment.year));

export function momentDescription(moment: CoreFieldMoment): string {
  return moment.year < 1945 ? 'model less certain before 1945' : '';
}

export function momentStatus(moment: CoreFieldMoment): string {
  const share = moment.older.reversedSouth + (moment.newer.reversedSouth - moment.older.reversedSouth) * moment.mix;
  const certainty = moment.year < 1945 ? ' · not a definitive model' : '';
  return `${yearText(moment)} · reversed flux under ${Math.round(share * 100)}% of the southern core${certainty}`;
}

/** Where the control opens: `?core=<year>` if within the epochs, else the newest. */
export function positionFromLocation(search: string, data: CoreFieldData): number {
  const year = Number(new URLSearchParams(search).get('core'));
  if (!Number.isFinite(year) || year < data.epochs[0].year || year > newestYear(data)) return 0;
  return newestYear(data) - year;
}
