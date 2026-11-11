import type { LayerDefinition } from '../types';
import { rampGradient } from '../weather/ramps';
import { RESIDUAL_RAMP } from './rays';

const innerCore: LayerDefinition = {
  id: 'inner-core',
  label: 'Inner core: rays through it (anisotropy)',
  section: 'Inside the Earth',
  order: 66,
  legend: rampGradient(RESIDUAL_RAMP),
  caption:
    '5,129 earthquake waves that crossed the solid inner core, each drawn from where it entered down to where it turned and out · ' +
    'blue arrived early, red late, against a standard Earth model, −3 … +4 s · ' +
    'the waves near the axis (grey line) are blue: iron crystals there are lined up, and waves travel faster along the axis than across it · ' +
    'what is empty no wave has crossed; the hemispheres and the innermost inner core that studies propose are not drawn',
  credits: [
    {
      what: 'PKIKP differential travel-time residuals, with inner-core entry, exit and turning points (compiled from six source sets)',
      source:
        'Frost, D.A., Lasbleis, M., Chandler, B. & Romanowicz, B. (2021), Dynamic history of the inner core constrained by seismic anisotropy, Nature Geoscience 14, 531–535, doi:10.1038/s41561-021-00761-w; data: Zenodo, doi:10.5281/zenodo.4721364',
      licence: 'CC BY 4.0',
      url: 'https://doi.org/10.5281/zenodo.4721364',
    },
  ],
  load: async (context) => (await import('./inner-core')).createInnerCoreLayer(context),
};

export default innerCore;
