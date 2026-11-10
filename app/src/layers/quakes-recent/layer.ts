import { depthRampGradient } from '../../render/interior';
import type { LayerDefinition } from '../types';

const quakesRecent: LayerDefinition = {
  id: 'quakes-recent',
  label: 'Recent earthquakes (live)',
  section: 'Inside the Earth',
  order: 10,
  legend: depthRampGradient(700),
  caption:
    'rings at the hypocentre · depth 0 – 700 km · M4.5+ of the past 30 days, M2.5+ of the past 7 (small ones mostly from US networks) · the last 24 h ripple',
  credits: [
    {
      what: 'Recent earthquakes (live)',
      source: 'USGS Earthquake Hazards Program, real-time GeoJSON feeds of the ANSS Comprehensive Catalog',
      licence: 'public domain',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
    },
  ],
  load: async (context) => (await import('./recent')).createRecentQuakesLayer(context),
};

export default quakesRecent;
