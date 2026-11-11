/**
 * The colours of the geologic provinces, by the class numbers the bake
 * writes (tools/pipeline/generate_geologic_provinces.py, PROVINCE_CLASSES):
 * old stable crust in earth reds, mountain belts in violets, arcs pink,
 * rifts and basins in cyan and sand, the ocean floor a quiet blue.
 */

import { bandsLegend, type PaletteEntry } from './drape';

export interface ProvinceClass {
  readonly id: number;
  readonly name: string;
  readonly color: number;
}

export const PROVINCE_CLASSES: readonly ProvinceClass[] = [
  { id: 1, name: 'craton', color: 0xb5523b },
  { id: 2, name: 'shield', color: 0xe08a5f },
  { id: 3, name: 'orogenic belt', color: 0x9a7fd1 },
  { id: 4, name: 'accretionary complex', color: 0xc4a8e8 },
  { id: 5, name: 'volcanic arc', color: 0xff6f91 },
  { id: 6, name: 'magmatic province', color: 0xffb000 },
  { id: 7, name: 'rift', color: 0x4fc1e8 },
  { id: 8, name: 'basin', color: 0xe8d38a },
  { id: 9, name: 'passive margin', color: 0x8fd19e },
  { id: 10, name: 'ophiolite complex', color: 0x2bb3a0 },
  { id: 11, name: 'oceanic crust', color: 0x3a6ea5 },
];

/** The ocean floor is most of the map: drawn faint so the continents' provinces lead. */
const FILL_OPACITY = 0.62;
const OCEAN_OPACITY = 0.3;

export const PROVINCE_PALETTE: readonly PaletteEntry[] = PROVINCE_CLASSES.map((c) => [
  c.id,
  c.color,
  c.name === 'oceanic crust' ? OCEAN_OPACITY : FILL_OPACITY,
]);

export const PROVINCE_LEGEND = bandsLegend(PROVINCE_CLASSES.map((c) => c.color));
