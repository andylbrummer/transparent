/**
 * Where the magnetic poles have been: the north and south dip poles year
 * by year from 1590 to 2025 and NOAA's forecast to 2030
 * (app/public/geo/magnetic-poles.json, tools/pipeline/
 * generate_magnetic_poles.py), drawn on the ground as a track that
 * brightens toward the present, with the year marked every half century.
 *
 * Positions before the first surveys are a model's, as the caption says.
 */

import * as THREE from 'three';
import { decimalYear } from '@transparent-earth/core';
import { ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import type { GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { FEATURED_RANK, assembleLayer, labelAt, lineSegments } from '../human-world/shared';
import type { LayerContext, LayerInstance } from '../types';

/** [year, longitude east, latitude]. */
export type PoleRow = readonly [number, number, number];

export interface PoleTracks {
  readonly model: readonly PoleRow[];
  readonly forecast: readonly PoleRow[];
}

/** The shape of app/public/geo/magnetic-poles.json. */
export interface MagneticPoleData {
  readonly north: PoleTracks;
  readonly south: PoleTracks;
}

export type Hemisphere = 'north' | 'south';

/** Years named along a track; the ends of the record are named too. */
const MARK_EVERY_YEARS = 50;
/** Lines ride just above the ground so that the surface's own lines do not cut them. */
const ALTITUDE_M = 2000;
const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/** The track's colour by year, as NOAA's own map runs it: deep blue in 1590 to yellow now. Display values 0..1. */
export function yearColor(year: number, first: number, last: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (year - first) / (last - first)));
  // Eased toward the present, where the track is long and the years far apart on the ground.
  const k = t * t;
  return [0.45 + 0.55 * k, 0.62 + 0.28 * k, 1 - 0.75 * k];
}

/** The forecast is paler than anything measured or modelled from measurements. */
export const FORECAST_COLOR: readonly [number, number, number] = [1, 1, 1];

export function greatCircleKm(a: PoleRow, b: PoleRow): number {
  const la1 = a[2] * DEG;
  const la2 = b[2] * DEG;
  const cos = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos((b[1] - a[1]) * DEG);
  return EARTH_RADIUS_KM * Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** The whole record in order: the model's years, then the forecast's years after the model ends. */
export function fullTrack(tracks: PoleTracks): PoleRow[] {
  const lastModelled = tracks.model[tracks.model.length - 1][0];
  return [...tracks.model, ...tracks.forecast.filter((row) => row[0] > lastModelled)];
}

/**
 * Where the pole is at a (fractional) year: along the great circle between
 * the two yearly positions either side. Outside the record, its nearer end.
 */
export function poleAt(track: readonly PoleRow[], year: number): { lon: number; lat: number } {
  if (year <= track[0][0]) return { lon: track[0][1], lat: track[0][2] };
  const last = track[track.length - 1];
  if (year >= last[0]) return { lon: last[1], lat: last[2] };
  const i = track.findIndex((row) => row[0] > year) - 1;
  const a = ecefAtAltitude(track[i][1], track[i][2], 0, new THREE.Vector3());
  const b = ecefAtAltitude(track[i + 1][1], track[i + 1][2], 0, new THREE.Vector3());
  // The poles sit near the geographic ones, where a straight blend of longitudes would go the wrong way round.
  const p = a.lerp(b, (year - track[i][0]) / (track[i + 1][0] - track[i][0])).normalize();
  return { lon: Math.atan2(p.y, p.x) / DEG, lat: Math.asin(p.z) / DEG };
}

/** How fast the pole is moving at `year`, km a year: over the year before and the year after. */
export function driftKmPerYear(track: readonly PoleRow[], year: number): number {
  const first = track[0][0];
  const last = track[track.length - 1][0];
  const from = Math.max(first, Math.min(last - 2, Math.floor(year) - 1));
  const a = track.find((row) => row[0] === from)!;
  const b = track.find((row) => row[0] === from + 2)!;
  return greatCircleKm(a, b) / 2;
}

/** Segment endpoints and a colour per vertex for one track, ECEF metres. */
export function trackSegments(rows: readonly PoleRow[], color: (year: number) => readonly [number, number, number]): { positions: Float32Array; colors: Float32Array } {
  const count = Math.max(0, rows.length - 1);
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    for (let end = 0; end < 2; end++) {
      const row = rows[i + end];
      ecefAtAltitude(row[1], row[2], ALTITUDE_M, point).toArray(positions, i * 6 + end * 3);
      colors.set(color(row[0]), i * 6 + end * 3);
    }
  }
  return { positions, colors };
}

/** The years named along a track: every half century, and the first and last of the record. */
export function markedYears(track: readonly PoleRow[]): number[] {
  const first = track[0][0];
  const last = track[track.length - 1][0];
  const years = new Set([first, last]);
  for (let year = Math.ceil(first / MARK_EVERY_YEARS) * MARK_EVERY_YEARS; year < last; year += MARK_EVERY_YEARS) years.add(year);
  return [...years].sort((a, b) => a - b);
}

const hexOf = (rgb: readonly [number, number, number]): number =>
  (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255);

const NAMES: Readonly<Record<Hemisphere, string>> = { north: 'North magnetic pole', south: 'South magnetic pole' };

/** "North magnetic pole · 2026 · 37 km a year". */
export function nowLabel(hemisphere: Hemisphere, track: readonly PoleRow[], year: number): string {
  const shown = Math.max(track[0][0], Math.min(track[track.length - 1][0], year));
  return `${NAMES[hemisphere]} · ${Math.floor(shown)} · ${Math.round(driftKmPerYear(track, shown))} km a year`;
}

export async function createMagneticPolesLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<MagneticPoleData>(context.assetUrl('geo/magnetic-poles.json'));
  const year = decimalYear(context.now());
  const objects: THREE.Object3D[] = [];
  const markers: GeoMarker[] = [];
  const yearLabels: GroupLabel[] = [];
  const nowLabels: GroupLabel[] = [];
  for (const hemisphere of ['north', 'south'] as const) {
    const tracks = data[hemisphere];
    const first = tracks.model[0][0];
    const last = tracks.model[tracks.model.length - 1][0];
    const modelled = trackSegments(tracks.model, (y) => yearColor(y, first, last));
    objects.push(
      lineSegments(`magnetic-pole-${hemisphere}`, modelled.positions, {
        color: 0xffffff,
        opacity: 0.95,
        vertexColors: modelled.colors,
        renderOrder: RENDER_ORDER.outlines + 0.2,
      })
    );
    const forecast = trackSegments(tracks.forecast, () => FORECAST_COLOR);
    objects.push(
      lineSegments(`magnetic-pole-${hemisphere}-forecast`, forecast.positions, {
        color: 0xffffff,
        opacity: 0.55,
        vertexColors: forecast.colors,
        renderOrder: RENDER_ORDER.outlines + 0.2,
      })
    );
    const track = fullTrack(tracks);
    for (const marked of markedYears(track)) {
      const row = track.find((r) => r[0] === marked)!;
      const isForecast = marked > last;
      markers.push({
        lon: row[1],
        lat: row[2],
        altitudeM: ALTITUDE_M,
        shape: 'ring',
        color: isForecast ? 0xffffff : hexOf(yearColor(marked, first, last)),
        sizePx: 7,
        alpha: isForecast ? 0.7 : 1,
      });
      // The newest years first when names collide: that is where the track is going.
      yearLabels.push(labelAt(isForecast ? `${marked} (forecast)` : String(marked), -marked, row[1], row[2], ALTITUDE_M));
    }
    const now = poleAt(track, year);
    markers.push({ lon: now.lon, lat: now.lat, altitudeM: ALTITUDE_M, shape: 'star', color: 0xffe36a, sizePx: 14 });
    nowLabels.push(labelAt(nowLabel(hemisphere, track, year), 0, now.lon, now.lat, ALTITUDE_M));
  }
  return assembleLayer(
    context,
    'magnetic-poles',
    markers,
    [
      { rank: FEATURED_RANK - 0.1, style: { fontPx: 11, color: '#ffe36a', bold: true, offsetYPx: 12 }, labels: nowLabels },
      { rank: FEATURED_RANK + 0.2, style: { fontPx: 10, color: '#cfd8ff', offsetYPx: 9 }, labels: yearLabels },
    ],
    objects
  );
}
