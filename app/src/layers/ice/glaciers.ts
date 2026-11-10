/**
 * Land ice: every glacier, ice cap and ice sheet Natural Earth maps, and
 * the ice shelves that float off Antarctica, as a coverage mask draped on
 * the surface (app/public/geo/ice-mask.png, from
 * tools/pipeline/generate_ice.py): red is ice on land, green is shelf.
 *
 * Names are Natural Earth's own - it names the two ice sheets, the larger
 * ice caps and shelves - with the area of the outline it draws for each.
 */

import * as THREE from 'three';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { ICE_SHELF_COLOR, LAND_ICE_COLOR } from './layer';

export interface IceLabel {
  readonly name: string;
  readonly kind: 'glacier' | 'shelf';
  readonly lon: number;
  readonly lat: number;
  /** Area of Natural Earth's outline, km². */
  readonly areaKm2: number;
}

/** The shape of app/public/geo/ice.json: largest first. */
export interface IceData {
  readonly labels: readonly IceLabel[];
}

/** The largest are named ahead of the country names' neighbours; the rest wait their turn. */
const FEATURED = 12;

/** Two significant figures: "12 million km²", "1.8 million km²", "500,000 km²", "8,500 km²", "140 km²". */
export function areaText(areaKm2: number): string {
  if (areaKm2 <= 0) return '';
  const magnitude = 10 ** (Math.floor(Math.log10(areaKm2)) - 1);
  const rounded = Math.round(areaKm2 / magnitude) * magnitude;
  if (rounded >= 1e6) return `${String(Number((rounded / 1e6).toPrecision(2)))} million km²`;
  return `${Math.round(rounded).toLocaleString('en-US')} km²`;
}

/** "Vatnajökull · 8,500 km²". */
export function iceLabelText(label: IceLabel): string {
  return `${label.name} · ${areaText(label.areaKm2)}`;
}

/** '#rrggbb' as a GLSL vec3 of display values: the app draws colours as they are (see GlobeRenderer.setSurfaceImagery). */
export function glslColor(css: string): string {
  const hex = parseInt(css.slice(1), 16);
  const channel = (shift: number): string => (((hex >> shift) & 255) / 255).toFixed(4);
  return `vec3(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Ice on land over shelf where a texel holds both; the mask's soft edge is the alpha. */
const ICE_SHADE = `
  float land = texel.r;
  float shelf = texel.g;
  float cover = max(land, shelf);
  if (cover < 0.02) return vec4(0.0);
  vec3 color = mix(${glslColor(ICE_SHELF_COLOR)}, ${glslColor(LAND_ICE_COLOR)}, land / (land + shelf));
  return vec4(color, cover);
`;

export async function createGlacierLayer(context: LayerContext): Promise<LayerInstance> {
  const [data, texture] = await Promise.all([
    context.fetchJson<IceData>(context.assetUrl('geo/ice.json')),
    new THREE.TextureLoader().loadAsync(context.assetUrl('geo/ice-mask.png')),
  ]);
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'glaciers',
    opacity: 0.9,
    // Under the data overlays and the weather, over the base map.
    renderOrder: RENDER_ORDER.surfaceShell + 0.02,
    shadeGlsl: ICE_SHADE,
  });
  shell.setTexture(texture);
  context.earthRoot.add(shell.object);

  const labelOf = (label: IceLabel, i: number): GroupLabel => ({
    text: iceLabelText(label),
    priority: i,
    position: ecefAtAltitude(label.lon, label.lat, 0, new THREE.Vector3()),
  });
  const groups = [
    context.addLabels({
      rank: LABEL_KIND_ORDER.indexOf('country') + 0.45,
      style: { fontPx: 11, color: '#dff4ff', italic: true, bold: true },
      frame: 'earth',
      labels: data.labels.slice(0, FEATURED).map(labelOf),
    }),
    context.addLabels({
      rank: LABEL_KIND_ORDER.indexOf('volcano') - 0.3,
      style: { fontPx: 10, color: '#cfeaf7', italic: true },
      frame: 'earth',
      labels: data.labels.slice(FEATURED).map(labelOf),
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
