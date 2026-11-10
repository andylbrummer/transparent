/**
 * The Saffir-Simpson hurricane wind scale, and the colours tropical
 * cyclones are drawn in. Nothing heavy: layer.ts takes its legend from here.
 *
 * The scale is defined on 1-minute sustained wind, which is what the U.S.
 * agencies (NHC, CPHC, JTWC) report; classes below hurricane strength are
 * the usual tropical depression (under 34 kt) and tropical storm.
 */

/** 0 depression, 1 storm, 2..6 hurricane categories 1..5. */
export type CycloneClass = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Lowest wind of each class, knots. */
export const CLASS_MIN_KT: readonly number[] = [0, 34, 64, 83, 96, 113, 137];

/**
 * The colours track maps have used since the 2000s (blue for a depression
 * through yellow to red for category 5): anyone who has seen a hurricane
 * track will read them without the legend.
 */
export const CLASS_COLORS: readonly number[] = [0x5ebaff, 0x00faf4, 0xffffcc, 0xffe775, 0xffc140, 0xff8f20, 0xff6060];
export const CLASS_SHORT: readonly string[] = ['TD', 'TS', 'Cat 1', 'Cat 2', 'Cat 3', 'Cat 4', 'Cat 5'];
/** A track point with no U.S. wind. */
export const UNKNOWN_WIND_COLOR = 0x7f95ad;

export function cycloneClass(windKt: number): CycloneClass {
  let c = 0;
  while (c < 6 && windKt >= CLASS_MIN_KT[c + 1]) c++;
  return c as CycloneClass;
}

/** Colour of a wind in knots; 0 or less means "not given". */
export function windColor(windKt: number): number {
  return windKt > 0 ? CLASS_COLORS[cycloneClass(windKt)] : UNKNOWN_WIND_COLOR;
}

/** Knots to km/h, rounded to the nearest 5 as advisories do. */
export function ktToKmh(windKt: number): number {
  return Math.round((windKt * 1.852) / 5) * 5;
}

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** The seven classes as equal hard-edged bands. */
export function scaleLegend(): string {
  const n = CLASS_COLORS.length;
  const stops = CLASS_COLORS.map((color, i) => `${hex(color)} ${((i / n) * 100).toFixed(2)}% ${(((i + 1) / n) * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
