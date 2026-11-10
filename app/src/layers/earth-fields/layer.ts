import type { LayerDefinition } from '../types';
import { rampGradient } from '../weather/ramps';
import { EARTH_FIELDS } from './fields';

/** One at a time: each covers the surface, and each is a fullscreen pass. */
const earthFields: readonly LayerDefinition[] = EARTH_FIELDS.map((field, index) => ({
  id: field.id,
  label: field.label,
  section: 'Surface',
  order: 70 + index,
  exclusiveGroup: 'earth-field',
  legend: rampGradient(field.ramp),
  caption: field.caption,
  credits: field.credits,
  load: async (context) => (await import('./field')).createEarthFieldLayer(context, field),
}));

export default earthFields;
