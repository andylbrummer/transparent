import type { LayerDefinition } from '../types';

const planets: LayerDefinition = {
  id: 'planets',
  label: 'Planets',
  section: 'Sky',
  order: 55,
  // Seven points and seven names.
  defaultOn: true,
  caption: 'Mercury to Neptune at their true places · size by apparent magnitude, on the stars’ scale',
  credits: [
    {
      what: 'Positions and magnitudes of the planets',
      source:
        'VSOP87 planetary theory, Bretagnon & Francou 1988 (CDS VI/81); magnitudes after Meeus, Astronomical Algorithms (1998) ch. 41; checked against JPL Horizons',
      licence: 'free use with acknowledgement',
      url: 'https://vizier.cfa.harvard.edu/ftp/cats/VI/81/',
    },
  ],
  load: async (context) => (await import('./planets')).createPlanetsLayer(context),
};

export default planets;
