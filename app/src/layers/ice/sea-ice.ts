/**
 * Where the sea ice ends, at both poles, with where it used to end.
 *
 * Two lines per pole from the NSIDC Sea Ice Index: the edge of the ice on
 * one day - the boundary of the area at least 15 % ice-covered - and the
 * median position of that edge on the same day of the year over 1981-2010.
 * The gap between them is three decades of change.
 *
 * NSIDC's server sends no CORS header, so nothing here is fetched live:
 * tools/pipeline/generate_ice.py bakes the newest day and the 1st and 15th
 * of the year before it. The layer shows the baked day nearest the app
 * clock and always names it - in the chip and in the labels - with its age
 * once the clock has moved past the newest. A clock set before the first
 * baked day gets no lines rather than the wrong season's.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance, StatusTone } from '../types';
import { ICE_EDGE_COLOR, MEDIAN_EDGE_COLOR } from './layer';

export interface PoleIce {
  /** Millions of km²; null when the index has no figure for the day. */
  readonly extentMkm2: number | null;
  readonly medianMkm2: number | null;
  /** Polylines: lon, lat, lon, lat, ... in hundredths of a degree. */
  readonly edge: readonly (readonly number[])[];
  readonly median: readonly (readonly number[])[];
}

export interface SeaIceDay {
  /** "2026-11-08", UTC. */
  readonly date: string;
  readonly north: PoleIce;
  readonly south: PoleIce;
}

/** The shape of app/public/geo/sea-ice-extent.json: days oldest first. */
export interface SeaIceData {
  readonly days: readonly SeaIceDay[];
}

const DAY_MS = 86_400_000;
/** Baked days are at most 17 days apart: half that, and a day's grace, reaches every date between them. */
export const MAX_GAP_DAYS = 9.5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Noon UTC of a baked day: the grids are daily composites. */
export function dayTimeMs(day: SeaIceDay): number {
  return Date.parse(`${day.date}T12:00:00Z`);
}

/** "8 Nov 2026" from "2026-11-08". */
export function dayText(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export interface PickedDay {
  readonly day: SeaIceDay;
  /** Whole days from the baked day to the app clock: positive when the clock is later. */
  readonly ageDays: number;
}

/**
 * The baked day to show at `nowMs`: the nearest one, when it is within
 * MAX_GAP_DAYS; past the newest, the newest however old - it is the last
 * word the app has, and is shown as such. Before the first day, nothing.
 */
export function pickDay(days: readonly SeaIceDay[], nowMs: number): PickedDay | null {
  if (days.length === 0) return null;
  let best = days[0];
  for (const day of days) {
    if (Math.abs(dayTimeMs(day) - nowMs) < Math.abs(dayTimeMs(best) - nowMs)) best = day;
  }
  const ageDays = (nowMs - dayTimeMs(best)) / DAY_MS;
  const newest = days[days.length - 1];
  if (Math.abs(ageDays) > MAX_GAP_DAYS && !(best === newest && ageDays > 0)) return null;
  // "+ 0" turns the −0 a morning of the same day rounds to into 0.
  return { day: best, ageDays: Math.round(ageDays) + 0 };
}

/** The chip: always the baked day's date, never 'live'. */
export function seaIceStatus(picked: PickedDay | null, days: readonly SeaIceDay[]): { text: string; tone: StatusTone } {
  if (!picked) {
    const span = days.length > 0 ? ` · baked ${dayText(days[0].date)} – ${dayText(days[days.length - 1].date)}` : '';
    return { text: `no data for this date${span}`, tone: 'error' };
  }
  const age = picked.ageDays > MAX_GAP_DAYS ? ` · ${picked.ageDays} d old` : '';
  return { text: `snapshot · ${dayText(picked.day.date)}${age}`, tone: 'stale' };
}

/** "Arctic sea ice 8.58 M km² · median 10.19 · 8 Nov 2026". */
export function poleLabelText(name: string, pole: PoleIce, date: string): string {
  const extent = pole.extentMkm2 === null ? '' : ` ${pole.extentMkm2.toFixed(2)} M km²`;
  const median = pole.medianMkm2 === null ? '' : ` · 1981–2010 median ${pole.medianMkm2.toFixed(2)}`;
  return `${name} sea ice${extent}${median} · ${dayText(date)}`;
}

/** Segment endpoints (x0,y0,z0, x1,y1,z1, ...) in ECEF metres for a set of encoded polylines. */
export function lineSegmentPositions(lines: readonly (readonly number[])[]): Float32Array {
  let segments = 0;
  for (const line of lines) segments += Math.max(0, line.length / 2 - 1);
  const out = new Float32Array(segments * 6);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let offset = 0;
  for (const line of lines) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      ecefAtAltitude(line[i] / 100, line[i + 1] / 100, 0, a);
      ecefAtAltitude(line[i + 2] / 100, line[i + 3] / 100, 0, b);
      a.toArray(out, offset);
      b.toArray(out, offset + 3);
      offset += 6;
    }
  }
  return out;
}

interface EdgeLine {
  readonly object: LineSegments2;
  readonly material: LineMaterial;
  set(lines: readonly (readonly number[])[]): void;
  dispose(): void;
}

function createEdgeLine(name: string, color: string, widthPx: number, renderOrder: number): EdgeLine {
  const material = new LineMaterial({ color, linewidth: widthPx, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const object = new LineSegments2(new LineSegmentsGeometry(), material);
  object.name = name;
  object.frustumCulled = false;
  object.renderOrder = renderOrder;
  return {
    object,
    material,
    set(lines) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(lineSegmentPositions(lines));
      object.geometry.dispose();
      object.geometry = geometry;
    },
    dispose() {
      object.removeFromParent();
      object.geometry.dispose();
      material.dispose();
    },
  };
}

export async function createSeaIceLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<SeaIceData>(context.assetUrl('geo/sea-ice-extent.json'));
  // The median under the day's edge: where they run together, today's line is the one seen.
  const median = createEdgeLine('sea-ice-median', MEDIAN_EDGE_COLOR, 2, RENDER_ORDER.outlines + 0.24);
  const edge = createEdgeLine('sea-ice-edge', ICE_EDGE_COLOR, 2.6, RENDER_ORDER.outlines + 0.25);
  const group = new THREE.Group();
  group.add(median.object, edge.object);
  context.earthRoot.add(group);

  const poles = { north: ecefAtAltitude(0, 90, 0, new THREE.Vector3()), south: ecefAtAltitude(0, -90, 0, new THREE.Vector3()) };
  let labels: LabelGroup | null = null;
  let shown: SeaIceDay | null | undefined;
  let statusText: string | null = null;
  let visible = false;
  let checkedMinute = NaN;

  const show = (nowMs: number): void => {
    const picked = pickDay(data.days, nowMs);
    const status = seaIceStatus(picked, data.days);
    if (picked?.day !== shown) {
      shown = picked?.day ?? null;
      labels?.remove();
      labels = null;
      edge.set(picked ? [...picked.day.north.edge, ...picked.day.south.edge] : []);
      median.set(picked ? [...picked.day.north.median, ...picked.day.south.median] : []);
      if (picked) {
        const group: GroupLabel[] = [
          { text: poleLabelText('Arctic', picked.day.north, picked.day.date), priority: 0, position: poles.north },
          { text: poleLabelText('Antarctic', picked.day.south, picked.day.date), priority: 1, position: poles.south },
        ];
        labels = context.addLabels({
          rank: LABEL_KIND_ORDER.indexOf('country') - 0.3,
          style: { fontPx: 11, color: '#d8f8ff', bold: true },
          frame: 'earth',
          labels: group,
        });
        labels.setVisible(visible);
      }
    }
    // The age in the chip moves on by the day even when the lines do not.
    if (status.text !== statusText) {
      statusText = status.text;
      context.setStatus(status.text, status.tone);
    }
  };
  show(context.now().getTime());

  return {
    setVisible(next) {
      visible = next;
      group.visible = next;
      labels?.setVisible(next);
    },
    update(frame) {
      // The day shown changes at most daily: a look a minute is plenty.
      const minute = Math.floor(frame.date.getTime() / 60_000);
      if (minute === checkedMinute) return;
      checkedMinute = minute;
      show(frame.date.getTime());
    },
    setResolution(widthCss, heightCss) {
      edge.material.resolution.set(widthCss, heightCss);
      median.material.resolution.set(widthCss, heightCss);
    },
    dispose() {
      labels?.remove();
      edge.dispose();
      median.dispose();
      group.removeFromParent();
    },
  };
}
