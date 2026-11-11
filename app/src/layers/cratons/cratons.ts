/**
 * Archean crust (Hasterok et al. 2022's cratons file), draped on the
 * surface: app/public/geo/cratons.png and cratons.json, from
 * tools/pipeline/generate_geologic_provinces.py. The groups the source
 * calls cratons or shields are named, largest first.
 */

import { createDrape } from '../geologic-provinces/drape';
import type { LayerContext, LayerInstance } from '../types';
import { CRATON_PALETTE } from './classes';

export interface CratonsData {
  readonly labels: readonly { readonly name: string; readonly lon: number; readonly lat: number; readonly km2: number; readonly members: readonly string[] }[];
}

export async function createCratonsLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<CratonsData>(context.assetUrl('geo/cratons.json'));
  return createDrape(context, {
    name: 'cratons',
    picture: 'geo/cratons.png',
    palette: CRATON_PALETTE,
    orderOffset: 0.012,
    labels: data.labels.map((label) => ({ text: label.name, lon: label.lon, lat: label.lat })),
    labelStyle: { fontPx: 11, color: '#ffc27a', italic: true },
  });
}
