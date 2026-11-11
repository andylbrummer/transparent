import type { LayerDefinition } from '../types';
import { rampGradient } from '../weather/ramps';
import { LITHOSPHERE_RAMP } from './ramp';

const lithosphere: LayerDefinition = {
  id: 'lithosphere',
  label: 'Lithosphere thickness (the plates’ depth)',
  section: 'Inside the Earth',
  order: 20,
  legend: rampGradient(LITHOSPHERE_RAMP),
  caption:
    'how deep the cold, rigid plate goes before the mantle below flows: 20 km (dark) … 260 km (white), drawn on the surface above · a line every 50 km · ' +
    'keels over 150 km under the old cratons of Canada, Siberia, Africa, Australia and Scandinavia; under 40 km at the spreading ridges, thickening as the seafloor ages · ' +
    'a model from surface waves (CAM2023), 2° cells',
  credits: [
    {
      what: 'Depth of the thermal lithosphere-asthenosphere boundary (model CAM2023, 2° grid)',
      source:
        'Priestley, K., Ho, T., Takei, Y. & McKenzie, D. (2024), The thermal and anisotropic structure of the top 300 km of the mantle, Earth Planet. Sci. Lett. 626, 118525; files from the EarthScope Earth Model Collaboration (CAM2023.emc, 2025-01-13)',
      licence: 'no stated licence; the authors and the EMC ask to be cited',
      url: 'https://doi.org/10.1016/j.epsl.2023.118525',
    },
  ],
  load: async (context) => (await import('./lithosphere')).createLithosphereLayer(context),
};

export default lithosphere;
