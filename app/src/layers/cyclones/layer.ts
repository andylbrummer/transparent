import type { LayerDefinition } from '../types';
import { scaleLegend } from './scale';

const SCALE_CAPTION = 'depression · storm · hurricane category 1 – 5 (Saffir-Simpson, 1-minute wind)';

const cycloneLayers: readonly LayerDefinition[] = [
  {
    id: 'cyclones-live',
    label: 'Tropical cyclones now (live)',
    section: 'Surface',
    order: 70,
    legend: scaleLegend(),
    caption: `${SCALE_CAPTION} · track so far, dashed forecast and its uncertainty cone · storms of the past 10 days fade`,
    credits: [
      {
        what: 'Active tropical cyclones: advisory positions, winds, forecast tracks and uncertainty cones',
        source:
          'Global Disaster Alert and Coordination System (GDACS; European Commission JRC and United Nations OCHA), compiled from NOAA NHC/CPHC, JTWC and WMO regional centre advisories',
        licence: 'free reuse with attribution (European Commission reuse policy, CC BY 4.0; no licence stated on gdacs.org)',
        url: 'https://www.gdacs.org/',
      },
    ],
    load: async (context) => (await import('./live')).createLiveCyclonesLayer(context),
  },
  {
    id: 'cyclone-tracks',
    label: 'Major hurricanes and typhoons since 1980',
    section: 'Surface',
    order: 71,
    legend: scaleLegend(),
    caption: `${SCALE_CAPTION} · every storm that reached category 3, with Tip 1979 and Camille 1969 · a storm under way at the app’s clock is marked`,
    credits: [
      {
        what: 'Tropical cyclone best tracks',
        source:
          'IBTrACS v04r01, NOAA National Centers for Environmental Information: Knapp et al. (2010), doi:10.1175/2009BAMS2755.1; Gahtan et al. (2024), doi:10.25921/82ty-9e16',
        licence: 'public domain (U.S. Government work)',
        url: 'https://www.ncei.noaa.gov/products/international-best-track-archive',
      },
    ],
    load: async (context) => (await import('./tracks')).createCycloneTracksLayer(context),
  },
];

export default cycloneLayers;
