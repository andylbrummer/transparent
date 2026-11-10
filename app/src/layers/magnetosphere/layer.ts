import type { Credit, LayerDefinition } from '../types';

const WMM: Credit = {
  what: 'Geomagnetic field (World Magnetic Model 2025, degree 12)',
  source: 'NOAA National Centers for Environmental Information and the British Geological Survey',
  licence: 'public domain',
  url: 'https://www.ncei.noaa.gov/products/world-magnetic-model',
};

const SOLAR_WIND: Credit = {
  what: 'Real-time solar wind at L1, propagated to the Earth',
  source: 'NOAA Space Weather Prediction Center, from the solar wind monitors at the Sun–Earth L1 point',
  licence: 'public domain (NOAA/NWS)',
  url: 'https://www.swpc.noaa.gov/products/real-time-solar-wind',
};

const SHUE: Credit = {
  what: 'Magnetopause model',
  source: 'Shue et al. (1998), “Magnetopause location under extreme solar wind conditions”, J. Geophys. Res. 103, 17691',
  licence: 'published formula',
  url: 'https://doi.org/10.1029/98JA01103',
};

const OVATION: Credit = {
  what: 'Aurora nowcast (OVATION Prime), hemispheric power and planetary K index',
  source: 'NOAA Space Weather Prediction Center',
  licence: 'public domain (NOAA/NWS)',
  url: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',
};

const STRENGTH_LEGEND = 'linear-gradient(90deg, #4d66ff, #4de6ff, #ffed99)';

const layers: LayerDefinition[] = [
  {
    id: 'magnetic-field',
    label: 'Magnetic field lines',
    section: 'Near space',
    order: 40,
    legend: STRENGTH_LEGEND,
    caption:
      'the Earth’s own field traced through the WMM2025 model, out to 8 Earth radii · 100 nT blue – 60,000 nT warm · lines from near the poles leave the drawing · beyond a few radii the real field is bent by the solar wind',
    credits: [WMM],
    load: async (context) => (await import('./magnetic-field')).createMagneticFieldLayer(context),
  },
  {
    id: 'magnetopause',
    label: 'Magnetopause (model, live solar wind)',
    section: 'Near space',
    order: 41,
    caption:
      'MODEL: where the solar wind stops the Earth’s field (Shue et al. 1998), sized by the wind measured at L1 now and pointed at the Sun · the real boundary moves about it',
    credits: [SHUE, SOLAR_WIND],
    load: async (context) => (await import('./magnetopause')).createMagnetopauseLayer(context),
  },
  {
    id: 'aurora',
    label: 'Aurora (live forecast)',
    section: 'Near space',
    order: 42,
    legend: 'linear-gradient(90deg, rgba(56,255,107,0.1), #38ff6b 55%, #ff52b8)',
    caption: 'probability of aurora 5 – 100 %, 110 km up, both ovals · NOAA’s OVATION nowcast for the next half hour to hour',
    credits: [OVATION],
    load: async (context) => (await import('./aurora')).createAuroraLayer(context),
  },
];

export default layers;
