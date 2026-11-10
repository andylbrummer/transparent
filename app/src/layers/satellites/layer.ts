import type { Credit, LayerDefinition } from '../types';

const CELESTRAK: Credit = {
  what: 'Satellite orbits (GP element sets), refreshed at most every two hours',
  source: 'CelesTrak (Dr. T.S. Kelso), from the US Space Force 18th and 19th Space Defense Squadrons’ public catalogue',
  licence: 'free to use; CelesTrak asks for one download per data update',
  url: 'https://celestrak.org/NORAD/elements/',
};

const SGP4: Credit = {
  what: 'Orbit propagation (SGP4/SDP4)',
  source: 'satellite.js by Shashwat Kandadai and contributors, after Vallado, Crawford, Hujsak & Kelso, “Revisiting Spacetrack Report #3” (2006)',
  licence: 'MIT',
  url: 'https://github.com/shashwatak/satellite-js',
};

const credits = [CELESTRAK, SGP4];
const stops = (...colors: string[]): string =>
  `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(', ')})`;
const COMMON = 'true position and height · dim in the Earth’s shadow, fainter below your horizon';

type Row = readonly [id: string, label: string, caption: string, legend?: string];

// Ids are the keys of LAYER_SPECS in groups.ts, which arrives with the lazy chunk.
const ROWS: readonly Row[] = [
  ['sat-stations', 'Space stations (ISS, Tiangong)', `crewed stations and the ships docked to them, with the next orbit · ${COMMON}`],
  ['sat-visual', 'Brightest satellites', `the 150 or so easiest to see by eye · ${COMMON} · larger when sunlit in your dark sky`],
  [
    'sat-gnss',
    'Navigation satellites (GPS, Galileo, GLONASS, BeiDou)',
    'GPS gold · Galileo blue · GLONASS red · BeiDou green · most in shells 19,100 – 23,200 km up, each satellite with its orbit',
    stops('#ffd24d', '#66b3ff', '#ff7366', '#80f299'),
  ],
  ['sat-geo', 'Geostationary belt', 'the ring 35,786 km over the equator: weather, relay and television satellites, each over one longitude'],
  ['sat-earth-obs', 'Weather and Earth-observing satellites', `NOAA, MetOp, Landsat, Terra, Aqua, Sentinel and the rest · ${COMMON}`],
  ['sat-science', 'Space telescopes and science satellites', `Hubble, Chandra, XMM-Newton, Fermi, NuSTAR… with their orbits · ${COMMON}`],
  ['sat-starlink', 'Starlink', `every Starlink satellite in the catalogue, about 11,000 · ${COMMON}`],
  ['sat-oneweb', 'OneWeb', `the OneWeb constellation, 1,200 km up in polar orbits · ${COMMON}`],
  ['sat-iridium', 'Iridium', `Iridium NEXT: six polar planes 780 km up, with their orbits · ${COMMON}`],
  [
    'sat-debris',
    'Debris clouds',
    'tracked fragments: Fengyun-1C (2007 missile test) orange · Cosmos 2251 red and Iridium 33 yellow (2009 collision) · Cosmos 1408 violet',
    stops('#ff8040', '#ff4d66', '#ffc04d', '#e066e6'),
  ],
];

const layers: LayerDefinition[] = ROWS.map(([id, label, caption, legend], index) => ({
  id,
  label,
  section: 'Near space',
  order: 10 + index,
  caption,
  legend,
  credits,
  load: async (context) => (await import('./satellites')).createSatelliteLayer(context, id),
}));

export default layers;
