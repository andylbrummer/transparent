import type { LayerDefinition } from '../types';

const stars: LayerDefinition = {
  id: 'stars',
  label: 'Stars',
  section: 'Sky',
  order: 10,
  defaultOn: true,
  caption: '15,544 stars to magnitude 7, true colours · names for the brightest',
  credits: [
    {
      what: 'Star positions, magnitudes and colours',
      source: 'The Hipparcos and Tycho Catalogues, ESA SP-1200 (1997), via CDS VizieR I/239',
      licence: 'free use with acknowledgement',
      url: 'https://www.cosmos.esa.int/web/hipparcos/catalogues',
    },
    {
      what: 'Positions of seven close binaries Hipparcos could not solve (ξ UMa, ξ Sco and five fainter)',
      source: 'SIMBAD astronomical database, CDS Strasbourg',
      licence: 'free use with acknowledgement',
      url: 'https://simbad.cds.unistra.fr/simbad/',
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
