import type { LayerDefinition } from '../types';
import { depositLegend } from './deposits';

const mineralDeposits: LayerDefinition = {
  id: 'mineral-deposits',
  label: 'Major mineral deposits',
  section: 'Human world',
  order: 70,
  legend: depositLegend(['precious', 'base', 'steel', 'aluminium', 'critical', 'gems', 'industrial']),
  caption:
    '3,161 deposits of the major non-fuel minerals, coloured by what they are first worked for: ' +
    'gold · copper and base metals · iron and steel metals · bauxite · lithium, rare earths, tin and the like · diamonds and gems · phosphate, potash, salt · ' +
    'no tonnages in the source, so all are one size; a few well-known ones are named · positions near the deposits, not their outlines · compiled 2005',
  credits: [
    {
      what: 'Major mineral deposits: name, country, position, commodities, geological setting',
      source: 'Schulz, K.J. & Briskey, J.A. (compilers), Major mineral deposits of the world, U.S. Geological Survey Open-File Report 2005-1294',
      licence: 'public domain (U.S. Government work)',
      url: 'https://mrdata.usgs.gov/major-deposits/',
    },
  ],
  load: async (context) => (await import('./mineral-deposits')).createMineralDepositLayer(context),
};

export default mineralDeposits;
