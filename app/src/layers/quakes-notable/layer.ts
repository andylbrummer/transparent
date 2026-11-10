import { depthRampGradient } from '../../render/interior';
import type { LayerDefinition } from '../types';

const quakesNotable: LayerDefinition = {
  id: 'quakes-notable',
  label: 'Notable earthquakes since 1900',
  section: 'Inside the Earth',
  order: 11,
  legend: depthRampGradient(700),
  caption: 'every M8.5+ since 1900, and San Francisco 1906 and Türkiye 2023 · rings at the hypocentre · depth 0 – 700 km',
  credits: [
    {
      what: 'Notable earthquakes: magnitudes, and locations since 1973',
      source: 'USGS ANSS Comprehensive Earthquake Catalog (ComCat)',
      licence: 'public domain',
      url: 'https://earthquake.usgs.gov/data/comcat/',
    },
    {
      what: 'Earthquake locations before 1973, and 0.4 % of the M5+ catalogue',
      source: 'ISC-GEM Global Instrumental Earthquake Catalogue, International Seismological Centre (2026), via ComCat',
      licence: 'CC BY-SA 3.0',
      url: 'https://doi.org/10.31905/D808B825',
    },
  ],
  load: async (context) => (await import('./notable')).createNotableQuakesLayer(context),
};

export default quakesNotable;
