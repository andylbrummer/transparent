import type { Credit, LayerDefinition } from '../types';

/** Comets are drawn while their predicted total magnitude is this or brighter. */
export const COMET_MAG_LIMIT = 15;

/** One colour per dynamical class of the cloud, keyed as in small-bodies-cloud.json. */
export const CLOUD_CLASS_COLORS: Readonly<Record<string, number>> = {
  neo: 0xff6f61,
  'mars-crosser': 0xffa978,
  'main-belt': 0xd8c7a2,
  hilda: 0xd9a0ff,
  trojan: 0x86f58f,
  centaur: 0x6fd8ff,
  tno: 0x8aa8ff,
};

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Equal hard-edged bands, in the order the caption names them. */
function bands(keys: readonly string[]): string {
  const step = 100 / keys.length;
  const stops = keys.map((key, i) => `${hex(CLOUD_CLASS_COLORS[key])} ${(i * step).toFixed(1)}% ${((i + 1) * step).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

const PUBLIC_DOMAIN = 'public domain (U.S. Government work; JPL asks for credit)';

const SBDB: Credit = {
  what: 'Small bodies: names, classes, absolute magnitudes (H, G), comet magnitude parameters (M1, K1)',
  source: 'NASA/JPL Small-Body Database, Solar System Dynamics group, Jet Propulsion Laboratory',
  licence: PUBLIC_DOMAIN,
  url: 'https://ssd.jpl.nasa.gov/tools/sbdb_query.html',
};

const HORIZONS: Credit = {
  what: 'Osculating orbital elements of the named bodies and comets, and the reference places they are checked against',
  source: 'NASA/JPL Horizons On-Line Ephemeris System (Giorgini et al.), Solar System Dynamics group, Jet Propulsion Laboratory',
  licence: PUBLIC_DOMAIN,
  url: 'https://ssd.jpl.nasa.gov/horizons/',
};

const VALIDITY = 'two-body orbits of epoch 1 Jan 2027, within 7′ of JPL Horizons through 2026 – 2027; hidden outside those years';

const LAYERS: readonly LayerDefinition[] = [
  {
    id: 'dwarf-planets-asteroids',
    label: 'Dwarf planets and asteroids',
    section: 'Sky',
    order: 56,
    legend: 'linear-gradient(to right, #9ee6ff 0% 30%, #f5cc8f 30% 100%)',
    caption: `◯ the five dwarf planets and four more big trans-Neptunian objects · ◇ the 50 intrinsically brightest main-belt asteroids, and Eros, Apophis, Bennu, Ryugu, Didymos, Hektor, Chiron · name and visual magnitude now (H,G) · ${VALIDITY}`,
    credits: [HORIZONS, SBDB],
    load: async (context) => (await import('./bodies')).createNamedBodiesLayer(context),
  },
  {
    id: 'comets',
    label: 'Comets (predicted brightness)',
    section: 'Sky',
    order: 57,
    legend: '#8cffd9',
    caption: `☄ comets JPL’s magnitude law puts at magnitude ${COMET_MAG_LIMIT} or brighter now · “~” magnitudes are predictions (M1 + 5 log Δ + K1 log r), often a magnitude or two out · the line points away from the Sun, as a tail would; its length means nothing · ${VALIDITY}`,
    credits: [HORIZONS, SBDB],
    load: async (context) => (await import('./bodies')).createCometsLayer(context),
  },
  {
    id: 'asteroid-belt-cloud',
    label: 'Asteroid belt, Trojans, Kuiper belt',
    section: 'Sky',
    order: 58,
    legend: bands(['neo', 'mars-crosser', 'main-belt', 'hilda', 'trojan', 'centaur', 'tno']),
    caption:
      'near-Earth · Mars-crossers · main belt · Hildas · Jupiter Trojans (60° ahead of and behind Jupiter) · centaurs · trans-Neptunian · the 36,000 intrinsically brightest known, each on its own orbit · brighter = bigger or nearer, each class on its own scale · two-body orbits of epoch 1 Jan 2027, shown for 2026 – 2027 only',
    credits: [
      {
        what: 'Orbital elements and absolute magnitudes of 35,846 minor planets',
        source: 'NASA/JPL Small-Body Database, Solar System Dynamics group, Jet Propulsion Laboratory',
        licence: PUBLIC_DOMAIN,
        url: 'https://ssd.jpl.nasa.gov/tools/sbdb_query.html',
      },
    ],
    load: async (context) => (await import('./cloud')).createCloudLayer(context),
  },
  {
    id: 'neo-approaches',
    label: 'Asteroids passing the Earth',
    section: 'Sky',
    order: 59,
    legend: '#ff8052',
    caption:
      '□ asteroids within 10 lunar distances (LD, 384,399 km), for two days either side of closest approach, where they stand in your sky · distance now, closest distance and date · sizes with “~” are the range the brightness allows · list of 10 Sep 2026 – 9 Nov 2027 as known on 9 Nov 2026: most small ones are found days before they pass',
    credits: [
      {
        what: 'Close approaches of near-Earth objects: times, distances, speeds, sizes',
        source: 'NASA/JPL Center for Near-Earth Object Studies (CNEOS), Close-Approach Data API',
        licence: PUBLIC_DOMAIN,
        url: 'https://cneos.jpl.nasa.gov/ca/',
      },
      {
        what: 'Positions of the passing asteroids round closest approach',
        source: 'NASA/JPL Horizons On-Line Ephemeris System (Giorgini et al.), Solar System Dynamics group, Jet Propulsion Laboratory',
        licence: PUBLIC_DOMAIN,
        url: 'https://ssd.jpl.nasa.gov/horizons/',
      },
    ],
    load: async (context) => (await import('./neo')).createApproachLayer(context),
  },
];

export default LAYERS;
