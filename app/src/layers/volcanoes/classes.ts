/**
 * How the volcano layers class and colour what they draw: small and free
 * of three.js, because layer.ts builds the panel's legends from it.
 */

export interface RecencyClass {
  readonly key: 'recent' | 'since1900' | 'historic' | 'holocene' | 'pleistocene';
  /** For the caption. */
  readonly label: string;
  readonly color: number;
  /** Triangle size, CSS px. */
  readonly sizePx: number;
  readonly alpha: number;
}

/**
 * Most recently active first. One hue cooling from pale yellow to a dull
 * brown: how long since the volcano last erupted, not a depth - the
 * triangles are what set these apart from the earthquakes' dots.
 */
export const RECENCY_CLASSES: readonly RecencyClass[] = [
  { key: 'recent', label: 'erupted this year or last', color: 0xfff2a8, sizePx: 11, alpha: 1 },
  { key: 'since1900', label: 'since 1900', color: 0xffa52e, sizePx: 8.5, alpha: 1 },
  { key: 'historic', label: 'since 1 CE', color: 0xe0683a, sizePx: 7, alpha: 0.95 },
  { key: 'holocene', label: 'earlier in the Holocene', color: 0xa3523f, sizePx: 5.5, alpha: 0.9 },
  { key: 'pleistocene', label: 'Pleistocene', color: 0x8a7a76, sizePx: 4.5, alpha: 0.7 },
];

/**
 * The class of a Holocene volcano last known to erupt in `lastYear`
 * (null: no dated eruption), judged in the year the data were read.
 */
export function recencyClass(lastYear: number | null, asOfYear: number): RecencyClass {
  if (lastYear === null) return RECENCY_CLASSES[3];
  if (lastYear >= asOfYear - 1) return RECENCY_CLASSES[0];
  if (lastYear >= 1900) return RECENCY_CLASSES[1];
  if (lastYear >= 1) return RECENCY_CLASSES[2];
  return RECENCY_CLASSES[3];
}

/** Equal hard-edged bands, most recent on the left. */
export function recencyLegend(): string {
  const step = 100 / RECENCY_CLASSES.length;
  const bands = RECENCY_CLASSES.map(
    (c, i) => `#${c.color.toString(16).padStart(6, '0')} ${(i * step).toFixed(0)}% ${((i + 1) * step).toFixed(0)}%`
  );
  return `linear-gradient(to right, ${bands.join(', ')})`;
}

/** A year as the database counts them: 1815 → "1815", −1610 → "1610 BCE". */
export function formatYear(year: number): string {
  return year > 0 ? String(year) : `${-year} BCE`;
}

export const GREAT_ERUPTION_COLOR = 0xfff7d6;
/** Star size, CSS px, for a Volcanic Explosivity Index. */
export function eruptionSizePx(vei: number): number {
  return 15 + 8 * (vei - 6);
}
