import type { LayerDefinition } from '../types';
import { rampGradient } from '../weather/ramps';
import { SKS_RAMP } from './stations';

const sksSplitting: LayerDefinition = {
  id: 'sks-splitting',
  label: 'Grain of the upper mantle (SKS splitting)',
  section: 'Inside the Earth',
  order: 22,
  legend: rampGradient(SKS_RAMP),
  caption:
    'at 13,352 seismic stations, the direction shear waves from the core ran fastest on their way up: mostly olivine crystals lined up by the mantle’s flow in the top few hundred km · ' +
    'bar along the fast direction, longer and yellower for a longer delay (0.3 … 2 s; 1 s = 90 km of bar), dimmer where a station’s measurements disagree · ' +
    'grey rings: 268 stations where every wave arrived unsplit · the depth of the grain along the path is not known · 66,458 published measurements, averaged per station',
  credits: [
    {
      what: 'Shear-wave splitting measurements of SKS, SKKS and PKS at seismic stations, from the published literature',
      source:
        'Barruol, G., Wüstefeld, A. & Bokelmann, G. (2009), SKS-Splitting-database, Université de Montpellier, Laboratoire Géosciences, doi:10.18715/SKS_SPLITTING_DATABASE; Wüstefeld, A. et al. (2009), Phys. Earth Planet. Inter. 176, 198–212; and the works it compiles',
      licence: 'open-access database, no named licence; the site asks that the works be cited',
      url: 'https://doi.org/10.18715/SKS_SPLITTING_DATABASE',
    },
  ],
  load: async (context) => (await import('./sks-splitting')).createSksLayer(context),
};

export default sksSplitting;
