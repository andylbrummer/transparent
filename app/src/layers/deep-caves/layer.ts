import type { LayerDefinition } from '../types';
import { DEPTH_BANDS } from './caves';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const stops = DEPTH_BANDS.map((band, i) => `${hex(band.color)} ${String(i * 25)}% ${String((i + 1) * 25)}%`).join(', ');

const deepCaves: LayerDefinition = {
  id: 'deep-caves',
  label: 'Caves with a known depth',
  section: 'Surface',
  order: 68,
  legend: `linear-gradient(to right, ${stops})`,
  caption:
    '▲ caves whose depth, entrance to lowest point, is on Wikidata: under 100 m · 100–300 m · 300 m–1 km · over 1 km · ' +
    'named: half a kilometre and deeper · the three deepest lie within 2 km of each other in the Arabika Massif, Abkhazia · ' +
    'coverage follows who entered the caves: many famous deep systems have no depth on Wikidata yet',
  credits: [
    {
      what: 'Caves, their positions and vertical depths (P4511)',
      source: 'Wikidata, queried at query.wikidata.org',
      licence: 'CC0 1.0',
      url: 'https://www.wikidata.org/wiki/Property:P4511',
    },
  ],
  load: async (context) => (await import('./deep-caves')).createDeepCaveLayer(context),
};

export default deepCaves;
