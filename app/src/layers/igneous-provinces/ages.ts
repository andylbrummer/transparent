/**
 * Colours and names of the igneous provinces by age. The picture's red
 * channel holds 1 + age / OLDEST_MA * 254, 255 for OLDEST_MA and older
 * (tools/pipeline/generate_igneous_provinces.py); the palette turns each
 * of those 255 values into a colour on AGE_RAMP, so picture and legend
 * share one scale.
 */

import { bandsLegend, type PaletteEntry } from '../geologic-provinces/drape';

export const OLDEST_MA = 300;

/** [Ma, colour]: young yellow, through the extinction-age reds, to violet for the oldest. */
export const AGE_RAMP: readonly (readonly [number, number])[] = [
  [0, 0xfff3a0],
  [66, 0xffb000],
  [145, 0xff5a36],
  [201, 0xd6336c],
  [252, 0x9b4dca],
  [300, 0x5b4fe0],
];

const FILL_OPACITY = 0.75;

export function ageColor(ageMa: number): number {
  const age = Math.min(Math.max(ageMa, 0), OLDEST_MA);
  let i = 0;
  while (i < AGE_RAMP.length - 2 && AGE_RAMP[i + 1][0] <= age) i++;
  const [a0, c0] = AGE_RAMP[i];
  const [a1, c1] = AGE_RAMP[i + 1];
  const t = (age - a0) / (a1 - a0);
  const channel = (shift: number): number => Math.round(((c0 >> shift) & 255) * (1 - t) + ((c1 >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** The age a value in the picture stands for. */
export const ageOfValue = (value: number): number => ((value - 1) / 254) * OLDEST_MA;

export const AGE_PALETTE: readonly PaletteEntry[] = Array.from({ length: 255 }, (_, i): PaletteEntry => [i + 1, ageColor(ageOfValue(i + 1)), FILL_OPACITY]);

/** Bands every 25 Myr from 0 to 300 Ma: the legend reads left young, right old. */
export const AGE_LEGEND = bandsLegend(Array.from({ length: 12 }, (_, i) => ageColor(i * 25 + 12.5)));

/** "Siberian Traps · 248–251 Ma"; the oldest ages in the file are not shown, being at the end of the scale. */
export function provinceLabel(name: string, ageMa: readonly [number, number]): string {
  const [young, old] = ageMa;
  if (old >= OLDEST_MA) return name;
  const text = (age: number): string => String(Math.round(age));
  return `${name} · ${young === old ? text(old) : `${text(young)}–${text(old)}`} Ma`;
}
