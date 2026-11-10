/**
 * Meteorites (app/public/geo/meteorites.json, from
 * tools/pipeline/generate_meteorites.py; the Meteoritical Bulletin as NASA
 * published it in 2013).
 *
 * Two sets. Falls are the meteorites somebody saw come down - about eleven
 * hundred in a thousand years of records, which maps where people lived
 * and wrote things down as much as where stones land. Finds are shown only
 * for the greatest masses: Hoba's sixty tonnes still lie where they fell.
 *
 * A fall later than the app clock's year is hidden.
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { FALL_COLOR, FIND_COLOR } from './layer';

/** [name, year, lat, lon, mass in grams, class]; year or mass may be unknown. */
export type MeteoriteRow = readonly [string, number | null, number, number, number | null, string];

/** The shape of app/public/geo/meteorites.json: heaviest first in each list. */
export interface MeteoriteData {
  readonly falls: readonly MeteoriteRow[];
  readonly finds: readonly MeteoriteRow[];
}

/** The heaviest finds and falls named ahead of the towns. */
export const FEATURED_FINDS = 12;
export const FEATURED_FALLS = 12;
/** Further falls named where there is room. */
export const OTHER_FALLS = 40;
const FEATURED_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.36;
const OTHER_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.25;

/** Diamond size for a fall, CSS px: 5 up to 1 kg, 12 at 10 t and over. A fall of unknown mass is the smallest. */
export function fallSizePx(massG: number | null): number {
  if (massG === null) return 5;
  return 5 + 7 * Math.min(Math.max(Math.log10(massG / 1000) / 4, 0), 1);
}

/** Square size for a find of a tonne or more, CSS px: 8 at 1 t, 14 at Hoba's 60 t. */
export function findSizePx(massG: number): number {
  return 8 + 6 * Math.min(Math.max(Math.log10(massG / 1e6) / Math.log10(60), 0), 1);
}

/** "60 t", "2 t", "1.1 t", "330 kg", "472 g": two significant figures. */
export function massText(massG: number): string {
  const short = (value: number): string => String(Number(value.toPrecision(2)));
  if (massG >= 1e6) return `${short(massG / 1e6)} t`;
  if (massG >= 1000) return `${short(massG / 1000)} kg`;
  return `${short(massG)} g`;
}

/** "◆ Allende · fell 1969 · 2 t · CV3" / "■ Hoba · found 1920 · 60 t · Iron, IVB". */
export function meteoriteLabelText(row: MeteoriteRow, kind: 'fall' | 'find'): string {
  const [name, year, , , massG, cls] = row;
  const parts = [name];
  if (year !== null) parts.push(`${kind === 'fall' ? 'fell' : 'found'} ${year}`);
  if (massG !== null) parts.push(massText(massG));
  parts.push(cls);
  return `${kind === 'fall' ? '◆' : '■'} ${parts.join(' · ')}`;
}

/** Falls of `year` or before; one with no year recorded is old and stays. */
export function fallsBy(falls: readonly MeteoriteRow[], year: number): MeteoriteRow[] {
  return falls.filter((row) => row[1] === null || row[1] <= year);
}

export function meteoriteMarkers(falls: readonly MeteoriteRow[], finds: readonly MeteoriteRow[]): GeoMarker[] {
  // Finds first and falls over them, lightest last, so a small fall beside a great iron still shows.
  return [
    ...finds.map(
      (row): GeoMarker => ({ lon: row[3], lat: row[2], shape: 'square', color: FIND_COLOR, sizePx: findSizePx(row[4] ?? 1e6) })
    ),
    ...falls.map(
      (row): GeoMarker => ({ lon: row[3], lat: row[2], shape: 'diamond', color: FALL_COLOR, sizePx: fallSizePx(row[4]), alpha: 0.95 })
    ),
  ];
}

export async function createMeteoriteLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<MeteoriteData>(context.assetUrl('geo/meteorites.json'));
  const markers = new GeoMarkers('meteorites', context.skyUniforms.uPixelRatio);
  context.earthRoot.add(markers.object);

  let groups: LabelGroup[] = [];
  let shownYear = NaN;
  let visible = false;

  const labelOf =
    (kind: 'fall' | 'find') =>
    (row: MeteoriteRow, i: number): GroupLabel => ({
      text: meteoriteLabelText(row, kind),
      priority: i,
      position: ecefAtAltitude(row[3], row[2], 0, new THREE.Vector3()),
    });

  const rebuild = (year: number): void => {
    if (year === shownYear) return;
    shownYear = year;
    const falls = fallsBy(data.falls, year);
    markers.setMarkers(meteoriteMarkers(falls, data.finds));
    for (const group of groups) group.remove();
    groups = [
      context.addLabels({
        rank: FEATURED_RANK,
        style: { fontPx: 11, color: '#dbe4f2', bold: true, offsetYPx: 14 },
        frame: 'earth',
        labels: data.finds.slice(0, FEATURED_FINDS).map(labelOf('find')),
      }),
      context.addLabels({
        rank: FEATURED_RANK + 0.01,
        style: { fontPx: 11, color: '#ffc4e4', bold: true, offsetYPx: 13 },
        frame: 'earth',
        labels: falls.slice(0, FEATURED_FALLS).map(labelOf('fall')),
      }),
      context.addLabels({
        rank: OTHER_RANK,
        style: { fontPx: 10, color: '#f5b8d8', offsetYPx: 11 },
        frame: 'earth',
        labels: falls.slice(FEATURED_FALLS, FEATURED_FALLS + OTHER_FALLS).map(labelOf('fall')),
      }),
    ];
    for (const group of groups) group.setVisible(visible);
  };
  rebuild(context.now().getUTCFullYear());

  return {
    setVisible(next) {
      visible = next;
      markers.object.visible = next;
      for (const group of groups) group.setVisible(next);
    },
    update(frame) {
      rebuild(frame.date.getUTCFullYear());
    },
    dispose() {
      for (const group of groups) group.remove();
      markers.dispose();
    },
  };
}
