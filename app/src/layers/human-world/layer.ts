/**
 * The human world: what people have built and where they go, seen through
 * the planet - cables on the sea floor, shipping lanes, ports, airports
 * and routes, power plants, and the landmarks people point at. Every one
 * is a baked snapshot of a published dataset; none is live.
 */

import type { Credit, LayerDefinition } from '../types';
import { rampGradient } from '../weather/ramps';
import {
  ACCELERATOR_STYLE,
  AIRPORT_STYLE,
  CABLE_COLORS,
  DEEP_STYLE,
  FUEL_COLORS,
  HERITAGE_STYLE,
  LAUNCH_STYLE,
  MOUNTAIN_STYLE,
  NUCLEAR_STYLE,
  OBSERVATORY_COLORS,
  OTHER_FUEL_COLOR,
  PORT_STYLE,
  ROUTE_COLOR,
  SHIP_DENSITY_RAMP,
  WATER_COLORS,
  WRECK_STYLE,
  bandLegend,
  hex,
} from './styles';

const TELEGEOGRAPHY: Credit = {
  what: 'Undersea cable routes, landing points, lengths and years, as of 14 November 2022',
  source: 'TeleGeography, Submarine Cable Map (the last openly licensed release of its data)',
  licence: 'CC BY-NC-SA 3.0 (non-commercial, share-alike)',
  url: 'https://www.submarinecablemap.com/',
};

const WIKIDATA: Credit = {
  what: 'Landmarks: positions, elevations, depths and how widely each is written about',
  source: 'Wikidata',
  licence: 'CC0 1.0',
  url: 'https://www.wikidata.org/',
};

const WIKIPEDIA_MINES: Credit = {
  what: 'Depths of the Mponeng and TauTona gold mines',
  source: 'Wikipedia, "Mponeng Gold Mine" and "TauTona Mine"',
  licence: 'CC BY-SA 4.0',
  url: 'https://en.wikipedia.org/wiki/Mponeng_Gold_Mine',
};

const POWER_PLANTS: Credit = {
  what: 'Power plants: position, capacity and fuel',
  source:
    'Global Energy Observatory, Google, KTH Royal Institute of Technology in Stockholm, Enipedia, World Resources Institute (2021), Global Power Plant Database v1.3.0',
  licence: 'CC BY 4.0',
  url: 'https://datasets.wri.org/dataset/globalpowerplantdatabase',
};

const SHIP_DENSITY: Credit = {
  what: 'Global shipping traffic density, 2015–2021',
  source:
    'Cerdeiro, D.A., Komaromi, A., Liu, Y. & Saeed, M. (2020), World Seaborne Trade in Real Time, IMF Working Paper 20/57; World Bank Data Catalog, Global Shipping Traffic Density',
  licence: 'CC BY 4.0',
  url: 'https://datacatalog.worldbank.org/search/dataset/0037580',
};

const NATURAL_EARTH: Credit = {
  what: 'Rivers, lakes and sea ports',
  source: 'Natural Earth',
  licence: 'public domain',
  url: 'https://www.naturalearthdata.com/',
};

const OURAIRPORTS: Credit = {
  what: 'Airports: positions and IATA codes',
  source: 'OurAirports (scale ranks from Natural Earth)',
  licence: 'public domain',
  url: 'https://ourairports.com/data/',
};

const OPENFLIGHTS: Credit = {
  what: 'Air routes as of June 2014',
  source: 'OpenFlights route database',
  licence: 'Open Database License (ODbL) 1.0',
  url: 'https://openflights.org/data.php',
};

const SNAPSHOT = 'as Wikidata lists them: an open database, not a complete register';

const humanWorld: readonly LayerDefinition[] = [
  {
    id: 'rivers-lakes',
    label: 'Rivers and lakes',
    section: 'Surface lines',
    order: 40,
    legend: bandLegend([WATER_COLORS.river, WATER_COLORS.lake]),
    caption: 'the great rivers and the shores of the lakes over 300 km², with their names',
    credits: [NATURAL_EARTH],
    load: async (context) => (await import('./waters')).createWaterLayer(context),
  },
  {
    id: 'undersea-cables',
    label: 'Undersea cables (2022)',
    section: 'Human world',
    order: 10,
    legend: bandLegend([CABLE_COLORS.cable, CABLE_COLORS.cable, CABLE_COLORS.planned]),
    caption:
      'the fibre-optic cables on the sea floor that carry nearly all traffic between continents, as mapped in November 2022 · green in service then, violet planned then - many of those are lit now, and newer cables are missing · dots are the landing points, the busiest named with their cable count · names carry the year lit and the length · routes are the map-maker’s drawing between true landing points, not surveyed positions',
    credits: [TELEGEOGRAPHY],
    load: async (context) => (await import('./cables')).createCableLayer(context),
  },
  {
    id: 'ship-density',
    label: 'Shipping lanes',
    section: 'Human world',
    order: 20,
    legend: rampGradient(SHIP_DENSITY_RAMP),
    caption:
      'how much shipping passed, January 2015 to February 2021, from ships’ AIS position reports · a logarithmic scale: left to right is a hundred-thousand-fold · between 85°N and 85°S',
    credits: [SHIP_DENSITY],
    load: async (context) => (await import('./ship-density')).createShipDensityLayer(context),
  },
  {
    id: 'ports',
    label: 'Sea ports',
    section: 'Human world',
    order: 21,
    legend: hex(PORT_STYLE.color),
    caption: '■ 1,081 sea ports, the larger drawn larger · Natural Earth’s list, which misses some great ports (Busan, Shenzhen)',
    credits: [NATURAL_EARTH],
    load: async (context) => (await import('./waters')).createPortLayer(context),
  },
  {
    id: 'airports',
    label: 'Airports',
    section: 'Human world',
    order: 30,
    legend: hex(AIRPORT_STYLE.color),
    caption: '✚ every large airport with scheduled flights, by its IATA code · the great hubs larger and with their city',
    credits: [OURAIRPORTS],
    load: async (context) => (await import('./air')).createAirportLayer(context),
  },
  {
    id: 'air-routes',
    label: 'Air routes (2014)',
    section: 'Human world',
    order: 31,
    legend: hex(ROUTE_COLOR),
    caption:
      'the network of June 2014, when the route database was last kept up: non-stop routes flown by three or more airlines, and every route over 8,000 km · brighter with more airlines · great circles drawn lifted to read as arcs, not flight paths or heights',
    credits: [OPENFLIGHTS, OURAIRPORTS],
    load: async (context) => (await import('./air')).createRouteLayer(context),
  },
  {
    id: 'power-plants',
    label: 'Power plants, 500 MW and more',
    section: 'Human world',
    order: 40,
    legend: bandLegend([FUEL_COLORS.Coal, FUEL_COLORS.Gas, FUEL_COLORS.Oil, FUEL_COLORS.Nuclear, FUEL_COLORS.Hydro, FUEL_COLORS.Solar, FUEL_COLORS.Wind, OTHER_FUEL_COLOR]),
    caption:
      '● coal · gas · oil · nuclear · hydro · solar · wind · other · area goes with capacity · the database’s last release is of 2021 and most of its figures of 2017–2019: plants built since are missing',
    credits: [POWER_PLANTS],
    load: async (context) => (await import('./power')).createPowerPlantLayer(context),
  },
  {
    id: 'nuclear-plants',
    label: 'Nuclear power plants',
    section: 'Human world',
    order: 41,
    legend: hex(NUCLEAR_STYLE.color),
    caption: '● the 195 nuclear plants of the 2021 database, of any size, with their capacity',
    credits: [POWER_PLANTS],
    load: async (context) => (await import('./power')).createNuclearLayer(context),
  },
  {
    id: 'high-mountains',
    label: 'Highest mountains',
    section: 'Human world',
    order: 50,
    legend: hex(MOUNTAIN_STYLE.color),
    caption: `△ the fourteen peaks over 8,000 m, the Seven Summits and the mountains that rise 3,000 m above everything around them, at their height · ${SNAPSHOT}`,
    credits: [WIKIDATA],
    load: async (context) => (await import('./landmarks')).createLandmarkLayer(context, 'mountains'),
  },
  {
    id: 'deep-places',
    label: 'Deepest holes',
    section: 'Human world',
    order: 51,
    legend: hex(DEEP_STYLE.color),
    caption: `✚ boreholes, mines and caves a kilometre deep and more, drawn at their bottom · the deepest, the Kola Superdeep Borehole, reaches 12 km of the 6,371 to the centre · ${SNAPSHOT}`,
    credits: [WIKIDATA, WIKIPEDIA_MINES],
    load: async (context) => (await import('./landmarks')).createLandmarkLayer(context, 'deep'),
  },
  {
    id: 'launch-sites',
    label: 'Space launch sites',
    section: 'Human world',
    order: 52,
    legend: hex(LAUNCH_STYLE.color),
    caption: `✦ spaceports and rocket ranges, the best known larger · ${SNAPSHOT}`,
    credits: [WIKIDATA],
    load: async (context) => (await import('./landmarks')).createLandmarkLayer(context, 'launchSites'),
  },
  {
    id: 'observatories',
    label: 'Telescopes and detectors',
    section: 'Human world',
    order: 53,
    legend: bandLegend([OBSERVATORY_COLORS.optical, OBSERVATORY_COLORS.radio, OBSERVATORY_COLORS.neutrino, OBSERVATORY_COLORS.gw]),
    caption: `◯ optical telescopes and observatories · radio telescopes · neutrino detectors · gravitational-wave detectors · ${SNAPSHOT}`,
    credits: [WIKIDATA],
    load: async (context) => (await import('./landmarks')).createLandmarkLayer(context, 'observatories'),
  },
  {
    id: 'particle-accelerators',
    label: 'Particle accelerators',
    section: 'Human world',
    order: 54,
    legend: hex(ACCELERATOR_STYLE.color),
    caption: `◆ colliders, synchrotrons and light sources · a marker, not a size: the largest ring, the LHC, is 27 km round · ${SNAPSHOT}`,
    credits: [WIKIDATA],
    load: async (context) => (await import('./landmarks')).createLandmarkLayer(context, 'accelerators'),
  },
  {
    id: 'world-heritage',
    label: 'World Heritage Sites',
    section: 'Human world',
    order: 55,
    legend: hex(HERITAGE_STYLE.color),
    caption: `■ places on UNESCO’s World Heritage List, the most written-about named first · ${SNAPSHOT}`,
    credits: [WIKIDATA],
    load: async (context) => (await import('./landmarks')).createLandmarkLayer(context, 'heritage'),
  },
  {
    id: 'shipwrecks',
    label: 'Shipwrecks',
    section: 'Human world',
    order: 56,
    legend: hex(WRECK_STYLE.color),
    caption: `◯ the three hundred best-known wrecks, where they lie or went down · drawn at the surface: the data give almost no depths · ${SNAPSHOT}`,
    credits: [WIKIDATA],
    load: async (context) => (await import('./landmarks')).createLandmarkLayer(context, 'wrecks'),
  },
];

export default humanWorld;
