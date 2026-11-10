import type { Credit, LayerDefinition } from '../types';

const FIGURES_CREDIT: Credit = {
  what: 'Constellation figures and name positions',
  source: 'd3-celestial by Olaf Frohn, after the IAU / Sky & Telescope constellation charts',
  licence: 'BSD 3-Clause',
  url: 'https://github.com/ofrohn/d3-celestial',
};

const BOUNDARIES_CREDIT: Credit = {
  what: 'Constellation boundaries',
  source: 'Catalogue of Constellation Boundary Data, Davenhall & Leggett 1989 (CDS VI/49), after Delporte 1930',
  licence: 'free use with acknowledgement',
  url: 'https://vizier.cfa.harvard.edu/ftp/cats/VI/49/',
};

const constellations: LayerDefinition = {
  id: 'constellations',
  label: 'Constellations',
  section: 'Sky',
  order: 20,
  caption: 'the 88 IAU constellations: figures and names',
  credits: [FIGURES_CREDIT],
  load: async (context) => (await import('./constellations')).createFiguresLayer(context),
};

const boundaries: LayerDefinition = {
  id: 'constellation-boundaries',
  label: 'Constellation boundaries',
  section: 'Sky',
  order: 21,
  caption: 'IAU 1930: along the hour circles and parallels of 1875',
  credits: [BOUNDARIES_CREDIT],
  load: async (context) => (await import('./constellations')).createBoundariesLayer(context),
};

const grid: LayerDefinition = {
  id: 'sky-grid',
  label: 'Sky grid',
  section: 'Sky',
  order: 22,
  legend: 'linear-gradient(90deg, #5fb4d8 0 33%, #e0c060 33% 66%, #c878c8 66%)',
  caption: 'celestial equator · ecliptic · galactic plane, on hour circles and parallels',
  // Geometry, not data: nothing to credit.
  credits: [],
  load: async (context) => (await import('./grid')).createGridLayer(context),
};

export default [constellations, boundaries, grid];
