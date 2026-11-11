/**
 * Large igneous and other volcanic provinces (Johansson et al. 2018),
 * draped on the surface and coloured by age: app/public/geo/igneous-provinces.png
 * and .json, from tools/pipeline/generate_igneous_provinces.py. Laid over
 * the other geology drapes, as the lava lies on the crust it came through.
 */

import { createDrape } from '../geologic-provinces/drape';
import type { LayerContext, LayerInstance } from '../types';
import { AGE_PALETTE, provinceLabel } from './ages';

export interface IgneousData {
  readonly oldestMa: number;
  readonly labels: readonly { readonly name: string; readonly lon: number; readonly lat: number; readonly km2: number; readonly ageMa: readonly [number, number] }[];
}

export async function createIgneousProvincesLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<IgneousData>(context.assetUrl('geo/igneous-provinces.json'));
  return createDrape(context, {
    name: 'igneous-provinces',
    picture: 'geo/igneous-provinces.png',
    palette: AGE_PALETTE,
    orderOffset: 0.015,
    labels: data.labels.map((label) => ({ text: provinceLabel(label.name, label.ageMa), lon: label.lon, lat: label.lat })),
    labelStyle: { fontPx: 11, color: '#ffd88a', italic: true },
  });
}
