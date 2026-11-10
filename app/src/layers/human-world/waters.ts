/**
 * Rivers and lakes with their names, and sea ports
 * (app/public/geo/waters.json and ports.json,
 * tools/pipeline/generate_waters.py; Natural Earth).
 *
 * Rivers are not human, but they are where the people are, and the map
 * had none.
 */

import type { GeoMarker } from '../../render/geo-markers';
import type { GroupLabel } from '../../render/labels';
import { outlineSegmentPositions } from '../../render/outlines';
import type { LayerContext, LayerInstance } from '../types';
import { FEATURED_RANK, OTHER_RANK, assembleLayer, labelAt, splitRanked, wideLineGeometry, wideLines } from './shared';
import { PORT_STYLE, WATER_COLORS, hex } from './styles';

export interface RiverName {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Natural Earth's scale rank: 0 the greatest. */
  readonly rank: number;
  /** Length of the lines drawn under this name. */
  readonly lengthKm: number;
}

export interface LakeName {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  readonly rank: number;
  readonly areaKm2: number;
}

/** The shape of app/public/geo/waters.json. */
export interface WaterData {
  readonly quantumPerDegree: number;
  readonly rivers: readonly (readonly number[])[];
  readonly lakes: readonly (readonly number[])[];
  /** Longest first. */
  readonly riverNames: readonly RiverName[];
  /** Largest first. */
  readonly lakeNames: readonly LakeName[];
}

export interface Port {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Natural Earth's scale rank, 3 (the largest) to 8. */
  readonly rank: number;
}

const FEATURED_RIVERS = 16;
const OTHER_RIVERS = 140;
const FEATURED_LAKES = 8;
const OTHER_LAKES = 70;
const FEATURED_PORTS = 30;
const OTHER_PORTS = 220;

/** [the longest rivers and largest lakes, the next of each]. */
export function waterLabels(data: WaterData): [GroupLabel[], GroupLabel[]] {
  const rivers = data.riverNames.map((r) => labelAt(r.name, -r.lengthKm, r.lon, r.lat));
  // Square kilometres and kilometres do not compare; within their group lakes are ranked among themselves, after the rivers' scale.
  const lakes = data.lakeNames.map((l) => labelAt(l.name, -Math.sqrt(l.areaKm2) * 10, l.lon, l.lat));
  const [riversFirst, riversRest] = splitRanked(rivers, FEATURED_RIVERS, OTHER_RIVERS);
  const [lakesFirst, lakesRest] = splitRanked(lakes, FEATURED_LAKES, OTHER_LAKES);
  return [
    [...riversFirst, ...lakesFirst],
    [...riversRest, ...lakesRest],
  ];
}

export async function createWaterLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<WaterData>(context.assetUrl('geo/waters.json'));
  // A hair wider than the coastline's pixel: over land imagery a one-pixel blue line is lost.
  const rivers = wideLines('rivers', wideLineGeometry(outlineSegmentPositions(data.rivers, data.quantumPerDegree)), {
    color: WATER_COLORS.river,
    widthPx: 1.6,
    opacity: 1,
  });
  const lakes = wideLines('lakes', wideLineGeometry(outlineSegmentPositions(data.lakes, data.quantumPerDegree)), {
    color: WATER_COLORS.lake,
    widthPx: 1.3,
    opacity: 1,
  });
  const [featured, others] = waterLabels(data);
  return assembleLayer(
    context,
    'rivers-lakes',
    [],
    [
      { rank: FEATURED_RANK, style: { fontPx: 11, color: hex(WATER_COLORS.lake), italic: true }, labels: featured },
      { rank: OTHER_RANK, style: { fontPx: 10, color: '#8fc0ff', italic: true }, labels: others },
    ],
    [rivers, lakes]
  );
}

/** Symbol width, CSS px: Natural Earth's rank 3 the widest. */
export const portSizePx = (rank: number): number => Math.max(3, PORT_STYLE.sizePx + 0.7 * (5 - rank));

export function portMarkers(ports: readonly Port[]): GeoMarker[] {
  // The largest last, and so on top.
  return [...ports].reverse().map((p) => ({ lon: p.lon, lat: p.lat, shape: PORT_STYLE.shape, color: PORT_STYLE.color, sizePx: portSizePx(p.rank) }));
}

export async function createPortLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<{ ports: readonly Port[] }>(context.assetUrl('geo/ports.json'));
  // The file is ordered by rank, then name: that order is the priority.
  const labels = data.ports.map((p, i) => labelAt(p.name, i, p.lon, p.lat));
  const [featured, others] = splitRanked(labels, FEATURED_PORTS, OTHER_PORTS);
  return assembleLayer(context, 'ports', portMarkers(data.ports), [
    { rank: FEATURED_RANK + 0.05, style: { fontPx: 11, color: PORT_STYLE.labelColor, bold: true, offsetYPx: 9 }, labels: featured },
    { rank: OTHER_RANK + 0.05, style: { fontPx: 10, color: PORT_STYLE.labelColor, offsetYPx: 9 }, labels: others },
  ]);
}
