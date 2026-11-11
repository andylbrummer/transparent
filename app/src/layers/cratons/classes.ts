/**
 * Colours of the Archean crust layer, by the class numbers the bake writes
 * (tools/pipeline/generate_geologic_provinces.py, bake_cratons): 1 craton,
 * 2 shield, 3 another kind of province with Archean basement, and the same
 * plus 3 where the source marks it reworked after the Archean. Reworked
 * crust keeps its hue and is drawn fainter: still Archean underneath,
 * no longer untouched.
 */

import { bandsLegend, type PaletteEntry } from '../geologic-provinces/drape';

export const REWORKED_OFFSET = 3;

export const CRATON_KINDS = [
  { id: 1, name: 'craton', color: 0xff6a2b },
  { id: 2, name: 'shield', color: 0xffb347 },
  { id: 3, name: 'other', color: 0xe6cf9a },
] as const;

const INTACT_OPACITY = 0.72;
const REWORKED_OPACITY = 0.3;

export const CRATON_PALETTE: readonly PaletteEntry[] = CRATON_KINDS.flatMap((kind): PaletteEntry[] => [
  [kind.id, kind.color, INTACT_OPACITY],
  [kind.id + REWORKED_OFFSET, kind.color, REWORKED_OPACITY],
]);

/** Intact craton, shield, other; then reworked, as the shader blends them over a dark globe. */
const fainter = (color: number): number => {
  const scale = (c: number): number => Math.round(c * (REWORKED_OPACITY / INTACT_OPACITY));
  return (scale((color >> 16) & 255) << 16) | (scale((color >> 8) & 255) << 8) | scale(color & 255);
};
export const CRATON_LEGEND = bandsLegend([...CRATON_KINDS.map((k) => k.color), ...CRATON_KINDS.map((k) => fainter(k.color))]);
