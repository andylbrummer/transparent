import type { LayerDefinition } from '../types';

export type TsunamiCause = 'earthquake' | 'landslide' | 'volcano' | 'other';

/** What raised the water, in the legend's order. Sea-teal for the usual cause; none is a depth or boundary colour. */
export const TSUNAMI_CAUSES: readonly { readonly key: TsunamiCause; readonly label: string; readonly color: number }[] = [
  { key: 'earthquake', label: 'earthquake', color: 0x35d6cb },
  { key: 'landslide', label: 'landslide', color: 0xe9d48c },
  { key: 'volcano', label: 'volcano', color: 0xff7d5c },
  { key: 'other', label: 'weather, explosion or unknown', color: 0xaab4c0 },
];

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const step = 100 / TSUNAMI_CAUSES.length;

const tsunamis: LayerDefinition = {
  id: 'tsunamis',
  label: 'Tsunamis in history',
  section: 'Surface',
  order: 76,
  legend: `linear-gradient(to right, ${TSUNAMI_CAUSES.map((c, i) => `${hex(c.color)} ${i * step}% ${(i + 1) * step}%`).join(', ')})`,
  caption: `✚ sources of the 641 tsunamis since 1610 BCE that ran up 1 m or more or killed · raised by ${TSUNAMI_CAUSES.map((c) => c.label).join(' / ')} · size by highest run-up (to 524 m) and deaths`,
  credits: [
    {
      what: 'Tsunami source events: date, cause, maximum water height, deaths',
      source:
        'National Geophysical Data Center / World Data Service: NCEI/WDS Global Historical Tsunami Database, NOAA National Centers for Environmental Information, doi:10.7289/V5PN93H7',
      licence: 'public domain (U.S. Government work)',
      url: 'https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/tsunamis',
    },
  ],
  load: async (context) => (await import('./tsunamis')).createTsunamiLayer(context),
};

export default tsunamis;
