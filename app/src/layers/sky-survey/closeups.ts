/**
 * A survey of scattered close-ups (Webb's): the survey's tiles, asked for
 * only where its coverage file says it has something, and a ring on each
 * covered patch so the patches can be found from a wide view, fading out
 * as the user zooms in on one.
 */

import type { LayerContext, LayerInstance } from '../types';
import { SkyPoints } from '../../render/sky-points';
import { markerOpacity, parseCloseups, type CloseupsFile } from './coverage';
import { createSurveyLayer } from './survey';
import type { SurveySpec } from './surveys';

const MARKER_PX = 9;
/** Webb gold, so the rings read as something other than a star. */
const MARKER_RGB = [1, 0.78, 0.35] as const;

export async function createCloseupLayer(context: LayerContext, spec: SurveySpec, name: string): Promise<LayerInstance> {
  const coverage = parseCloseups(await context.fetchJson<CloseupsFile>(context.assetUrl('sky/closeups.json'))).get(name);
  if (!coverage) throw new Error(`sky/closeups.json has no coverage for ${name}`);
  const survey = createSurveyLayer(context, spec, coverage);
  const directions = coverage.centres();
  const count = directions.length / 3;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(MARKER_RGB, 3 * i);
  const markers = new SkyPoints(directions, new Float32Array(count).fill(MARKER_PX), colors, context.skyUniforms, {
    name: `sky-survey-${spec.id}-markers`,
    shape: 'ring',
    opacity: 0.8,
  });
  context.skyRoot.add(markers.object);
  let visible = true;
  return {
    setVisible(value) {
      visible = value;
      markers.object.visible = value;
      survey.setVisible(value);
    },
    setResolution(width, height) {
      survey.setResolution?.(width, height);
    },
    update(frame) {
      if (!visible) return;
      const opacity = 0.8 * markerOpacity(frame.camera.fov);
      markers.setOpacity(opacity);
      markers.object.visible = opacity > 0.01;
      survey.update?.(frame);
    },
    dispose() {
      markers.dispose();
      survey.dispose();
    },
  };
}
