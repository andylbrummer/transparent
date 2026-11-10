import type { LayerDefinition } from '../types';

const moon: LayerDefinition = {
  id: 'moon',
  label: 'Moon',
  section: 'Sky',
  order: 50,
  // One small sphere and one 1024 px map: cheap, and half the nights it is the brightest thing up there.
  defaultOn: true,
  caption: 'true place for where you stand, size, phase and libration · zoom in for the face',
  credits: [
    {
      what: 'Position, phase and orientation of the Moon',
      source: 'Lunar theory ELP-2000/82 and Cassini’s laws as in Meeus, Astronomical Algorithms (1998); checked against JPL Horizons',
      licence: 'free use with acknowledgement',
      url: 'https://ssd.jpl.nasa.gov/horizons/',
    },
    {
      what: 'Map of the Moon (LRO camera colour mosaic, CGI Moon Kit)',
      source: 'NASA’s Scientific Visualization Studio, from NASA/GSFC/Arizona State University LROC data',
      licence: 'public domain, credit requested',
      url: 'https://svs.gsfc.nasa.gov/4720',
    },
  ],
  load: async (context) => (await import('./moon')).createMoonLayer(context),
};

export default moon;
