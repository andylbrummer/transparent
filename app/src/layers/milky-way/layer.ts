import type { LayerDefinition } from '../types';

const milkyWay: LayerDefinition = {
  id: 'milky-way',
  label: 'Milky Way',
  section: 'Sky',
  order: 30,
  caption: 'the summed light of 1.7 billion Gaia stars too faint to draw one by one',
  credits: [
    {
      what: 'Milky Way panorama (Deep Star Maps 2020)',
      source: 'NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC',
      licence: 'public domain, credit requested',
      url: 'https://svs.gsfc.nasa.gov/4851',
    },
  ],
  load: async (context) => (await import('./milky-way')).createMilkyWayLayer(context),
};

export default milkyWay;
