/**
 * Volcanoes as data: every volcano of the Smithsonian's Volcanoes of the
 * World (app/public/geo/volcanoes.json, tools/pipeline/generate_volcanoes.py)
 * as a triangle coloured and sized by how recently it erupted, and the
 * greatest eruptions of the Holocene as stars.
 *
 * The always-loaded map names volcanoes (the 'volcano' labels, NOAA's
 * list); this says which of them are alive. Its own names carry the year
 * of the last eruption and the summit height, and outrank those.
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { GREAT_ERUPTION_COLOR, RECENCY_CLASSES, eruptionSizePx, formatYear, recencyClass } from './classes';

interface VolcanoTable {
  readonly lon: readonly number[];
  readonly lat: readonly number[];
  readonly elevationM: readonly number[];
  readonly type: readonly number[];
  readonly name: readonly string[];
  /** Holocene only. */
  readonly lastYear?: readonly number[];
}

export interface GreatEruption {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  readonly startYear: number;
  readonly endYear: number | null;
  readonly vei: number;
  /** ± years on the start; null when the year is known. */
  readonly yearUncertainty: number | null;
}

/** The shape of app/public/geo/volcanoes.json. */
export interface VolcanoData {
  /** The day the database was read, ISO. */
  readonly asOf: string;
  readonly quantumPerDegree: number;
  /** lastYear's value for a volcano with no dated eruption. */
  readonly missingYear: number;
  readonly types: readonly string[];
  readonly holocene: VolcanoTable;
  readonly pleistocene: VolcanoTable;
  readonly eruptions: readonly GreatEruption[];
}

/** Recently active volcanoes are named ahead of the country names; the rest wait their turn. */
const RECENT_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.4;
const OTHER_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.1;
const ERUPTION_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.45;
/** Volcanoes named beyond the recently active: those with the latest eruptions. */
const MAX_OTHER_LABELS = 260;

const lastYearOf = (data: VolcanoData, i: number): number | null => {
  const year = data.holocene.lastYear?.[i] ?? data.missingYear;
  return year === data.missingYear ? null : year;
};

/** Markers in drawing order: Pleistocene underneath, the recently active on top. */
export function volcanoMarkers(data: VolcanoData): GeoMarker[] {
  const asOfYear = Number(data.asOf.slice(0, 4));
  const q = data.quantumPerDegree;
  const old = RECENCY_CLASSES[RECENCY_CLASSES.length - 1];
  const markers: (GeoMarker & { readonly order: number })[] = data.pleistocene.lon.map((lon, i) => ({
    lon: lon / q,
    lat: data.pleistocene.lat[i] / q,
    shape: 'triangle',
    color: old.color,
    sizePx: old.sizePx,
    alpha: old.alpha,
    order: RECENCY_CLASSES.length,
  }));
  data.holocene.lon.forEach((lon, i) => {
    const c = recencyClass(lastYearOf(data, i), asOfYear);
    const at = { lon: lon / q, lat: data.holocene.lat[i] / q };
    markers.push({ ...at, shape: 'triangle', color: c.color, sizePx: c.sizePx, alpha: c.alpha, order: RECENCY_CLASSES.indexOf(c) });
  });
  return markers.sort((a, b) => b.order - a.order);
}

/** "▲ Etna · 2026 · 3,357 m"; without a dated eruption, "▲ Name · 1,234 m". */
export function volcanoLabelText(name: string, lastYear: number | null, elevationM: number): string {
  const height = `${elevationM.toLocaleString('en-US')} m`;
  return lastYear === null ? `▲ ${name} · ${height}` : `▲ ${name} · ${formatYear(lastYear)} · ${height}`;
}

/** [recently active, the next MAX_OTHER_LABELS by date of last eruption]. */
export function volcanoLabels(data: VolcanoData): [GroupLabel[], GroupLabel[]] {
  const asOfYear = Number(data.asOf.slice(0, 4));
  const q = data.quantumPerDegree;
  const recent: GroupLabel[] = [];
  const others: GroupLabel[] = [];
  data.holocene.name.forEach((name, i) => {
    const lastYear = lastYearOf(data, i);
    if (lastYear === null) return;
    const label: GroupLabel = {
      text: volcanoLabelText(name, lastYear, data.holocene.elevationM[i]),
      // The latest eruption first, and of two in one year the higher mountain.
      priority: -lastYear - data.holocene.elevationM[i] / 10_000,
      position: ecefAtAltitude(data.holocene.lon[i] / q, data.holocene.lat[i] / q, 0, new THREE.Vector3()),
    };
    (recencyClass(lastYear, asOfYear).key === 'recent' ? recent : others).push(label);
  });
  others.sort((a, b) => a.priority - b.priority);
  return [recent, others.slice(0, MAX_OTHER_LABELS)];
}

export async function createVolcanoLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<VolcanoData>(context.assetUrl('geo/volcanoes.json'));
  const markers = new GeoMarkers('volcanoes', context.skyUniforms.uPixelRatio);
  markers.setMarkers(volcanoMarkers(data));
  context.earthRoot.add(markers.object);
  const [recent, others] = volcanoLabels(data);
  const groups = [
    context.addLabels({
      rank: RECENT_RANK,
      style: { fontPx: 11, color: '#fff2a8', bold: true, offsetYPx: 13 },
      frame: 'earth',
      labels: recent,
    }),
    context.addLabels({ rank: OTHER_RANK, style: { fontPx: 10, color: '#ffc48a', offsetYPx: 11 }, frame: 'earth', labels: others }),
  ];
  const day = new Date(`${data.asOf}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  context.setStatus(`as of ${day}`, 'info');
  return {
    setVisible(visible) {
      markers.object.visible = visible;
      for (const group of groups) group.setVisible(visible);
    },
    dispose() {
      for (const group of groups) group.remove();
      markers.dispose();
    },
  };
}

/** "Tambora 1812–1815 · VEI 7"; "Santorini ~1610 BCE · VEI 7" where the year is an estimate. */
export function eruptionLabelText(eruption: GreatEruption): string {
  const about = eruption.yearUncertainty === null ? '' : '~';
  const end = eruption.endYear !== null && eruption.endYear !== eruption.startYear ? `–${formatYear(eruption.endYear)}` : '';
  return `${eruption.name} ${about}${formatYear(eruption.startYear)}${end} · VEI ${eruption.vei}`;
}

export function eruptionLabels(eruptions: readonly GreatEruption[]): GroupLabel[] {
  return eruptions.map((e) => ({
    text: eruptionLabelText(e),
    // The larger first; of equals, the more recent.
    priority: -e.vei * 100_000 - e.startYear,
    position: ecefAtAltitude(e.lon, e.lat, 0, new THREE.Vector3()),
  }));
}

export async function createGreatEruptionLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<VolcanoData>(context.assetUrl('geo/volcanoes.json'));
  const markers = new GeoMarkers('eruptions-great', context.skyUniforms.uPixelRatio);
  markers.setMarkers(
    [...data.eruptions]
      .sort((a, b) => a.vei - b.vei)
      .map((e) => ({ lon: e.lon, lat: e.lat, shape: 'star', color: GREAT_ERUPTION_COLOR, sizePx: eruptionSizePx(e.vei) }))
  );
  // Over the volcano triangles.
  markers.object.renderOrder += 0.05;
  context.earthRoot.add(markers.object);
  const labels = context.addLabels({
    rank: ERUPTION_RANK,
    style: { fontPx: 11, color: '#fff7d6', bold: true, offsetYPx: 16 },
    frame: 'earth',
    labels: eruptionLabels(data.eruptions),
  });
  return {
    setVisible(visible) {
      markers.object.visible = visible;
      labels.setVisible(visible);
    },
    dispose() {
      labels.remove();
      markers.dispose();
    },
  };
}
