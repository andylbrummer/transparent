/**
 * Landmarks: the highest mountains, the deepest holes, launch sites,
 * telescopes and detectors, accelerators, World Heritage Sites, wrecks -
 * small sets of points asked of Wikidata (app/public/geo/landmarks.json,
 * tools/pipeline/generate_landmarks.py), one switch each.
 *
 * A summit is drawn at its height and a borehole's or mine's symbol at
 * its bottom: these are in the Earth, if only by a hair at this scale.
 * Which names are written first is decided by the set's own measure -
 * metres for mountains and holes, otherwise how many Wikipedia language
 * editions have an article on the place.
 */

import type { GeoMarker } from '../../render/geo-markers';
import type { LayerContext, LayerInstance } from '../types';
import { FEATURED_RANK, OTHER_RANK, assembleLayer, formatDay, labelAt, splitRanked, thousands, type LabelSet } from './shared';
import {
  ACCELERATOR_STYLE,
  DEEP_STYLE,
  HERITAGE_STYLE,
  LAUNCH_STYLE,
  MOUNTAIN_STYLE,
  OBSERVATORY_COLORS,
  WRECK_STYLE,
  hex,
  type ObservatoryKind,
  type PointStyle,
} from './styles';

export type LandmarkSetId = 'mountains' | 'deep' | 'launchSites' | 'observatories' | 'accelerators' | 'heritage' | 'wrecks';

export interface Landmark {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Wikipedia language editions with an article on it. */
  readonly links: number;
  /** Metres: elevation of a mountain, depth of a hole. */
  readonly value?: number;
  /** The value as its source words it, where that is not a plain number: "over 4 km". */
  readonly valueText?: string;
  readonly kind?: string;
}

/** The shape of app/public/geo/landmarks.json. */
export interface LandmarkData {
  /** The day Wikidata was asked, ISO. */
  readonly asOf: string;
  readonly sets: Readonly<Record<LandmarkSetId, readonly Landmark[]>>;
}

interface SetView {
  /** Names written ahead of state names, and how many more after them. */
  readonly featured: number;
  readonly others: number;
  readonly labelColor: string;
  /** Lower is written first. */
  priority(landmark: Landmark): number;
  text(landmark: Landmark): string;
  marker(landmark: Landmark): Omit<GeoMarker, 'lon' | 'lat' | 'altitudeM'>;
  /** Metres above the sphere at which the symbol and its name sit. Default 0. */
  altitudeM?(landmark: Landmark): number;
}

const byLinks = (landmark: Landmark): number => -landmark.links;
const plain = (style: PointStyle) => (): Omit<GeoMarker, 'lon' | 'lat' | 'altitudeM'> => ({
  shape: style.shape,
  color: style.color,
  sizePx: style.sizePx,
});

/** Detectors of neutrinos and gravitational waves are few and strange: their names go ahead of the telescopes'. */
const DETECTOR_HEAD_START = 40;
const isDetector = (landmark: Landmark): boolean => landmark.kind === 'neutrino' || landmark.kind === 'gw';

export const SET_VIEWS: Readonly<Record<LandmarkSetId, SetView>> = {
  mountains: {
    featured: 14,
    others: 80,
    labelColor: MOUNTAIN_STYLE.labelColor,
    priority: (m) => -(m.value ?? 0),
    text: (m) => `△ ${m.name} · ${thousands(m.value ?? 0)} m`,
    marker: (m) => ({ ...plain(MOUNTAIN_STYLE)(), sizePx: (m.value ?? 0) >= 8000 ? 10 : 7.5 }),
    altitudeM: (m) => m.value ?? 0,
  },
  deep: {
    featured: 8,
    others: 20,
    labelColor: DEEP_STYLE.labelColor,
    priority: (d) => -(d.value ?? 0),
    text: (d) => `${d.name} · ${d.valueText ?? `${thousands(d.value ?? 0)} m`} down`,
    marker: plain(DEEP_STYLE),
    altitudeM: (d) => -(d.value ?? 0),
  },
  launchSites: {
    featured: 12,
    others: 60,
    labelColor: LAUNCH_STYLE.labelColor,
    priority: byLinks,
    text: (s) => s.name,
    marker: (s) => ({ ...plain(LAUNCH_STYLE)(), sizePx: s.links >= 20 ? 11 : 7.5 }),
  },
  observatories: {
    featured: 18,
    others: 110,
    labelColor: hex(OBSERVATORY_COLORS.optical),
    priority: (o) => -o.links - (isDetector(o) ? DETECTOR_HEAD_START : 0),
    text: (o) => (o.kind === 'neutrino' ? `${o.name} · neutrinos` : o.kind === 'gw' ? `${o.name} · gravitational waves` : o.name),
    marker: (o) => ({
      shape: 'ring',
      color: OBSERVATORY_COLORS[(o.kind ?? 'observatory') as ObservatoryKind] ?? OBSERVATORY_COLORS.observatory,
      sizePx: isDetector(o) ? 10 : 8,
    }),
  },
  accelerators: {
    featured: 6,
    others: 14,
    labelColor: ACCELERATOR_STYLE.labelColor,
    priority: byLinks,
    text: (a) => a.name,
    marker: plain(ACCELERATOR_STYLE),
  },
  heritage: {
    featured: 24,
    others: 200,
    labelColor: HERITAGE_STYLE.labelColor,
    priority: byLinks,
    text: (h) => h.name,
    marker: plain(HERITAGE_STYLE),
  },
  wrecks: {
    featured: 12,
    others: 120,
    labelColor: WRECK_STYLE.labelColor,
    priority: byLinks,
    text: (w) => w.name,
    marker: plain(WRECK_STYLE),
  },
};

/** Markers in drawing order: the least first, so the best known end on top. */
export function landmarkMarkers(landmarks: readonly Landmark[], view: SetView): GeoMarker[] {
  return [...landmarks]
    .sort((a, b) => view.priority(b) - view.priority(a))
    .map((l) => ({ lon: l.lon, lat: l.lat, altitudeM: view.altitudeM?.(l) ?? 0, ...view.marker(l) }));
}

/** [featured, others], each ranked. One instrument at two sites is named at both. */
export function landmarkLabels(landmarks: readonly Landmark[], view: SetView): [LabelSet['labels'], LabelSet['labels']] {
  const ranked = [...landmarks].sort((a, b) => view.priority(a) - view.priority(b));
  const [featured, others] = splitRanked(ranked, view.featured, view.others);
  const label = (l: Landmark): LabelSet['labels'][number] => labelAt(view.text(l), view.priority(l), l.lon, l.lat, view.altitudeM?.(l) ?? 0);
  return [featured.map(label), others.map(label)];
}

export async function createLandmarkLayer(context: LayerContext, set: LandmarkSetId): Promise<LayerInstance> {
  const data = await context.fetchJson<LandmarkData>(context.assetUrl('geo/landmarks.json'));
  const view = SET_VIEWS[set];
  const landmarks = data.sets[set];
  const [featured, others] = landmarkLabels(landmarks, view);
  const layer = assembleLayer(context, `landmarks-${set}`, landmarkMarkers(landmarks, view), [
    { rank: FEATURED_RANK, style: { fontPx: 11, color: view.labelColor, bold: true, offsetYPx: 11 }, labels: featured },
    { rank: OTHER_RANK, style: { fontPx: 10, color: view.labelColor, offsetYPx: 10 }, labels: others },
  ]);
  context.setStatus(`as of ${formatDay(data.asOf)}`, 'info');
  return layer;
}
