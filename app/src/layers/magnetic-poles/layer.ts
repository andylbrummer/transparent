import type { LayerDefinition } from '../types';

const magneticPoles: LayerDefinition = {
  id: 'magnetic-pole-track',
  label: 'Wandering magnetic poles',
  section: 'Surface lines',
  order: 60,
  legend: 'linear-gradient(to right, #739eff 0%, #96b0d0 50%, #ffe640 92%, #ffffff 100%)',
  caption:
    'where a compass needle would point straight down, every year 1590 → 2025, and forecast to 2030 (white) · computed from field models, not surveyed · the northern pole moved 4 km a year in the 1900s and 54 in the 2000s',
  credits: [
    {
      what: 'Magnetic (dip) pole positions 1590–2025 and forecast 2025–2030',
      source: 'NOAA National Centers for Environmental Information, Wandering of the Geomagnetic Poles (IGRF pole locations; WMM2025 pole locations)',
      licence: 'public domain (U.S. Government work)',
      url: 'https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles',
    },
  ],
  load: async (context) => (await import('./poles')).createMagneticPolesLayer(context),
};

export default magneticPoles;
