/**
 * The great earthquakes since 1900, from app/public/geo/quakes-notable.json
 * (tools/pipeline/generate_quake_sets.py: every M8.5+ in ComCat, and the
 * smaller presets of spec/seismic.md), each ringed and named at its
 * hypocentre. The catalogue's dots start in 1973; this reaches back to
 * Valdivia 1960, Alaska 1964 and San Francisco 1906.
 *
 * Like the live layer it follows the app clock: with ?time= pinned in
 * 1962 the view holds the earthquakes that had happened by then.
 */

import * as THREE from 'three';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import { QuakeMarkers, type QuakeMarker } from '../../render/quake-markers';
import { quakePointSizePx } from '../../render/quakes';
import type { LayerContext, LayerInstance } from '../types';

export interface NotableQuake {
  /** ComCat event id. */
  readonly id: string;
  /** Origin time, ISO 8601. */
  readonly time: string;
  readonly lon: number;
  readonly lat: number;
  readonly depthKm: number;
  readonly mag: number;
  /** Short name ending in the year: "Great Chilean 1960". */
  readonly name: string;
}

/** The shape of app/public/geo/quakes-notable.json. */
export interface NotableQuakeData {
  readonly events: readonly NotableQuake[];
}

/** Ring diameter, CSS px: clear of the catalogue's own dot (M7.8 13 px, M9.5 31 px). */
export function notableRingSizePx(magnitude: number): number {
  return 6 + 2.2 * quakePointSizePx(magnitude);
}

/** "M9.5 Great Chilean 1960 · 25 km". */
export function notableLabelText(quake: NotableQuake): string {
  return `M${quake.mag.toFixed(1)} ${quake.name} · ${Math.round(quake.depthKm)} km`;
}

export function notableMarkers(data: NotableQuakeData): QuakeMarker[] {
  return data.events.map((e) => ({ lon: e.lon, lat: e.lat, depthKm: e.depthKm, mag: e.mag, timeMs: Date.parse(e.time) }));
}

/** Labels for the events that have happened by `nowMs`, the greatest ranked first. */
export function notableLabels(data: NotableQuakeData, nowMs: number): GroupLabel[] {
  return data.events
    .filter((e) => Date.parse(e.time) <= nowMs)
    .map((e) => ({
      text: notableLabelText(e),
      priority: 10 - e.mag,
      position: ecefAtDepth(e.lon, e.lat, e.depthKm, new THREE.Vector3()),
    }));
}

export async function createNotableQuakesLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<NotableQuakeData>(context.assetUrl('geo/quakes-notable.json'));
  const markers = new QuakeMarkers({
    name: 'quakes-notable',
    sizePx: notableRingSizePx,
    pulseWindowS: 0,
    fadeOverS: Infinity,
    oldestAlpha: 1,
    ringWidthPx: 2.2,
    pixelRatio: context.skyUniforms.uPixelRatio,
  });
  markers.setMarkers(notableMarkers(data));
  context.earthRoot.add(markers.object);

  const timesMs = data.events.map((e) => Date.parse(e.time));
  let labels: LabelGroup | null = null;
  let labelled = -1;
  let visible = false;
  const syncLabels = (nowMs: number): void => {
    // The set only changes when the app clock crosses an earthquake.
    let happened = 0;
    for (const t of timesMs) if (t <= nowMs) happened++;
    if (happened === labelled) return;
    const group = notableLabels(data, nowMs);
    labels?.remove();
    labels = context.addLabels({
      // Ahead of the catalogue's M8+ names, which repeat the later of these.
      rank: LABEL_KIND_ORDER.indexOf('quake') - 0.25,
      style: { fontPx: 11, color: '#ffe9c7', bold: true, offsetYPx: 18 },
      frame: 'earth',
      labels: group,
    });
    labels.setVisible(visible);
    labelled = group.length;
  };
  syncLabels(context.now().getTime());

  return {
    setVisible(next) {
      visible = next;
      markers.object.visible = next;
      labels?.setVisible(next);
    },
    update(frame) {
      const nowMs = frame.date.getTime();
      markers.update(nowMs, frame.deltaMs);
      syncLabels(nowMs);
    },
    dispose() {
      labels?.remove();
      markers.dispose();
    },
  };
}
