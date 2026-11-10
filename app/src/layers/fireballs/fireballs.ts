/**
 * Fireballs: the bright meteors that U.S. Government sensors have reported
 * since 1988 (app/public/geo/fireballs.json, from
 * tools/pipeline/generate_fireballs.py; NASA/JPL CNEOS).
 *
 * Each is a four-pointed spark sized by its total impact energy and drawn
 * where it was brightest - which is not on the ground but tens of
 * kilometres above it: Chelyabinsk flashed 23 km up. About a third have
 * no reported height; those are drawn fainter, on the surface, rather
 * than at a guessed altitude.
 *
 * The CNEOS API sends no CORS header, so the table is baked; the chip says
 * how recent it is. Events later than the app clock are hidden.
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { FIREBALL_COLOR } from './layer';

export interface Fireball {
  /** Time of peak brightness, ISO UTC. */
  readonly t: string;
  readonly lat: number;
  readonly lon: number;
  /** Altitude of peak brightness, km; null where none was reported. */
  readonly altKm: number | null;
  readonly velKms: number | null;
  /** Total impact energy, kilotons of TNT. */
  readonly energyKt: number;
  readonly radiatedJ: number;
  readonly name?: string;
}

/** The shape of app/public/geo/fireballs.json: largest energy first. */
export interface FireballData {
  /** The day the table was read, "2026-11-10". */
  readonly fetched: string;
  readonly fireballs: readonly Fireball[];
}

/** How many of the most energetic are named ahead of the towns under them. */
export const FEATURED = 10;
/** And how many more get a label where there is room. */
export const OTHERS_LABELLED = 30;
const FEATURED_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.38;
const OTHER_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.3;
/** A fireball with no reported height is drawn this much fainter. */
export const NO_ALTITUDE_ALPHA = 0.5;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Spark size, CSS px: 7 at 0.1 kt, four more for every tenfold, 22 at Chelyabinsk's 440 kt. */
export function fireballSizePx(energyKt: number): number {
  return Math.min(Math.max(7 + 4 * Math.log10(energyKt / 0.1), 6), 22);
}

/** "440 kt", "49 kt", "3.2 kt", "0.18 kt": two significant figures. */
export function energyText(energyKt: number): string {
  if (energyKt >= 100) return `${Math.round(energyKt / 10) * 10} kt`;
  if (energyKt >= 10) return `${Math.round(energyKt)} kt`;
  return `${Number(energyKt.toPrecision(2))} kt`;
}

/** "15 Feb 2013", UTC. */
export function fireballDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "✦ Chelyabinsk · 15 Feb 2013 · 440 kt · 23 km up"; without a name or a height, without them. */
export function fireballLabelText(fireball: Fireball): string {
  const parts = [fireballDate(fireball.t), energyText(fireball.energyKt)];
  if (fireball.name) parts.unshift(fireball.name);
  if (fireball.altKm !== null) parts.push(`${Math.round(fireball.altKm)} km up`);
  return `✦ ${parts.join(' · ')}`;
}

/** Those that have happened by `nowMs`, in the file's order. */
export function fireballsBy(fireballs: readonly Fireball[], nowMs: number): Fireball[] {
  return fireballs.filter((f) => Date.parse(f.t) <= nowMs);
}

export function fireballMarkers(fireballs: readonly Fireball[]): GeoMarker[] {
  // Smallest last, so the many small ones are not buried under a big neighbour.
  return fireballs.map((f) => ({
    lon: f.lon,
    lat: f.lat,
    altitudeM: f.altKm === null ? 0 : f.altKm * 1000,
    shape: 'star',
    color: FIREBALL_COLOR,
    sizePx: fireballSizePx(f.energyKt),
    alpha: f.altKm === null ? NO_ALTITUDE_ALPHA : 1,
  }));
}

export async function createFireballLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<FireballData>(context.assetUrl('geo/fireballs.json'));
  const markers = new GeoMarkers('fireballs', context.skyUniforms.uPixelRatio);
  context.earthRoot.add(markers.object);
  // Baked, and it says so: the table grows by a few events a month.
  context.setStatus(`table of ${fireballDate(`${data.fetched}T00:00:00Z`)}`, 'info');

  let groups: LabelGroup[] = [];
  let shown = -1;
  let visible = false;
  let lastCheckMs = NaN;

  const labelOf = (f: Fireball, i: number): GroupLabel => ({
    text: fireballLabelText(f),
    priority: i,
    position: ecefAtAltitude(f.lon, f.lat, (f.altKm ?? 0) * 1000, new THREE.Vector3()),
  });

  const rebuild = (nowMs: number): void => {
    const past = fireballsBy(data.fireballs, nowMs);
    if (past.length === shown) return;
    shown = past.length;
    markers.setMarkers(fireballMarkers(past));
    for (const group of groups) group.remove();
    groups = [
      context.addLabels({
        rank: FEATURED_RANK,
        style: { fontPx: 11, color: '#c9f3ff', bold: true, offsetYPx: 15 },
        frame: 'earth',
        labels: past.slice(0, FEATURED).map(labelOf),
      }),
      context.addLabels({
        rank: OTHER_RANK,
        style: { fontPx: 10, color: '#b4e6f7', offsetYPx: 12 },
        frame: 'earth',
        labels: past.slice(FEATURED, FEATURED + OTHERS_LABELLED).map(labelOf),
      }),
    ];
    for (const group of groups) group.setVisible(visible);
  };
  rebuild(context.now().getTime());

  return {
    setVisible(next) {
      visible = next;
      markers.object.visible = next;
      for (const group of groups) group.setVisible(next);
    },
    update(frame) {
      const nowMs = frame.date.getTime();
      // The clock only matters when it is pinned or stepped into the past: a look a second is plenty.
      if (Math.abs(nowMs - lastCheckMs) < 1000) return;
      lastCheckMs = nowMs;
      rebuild(nowMs);
    },
    dispose() {
      for (const group of groups) group.remove();
      markers.dispose();
    },
  };
}
