/**
 * Airports and air routes (app/public/geo/airports.json and
 * air-routes.json, tools/pipeline/generate_air.py).
 *
 * The airports are today's (OurAirports). The routes are OpenFlights'
 * last snapshot, of June 2014: the network of a decade ago, and the chip
 * says so. A route is drawn as the great circle between its airports,
 * lifted in the middle so that it reads as an arc - far higher than an
 * airliner flies, which at this scale would be on the ground.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { ecefAtAltitude, type GeoMarker } from '../../render/geo-markers';
import type { GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';
import { FEATURED_RANK, OTHER_RANK, assembleLayer, labelAt, lineSegments, splitRanked } from './shared';
import { AIRPORT_STYLE, ROUTE_COLOR } from './styles';

export interface Airport {
  readonly iata: string;
  readonly city: string;
  readonly lon: number;
  readonly lat: number;
  /** Natural Earth's scale rank, 2 (the great hubs) to 9; 10 where it lists none. */
  readonly rank: number;
}

/** The shape of app/public/geo/air-routes.json. */
export interface RouteData {
  /** "2014-06". */
  readonly dataDate: string;
  /** [IATA code, lon, lat]. */
  readonly airports: readonly (readonly [string, number, number])[];
  /** [airport index, airport index, airlines flying it]; most airlines first. */
  readonly routes: readonly (readonly [number, number, number])[];
}

const FEATURED_AIRPORTS = 62;
const OTHER_AIRPORTS = 420;

/** The peak of an arc above the ground, as a share of the route's length along the ground. */
export const ROUTE_PEAK_FRACTION = 0.04;
/** One segment for about this much of the great circle, degrees. */
const ROUTE_STEP_DEG = 2.5;
/** A route flown by this many airlines or more is drawn at full strength. */
const FULL_STRENGTH_AIRLINES = 8;

export function airportMarkers(airports: readonly Airport[]): GeoMarker[] {
  // The hubs last, and so on top.
  return [...airports].reverse().map((a) => ({
    lon: a.lon,
    lat: a.lat,
    shape: AIRPORT_STYLE.shape,
    color: AIRPORT_STYLE.color,
    sizePx: a.rank <= 2 ? AIRPORT_STYLE.sizePx + 2.5 : a.rank <= 4 ? AIRPORT_STYLE.sizePx + 1 : AIRPORT_STYLE.sizePx,
    alpha: a.rank <= 4 ? 1 : 0.8,
  }));
}

/** "CDG · Paris": the code and the town, without the commune the source adds in brackets. */
export function airportLabelText(airport: Airport): string {
  const city = airport.city.split(' (')[0];
  return city ? `${airport.iata} · ${city}` : airport.iata;
}

/** [the hubs, as "LHR · London"; the rest by code alone]. */
export function airportLabels(airports: readonly Airport[]): [GroupLabel[], GroupLabel[]] {
  // The file is ordered by rank, then code: that order is the priority.
  const [hubs, rest] = splitRanked(airports, FEATURED_AIRPORTS, OTHER_AIRPORTS);
  return [
    hubs.map((a, i) => labelAt(airportLabelText(a), i, a.lon, a.lat)),
    rest.map((a, i) => labelAt(a.iata, i, a.lon, a.lat)),
  ];
}

export async function createAirportLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<{ airports: readonly Airport[] }>(context.assetUrl('geo/airports.json'));
  const [hubs, rest] = airportLabels(data.airports);
  return assembleLayer(context, 'airports', airportMarkers(data.airports), [
    { rank: FEATURED_RANK + 0.1, style: { fontPx: 10, color: AIRPORT_STYLE.labelColor, bold: true, offsetYPx: 9 }, labels: hubs },
    { rank: OTHER_RANK + 0.1, style: { fontPx: 9, color: AIRPORT_STYLE.labelColor, offsetYPx: 8 }, labels: rest },
  ]);
}

/**
 * Appends the segments (x0,y0,z0, x1,y1,z1, ...) of the lifted great
 * circle from `a` to `b` (each [lon, lat], degrees) to `out`, and returns
 * how many segments it added.
 */
export function routeArcSegments(a: readonly [number, number], b: readonly [number, number], out: number[]): number {
  const from = ecefAtAltitude(a[0], a[1], 0, new THREE.Vector3()).normalize();
  const to = ecefAtAltitude(b[0], b[1], 0, new THREE.Vector3()).normalize();
  const angle = from.angleTo(to);
  // Antipodes have no one great circle between them; nothing flies that far.
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return 0;
  const steps = Math.max(6, Math.ceil(angle / ((ROUTE_STEP_DEG * Math.PI) / 180)));
  const peakM = ROUTE_PEAK_FRACTION * angle * EARTH_RADIUS_M;
  const sine = Math.sin(angle);
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wa = Math.sin((1 - t) * angle) / sine;
    const wb = Math.sin(t * angle) / sine;
    const r = EARTH_RADIUS_M + peakM * Math.sin(Math.PI * t);
    const x = (from.x * wa + to.x * wb) * r;
    const y = (from.y * wa + to.y * wb) * r;
    const z = (from.z * wa + to.z * wb) * r;
    if (i > 0) out.push(px, py, pz, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
  return steps;
}

/** Brightness, 0..1, of a route flown by `airlines` airlines. */
export const routeStrength = (airlines: number): number => 0.3 + 0.7 * Math.min(1, airlines / FULL_STRENGTH_AIRLINES);

export function routeGeometry(data: RouteData): { positions: Float32Array; colors: Float32Array } {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const [from, to, airlines] of data.routes) {
    const a = data.airports[from];
    const b = data.airports[to];
    const segments = routeArcSegments([a[1], a[2]], [b[1], b[2]], positions);
    const strength = routeStrength(airlines);
    for (let i = 0; i < segments * 2; i++) colors.push(strength, strength, strength);
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
}

export async function createRouteLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<RouteData>(context.assetUrl('geo/air-routes.json'));
  const { positions, colors } = routeGeometry(data);
  const arcs = lineSegments('air-routes', positions, {
    color: ROUTE_COLOR,
    opacity: 0.3,
    additive: true,
    vertexColors: colors,
    // Above the ground: with the things around the Earth, over the surface lines.
    renderOrder: RENDER_ORDER.outlines + 0.4,
  });
  const [year, month] = data.dataDate.split('-');
  const monthName = new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  // A snapshot a decade old: say so where the switch is.
  context.setStatus(`routes of ${monthName} ${year}`, 'stale');
  return assembleLayer(context, 'air-routes', [], [], [arcs]);
}
