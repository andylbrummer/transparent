import type { Credit, LayerDefinition } from '../types';

const SWPC_TERMS = 'public domain (NOAA/NWS)';

const EPHEMERIS_CREDIT: Credit = {
  what: 'Positions of the Sun, Moon and planets',
  source:
    'VSOP87 planetary theory, Bretagnon & Francou 1988 (CDS VI/81); lunar theory ELP-2000/82 as in Meeus, Astronomical Algorithms (1998); checked against JPL Horizons',
  licence: 'free use with acknowledgement',
  url: 'https://vizier.cfa.harvard.edu/ftp/cats/VI/81/',
};

const HMI_CREDIT: Credit = {
  what: 'Live white-light image of the Sun (HMI continuum)',
  source: 'Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams, via NOAA SWPC',
  licence: 'not copyrighted; free for non-commercial and educational use, credit requested',
  url: 'https://sdo.gsfc.nasa.gov/data/rules.php',
};

const SUVI_CREDIT: Credit = {
  what: 'Live extreme-ultraviolet images of the Sun (GOES-19 SUVI)',
  source: 'NOAA Space Weather Prediction Center / NOAA NESDIS',
  licence: SWPC_TERMS,
  url: 'https://www.swpc.noaa.gov/products/goes-solar-ultraviolet-imager-suvi',
};

const LASCO_CREDIT: Credit = {
  what: 'Live coronagraph images (LASCO C2 and C3)',
  source: 'Courtesy of SOHO/LASCO consortium. SOHO is a project of international cooperation between ESA and NASA. Via NOAA SWPC',
  licence: 'free for public education and non-commercial use, credit requested',
  url: 'https://soho.nascom.nasa.gov/data/summary/copyright.html',
};

const CCOR_CREDIT: Credit = {
  what: 'Live coronagraph images (GOES-19 CCOR-1)',
  source: 'NOAA Space Weather Prediction Center / NOAA NESDIS',
  licence: SWPC_TERMS,
  url: 'https://www.swpc.noaa.gov/products/coronagraph',
};

const ACTIVITY_CREDIT: Credit = {
  what: 'Active regions, X-ray level, sunspot number, 10.7 cm flux, solar wind speed',
  source: 'NOAA Space Weather Prediction Center',
  licence: SWPC_TERMS,
  url: 'https://www.swpc.noaa.gov/products/solar-region-summary',
};

const sun: LayerDefinition = {
  id: 'sun',
  label: 'Sun',
  section: 'Sky',
  order: 40,
  // One sprite and one small image: cheap, and the sky is not the sky without it.
  defaultOn: true,
  caption: 'true place and size · zoom in for the live disc and today’s sunspots',
  credits: [EPHEMERIS_CREDIT, HMI_CREDIT],
  load: async (context) => (await import('./sun')).createSunLayer(context),
};

const euv = (wavelength: '171' | '195' | '304', order: number): LayerDefinition => ({
  id: `sun-euv-${wavelength}`,
  label: `Sun in EUV ${wavelength} Å`,
  section: 'Sky',
  order,
  exclusiveGroup: 'sun-euv',
  caption: 'the Sun’s atmosphere in extreme ultraviolet, live · on the disc and out to half a radius beyond the limb',
  credits: [SUVI_CREDIT],
  load: async (context) => (await import('./sun')).createEuvLayer(context, `suvi-${wavelength}`),
});

const lasco: LayerDefinition = {
  id: 'sun-corona-lasco',
  label: 'Corona (SOHO LASCO)',
  section: 'Sky',
  order: 45,
  exclusiveGroup: 'sun-corona',
  caption: 'live white-light corona, 2.4 – 27 solar radii (± 7.3°), from L1',
  credits: [LASCO_CREDIT],
  load: async (context) => (await import('./sun')).createLascoLayer(context),
};

const ccor: LayerDefinition = {
  id: 'sun-corona-ccor1',
  label: 'Corona (GOES-19 CCOR-1)',
  section: 'Sky',
  order: 46,
  exclusiveGroup: 'sun-corona',
  caption: 'live white-light corona, 4 – 21 solar radii (± 5.7°), from geostationary orbit',
  credits: [CCOR_CREDIT],
  load: async (context) => (await import('./sun')).createCcorLayer(context),
};

const activity: LayerDefinition = {
  id: 'sun-activity',
  label: 'Solar activity',
  section: 'Sky',
  order: 47,
  caption: 'numbered active regions on the disc · X-ray level, sunspot number, radio flux, solar wind',
  credits: [ACTIVITY_CREDIT],
  load: async (context) => (await import('./activity')).createActivityLayer(context),
};

export default [
  sun,
  euv('171', 41),
  euv('195', 42),
  euv('304', 43),
  lasco,
  ccor,
  activity,
];
