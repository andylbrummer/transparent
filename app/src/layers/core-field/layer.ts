import type { LayerDefinition, LayerParams } from '../types';
import { CORE_FIELD_LEGEND } from './shade';

/** What a guide or a link may set (core-field.ts setParams). The years are IGRF's span: a test holds them to the baked epochs. */
export const CORE_FIELD_PARAMS = {
  year: { type: 'number', description: 'The year shown; between two epochs the pictures are blended.', minimum: 1900, maximum: 2025 },
  playing: { type: 'boolean', description: 'Play toward the present, or pause. Played from the present, it starts at 1900.' },
} as const satisfies LayerParams;

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
  params: CORE_FIELD_PARAMS,
  load: async (context) => (await import('./core-field')).createCoreFieldLayer(context),
};

export default coreField;
