import type { LayerDefinition } from '../types';
import { AGE_LEGEND_MYR, ageRampGradient } from './ramp';

/** Lines of equal age are drawn this far apart, Myr. */
export const ISOCHRON_MYR = 10;

const seafloorAge: LayerDefinition = {
  id: 'seafloor-age',
  label: 'Seafloor age',
  section: 'Surface',
  order: 40,
  legend: ageRampGradient(),
  caption: `age of the ocean crust, 0 – ${AGE_LEGEND_MYR} Myr · a line every ${ISOCHRON_MYR} Myr · brightest: new crust at the ridges`,
  credits: [
    {
      what: 'Age of the oceanic crust',
      source: 'Seton et al. (2020), Geochemistry, Geophysics, Geosystems 21, e2020GC009214; EarthByte age grid 2020.1 (GTS2012)',
      licence: 'CC BY 4.0',
      url: 'https://www.earthbyte.org/webdav/ftp/earthbyte/agegrid/2020/',
    },
  ],
  load: async (context) => (await import('./age')).createSeafloorAgeLayer(context),
};

export default seafloorAge;
