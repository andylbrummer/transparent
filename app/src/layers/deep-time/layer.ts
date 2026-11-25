import type { Credit, LayerDefinition, LayerParams } from '../types';

const PLATE_MODEL: Credit = {
  what: 'Plate reconstruction, 1,000 Ma to today: rotations, coastlines and continental blocks (a model)',
  source:
    'Merdith, A.S., Williams, S.E., Collins, A.S., Tetley, M.G., Mulder, J.A., Blades, M.L., Young, A., Armistead, S.E., Cannon, J., Zahirovic, S. & Müller, R.D. (2021), Earth-Science Reviews 214, 103477, doi:10.1016/j.earscirev.2020.103477; model files from EarthByte / GPlates',
  licence: 'CC BY 4.0',
  url: 'https://doi.org/10.5281/zenodo.13635864',
};

const TIME_SCALE: Credit = {
  what: 'Geological time scale: periods, epochs and their colours',
  source:
    'International Commission on Stratigraphy, International Chronostratigraphic Chart v2024/12; Cohen, K.M., Harper, D.A.T., Gibbard, P.L. & Car, N. (2025), Episodes 48, 105–115',
  licence: 'CC BY 4.0',
  url: 'https://stratigraphy.org/chart',
};

/** What a guide or a link may set (continents.ts setParams). The age reaches as far back as the model: a test holds it to plates.bin. */
export const CONTINENTS_PARAMS = {
  ma: { type: 'number', description: 'Millions of years ago; 0 is today.', minimum: 0, maximum: 1000 },
  playing: { type: 'boolean', description: 'Play toward the present, or pause. Played from today, it starts at 250 Ma.' },
} as const satisfies LayerParams;

const continents: LayerDefinition = {
  id: 'continents-through-time',
  label: 'Continents through time',
  section: 'Surface lines',
  order: 60,
  legend: 'linear-gradient(to right, #c98f4a, #ffd27a)',
  caption:
    'Where a plate model puts the coasts and continental blocks, today back to 1,000 Ma · Merdith et al. (2021), palaeomagnetic frame: latitudes are real, longitudes the model’s choice · a model, not a measurement · deep time only: the sky and clock stay at now',
  credits: [PLATE_MODEL, TIME_SCALE],
  params: CONTINENTS_PARAMS,
  load: async (context) => (await import('./continents')).createContinentsLayer(context),
};

export default [continents];
