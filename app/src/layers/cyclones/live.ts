/**
 * Tropical cyclones under way anywhere in the world, from GDACS
 * (./gdacs.ts): for each, the track of its advisories so far coloured by
 * wind, the turning cyclone symbol at its latest reported position, and
 * the latest advisory's forecast - a dashed track, a dot per forecast
 * hour, and the cone of uncertainty around them. Storms that ended in the
 * past ten days stay as faint tracks.
 *
 * Everything is placed by the app clock. With ?time= pinned in the past
 * the storms of that week are fetched and each track is cut at that
 * instant; no forecast is drawn then, because GDACS keeps only the latest
 * one - a forecast is never shown as if it had been issued earlier.
 *
 * When GDACS cannot be reached the layer shows the last answer it got
 * (localStorage), else the snapshot baked into the app
 * (tools/pipeline/generate_cyclones.py --snapshot), under a 'stale' chip
 * naming the data's date; storms too old for the clock simply do not draw.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { GeoMarkers, ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import type { GroupLabel, LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance, StatusTone } from '../types';
import { LOOKBACK_DAYS, loadLive, type LiveData, type LiveIo, type LiveStorm, type TrackPoint } from './gdacs';
import { CLASS_SHORT, cycloneClass, windColor } from './scale';
import { CycloneSymbols, symbolSizePx, type CycloneSymbol } from './symbols';

export const SNAPSHOT_PATH = 'geo/cyclone-live-snapshot.json';
export const CACHE_KEY = 'transparent-earth.cyclones-live';
/** Advisories come every six hours (three near land): an hourly look is prompt and light on GDACS. */
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
/** After a failure, try again this soon: GDACS drops the odd request. */
export const RETRY_INTERVAL_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** With no forecast beyond its last advisory, a storm is over once the next advisory is this overdue. */
const OVERDUE_MS = 12 * HOUR_MS;
/** With a forecast, a silent storm is given this long: some centres report twice a day. */
const SILENT_MS = 36 * HOUR_MS;

export type StormState = 'under-way' | 'ended';

export interface StormView {
  readonly storm: LiveStorm;
  readonly state: StormState;
  /** The advisories up to the clock. */
  readonly track: readonly TrackPoint[];
  /** Where the symbol goes: the latest advisory, or between two when the clock is inside the track. */
  readonly fix: { readonly lon: number; readonly lat: number; readonly windKt: number };
  /** Age of the latest advisory at the clock; null when the clock is inside the track. */
  readonly advisoryAgeMs: number | null;
  /** The latest advisory followed by its forecast points; empty unless the clock is at or past that advisory. */
  readonly forecast: readonly TrackPoint[];
  /** Greatest advisory wind up to the clock, knots. */
  readonly peakKt: number;
}

/** The short way round from one longitude to another, degrees. */
const lonStep = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

/**
 * What to draw of a storm at `nowMs`: null if it has not begun by then or
 * ended more than LOOKBACK_DAYS before.
 */
export function stormView(storm: LiveStorm, nowMs: number): StormView | null {
  const observed = storm.points.filter((p) => !p.forecast);
  if (observed.length === 0 || observed[0].timeMs > nowMs) return null;
  const last = observed[observed.length - 1];
  const peakOf = (points: readonly TrackPoint[]): number => Math.max(...points.map((p) => p.windKt));

  if (nowMs < last.timeMs) {
    // Inside the track: between advisory i and the next.
    let i = 0;
    while (i < observed.length - 2 && observed[i + 1].timeMs <= nowMs) i++;
    const a = observed[i];
    const b = observed[i + 1];
    const t = (nowMs - a.timeMs) / Math.max(b.timeMs - a.timeMs, 1);
    const track = observed.slice(0, i + 1);
    return {
      storm,
      state: 'under-way',
      track,
      fix: { lon: ((a.lon + lonStep(a.lon, b.lon) * t + 540) % 360) - 180, lat: a.lat + (b.lat - a.lat) * t, windKt: a.windKt },
      advisoryAgeMs: null,
      forecast: [],
      peakKt: peakOf(track),
    };
  }

  const age = nowMs - last.timeMs;
  if (age > LOOKBACK_DAYS * DAY_MS) return null;
  const forecast = storm.points.filter((p) => p.forecast);
  const expected = forecast.some((p) => p.timeMs > nowMs);
  const underWay = age <= OVERDUE_MS || (expected && age <= SILENT_MS);
  return {
    storm,
    state: underWay ? 'under-way' : 'ended',
    track: observed,
    fix: { lon: last.lon, lat: last.lat, windKt: last.windKt },
    advisoryAgeMs: age,
    forecast: underWay && forecast.length > 0 ? [last, ...forecast] : [],
    peakKt: peakOf(observed),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');
const utcDay = (ms: number): string => `${new Date(ms).getUTCDate()} ${MONTHS[new Date(ms).getUTCMonth()]}`;
const utcDate = (ms: number): string => `${utcDay(ms)} ${new Date(ms).getUTCFullYear()}`;
const utcTime = (ms: number): string => `${two(new Date(ms).getUTCHours())}:${two(new Date(ms).getUTCMinutes())} UTC`;

const strength = (windKt: number): string => (windKt > 0 ? `${CLASS_SHORT[cycloneClass(windKt)]} · ${windKt} kt` : 'wind not given');

/** "Cempaka · Cat 2 · 95 kt · advisory 4 h ago"; "ex-Murasu · peak 85 kt · ended 3 Nov". */
export function stormLabel(view: StormView): string {
  const { storm, fix } = view;
  if (view.state === 'ended') {
    const last = view.track[view.track.length - 1];
    return `ex-${storm.name} · peak ${view.peakKt} kt · ended ${utcDay(last.timeMs)}`;
  }
  if (view.advisoryAgeMs === null) return `${storm.name} · ${strength(fix.windKt)}`;
  const hours = Math.floor(view.advisoryAgeMs / HOUR_MS);
  return `${storm.name} · ${strength(fix.windKt)} · advisory ${hours < 1 ? 'under 1 h' : `${hours} h`} ago`;
}

/** The end of a forecast: "→ 12 Nov 12:00 UTC · TS · 45 kt". */
export function forecastLabel(point: TrackPoint): string {
  return `→ ${utcDay(point.timeMs)} ${utcTime(point.timeMs)} · ${strength(point.windKt)}`;
}

/** The chip for a state of the data. Never calls a fallback live. */
export function liveStatus(data: LiveData, views: readonly StormView[], nowMs: number): { text: string; tone: StatusTone } {
  const underWay = views.filter((v) => v.state === 'under-way').length;
  const count = underWay === 0 ? 'no active storms' : `${underWay} active`;
  const when = data.dataMs;
  switch (data.source) {
    case 'live': {
      const partial = data.missing > 0 ? ` · ${data.missing} unread` : '';
      // With the clock pinned in the past the answer is GDACS's archive: say of when.
      const stamp = when === null || underWay === 0 ? '' : Math.abs(nowMs - when) < DAY_MS ? ` · ${utcTime(when)}` : ` · as of ${utcDate(nowMs)}`;
      return { text: `live · ${count}${stamp}${partial}`, tone: 'live' };
    }
    case 'cache':
      return { text: when === null ? 'offline · last fetched data' : `offline · data of ${utcDate(when)} ${utcTime(when)}`, tone: 'stale' };
    case 'snapshot':
      return { text: when === null ? 'offline · snapshot' : `offline · snapshot ${utcDate(when)}`, tone: 'stale' };
    case 'none':
      return { text: 'no data · GDACS unreachable', tone: 'error' };
  }
}

export interface Segments {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
}

/** The legs between consecutive points, each in the colour of the wind at its start. */
export function legSegments(tracks: readonly (readonly TrackPoint[])[]): Segments {
  const count = tracks.reduce((sum, track) => sum + Math.max(track.length - 1, 0), 0);
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  let k = 0;
  for (const track of tracks) {
    for (let i = 0; i + 1 < track.length; i++, k++) {
      ecefAtAltitude(track[i].lon, track[i].lat, 0, point).toArray(positions, k * 6);
      ecefAtAltitude(track[i + 1].lon, track[i + 1].lat, 0, point).toArray(positions, k * 6 + 3);
      color.setHex(windColor(track[i].windKt), THREE.LinearSRGBColorSpace);
      color.toArray(colors, k * 6);
      color.toArray(colors, k * 6 + 3);
    }
  }
  return { positions, colors };
}

/**
 * One ring of a cone as triangles and as outline legs, in ECEF metres. The
 * ring is triangulated in longitude and latitude, unwrapped so that one
 * over the date line stays in one piece.
 */
export function coneGeometry(ring: readonly (readonly [number, number])[]): { triangles: Float32Array; outline: Float32Array } {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring;
  const flat: THREE.Vector2[] = [];
  let lon = open.length > 0 ? open[0][0] : 0;
  for (const [nextLon, lat] of open) {
    lon += lonStep(lon, nextLon);
    flat.push(new THREE.Vector2(lon, lat));
  }
  const corners = flat.map((v) => ecefAtAltitude(v.x, v.y, 0, new THREE.Vector3()));
  const triangles: number[] = [];
  for (const face of THREE.ShapeUtils.triangulateShape(flat, [])) for (const index of face) triangles.push(...corners[index].toArray());
  const outline: number[] = [];
  // An edge along the date line is where GDACS cut the cone in two, not part of its outline.
  const onDateLine = (v: THREE.Vector2): boolean => Math.abs(Math.abs(v.x) - 180) < 1e-6;
  corners.forEach((corner, i) => {
    const next = (i + 1) % corners.length;
    if (!(onDateLine(flat[i]) && onDateLine(flat[next]))) outline.push(...corner.toArray(), ...corners[next].toArray());
  });
  return { triangles: new Float32Array(triangles), outline: new Float32Array(outline) };
}

function browserIo(context: LayerContext): LiveIo {
  return {
    fetchJson: (url) => context.fetchJson<unknown>(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    fetchSnapshot: () => context.fetchJson<unknown>(context.assetUrl(SNAPSHOT_PATH)),
    readCache: () => {
      try {
        return localStorage.getItem(CACHE_KEY);
      } catch {
        return null;
      }
    },
    writeCache: (value) => localStorage.setItem(CACHE_KEY, value),
    reportError: (message, error) => console.error(message, error),
  };
}

interface FatLineOptions {
  readonly linewidth: number;
  readonly opacity: number;
  readonly order: number;
  /** Length of dash and of gap, metres; absent for a solid line. */
  readonly dashM?: readonly [number, number];
  /** One colour for the whole line; absent for a colour per vertex. */
  readonly color?: number;
}

function fatLines(name: string, options: FatLineOptions): LineSegments2 {
  const material = new LineMaterial({
    vertexColors: options.color === undefined,
    color: options.color ?? 0xffffff,
    linewidth: options.linewidth,
    transparent: true,
    opacity: options.opacity,
    depthTest: false,
    depthWrite: false,
    dashed: options.dashM !== undefined,
    dashSize: options.dashM?.[0] ?? 1,
    gapSize: options.dashM?.[1] ?? 1,
  });
  const lines = new LineSegments2(new LineSegmentsGeometry(), material);
  lines.name = name;
  lines.frustumCulled = false;
  lines.renderOrder = options.order;
  lines.visible = false;
  return lines;
}

function setSegments(lines: LineSegments2, positions: Float32Array, colors?: Float32Array): void {
  lines.geometry.dispose();
  const geometry = new LineSegmentsGeometry();
  if (positions.length > 0) {
    geometry.setPositions(positions);
    if (colors) geometry.setColors(colors);
  }
  lines.geometry = geometry;
  if (positions.length > 0 && (lines.material as LineMaterial).dashed) lines.computeLineDistances();
  lines.visible = positions.length > 0;
}

/** A storm's latest advisory outranks every name on the map. */
const STORM_RANK = -0.7;
const FORECAST_RANK = 6.2;
const ENDED_RANK = 6.6;

export async function createLiveCyclonesLayer(context: LayerContext): Promise<LayerInstance> {
  const io = browserIo(context);
  const base = RENDER_ORDER.outlines + 0.4;
  const ended = fatLines('cyclones-ended', { linewidth: 1.4, opacity: 0.4, order: base });
  const tracks = fatLines('cyclones-tracks', { linewidth: 2.8, opacity: 1, order: base + 0.03 });
  const forecasts = fatLines('cyclones-forecast', { linewidth: 1.8, opacity: 0.95, order: base + 0.02, dashM: [110_000, 80_000] });
  const coneEdges = fatLines('cyclones-cone-edge', { linewidth: 1, opacity: 0.55, order: base + 0.01, color: 0xffffff });
  const coneFill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
  );
  coneFill.name = 'cyclones-cone';
  coneFill.frustumCulled = false;
  coneFill.renderOrder = base;
  const dots = new GeoMarkers('cyclones-forecast-points', context.skyUniforms.uPixelRatio, RENDER_ORDER.quakes - 0.12);
  const symbols = new CycloneSymbols('cyclones-symbols', context.skyUniforms.uPixelRatio);
  const group = new THREE.Group();
  group.add(coneFill, ended, coneEdges, forecasts, tracks, dots.object, symbols.object);
  context.earthRoot.add(group);
  const lines = [ended, tracks, forecasts, coneEdges];

  let data: LiveData = { source: 'none', storms: [], dataMs: null, missing: 0 };
  let labelGroups: LabelGroup[] = [];
  let visible = false;
  let disposed = false;
  let refreshing = false;
  let lastAttemptMs = -Infinity;
  let fetchedForMs = NaN;
  let drawnMinute = NaN;

  const draw = (nowMs: number): void => {
    drawnMinute = Math.floor(nowMs / MINUTE_MS);
    const views = data.storms.map((storm) => stormView(storm, nowMs)).filter((v): v is StormView => v !== null);
    const underWay = views.filter((v) => v.state === 'under-way');
    const over = views.filter((v) => v.state === 'ended');

    const endedLegs = legSegments(over.map((v) => v.track));
    setSegments(ended, endedLegs.positions, endedLegs.colors);
    const trackLegs = legSegments(underWay.map((v) => v.track));
    setSegments(tracks, trackLegs.positions, trackLegs.colors);
    const forecastLegs = legSegments(underWay.map((v) => v.forecast));
    setSegments(forecasts, forecastLegs.positions, forecastLegs.colors);

    const cones = underWay.filter((v) => v.forecast.length > 0).flatMap((v) => (v.storm.cone ?? []).map(coneGeometry));
    const join = (parts: readonly Float32Array[]): Float32Array => {
      const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    };
    setSegments(coneEdges, join(cones.map((c) => c.outline)));
    coneFill.geometry.dispose();
    coneFill.geometry = new THREE.BufferGeometry();
    coneFill.geometry.setAttribute('position', new THREE.BufferAttribute(join(cones.map((c) => c.triangles)), 3));
    coneFill.visible = cones.length > 0;

    dots.setMarkers(
      underWay.flatMap((v) =>
        v.forecast.slice(1).map((p): GeoMarker => ({ lon: p.lon, lat: p.lat, shape: 'disc', color: windColor(p.windKt), sizePx: 7 }))
      )
    );
    symbols.setSymbols(
      underWay.map((v): CycloneSymbol => ({ lon: v.fix.lon, lat: v.fix.lat, color: windColor(v.fix.windKt), sizePx: symbolSizePx(v.fix.windKt) }))
    );

    for (const labels of labelGroups) labels.remove();
    const at = (lon: number, lat: number): THREE.Vector3 => ecefAtAltitude(lon, lat, 0, new THREE.Vector3());
    const named = (list: readonly StormView[]): GroupLabel[] =>
      list.map((v) => ({ text: stormLabel(v), priority: -v.fix.windKt, position: at(v.fix.lon, v.fix.lat) }));
    const ends: GroupLabel[] = underWay
      .filter((v) => v.forecast.length > 1)
      .map((v) => {
        const end = v.forecast[v.forecast.length - 1];
        return { text: forecastLabel(end), priority: -v.fix.windKt, position: at(end.lon, end.lat) };
      });
    labelGroups = [
      context.addLabels({ rank: STORM_RANK, style: { fontPx: 12, color: '#ffffff', bold: true, offsetYPx: 22 }, frame: 'earth', labels: named(underWay) }),
      context.addLabels({ rank: FORECAST_RANK, style: { fontPx: 10, color: '#e8eef5', offsetYPx: 11 }, frame: 'earth', labels: ends }),
      context.addLabels({ rank: ENDED_RANK, style: { fontPx: 10, color: '#aebccb', italic: true, offsetYPx: 10 }, frame: 'earth', labels: named(over) }),
    ];
    for (const labels of labelGroups) labels.setVisible(visible);

    const status = liveStatus(data, views, nowMs);
    context.setStatus(status.text, status.tone);
  };

  const refresh = async (): Promise<void> => {
    if (refreshing || disposed) return;
    refreshing = true;
    lastAttemptMs = performance.now();
    const nowMs = context.now().getTime();
    try {
      const next = await loadLive(io, nowMs, data);
      if (disposed) return;
      data = next;
      fetchedForMs = nowMs;
      draw(context.now().getTime());
    } finally {
      refreshing = false;
    }
  };

  await refresh();
  // Wall time, not the app clock: this paces requests, it dates nothing.
  const timer = setInterval(() => {
    if (visible) void refresh();
  }, REFRESH_INTERVAL_MS);

  return {
    setVisible(next) {
      visible = next;
      group.visible = next;
      for (const labels of labelGroups) labels.setVisible(next);
      // Back on after a while off: do not show old news until the next tick.
      if (next && performance.now() - lastAttemptMs > REFRESH_INTERVAL_MS) void refresh();
    },
    update(frame) {
      const nowMs = frame.date.getTime();
      symbols.advance(frame.deltaMs);
      // The clock was moved (a new ?time=) well away from what was asked for: ask again.
      const sinceAttemptMs = performance.now() - lastAttemptMs;
      if (Math.abs(nowMs - fetchedForMs) > DAY_MS && sinceAttemptMs > MINUTE_MS) void refresh();
      else if (data.source !== 'live' && sinceAttemptMs > RETRY_INTERVAL_MS) void refresh();
      // Ages in the labels, and which storms count as under way, move on by the minute.
      else if (Math.floor(nowMs / MINUTE_MS) !== drawnMinute) draw(nowMs);
    },
    setResolution(widthCss, heightCss) {
      for (const line of lines) (line.material as LineMaterial).resolution.set(widthCss, heightCss);
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      for (const labels of labelGroups) labels.remove();
      group.removeFromParent();
      for (const line of lines) {
        line.geometry.dispose();
        (line.material as LineMaterial).dispose();
      }
      coneFill.geometry.dispose();
      (coneFill.material as THREE.Material).dispose();
      dots.dispose();
      symbols.dispose();
    },
  };
}
