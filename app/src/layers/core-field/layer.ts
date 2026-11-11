import type { LayerDefinition } from '../types';
import { CORE_FIELD_LEGEND } from './shade';

const coreField: LayerDefinition = {
  id: 'core-field',
  label: 'Magnetic field on the core, 1900–2025',
  section: 'Inside the Earth',
  order: 58,
  legend: CORE_FIELD_LEGEND,
  caption:
    'the field where the geodynamo makes it, on the core 2,891 km down: teal points into the core, gold out · ' +
    'continued down from the field measured at the surface (IGRF, to degree 10), so only its broad patches show · ' +
    'flux lobes under Canada and Siberia; the reversed patches under the South Atlantic that weaken the field there grow · ' +
    'step through the years with the control',
  credits: [
    {
      what: 'Main geomagnetic field, Gauss coefficients 1900–2025',
      source:
        'International Geomagnetic Reference Field, 14th generation (IGRF-14), IAGA Division V Working Group V-MOD, December 2024; coefficient file served by NOAA NCEI',
      licence: 'freely available international reference model; the file is distributed by NOAA (US Government)',
      url: 'https://www.ncei.noaa.gov/products/international-geomagnetic-reference-field',
    },
  ],
  load: async (context) => (await import('./core-field')).createCoreFieldLayer(context),
};

export default coreField;
