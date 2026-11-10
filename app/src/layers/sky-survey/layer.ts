import type { LayerDefinition } from '../types';
import { SURVEYS } from './surveys';

/**
 * One switch per survey. Only one whole-sky picture is drawn at a time, these or the all-sky maps; a survey of
 * scattered close-ups is drawn over whichever is on.
 */
const surveys: LayerDefinition[] = SURVEYS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  section: 'Sky maps',
  order: spec.order,
  caption: spec.caption,
  exclusiveGroup: spec.fields ? undefined : 'sky-map',
  credits: spec.credits,
  load: async (context) =>
    spec.fields ? (await import('./closeups')).createCloseupLayer(context, spec, spec.fields) : (await import('./survey')).createSurveyLayer(context, spec),
}));

export default surveys;
