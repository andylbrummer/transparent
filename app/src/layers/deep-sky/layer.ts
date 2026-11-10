import type { LayerDefinition } from '../types';
import { DEEP_SKY_SPECS, classLegend, rampLegend, specCaption } from './specs';

/** One switch per catalogue, all off until asked for: together they are 90,000 objects. */
const deepSky: LayerDefinition[] = DEEP_SKY_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  section: 'Deep sky',
  order: spec.order,
  legend: spec.kind === 'cloud' ? rampLegend(spec.ramp) : classLegend(spec.classes),
  caption: specCaption(spec),
  credits: spec.credits,
  load: async (context) => (await import('./catalog')).createDeepSkyLayer(context, spec),
}));

export default deepSky;
