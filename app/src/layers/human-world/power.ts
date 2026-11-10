/**
 * Power plants: every plant of 500 MW and more as a disc whose area goes
 * with its capacity and whose colour is its fuel, and - a switch of its
 * own - every nuclear plant (app/public/geo/power-plants.json,
 * tools/pipeline/generate_power_plants.py; Global Power Plant Database
 * v1.3.0, whose last release is of June 2021).
 */

import type { GeoMarker } from '../../render/geo-markers';
import type { GroupLabel } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { FEATURED_RANK, OTHER_RANK, assembleLayer, labelAt, splitRanked, thousands } from './shared';
import { NUCLEAR_STYLE, fuelColor, plantSizePx } from './styles';

export interface NuclearPlant {
  readonly name: string;
  readonly country: string;
  readonly lon: number;
  readonly lat: number;
  readonly mw: number;
}

/** The shape of app/public/geo/power-plants.json. */
export interface PowerPlantData {
  /** "1.3.0 (June 2021)". */
  readonly version: string;
  readonly minCapacityMw: number;
  readonly fuels: readonly string[];
  /** Columns, largest plant first; `name` covers only the first few hundred. */
  readonly plants: {
    readonly lon: readonly number[];
    readonly lat: readonly number[];
    readonly mw: readonly number[];
    readonly fuel: readonly number[];
    readonly name: readonly string[];
  };
  /** Largest first. */
  readonly nuclear: readonly NuclearPlant[];
}

const FEATURED_PLANTS = 12;
const OTHER_PLANTS = 150;
const FEATURED_NUCLEAR = 10;

/** "Three Gorges Dam · hydro · 22,500 MW". */
export function plantLabelText(name: string, fuel: string, mw: number): string {
  return `${name} · ${fuel.toLowerCase()} · ${thousands(mw)} MW`;
}

/** Discs in drawing order: the largest first, so that a small plant beside a great one is not buried under it. */
export function plantMarkers(data: PowerPlantData): GeoMarker[] {
  const { lon, lat, mw, fuel } = data.plants;
  return lon.map((x, i) => ({
    lon: x,
    lat: lat[i],
    shape: 'disc',
    color: fuelColor(data.fuels[fuel[i]]),
    sizePx: plantSizePx(mw[i]),
    alpha: 0.9,
  }));
}

export function plantLabels(data: PowerPlantData): [GroupLabel[], GroupLabel[]] {
  const { lon, lat, mw, fuel, name } = data.plants;
  const labels = name.map((n, i) => labelAt(plantLabelText(n, data.fuels[fuel[i]], mw[i]), -mw[i], lon[i], lat[i]));
  return splitRanked(labels, FEATURED_PLANTS, OTHER_PLANTS);
}

const versionYear = (version: string): string => /\d{4}/.exec(version)?.[0] ?? version;

export async function createPowerPlantLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<PowerPlantData>(context.assetUrl('geo/power-plants.json'));
  const [featured, others] = plantLabels(data);
  const layer = assembleLayer(context, 'power-plants', plantMarkers(data), [
    { rank: FEATURED_RANK, style: { fontPx: 11, color: '#fff1c9', bold: true, offsetYPx: 13 }, labels: featured },
    { rank: OTHER_RANK, style: { fontPx: 10, color: '#e9dcb8', offsetYPx: 10 }, labels: others },
  ]);
  context.setStatus(`database of ${versionYear(data.version)}`, 'info');
  return layer;
}

export function nuclearLabels(plants: readonly NuclearPlant[]): [GroupLabel[], GroupLabel[]] {
  const labels = plants.map((p) => labelAt(`${p.name} · ${thousands(p.mw)} MW`, -p.mw, p.lon, p.lat));
  return splitRanked(labels, FEATURED_NUCLEAR, plants.length);
}

export async function createNuclearLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<PowerPlantData>(context.assetUrl('geo/power-plants.json'));
  const markers: GeoMarker[] = [...data.nuclear].map((p) => ({
    lon: p.lon,
    lat: p.lat,
    shape: NUCLEAR_STYLE.shape,
    color: NUCLEAR_STYLE.color,
    sizePx: Math.max(NUCLEAR_STYLE.sizePx, plantSizePx(p.mw)),
    alpha: 0.9,
  }));
  const [featured, others] = nuclearLabels(data.nuclear);
  const layer = assembleLayer(context, 'nuclear-plants', markers, [
    { rank: FEATURED_RANK, style: { fontPx: 11, color: NUCLEAR_STYLE.labelColor, bold: true, offsetYPx: 13 }, labels: featured },
    { rank: OTHER_RANK, style: { fontPx: 10, color: NUCLEAR_STYLE.labelColor, offsetYPx: 10 }, labels: others },
  ]);
  context.setStatus(`database of ${versionYear(data.version)}`, 'info');
  return layer;
}
