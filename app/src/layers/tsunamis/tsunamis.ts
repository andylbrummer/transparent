/**
 * Tsunamis in history (app/public/geo/tsunamis.json, from
 * tools/pipeline/generate_tsunamis.py; NOAA NCEI Global Historical Tsunami
 * Database): a cross at the SOURCE of each - the epicentre, the landslide,
 * the volcano - coloured by what raised the water and sized by how high it
 * ran and how many it killed.
 *
 * The two measures pick out different events, and both matter: the highest
 * waves are landslides into fjords that drowned few (Lituya Bay, 524 m,
 * five dead); the deadliest were barely a tenth as high and crossed oceans
 * (2004, 51 m, 228,000 dead).
 *
 * A tsunami later than the app clock's year is hidden.
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { TSUNAMI_CAUSES, type TsunamiCause } from './layer';

export interface Tsunami {
  readonly id: number;
  /** Year; negative is BCE. Month and day may be unknown. */
  readonly y: number;
  readonly m: number | null;
  readonly d: number | null;
  readonly lat: number;
  readonly lon: number;
  readonly cause: TsunamiCause;
  /** Highest water recorded anywhere, metres. */
  readonly heightM: number | null;
  /** Killed by the tsunami itself - not by the earthquake or eruption behind it. */
  readonly deaths: number | null;
  readonly mag: number | null;
  readonly place: string;
  readonly country: string;
}

/** The shape of app/public/geo/tsunamis.json: highest water first. */
export interface TsunamiData {
  readonly tsunamis: readonly Tsunami[];
}

/** How many of the highest, and of the deadliest, are named ahead of the towns. */
export const FEATURED_HIGHEST = 8;
export const FEATURED_DEADLIEST = 10;
/** Further ones named where there is room. */
export const OTHERS_LABELLED = 40;
const FEATURED_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.34;
const OTHER_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.22;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLOR_OF = new Map(TSUNAMI_CAUSES.map((c) => [c.key, c.color]));

/** The toll to size and rank by: the tsunami's own, nothing where the database has no figure. */
export function tsunamiDeaths(t: Tsunami): number {
  return t.deaths ?? 0;
}

/**
 * Cross size, CSS px, the larger of two scales so that both the highest and
 * the deadliest stand out: by run-up 6 at 1 m, 10.5 at 10 m, 18 at Lituya
 * Bay’s 524 m; by deaths 6 at 10, 11.5 at 1,000, 18 at 2004’s 228,000.
 */
export function tsunamiSizePx(t: Tsunami): number {
  const byHeight = t.heightM !== null && t.heightM > 1 ? 6 + 4.5 * Math.log10(t.heightM) : 6;
  const deaths = tsunamiDeaths(t);
  const byDeaths = deaths > 10 ? 6 + 2.75 * (Math.log10(deaths) - 1) : 6;
  return Math.min(Math.max(byHeight, byDeaths), 18.5);
}

/** "26 Dec 2004", "Aug 1883", "1674", "1610 BCE". */
export function tsunamiDate(t: Tsunami): string {
  if (t.y <= 0) return `${-t.y} BCE`;
  if (t.m === null) return String(t.y);
  const month = MONTHS[t.m - 1];
  return t.d === null ? `${month} ${t.y}` : `${t.d} ${month} ${t.y}`;
}

/** "524.6 m", "39.3 m", "25 m", "0.5 m": to the decimetre, as measured. */
export function heightText(heightM: number): string {
  return `${Number(heightM.toFixed(1))} m`;
}

/** "✚ Lituya Bay, Alaska · 10 Jul 1958 · 524.6 m · 5 dead". */
export function tsunamiLabelText(t: Tsunami): string {
  const parts = [t.place, tsunamiDate(t)];
  if (t.heightM !== null) parts.push(heightText(t.heightM));
  const deaths = tsunamiDeaths(t);
  if (deaths > 0) parts.push(`${deaths.toLocaleString('en-US')} dead`);
  return `✚ ${parts.join(' · ')}`;
}

/** Those of `year` or before. */
export function tsunamisBy(tsunamis: readonly Tsunami[], year: number): Tsunami[] {
  return tsunamis.filter((t) => t.y <= year);
}

/** The highest and the deadliest, each once, in the order given (highest water first). */
export function pickFeatured(tsunamis: readonly Tsunami[]): Tsunami[] {
  const deadliest = [...tsunamis].sort((a, b) => tsunamiDeaths(b) - tsunamiDeaths(a)).slice(0, FEATURED_DEADLIEST);
  const picked = new Set<Tsunami>([...tsunamis.slice(0, FEATURED_HIGHEST), ...deadliest]);
  return tsunamis.filter((t) => picked.has(t));
}

export function tsunamiMarkers(tsunamis: readonly Tsunami[]): GeoMarker[] {
  // Biggest first, so the many small ones around Japan are not buried under 2011.
  return [...tsunamis]
    .sort((a, b) => tsunamiSizePx(b) - tsunamiSizePx(a))
    .map((t) => ({
      lon: t.lon,
      lat: t.lat,
      shape: 'cross',
      color: COLOR_OF.get(t.cause) ?? 0xaab4c0,
      sizePx: tsunamiSizePx(t),
    }));
}

export async function createTsunamiLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<TsunamiData>(context.assetUrl('geo/tsunamis.json'));
  const markers = new GeoMarkers('tsunamis', context.skyUniforms.uPixelRatio);
  context.earthRoot.add(markers.object);

  let groups: LabelGroup[] = [];
  let shownYear = NaN;
  let visible = false;

  // In the order given: the featured by height of water, the rest by size of symbol.
  const labelOf = (t: Tsunami, i: number): GroupLabel => ({
    text: tsunamiLabelText(t),
    priority: i,
    position: ecefAtAltitude(t.lon, t.lat, 0, new THREE.Vector3()),
  });

  const rebuild = (year: number): void => {
    if (year === shownYear) return;
    shownYear = year;
    const past = tsunamisBy(data.tsunamis, year);
    markers.setMarkers(tsunamiMarkers(past));
    const featured = pickFeatured(past);
    const featuredSet = new Set(featured);
    const others = past
      .filter((t) => !featuredSet.has(t))
      .sort((a, b) => tsunamiSizePx(b) - tsunamiSizePx(a))
      .slice(0, OTHERS_LABELLED);
    for (const group of groups) group.remove();
    groups = [
      context.addLabels({
        rank: FEATURED_RANK,
        style: { fontPx: 11, color: '#b8f5ef', bold: true, offsetYPx: 15 },
        frame: 'earth',
        labels: featured.map(labelOf),
      }),
      context.addLabels({
        rank: OTHER_RANK,
        style: { fontPx: 10, color: '#a5e6e0', offsetYPx: 12 },
        frame: 'earth',
        labels: others.map(labelOf),
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
