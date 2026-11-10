/**
 * Undersea communication cables: the glass threads nearly all of the
 * world's data crosses the oceans in, with the towns where they come
 * ashore (app/public/geo/cables.json, tools/pipeline/generate_cables.py).
 *
 * The routes are TeleGeography's map drawing - true at the landing points,
 * stylised in between - and the caption says so. Cables in service glow
 * green; those announced but not yet lit are thinner and violet.
 *
 * The data are a snapshot of November 2022, the last TeleGeography
 * published under an open licence (see the bake): "in service" and
 * "planned" are as of then, and the chip and caption say that too.
 */

import type { GeoMarker } from '../../render/geo-markers';
import type { GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { outlineSegmentPositions } from '../../render/outlines';
import type { LayerContext, LayerInstance } from '../types';
import { FEATURED_RANK, OTHER_RANK, assembleLayer, formatDay, labelAt, splitRanked, thousands, wideLineGeometry, wideLines } from './shared';
import { CABLE_COLORS, hex } from './styles';

export interface Cable {
  readonly name: string;
  readonly lengthKm: number;
  /** The length is that of the drawn route: the operator states none. */
  readonly lengthIsDrawn?: boolean;
  /** Ready-for-service year; null where none is announced. */
  readonly year: number | null;
  readonly planned: boolean;
  /** Half way along the longest piece: where the name goes. */
  readonly lon: number;
  readonly lat: number;
}

export interface Landing {
  /** "Marseille, France". */
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Cables in service that land here. */
  readonly cables: number;
}

/** The shape of app/public/geo/cables.json. */
export interface CableData {
  readonly asOf: string;
  readonly quantumPerDegree: number;
  /** Longest first. */
  readonly cables: readonly Cable[];
  /** Each: the cable's index, then a delta-encoded polyline as in outlines.json. */
  readonly lines: readonly (readonly number[])[];
  /** Most cables first. */
  readonly landings: readonly Landing[];
}

const FEATURED_CABLES = 14;
const OTHER_CABLES = 70;
const NAMED_LANDINGS = 30;

/** "MAREA · 2018 · 6,605 km"; a cable still planned at the snapshot says when it was due, and a length measured off the drawing is marked "~". */
export function cableLabelText(cable: Cable): string {
  const when = cable.planned ? (cable.year === null ? 'planned' : `due ${cable.year}`) : cable.year === null ? null : String(cable.year);
  const length = `${cable.lengthIsDrawn ? '~' : ''}${thousands(cable.lengthKm)} km`;
  return [cable.name, when, length].filter((part) => part !== null).join(' · ');
}

/** "Marseille · 12 cables": the town without its country. */
export function landingLabelText(landing: Landing): string {
  return `${landing.name.split(',')[0]} · ${landing.cables} cables`;
}

/** The polylines of the cables in service and of those only planned, without their leading index. */
export function splitCableLines(data: CableData): { inService: number[][]; planned: number[][] } {
  const inService: number[][] = [];
  const planned: number[][] = [];
  for (const line of data.lines) (data.cables[line[0]].planned ? planned : inService).push(line.slice(1));
  return { inService, planned };
}

/** [the longest cables in service, then the next longest of any kind]. */
export function cableLabels(data: CableData): [GroupLabel[], GroupLabel[]] {
  const label = (cable: Cable): GroupLabel => labelAt(cableLabelText(cable), -cable.lengthKm, cable.lon, cable.lat);
  const inService = data.cables.filter((c) => !c.planned);
  const featured = inService.slice(0, FEATURED_CABLES);
  const rest = data.cables.filter((c) => !featured.includes(c)).slice(0, OTHER_CABLES);
  return [featured.map(label), rest.map(label)];
}

export function landingMarkers(data: CableData): GeoMarker[] {
  // The hubs last, and so on top.
  return [...data.landings].reverse().map((landing) => ({
    lon: landing.lon,
    lat: landing.lat,
    shape: 'disc',
    color: CABLE_COLORS.landing,
    sizePx: 2.6 + 0.3 * Math.min(landing.cables, 12),
    alpha: 0.9,
  }));
}

export async function createCableLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<CableData>(context.assetUrl('geo/cables.json'));
  const { inService, planned } = splitCableLines(data);
  const live = wideLineGeometry(outlineSegmentPositions(inService, data.quantumPerDegree));
  const future = wideLineGeometry(outlineSegmentPositions(planned, data.quantumPerDegree));
  // Over the coastlines they cross on their way ashore.
  const over = RENDER_ORDER.outlines + 0.3;
  const lines = [
    wideLines('cables-planned', future, { color: CABLE_COLORS.planned, widthPx: 1, opacity: 0.55, renderOrder: over }),
    // A wide faint pass under the thread: the glow.
    wideLines('cables-glow', live, { color: CABLE_COLORS.cable, widthPx: 3.5, opacity: 0.1, additive: true, renderOrder: over }),
    wideLines('cables', live, { color: CABLE_COLORS.cable, widthPx: 1.2, opacity: 0.9, renderOrder: over + 0.05 }),
  ];

  const [featured, others] = cableLabels(data);
  const [hubs] = splitRanked(data.landings, NAMED_LANDINGS, 0);
  const layer = assembleLayer(
    context,
    'undersea-cables',
    landingMarkers(data),
    [
      { rank: FEATURED_RANK, style: { fontPx: 11, color: hex(CABLE_COLORS.cable), bold: true }, labels: featured },
      { rank: OTHER_RANK, style: { fontPx: 10, color: '#8fe8cf' }, labels: others },
      {
        rank: OTHER_RANK + 0.05,
        style: { fontPx: 10, color: hex(CABLE_COLORS.landing), offsetYPx: 9 },
        labels: hubs.map((landing) => labelAt(landingLabelText(landing), -landing.cables, landing.lon, landing.lat)),
      },
    ],
    lines
  );
  // Four years old and frozen (see the bake): say so where the switch is.
  context.setStatus(`as of ${formatDay(data.asOf)}`, 'stale');
  return layer;
}
