import type { LayerDefinition } from '../types';
import { AGE_LEGEND } from './ages';

const igneousProvinces: LayerDefinition = {
  id: 'igneous-provinces',
  label: 'Large igneous and volcanic provinces',
  section: 'Surface',
  order: 66,
  legend: AGE_LEGEND,
  caption:
    'where the mantle poured out magma apart from the mid-ocean ridges: flood basalts, oceanic plateaus, dyke swarms and seamount chains · ' +
    'coloured by the age the compilation gives, 0 Ma on the left to 300 Ma and older on the right · ' +
    'drawn where they are today, not where they erupted · the best known are named with their ages',
  credits: [
    {
      what: 'Volcanic provinces (large igneous provinces and other non-ridge magmatism), v2',
      source:
        'Johansson, L., Zahirovic, S. & Müller, R.D. (2018), The interplay between the eruption and weathering of Large Igneous Provinces and the deep-time carbon cycle, Geophysical Research Letters 45, doi:10.1029/2017GL076691; EarthByte GPlates 2.3 sample data, IgneousProvinces.zip',
      licence: 'CC BY 3.0',
      url: 'https://www.earthbyte.org/webdav/ftp/earthbyte/GPlates/GPlates2.3_GeoData/Individual/IgneousProvinces.zip',
    },
  ],
  load: async (context) => (await import('./igneous')).createIgneousProvincesLayer(context),
};

export default igneousProvinces;
