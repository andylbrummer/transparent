import type { LayerDefinition } from '../types';
import { ICE_SHEET_COLOR } from '../ice-age/layer';

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
  load: async (context) => (await import('./ice-sheets-time')).createIceSheetsTimeLayer(context),
};

export default iceSheetsTime;
