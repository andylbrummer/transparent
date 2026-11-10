import type { LayerDefinition } from '../types';

/** Ice sheet and emerged land, as drawn. */
export const ICE_SHEET_COLOR = '#eaf4fb';
export const EMERGED_LAND_COLOR = '#a89a5c';

const iceAge: LayerDefinition = {
  id: 'ice-age',
  label: 'Ice age: the last glacial maximum',
  section: 'Surface',
  order: 97,
  legend: `linear-gradient(to right, ${ICE_SHEET_COLOR} 0 50%, ${EMERGED_LAND_COLOR} 50% 100%)`,
  // One drape of past ice at a time: this or the ice sheets through time.
  exclusiveGroup: 'ice-age',
  caption:
    'white: the northern ice sheets about 26,000–19,000 years ago, a published reconstruction · tan: sea floor less than 125 m deep today, about what a sea 120–135 m lower left dry · today’s depths, no allowance for the crust rising and sinking · Antarctica’s and Patagonia’s larger ice is not drawn',
  credits: [
    {
      what: 'Northern Hemisphere ice-sheet extent at the Last Glacial Maximum (best estimate)',
      source:
        'Batchelor, C.L., Margold, M., Krapp, M., Murton, D.K., Dalton, A.S., Gibbard, P.L., Stokes, C.R., Murton, J.B. & Manica, A. (2019), The configuration of Northern Hemisphere ice sheets through the Quaternary, Nature Communications 10, 3713; shapefiles at osf.io/7jen3',
      licence: 'article CC BY 4.0; no stated licence on the data repository',
      url: 'https://doi.org/10.1038/s41467-019-11601-2',
    },
    {
      what: 'Sea-floor depths (ETOPO1 global relief, every fourth arc-minute)',
      source: 'Amante, C. & Eakins, B.W. (2009), ETOPO1 1 Arc-Minute Global Relief Model, NOAA National Geophysical Data Center; served by NOAA CoastWatch ERDDAP',
      licence: 'public domain (U.S. Government work)',
      url: 'https://www.ncei.noaa.gov/products/etopo-global-relief-model',
    },
    {
      what: 'Sea level at the glacial maximum (about 134 m below today’s)',
      source: 'Lambeck, K., Rouby, H., Purcell, A., Sun, Y. & Sambridge, M. (2014), Sea level and global ice volumes from the Last Glacial Maximum to the Holocene, PNAS 111, 15296–15303',
      licence: 'cited figure',
      url: 'https://doi.org/10.1073/pnas.1411762111',
    },
  ],
  load: async (context) => (await import('./ice-age')).createIceAgeLayer(context),
};

export default iceAge;
