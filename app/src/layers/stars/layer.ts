import type { LayerDefinition } from '../types';

const stars: LayerDefinition = {
  id: 'stars',
  label: 'Stars',
  section: 'Sky',
  order: 10,
  defaultOn: true,
  caption: '15,537 stars to magnitude 7, true colours · names for the brightest',
  credits: [
    {
      what: 'Star positions, magnitudes and colours',
      source: 'The Hipparcos and Tycho Catalogues, ESA SP-1200 (1997), via CDS VizieR I/239',
      licence: 'free use with acknowledgement',
      url: 'https://www.cosmos.esa.int/web/hipparcos/catalogues',
    },
    {
      what: 'Star names',
      source: 'IAU Catalog of Star Names, IAU Working Group on Star Names',
      licence: 'CC BY 4.0',
      url: 'https://www.iau.org/public/themes/naming_stars/',
    },
  ],
  load: async (context) => (await import('./stars')).createStarLayer(context),
};

export default stars;
