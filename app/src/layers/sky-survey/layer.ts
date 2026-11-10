import type { LayerDefinition } from '../types';
import { SURVEYS } from './surveys';

/** One switch per survey; only one whole-sky picture is drawn at a time, these or the all-sky maps. */
const surveys: LayerDefinition[] = SURVEYS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  section: 'Sky maps',
  order: spec.order,
  caption: spec.caption,
  exclusiveGroup: 'sky-map',
  credits: spec.credits,
  load: async (context) => (await import('./survey')).createSurveyLayer(context, spec),
}));

export default surveys;
