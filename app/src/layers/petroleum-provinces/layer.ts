import type { LayerDefinition } from '../types';
import { PROVINCES_LEGEND } from './classes';

const petroleumProvinces: LayerDefinition = {
  id: 'petroleum-provinces',
  label: 'Petroleum provinces (USGS, 2000)',
  section: 'Human world',
  order: 43,
  legend: PROVINCES_LEGEND,
  caption:
    'the 939 geologic provinces the USGS drew for its World Petroleum Assessment 2000, outlined · ' +
    'the 141 it assessed washed orange where mainly oil, blue where mainly gas, pale where it gave no main commodity · ' +
    'the 14 with the most oil and gas found by 2000 named, in barrels of oil equivalent produced and still in reserve then · ' +
    'the United States was not reassessed - the USGS’s 1995 national assessment stood - so its provinces are only outlined',
  credits: [
    {
      what: 'Geologic provinces of the world, with the commodity and the known and undiscovered petroleum of those assessed',
      source:
        'U.S. Geological Survey World Energy Assessment Team (2000), U.S. Geological Survey World Petroleum Assessment 2000 — Description and Results, USGS Digital Data Series DDS-60; shapefile “Geologic Provinces of the World, 2000 World Petroleum Assessment, all defined provinces” (Osmonson, Persits, Steinshouer & Klett)',
      licence: 'public domain (U.S. Government work)',
      url: 'https://www.sciencebase.gov/catalog/item/60ad2fd7d34e4043c850edb3',
    },
  ],
  load: async (context) => (await import('./petroleum-provinces')).createPetroleumProvincesLayer(context),
};

export default petroleumProvinces;
