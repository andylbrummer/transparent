/**
 * A survey of scattered close-ups (Webb's, Euclid's): one survey per
 * field, each asking its own server for tiles only where its coverage file
 * says it has something, behind one switch and one status chip. Fields too
 * small to find from a wide view get a ring on each covered cell, fading
 * out as the user zooms in.
 */

import type { LayerContext, LayerInstance } from '../types';
import { SkyPoints } from '../../render/sky-points';
import { markerOpacity, mergeStatuses, parseCloseups, type CloseupsFile, type Coverage, type FieldStatus } from './coverage';
import { createSurveyLayer } from './survey';
import type { CloseupField, SurveySpec } from './surveys';

const MARKER_PX = 9;
/** Gold, so the rings read as something other than a star. */
const MARKER_RGB = [1, 0.78, 0.35] as const;
const MARKER_OPACITY = 0.8;

function ringsOn(context: LayerContext, name: string, coverages: readonly Coverage[]): SkyPoints {
  const parts = coverages.map((coverage) => coverage.centres());
  const directions = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    directions.set(part, offset);
    offset += part.length;
  }
  const count = directions.length / 3;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(MARKER_RGB, 3 * i);
  const markers = new SkyPoints(directions, new Float32Array(count).fill(MARKER_PX), colors, context.skyUniforms, {
    name,
    shape: 'ring',
    opacity: MARKER_OPACITY,
  });
  context.skyRoot.add(markers.object);
  return markers;
}

export async function createCloseupLayer(context: LayerContext, spec: SurveySpec, fields: readonly CloseupField[]): Promise<LayerInstance> {
  const file = parseCloseups(await context.fetchJson<CloseupsFile>(context.assetUrl('sky/closeups.json')));
  const coverages = fields.map((field) => {
    const coverage = file.get(field.coverage);
    if (!coverage) throw new Error(`sky/closeups.json has no coverage for ${field.coverage}`);
    return coverage;
  });

  const statuses: FieldStatus[] = fields.map(() => ({ text: null, tone: 'info' }));
  let shown: FieldStatus = { text: null, tone: 'info' };
  const surveys = fields.map((field, i) => {
    const fieldContext: LayerContext = {
      ...context,
      setStatus(text, tone = 'info') {
        statuses[i] = { text, tone };
        const merged = mergeStatuses(statuses);
        if (merged.text === shown.text && merged.tone === shown.tone) return;
        shown = merged;
        context.setStatus(merged.text, merged.tone);
      },
    };
    return createSurveyLayer(fieldContext, { ...spec, id: `${spec.id}-${field.coverage}`, bases: [field.base] }, coverages[i]);
  });
  const markers = spec.markers ? ringsOn(context, `sky-survey-${spec.id}-markers`, coverages) : null;

  let visible = true;
  return {
    setVisible(value) {
      visible = value;
      if (markers) markers.object.visible = value;
      for (const survey of surveys) survey.setVisible(value);
    },
    setResolution(width, height) {
      for (const survey of surveys) survey.setResolution?.(width, height);
    },
    update(frame) {
      if (!visible) return;
      if (markers) {
        const opacity = MARKER_OPACITY * markerOpacity(frame.camera.fov);
        markers.setOpacity(opacity);
        markers.object.visible = opacity > 0.01;
      }
      for (const survey of surveys) survey.update?.(frame);
    },
    dispose() {
      markers?.dispose();
      for (const survey of surveys) survey.dispose();
      context.setStatus(null);
    },
  };
}
