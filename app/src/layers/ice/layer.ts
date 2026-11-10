import type { LayerDefinition } from '../types';

/** Grounded ice: glaciers, ice caps, the two ice sheets. */
export const LAND_ICE_COLOR = '#e8f7ff';
/** Floating ice shelves, still fed by the ice sheet behind them. */
export const ICE_SHELF_COLOR = '#7fd6e8';
/** The edge of the sea ice on the day shown. */
export const ICE_EDGE_COLOR = '#ffffff';
/** Where that edge sat on the same day of the year in the median of 1981–2010. */
export const MEDIAN_EDGE_COLOR = '#ff9f43';

/** A colour ramp: [value, '#rrggbb'] stops in rising order, blended linearly between. */
export type RampStop = readonly [number, string];

/** Ice thickness, metres: the pale of thin ice to the indigo of the deepest basins. */
export const THICKNESS_RAMP: readonly RampStop[] = [
  [0, '#eefcff'],
  [1000, '#9bdcf2'],
  [2000, '#4a9bdc'],
  [3000, '#3d55bd'],
  [4000, '#5a2ea3'],
  [4800, '#2b1058'],
];

/** Bed elevation, metres from sea level: blue below it, earth above, white for the highest buried ranges. */
export const BED_RAMP: readonly RampStop[] = [
  [-2500, '#0b2a6b'],
  [-1000, '#3f7fc4'],
  [0, '#d8ecf5'],
  [500, '#d9c58f'],
  [1500, '#a8743b'],
  [3000, '#6b3a1d'],
  [4000, '#ffffff'],
];

/** The ramp as a CSS gradient with each stop at its value's place along the bar. */
export function rampGradient(stops: readonly RampStop[]): string {
  const low = stops[0][0];
  const span = stops[stops.length - 1][0] - low;
  return `linear-gradient(to right, ${stops.map(([value, color]) => `${color} ${(((value - low) / span) * 100).toFixed(1)}%`).join(', ')})`;
}

const BEDMAP3_CREDIT = {
  source:
    'Pritchard, H., Fretwell, P., Fremand, A., Bodart, J., Kirkham, J., Aitken, A., et al. (2024), BEDMAP3 - Ice thickness, bed and surface elevation for Antarctica - gridding products (Version 1.0), NERC EDS UK Polar Data Centre, doi:10.5285/2d0e4791-8e20-46a3-80e4-f5f6716025d2',
  licence: 'CC BY 4.0',
  url: 'https://doi.org/10.5285/2d0e4791-8e20-46a3-80e4-f5f6716025d2',
} as const;

const NATURAL_EARTH_URL = 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/';

const ICE_LAYERS: readonly LayerDefinition[] = [
  {
    id: 'glaciers',
    label: 'Glaciers, ice sheets and ice shelves',
    section: 'Surface',
    order: 93,
    legend: `linear-gradient(to right, ${LAND_ICE_COLOR} 0 50%, ${ICE_SHELF_COLOR} 50% 100%)`,
    caption:
      'white: ice resting on land, from mountain glaciers to the ice sheets · aqua: Antarctic ice shelves, afloat · areas are those of the mapped outlines',
    credits: [
      {
        what: 'Glaciated areas and Antarctic ice shelves, with their names',
        source: 'Natural Earth 1:10m physical vectors (glaciated areas; Antarctic ice shelves)',
        licence: 'public domain',
        url: NATURAL_EARTH_URL,
      },
    ],
    load: async (context) => (await import('./glaciers')).createGlacierLayer(context),
  },
  {
    id: 'sea-ice-extent',
    label: 'Sea ice edge, with its 1981–2010 median',
    section: 'Surface',
    order: 94,
    legend: `linear-gradient(to right, ${ICE_EDGE_COLOR} 0 50%, ${MEDIAN_EDGE_COLOR} 50% 100%)`,
    caption:
      'white: edge of the sea ice (15 % cover) on the day named · orange: the median edge for that day of the year, 1981–2010 · baked days: the newest, and the 1st and 15th of the year before',
    credits: [
      {
        what: 'Sea ice extent grids, median extent lines and daily extent figures',
        source:
          'Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. & Stafford, T. (2025), Sea Ice Index, Version 4 (G02135), National Snow and Ice Data Center, Boulder, Colorado, doi:10.7265/a98x-0f50',
        licence: 'free to use with citation (NOAA@NSIDC)',
        url: 'https://nsidc.org/data/g02135',
      },
    ],
    load: async (context) => (await import('./sea-ice')).createSeaIceLayer(context),
  },
  {
    id: 'antarctic-ice-thickness',
    label: 'Antarctic ice thickness',
    section: 'Surface',
    order: 95,
    exclusiveGroup: 'antarctic-ice',
    legend: rampGradient(THICKNESS_RAMP),
    caption: '0 – 4,800 m of ice, grounded and floating · Bedmap3, averaged to 4 km · the cross marks the thickest ice in the grid',
    credits: [{ what: 'Antarctic ice thickness (Bedmap3)', ...BEDMAP3_CREDIT }],
    load: async (context) => (await import('./antarctic')).createAntarcticLayer(context, 'thickness'),
  },
  {
    id: 'antarctic-bed',
    label: 'Antarctica under the ice',
    section: 'Surface',
    order: 96,
    exclusiveGroup: 'antarctic-ice',
    legend: rampGradient(BED_RAMP),
    caption:
      'the bed beneath the ice, −2,500 – +4,000 m from sea level: blue would be sea without the ice, as the land lies today, still pressed down by its load · Bedmap3, 4 km · the cross marks the deepest point under grounded ice',
    credits: [{ what: 'Elevation of the bed under the Antarctic ice (Bedmap3)', ...BEDMAP3_CREDIT }],
    load: async (context) => (await import('./antarctic')).createAntarcticLayer(context, 'bed'),
  },
];

export default ICE_LAYERS;
