import type { LayerDefinition } from '../types';
import { depthRampGradient } from '../../render/interior';

/**
 * Subducting slabs as translucent plates. Keeps the id of the contour
 * lines it replaced, so a saved choice for "slabs" still applies.
 */
const slabs: LayerDefinition = {
  id: 'slabs',
  label: 'Subducting slabs',
  section: 'Inside the Earth',
  order: 10,
  // On from the start, as the contour lines were: the slabs are half of what
  // the earthquakes are showing, and the mesh arrives after first paint.
  defaultOn: true,
  legend: depthRampGradient(700),
  caption: 'plates at their real thickness · depth 0 – 700 km · a line every 20 km, bright every 100',
  credits: [
    // Word for word the built-in list's entry (ui/credits.ts), so the two merge into one line.
    {
      what: 'Subducting slabs',
      source: 'Hayes et al. (2018), Slab2, USGS',
      licence: 'public domain',
      url: 'https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467',
    },
  ],
  load: async (context) => (await import('./slabs')).createSlabLayer(context),
};

export default slabs;
