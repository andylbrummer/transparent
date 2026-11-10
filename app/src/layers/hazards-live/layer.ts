import type { MarkerShape } from '../../render/geo-markers';
import type { LayerDefinition } from '../types';

export interface HazardCategory {
  /** EONET category ids drawn this way. */
  readonly ids: readonly string[];
  readonly label: string;
  readonly symbol: string;
  readonly shape: MarkerShape;
  readonly color: number;
}

/**
 * How each kind of event is drawn, in the legend's order. Shape tells them
 * apart as much as colour: an erupting volcano is a triangle like any
 * volcano, but in a red the volcano layer does not use.
 */
export const HAZARD_CATEGORIES: readonly HazardCategory[] = [
  { ids: ['wildfires'], label: 'wildfire', symbol: '●', shape: 'disc', color: 0xff6a1f },
  { ids: ['volcanoes'], label: 'erupting volcano', symbol: '▲', shape: 'triangle', color: 0xff2f55 },
  { ids: ['severeStorms'], label: 'severe storm', symbol: '◯', shape: 'ring', color: 0xffffff },
  { ids: ['floods'], label: 'flood', symbol: '◆', shape: 'diamond', color: 0x4aa8ff },
  { ids: ['seaLakeIce'], label: 'iceberg', symbol: '■', shape: 'square', color: 0xd4f3ff },
];
/** Whatever else EONET lists (drought, dust, landslides, snow, temperature extremes, water colour, man-made). */
export const OTHER_HAZARD: HazardCategory = { ids: [], label: 'other', symbol: '✚', shape: 'cross', color: 0xc8b6ff };

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const ALL = [...HAZARD_CATEGORIES, OTHER_HAZARD];
const step = 100 / ALL.length;

const hazardsLive: LayerDefinition = {
  id: 'hazards-live',
  label: 'Natural events now (live)',
  section: 'Surface',
  order: 73,
  legend: `linear-gradient(to right, ${ALL.map((c, i) => `${hex(c.color)} ${(i * step).toFixed(1)}% ${((i + 1) * step).toFixed(1)}%`).join(', ')})`,
  caption: `${ALL.map((c) => `${c.symbol} ${c.label}`).join(' · ')} — volcanoes, icebergs and storms in progress; fires and floods reported in the past 14 days, fading with age; fires sized by area`,
  credits: [
    {
      what: 'Natural events in progress (live)',
      source:
        'NASA Earth Observatory Natural Event Tracker (EONET) v3, which curates events from GDACS, InciWeb/IRWIN, the Smithsonian Global Volcanism Program, the U.S. National Ice Center, BYU, JTWC and NOAA NHC',
      licence: 'NASA open data, no restrictions on use',
      url: 'https://eonet.gsfc.nasa.gov/',
    },
  ],
  load: async (context) => (await import('./hazards')).createHazardsLayer(context),
};

export default hazardsLive;
