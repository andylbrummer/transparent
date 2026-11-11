import type { LayerDefinition } from '../types';
import { FIELDS_LEGEND } from './classes';

const oilGasFields: LayerDefinition = {
  id: 'oil-gas-fields',
  label: 'Oil and gas fields',
  section: 'Human world',
  order: 42,
  legend: FIELDS_LEGEND,
  caption:
    '17,181 field outlines: orange oil, blue gas, violet both, pale not stated · ' +
    'far from complete: in the United States only the basins on the EIA’s 2005 maps (the Rockies, the Appalachians, the northern plains, Alaska, ' +
    'some of California; nothing in Texas, Oklahoma, Kansas, Louisiana or the US Gulf of Mexico), ' +
    'and none at all for China, Brazil, Venezuela, Argentina, Colombia or Malaysia · ' +
    'Ghawar, the largest oil field, only as its parts (Shedgum, Haradh) · the Gulf’s fields are from a 2014 website, most of Russia’s from a GIS forum · ' +
    'fields a few km across are drawn as a pixel, so small ones look larger than they are',
  credits: [
    {
      what: 'Oil and gas field outlines (Oil and Gas Infrastructure Mapping database, OGIM v3.0, fields layer)',
      source:
        'Omara, M., Gautam, R., O’Brien, M. et al. (2023), Developing a spatially explicit global oil and gas infrastructure database for characterizing methane emission sources at high resolution, Earth Syst. Sci. Data 15, 3761–3790, doi:10.5194/essd-15-3761-2023; OGIM v3.0 (Environmental Defense Fund / MethaneSAT), Zenodo record 22835235',
      licence: 'CC BY 4.0 (the database); several upstream sources have no stated licence (see docs: human-world)',
      url: 'https://zenodo.org/records/22835235',
    },
  ],
  load: async (context) => (await import('./oil-gas-fields')).createOilGasFieldsLayer(context),
};

export default oilGasFields;
