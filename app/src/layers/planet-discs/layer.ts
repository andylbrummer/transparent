import type { LayerDefinition } from '../types';

const planetDiscs: LayerDefinition = {
  id: 'planet-discs',
  label: 'Planets close up',
  section: 'Sky',
  order: 56,
  caption:
    'discs, phases, Saturn’s rings and the big moons at their true places · drawn 40× life size · the giants’ cloud maps are from the Voyager years: belts are where they are, spots have drifted',
  credits: [
    {
      what: 'Size, tilt, rotation and phase of the planets’ discs',
      source:
        'IAU Working Group on Cartographic Coordinates and Rotational Elements 2015 (Archinal et al. 2018), from NAIF kernel pck00011.tpc; checked against JPL Horizons',
      licence: 'free use with acknowledgement',
      url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/',
    },
    {
      what: 'Places of the moons of Jupiter, Saturn and Neptune',
      source: 'Precessing ellipses fitted to JPL Horizons satellite ephemerides over 1950–2050 (Giorgini et al., JPL Solar System Dynamics)',
      licence: 'free use with acknowledgement',
      url: 'https://ssd.jpl.nasa.gov/horizons/',
    },
    {
      what: 'Maps of Mars, Jupiter, Saturn and Neptune (Viking and Voyager mosaics)',
      source: 'NASA 3D Resources, from the JPL Solar System Simulator; NASA/JPL-Caltech',
      licence: 'public domain, credit requested',
      url: 'https://github.com/nasa/NASA-3D-Resources',
    },
    {
      what: 'Edges, optical depths and albedos of Saturn’s rings',
      source: 'Saturnian Rings Fact Sheet, D. R. Williams, NASA Space Science Data Coordinated Archive',
      licence: 'public domain',
      url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html',
    },
  ],
  load: async (context) => (await import('./discs')).createPlanetDiscsLayer(context),
};

export default planetDiscs;
