import type { Credit, LayerDefinition } from '../types';

const HORIZONS: Credit = {
  what: 'Positions of spacecraft beyond Earth orbit (baked table, 2026 – 2027)',
  source: 'NASA/JPL Horizons On-Line Ephemeris System, from the missions’ own trajectories',
  licence: 'free use with acknowledgement',
  url: 'https://ssd.jpl.nasa.gov/horizons/',
};

const MOON: Credit = {
  what: 'The Moon’s orbit',
  source: 'Lunar theory ELP-2000/82 as in Meeus, Astronomical Algorithms (1998); checked against JPL Horizons',
  licence: 'free use with acknowledgement',
  url: 'https://ssd.jpl.nasa.gov/horizons/',
};

const LAGRANGE: Credit = {
  what: 'Lagrange points (restricted three-body problem), from the masses of the Sun, Earth and Moon',
  source: 'Computed; gravitational parameters from NASA/JPL Horizons',
  licence: 'free use with acknowledgement',
  url: 'https://ssd.jpl.nasa.gov/horizons/',
};

const layers: LayerDefinition[] = [
  {
    id: 'moon-orbit',
    label: 'Moon’s orbit and Earth–Moon Lagrange points',
    section: 'Near space',
    order: 50,
    caption: 'the Moon’s real path over one month centred on now, at true distance · L1 – L5 as the three-body problem places them for the Moon’s distance today',
    credits: [MOON, LAGRANGE],
    load: async (context) => (await import('./moon-orbit')).createMoonOrbitLayer(context),
  },
  {
    id: 'spacecraft-lagrange',
    label: 'Spacecraft at Sun–Earth L1 and L2',
    section: 'Near space',
    order: 51,
    caption:
      'SOHO, DSCOVR, ACE and the other Sun-watchers 1.5 million km toward the Sun; JWST and Euclid as far the other way · direction from where you stand, distance in the label · nothing is shown past the end of a spacecraft’s published trajectory',
    credits: [HORIZONS, LAGRANGE],
    load: async (context) => (await import('./spacecraft')).createSpacecraftLayer(context, 'lagrange'),
  },
  {
    id: 'spacecraft-deep',
    label: 'Deep-space probes',
    section: 'Near space',
    order: 52,
    caption:
      'the Voyagers, Pioneers, New Horizons, Parker Solar Probe, Juno, Europa Clipper and more: where each is on the sky, how far, and how long its signal takes · nothing is shown past the end of a probe’s published trajectory',
    credits: [HORIZONS],
    load: async (context) => (await import('./spacecraft')).createSpacecraftLayer(context, 'deep'),
  },
];

export default layers;
