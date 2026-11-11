/**
 * The world's geologic provinces (Hasterok et al. 2022), draped on the
 * surface and coloured by the kind of province. The picture is
 * app/public/geo/provinces.png, from tools/pipeline/generate_geologic_provinces.py.
 */

import type { LayerContext, LayerInstance } from '../types';
import { PROVINCE_PALETTE } from './classes';
import { createDrape } from './drape';

export function createProvincesLayer(context: LayerContext): Promise<LayerInstance> {
  return createDrape(context, { name: 'geologic-provinces', picture: 'geo/provinces.png', palette: PROVINCE_PALETTE, orderOffset: 0.01 });
}
