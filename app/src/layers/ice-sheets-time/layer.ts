import type { LayerDefinition, LayerParams } from '../types';
import { ICE_SHEET_COLOR } from '../ice-age/layer';

/**
 * What a guide or a link may set (ice-sheets-time.ts setParams). The slice ids are the baked file's, written here so
 * that a guide is checked without fetching it; a test holds the two together.
 */
export const ICE_SHEETS_TIME_PARAMS = {
  slice: {
    type: 'string',
    description: 'The time-slice, youngest first; today is the present, with no northern ice sheets but Greenland’s.',
    values: [
      'today',
      'lgm',
      '30ka',
      '35ka',
      '40ka',
      '45ka',
      'mis4',
      'mis5a',
      'mis5b',
      'mis5c',
      'mis5d',
      'mis6',
      'mis8',
      'mis10',
      'mis12',
      'mis16',
      'mis20-24',
      'early-matuyama',
      'late-gauss',
    ],
  },
  playing: { type: 'boolean', description: 'Step toward the present, or pause. Played from today, it starts at the oldest slice.' },
} as const satisfies LayerParams;

const iceSheetsTime: LayerDefinition = {
  id: 'ice-sheets-time',
  label: 'Ice sheets through time',
  section: 'Surface',
  order: 98,
  legend: ICE_SHEET_COLOR,
  // One drape of past ice at a time: this or the last glacial maximum with its emerged land.
  exclusiveGroup: 'ice-age',
  caption:
    'the northern ice sheets in 18 time-slices back to 3.6 million years ago, a published best estimate for each · the largest ice of each slice, except 45 ka, MIS 5a and 5c, drawn at their warmest · sheets over 50,000 km² only, nothing in the south · step through with the control',
  credits: [
    {
      what: 'Northern Hemisphere ice-sheet extent in 18 time-slices of the Quaternary (best estimates)',
      source:
        'Batchelor, C.L., Margold, M., Krapp, M., Murton, D.K., Dalton, A.S., Gibbard, P.L., Stokes, C.R., Murton, J.B. & Manica, A. (2019), The configuration of Northern Hemisphere ice sheets through the Quaternary, Nature Communications 10, 3713; shapefiles at osf.io/7jen3',
      licence: 'article CC BY 4.0; no stated licence on the data repository',
      url: 'https://doi.org/10.1038/s41467-019-11601-2',
    },
  ],
  params: ICE_SHEETS_TIME_PARAMS,
  load: async (context) => (await import('./ice-sheets-time')).createIceSheetsTimeLayer(context),
};

export default iceSheetsTime;
