/**
 * Four and a half decades of major tropical cyclones: the track of every
 * storm since 1980 that reached Saffir-Simpson category 3, coloured along
 * its length by the wind it had there (app/public/geo/cyclone-tracks.*,
 * from tools/pipeline/generate_cyclones.py; IBTrACS).
 *
 * Together the tracks draw the basins: the recurving fans of the western
 * Pacific and north Atlantic, the straight westward runs off Mexico, the
 * empty equator and the all but empty South Atlantic.
 *
 * With the app's clock set inside a storm's life (?time=2005-08-28T18:00Z)
 * that storm is picked out: its track so far drawn heavy, the turning
 * cyclone symbol where it was at that hour, and its wind then in the label.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';
import { CLASS_MIN_KT, CLASS_SHORT, cycloneClass, windColor } from './scale';
import { CycloneSymbols, symbolSizePx } from './symbols';

/** One storm of app/public/geo/cyclone-tracks.json. */
export interface StormEntry {
  /** IBTrACS serial, e.g. "2005236N23285". */
  readonly id: string;
  /** "" for a storm nobody named. */
  readonly name: string;
  readonly basin: string;
  /** First record, "YYYY-MM-DDTHH:MMZ". */
  readonly start: string;
  readonly points: number;
  readonly maxWindKt: number;
  readonly minPressureHpa: number | null;
  /** One of the storms to name first. */
  readonly featured?: boolean;
  /** A recent storm whose track the agencies have not yet finalised. */
  readonly provisional?: boolean;
}

export interface TrackIndex {
  readonly source: string;
  readonly firstSeason: number;
  readonly majorKt: number;
  readonly lastRecord: string;
  readonly pointCount: number;
  readonly storms: readonly StormEntry[];
}

export interface Storm extends StormEntry {
  /** Index of its first point. */
  readonly offset: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface Tracks {
  readonly storms: readonly Storm[];
  /** Longitude, latitude per point, hundredths of a degree. */
  readonly lonLat: Int16Array;
  /** Minutes since the storm's first point. */
  readonly minutes: Uint16Array;
  /** Knots; 0 where no U.S. agency gave a wind. */
  readonly winds: Uint8Array;
}

const MINUTE_MS = 60_000;
const HURRICANE_KT = CLASS_MIN_KT[2];

/** The binary's three blocks (see generate_cyclones.py), laid over the storms of the index. */
export function decodeTracks(index: TrackIndex, buffer: ArrayBuffer): Tracks {
  const n = index.pointCount;
  if (buffer.byteLength !== 7 * n) throw new Error(`cyclone tracks: ${buffer.byteLength} bytes for ${n} points`);
  const view = new DataView(buffer);
  const lonLat = new Int16Array(2 * n);
  const minutes = new Uint16Array(n);
  for (let i = 0; i < 2 * n; i++) lonLat[i] = view.getInt16(2 * i, true);
  for (let i = 0; i < n; i++) minutes[i] = view.getUint16(4 * n + 2 * i, true);
  const winds = new Uint8Array(buffer, 6 * n, n);
  let offset = 0;
  const storms = index.storms.map((entry) => {
    const startMs = Date.parse(entry.start.replace('Z', ':00Z'));
    const storm: Storm = { ...entry, offset, startMs, endMs: startMs + minutes[offset + entry.points - 1] * MINUTE_MS };
    offset += entry.points;
    return storm;
  });
  if (offset !== n) throw new Error(`cyclone tracks: storms hold ${offset} points of ${n}`);
  return { storms, lonLat, minutes, winds };
}

export const pointLon = (tracks: Tracks, i: number): number => tracks.lonLat[2 * i] / 100;
export const pointLat = (tracks: Tracks, i: number): number => tracks.lonLat[2 * i + 1] / 100;

export interface SegmentBuffers {
  /** x0,y0,z0, x1,y1,z1 per segment, ECEF metres. */
  readonly positions: Float32Array;
  /** r,g,b at each end, 0..1. */
  readonly colors: Float32Array;
}

/**
 * Every leg of the given storms' tracks, each in the colour of the wind at
 * its start, the weakest legs first - so where tracks cross, the stronger
 * storm is on top. `untilMs` cuts a track off at that instant; `keep`
 * picks legs by their wind.
 */
export function trackSegments(
  tracks: Tracks,
  storms: readonly Storm[],
  untilMs = Infinity,
  keep: (windKt: number) => boolean = () => true
): SegmentBuffers {
  const legs: number[] = [];
  for (const storm of storms) {
    for (let i = storm.offset; i < storm.offset + storm.points - 1; i++) {
      if (storm.startMs + tracks.minutes[i + 1] * MINUTE_MS > untilMs) break;
      if (keep(tracks.winds[i])) legs.push(i);
    }
  }
  legs.sort((a, b) => tracks.winds[a] - tracks.winds[b]);
  const positions = new Float32Array(legs.length * 6);
  const colors = new Float32Array(legs.length * 6);
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  legs.forEach((i, k) => {
    ecefAtAltitude(pointLon(tracks, i), pointLat(tracks, i), 0, point).toArray(positions, k * 6);
    ecefAtAltitude(pointLon(tracks, i + 1), pointLat(tracks, i + 1), 0, point).toArray(positions, k * 6 + 3);
    color.setHex(windColor(tracks.winds[i]), THREE.LinearSRGBColorSpace);
    color.toArray(colors, k * 6);
    color.toArray(colors, k * 6 + 3);
  });
  return { positions, colors };
}

/** The storms whose tracks span `nowMs`. */
export function stormsUnderWay(tracks: Tracks, nowMs: number): Storm[] {
  return tracks.storms.filter((s) => s.startMs <= nowMs && nowMs <= s.endMs);
}

export interface StormFix {
  readonly lon: number;
  readonly lat: number;
  /** The wind of the last record at or before the instant, knots; 0 if not given. */
  readonly windKt: number;
}

/** Where a storm was at `nowMs`, between the records either side; null outside its life. */
export function stormFixAt(tracks: Tracks, storm: Storm, nowMs: number): StormFix | null {
  if (nowMs < storm.startMs || nowMs > storm.endMs) return null;
  const elapsed = (nowMs - storm.startMs) / MINUTE_MS;
  let i = storm.offset;
  const last = storm.offset + storm.points - 1;
  while (i < last - 1 && tracks.minutes[i + 1] <= elapsed) i++;
  const span = tracks.minutes[i + 1] - tracks.minutes[i];
  const t = span > 0 ? Math.min(Math.max((elapsed - tracks.minutes[i]) / span, 0), 1) : 0;
  // The short way round, for a leg over the date line.
  const lon0 = pointLon(tracks, i);
  const step = ((pointLon(tracks, i + 1) - lon0 + 540) % 360) - 180;
  const lon = ((lon0 + step * t + 540) % 360) - 180;
  const lat = pointLat(tracks, i) + (pointLat(tracks, i + 1) - pointLat(tracks, i)) * t;
  return { lon, lat, windKt: tracks.winds[t >= 1 ? i + 1 : i] };
}

/** Index of the first point at the storm's greatest wind: where its name goes. */
export function peakPoint(tracks: Tracks, storm: Storm): number {
  let best = storm.offset;
  for (let i = storm.offset; i < storm.offset + storm.points; i++) if (tracks.winds[i] > tracks.winds[best]) best = i;
  return best;
}

const year = (storm: Storm): number => new Date(storm.startMs).getUTCFullYear();

/** "Katrina 2005 · 150 kt · 902 hPa"; a nameless storm is "1982 storm". */
export function stormLabelText(storm: Storm): string {
  const who = storm.name ? `${storm.name} ${year(storm)}` : `${year(storm)} storm`;
  const pressure = storm.minPressureHpa === null ? '' : ` · ${storm.minPressureHpa} hPa`;
  return `${who} · ${storm.maxWindKt} kt${pressure}`;
}

/** "Katrina · Cat 5 · 150 kt" for a storm under way, with its wind at that hour. */
export function underWayLabelText(storm: Storm, fix: StormFix): string {
  const who = storm.name || 'Unnamed storm';
  return fix.windKt > 0 ? `${who} · ${CLASS_SHORT[cycloneClass(fix.windKt)]} · ${fix.windKt} kt` : who;
}

/** How many storms beyond the featured ones are offered to the label layer, strongest first. */
export const OTHER_LABELS = 90;

/** Featured storms, then the strongest of the rest: each named at its peak. */
export function stormLabels(tracks: Tracks): [GroupLabel[], GroupLabel[]] {
  const labelOf = (storm: Storm): GroupLabel => {
    const i = peakPoint(tracks, storm);
    return {
      text: stormLabelText(storm),
      // The stronger first; of equals, the deeper.
      priority: -storm.maxWindKt * 10_000 + (storm.minPressureHpa ?? 1100),
      position: ecefAtAltitude(pointLon(tracks, i), pointLat(tracks, i), 0, new THREE.Vector3()),
    };
  };
  const byStrength = (a: GroupLabel, b: GroupLabel): number => a.priority - b.priority;
  const featured = tracks.storms.filter((s) => s.featured).map(labelOf).sort(byStrength);
  const others = tracks.storms
    .filter((s) => !s.featured)
    .map(labelOf)
    .sort(byStrength)
    .slice(0, OTHER_LABELS);
  return [featured, others];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The chip: the span of the archive, or the storms under way at the clock. */
export function tracksStatus(tracks: Tracks, underWay: readonly Storm[], nowMs: number): string {
  if (underWay.length > 0) {
    const d = new Date(nowMs);
    const names = underWay.map((s) => s.name || 'unnamed').join(', ');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}: ${names}`;
  }
  const first = Math.min(...tracks.storms.map(year));
  const last = Math.max(...tracks.storms.map((s) => new Date(s.endMs).getUTCFullYear()));
  return `${tracks.storms.length.toLocaleString('en-US')} storms · ${first}–${last}`;
}

const FEATURED_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.38;
const OTHER_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.3;
/** A storm under way at the clock outranks every name on the map. */
const UNDER_WAY_RANK = -0.6;

function fatLines(name: string, linewidth: number, opacity: number, renderOrder: number): LineSegments2 {
  const material = new LineMaterial({
    vertexColors: true,
    linewidth,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new LineSegments2(new LineSegmentsGeometry(), material);
  lines.name = name;
  lines.frustumCulled = false;
  lines.renderOrder = renderOrder;
  return lines;
}

/**
 * The faint web of sub-hurricane legs is most of the archive: as hairlines it costs a fraction of
 * what screen-space quads do, and on top of the default layers that is the difference between
 * holding the frame rate and missing it.
 */
function thinLines(name: string, opacity: number, renderOrder: number): THREE.LineSegments {
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthTest: false, depthWrite: false });
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  lines.name = name;
  lines.frustumCulled = false;
  lines.renderOrder = renderOrder;
  return lines;
}

function setThinSegments(lines: THREE.LineSegments, buffers: SegmentBuffers): void {
  lines.geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  lines.geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
}

function setSegments(lines: LineSegments2, buffers: SegmentBuffers): void {
  lines.geometry.dispose();
  const geometry = new LineSegmentsGeometry();
  if (buffers.positions.length > 0) {
    geometry.setPositions(buffers.positions);
    geometry.setColors(buffers.colors);
  }
  lines.geometry = geometry;
  lines.visible = buffers.positions.length > 0;
}

export async function createCycloneTracksLayer(context: LayerContext): Promise<LayerInstance> {
  const [index, response] = await Promise.all([
    context.fetchJson<TrackIndex>(context.assetUrl('geo/cyclone-tracks.json')),
    fetch(context.assetUrl('geo/cyclone-tracks.bin')),
  ]);
  if (!response.ok) throw new Error(`cyclone tracks: HTTP ${response.status}`);
  const tracks = decodeTracks(index, await response.arrayBuffer());

  // A storm spends most of its life below hurricane strength: drawn as heavy as the rest, those legs
  // bury the basins in the blue of depressions. They stay as a faint web under the hurricane legs.
  const weak = thinLines('cyclone-tracks-weak', 0.45, RENDER_ORDER.outlines + 0.28);
  setThinSegments(weak, trackSegments(tracks, tracks.storms, Infinity, (kt) => kt < HURRICANE_KT));
  const all = fatLines('cyclone-tracks', 1.3, 0.8, RENDER_ORDER.outlines + 0.3);
  setSegments(all, trackSegments(tracks, tracks.storms, Infinity, (kt) => kt >= HURRICANE_KT));
  const current = fatLines('cyclone-tracks-under-way', 3.2, 1, RENDER_ORDER.outlines + 0.35);
  current.visible = false;
  const symbols = new CycloneSymbols('cyclone-tracks-symbols', context.skyUniforms.uPixelRatio);
  const group = new THREE.Group();
  group.add(weak, all, current, symbols.object);
  context.earthRoot.add(group);

  const [featured, others] = stormLabels(tracks);
  const groups: LabelGroup[] = [
    context.addLabels({ rank: FEATURED_RANK, style: { fontPx: 11, color: '#ffe9c2', bold: true, offsetYPx: 10 }, frame: 'earth', labels: featured }),
    context.addLabels({ rank: OTHER_RANK, style: { fontPx: 10, color: '#f3d7ad', offsetYPx: 10 }, frame: 'earth', labels: others }),
  ];
  let underWayLabels: LabelGroup | null = null;
  let visible = false;
  let shownMinute = NaN;
  let shownKey = '';

  /** Redraw what depends on the clock: at most once per minute of app time. */
  const follow = (nowMs: number): void => {
    const minute = Math.floor(nowMs / MINUTE_MS);
    if (minute === shownMinute) return;
    shownMinute = minute;
    const underWay = stormsUnderWay(tracks, nowMs);
    const key = underWay.map((s) => s.id).join();
    if (key === '' && shownKey === '') return;
    shownKey = key;
    setSegments(current, trackSegments(tracks, underWay, nowMs));
    const labels: GroupLabel[] = [];
    symbols.setSymbols(
      underWay.flatMap((storm, i) => {
        const fix = stormFixAt(tracks, storm, nowMs);
        if (!fix) return [];
        labels.push({
          text: underWayLabelText(storm, fix),
          priority: i,
          position: ecefAtAltitude(fix.lon, fix.lat, 0, new THREE.Vector3()),
        });
        return [{ lon: fix.lon, lat: fix.lat, color: windColor(fix.windKt), sizePx: symbolSizePx(fix.windKt) }];
      })
    );
    underWayLabels?.remove();
    underWayLabels = context.addLabels({
      rank: UNDER_WAY_RANK,
      style: { fontPx: 12, color: '#ffffff', bold: true, offsetYPx: 22 },
      frame: 'earth',
      labels,
    });
    underWayLabels.setVisible(visible);
    context.setStatus(tracksStatus(tracks, underWay, nowMs), 'info');
  };
  context.setStatus(tracksStatus(tracks, [], 0), 'info');
  follow(context.now().getTime());

  return {
    setVisible(next) {
      visible = next;
      group.visible = next;
      for (const labels of groups) labels.setVisible(next);
      underWayLabels?.setVisible(next);
    },
    update(frame) {
      follow(frame.date.getTime());
      symbols.advance(frame.deltaMs);
    },
    setResolution(widthCss, heightCss) {
      for (const lines of [all, current]) (lines.material as LineMaterial).resolution.set(widthCss, heightCss);
    },
    dispose() {
      for (const labels of groups) labels.remove();
      underWayLabels?.remove();
      group.removeFromParent();
      weak.geometry.dispose();
      (weak.material as THREE.Material).dispose();
      for (const lines of [all, current]) {
        lines.geometry.dispose();
        (lines.material as LineMaterial).dispose();
      }
      symbols.dispose();
    },
  };
}
