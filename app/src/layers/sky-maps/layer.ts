import type { LayerDefinition } from '../types';
import { SKY_MAP_SPECS } from './specs';

/** One map at a time: each fills the sky, and two added together are mud. */
const skyMaps: LayerDefinition[] = SKY_MAP_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  section: 'Sky maps',
  order: spec.order,
  legend: spec.legend,
  caption: spec.caption,
  exclusiveGroup: 'sky-map',
  credits: spec.credits,
  load: async (context) => (await import('./sky-maps')).createSkyMapLayer(context, spec),
}));

export default skyMaps;
