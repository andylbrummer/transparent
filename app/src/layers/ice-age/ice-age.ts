/**
 * The Earth at the last glacial maximum: the Northern Hemisphere's ice
 * sheets as a published reconstruction maps them, and the sea floor a
 * lower sea would have left dry, as a coverage mask draped on today's
 * surface (app/public/geo/ice-age-mask.png, from
 * tools/pipeline/generate_ice_age.py): red is ice, green is emerged land.
 *
 * Today's coasts and borders stay drawn over it: the point is to see
 * where they were under ice, and which seas could be walked across.
 */

import * as THREE from 'three';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import { glslColor } from '../ice/glaciers';
import type { LayerContext, LayerInstance } from '../types';
import { EMERGED_LAND_COLOR, ICE_SHEET_COLOR } from './layer';

export interface IceAgeName {
  readonly name: string;
  readonly kind: 'ice' | 'land';
  readonly lon: number;
  readonly lat: number;
}

/** The shape of app/public/geo/ice-age.json. */
export interface IceAgeData {
  /** Today's depth, metres, down to which the sea floor is drawn as emerged land. */
  readonly shoreDepthM: number;
  readonly iceAreaKm2: number;
  readonly emergedAreaKm2: number;
  readonly names: readonly IceAgeName[];
}

/** Ice over emerged land where a soft-edged texel holds both. */
const ICE_AGE_SHADE = `
  float ice = texel.r;
  float land = texel.g;
  float cover = max(ice, land);
  if (cover < 0.02) return vec4(0.0);
  vec3 color = mix(${glslColor(EMERGED_LAND_COLOR)}, ${glslColor(ICE_SHEET_COLOR)}, ice / (ice + land));
  return vec4(color, cover * mix(0.78, 0.94, ice / (ice + land)));
`;

/** "26 million km²": two significant figures. */
export function millionsText(areaKm2: number): string {
  return `${String(Number((areaKm2 / 1e6).toPrecision(2)))} million km²`;
}

/** The chip beside the switch: the two totals. */
export function iceAgeStatus(data: IceAgeData): string {
  return `ice ${millionsText(data.iceAreaKm2)} · new land ${millionsText(data.emergedAreaKm2)}`;
}

export function iceAgeLabels(data: IceAgeData, kind: IceAgeName['kind']): GroupLabel[] {
  return data.names
    .filter((entry) => entry.kind === kind)
    .map((entry, i) => ({ text: entry.name, priority: i, position: ecefAtAltitude(entry.lon, entry.lat, 0, new THREE.Vector3()) }));
}

export async function createIceAgeLayer(context: LayerContext): Promise<LayerInstance> {
  const [data, texture] = await Promise.all([
    context.fetchJson<IceAgeData>(context.assetUrl('geo/ice-age.json')),
    new THREE.TextureLoader().loadAsync(context.assetUrl('geo/ice-age-mask.png')),
  ]);
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'ice-age',
    // Over the base map and today's ice, under the data overlays and the weather.
    renderOrder: RENDER_ORDER.surfaceShell + 0.03,
    shadeGlsl: ICE_AGE_SHADE,
  });
  shell.setTexture(texture);
  context.earthRoot.add(shell.object);
  context.setStatus(iceAgeStatus(data));
  const groups = [
    context.addLabels({
      rank: LABEL_KIND_ORDER.indexOf('country') + 0.44,
      style: { fontPx: 12, color: '#e9f6ff', italic: true, bold: true },
      frame: 'earth',
      labels: iceAgeLabels(data, 'ice'),
    }),
    context.addLabels({
      rank: LABEL_KIND_ORDER.indexOf('country') + 0.46,
      style: { fontPx: 11, color: '#e6d9a8', italic: true },
      frame: 'earth',
      labels: iceAgeLabels(data, 'land'),
    }),
  ];
  return {
    setVisible(visible) {
      shell.object.visible = visible;
      for (const group of groups) group.setVisible(visible);
    },
    dispose() {
      for (const group of groups) group.remove();
      // Disposes of the texture it holds, too.
      shell.dispose();
    },
  };
}
