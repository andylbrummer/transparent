/**
 * How the human-world layers look: colours, symbols and scales in one
 * place, small and free of three.js, because layer.ts builds the panel's
 * legends from it and the lazy code draws with the same values.
 *
 * The colours keep clear of what the map already uses: the earthquakes'
 * red-to-violet depth ramp, the volcanoes' yellow-to-brown triangles, the
 * craters' lime rings, the seafloor's pale blues.
 */

import type { MarkerShape } from '../../render/geo-markers';
import type { RampStop } from '../weather/ramps';

export const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Equal hard-edged bands, left to right. */
export function bandLegend(colors: readonly number[]): string {
  const step = 100 / colors.length;
  const bands = colors.map((c, i) => `${hex(c)} ${(i * step).toFixed(1)}% ${((i + 1) * step).toFixed(1)}%`);
  return `linear-gradient(to right, ${bands.join(', ')})`;
}

export const CABLE_COLORS = {
  /** In service. */
  cable: 0x45f0c0,
  /** Announced, not yet lit. */
  planned: 0xc9a2ff,
  landing: 0xe9fff7,
} as const;

export interface PointStyle {
  readonly shape: MarkerShape;
  readonly color: number;
  readonly sizePx: number;
  /** CSS colour of the names. */
  readonly labelColor: string;
}

export const MOUNTAIN_STYLE: PointStyle = { shape: 'triangle', color: 0xffffff, sizePx: 9, labelColor: '#ffffff' };
export const DEEP_STYLE: PointStyle = { shape: 'cross', color: 0xffb347, sizePx: 10, labelColor: '#ffc978' };
export const LAUNCH_STYLE: PointStyle = { shape: 'star', color: 0xff6fb1, sizePx: 11, labelColor: '#ff9fca' };
export const ACCELERATOR_STYLE: PointStyle = { shape: 'diamond', color: 0x8f7dff, sizePx: 8, labelColor: '#b9adff' };
export const HERITAGE_STYLE: PointStyle = { shape: 'square', color: 0xe8c468, sizePx: 4, labelColor: '#f0d58c' };
export const WRECK_STYLE: PointStyle = { shape: 'ring', color: 0x9fb4c8, sizePx: 7, labelColor: '#b8c9d9' };
export const PORT_STYLE: PointStyle = { shape: 'square', color: 0x58c8ff, sizePx: 4.5, labelColor: '#8fdcff' };
export const AIRPORT_STYLE: PointStyle = { shape: 'cross', color: 0xf4f7ff, sizePx: 5.5, labelColor: '#e6ecff' };
export const NUCLEAR_STYLE: PointStyle = { shape: 'disc', color: 0xf03cff, sizePx: 6, labelColor: '#f79dff' };

export type ObservatoryKind = 'optical' | 'radio' | 'observatory' | 'neutrino' | 'gw';

/** Rings: an eyepiece. Colour says what is looked at with. */
export const OBSERVATORY_COLORS: Readonly<Record<ObservatoryKind, number>> = {
  optical: 0x9fd0ff,
  observatory: 0x9fd0ff,
  radio: 0x7dffb0,
  neutrino: 0xff9df0,
  gw: 0xffffff,
};

/** Fuels as the Global Power Plant Database names them; anything else is `other`. */
export const FUEL_COLORS: Readonly<Record<string, number>> = {
  Coal: 0x9a9a9a,
  Gas: 0xff9f43,
  Oil: 0xb5651d,
  Nuclear: 0xf03cff,
  Hydro: 0x4aa8ff,
  Solar: 0xffe14a,
  Wind: 0x7ff0d0,
};
export const OTHER_FUEL_COLOR = 0x9acd66;
export const fuelColor = (fuel: string): number => FUEL_COLORS[fuel] ?? OTHER_FUEL_COLOR;

/** Disc width, CSS px, for a plant's capacity: area goes with the megawatts, between a floor and a ceiling. */
export function plantSizePx(mw: number): number {
  return Math.min(16, Math.max(3.5, 3.5 * Math.sqrt(mw / 500)));
}

export const WATER_COLORS = {
  river: 0x4aa0ff,
  lake: 0x86d4ff,
} as const;

export const ROUTE_COLOR = 0xffe2a6;

/**
 * The ship-density image's code, as tools/pipeline/generate_ship_density.py
 * writes it: 0 below the floor, then DECADES decades of density over 1..255.
 */
export const SHIP_DENSITY_FLOOR = 3000;
export const SHIP_DENSITY_DECADES = 5;
/** Code (0..1) of a density, positions per km². */
export const shipDensityCode = (density: number): number =>
  density < SHIP_DENSITY_FLOOR ? 0 : (1 + (254 * Math.log10(density / SHIP_DENSITY_FLOOR)) / SHIP_DENSITY_DECADES) / 255;

/** Over the code 0..1: open sea dark, the lanes cyan, the straits and harbour approaches white-hot. */
export const SHIP_DENSITY_RAMP: readonly RampStop[] = [
  [0, 0x0b1f4d],
  [0.25, 0x1557a8],
  [0.45, 0x18a6c9],
  [0.62, 0x6fe3b4],
  [0.78, 0xf6e58a],
  [1, 0xffffff],
];
