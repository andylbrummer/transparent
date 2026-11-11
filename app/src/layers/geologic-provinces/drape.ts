/**
 * A map of classed polygons draped on the surface: geologic provinces,
 * Archean crust, igneous provinces. Each picture (from
 * tools/pipeline/province_raster.py) holds a class number in red, outlines
 * in green (or none) and coverage in blue; the colours are a 256-entry
 * palette here, so the picture and the legend cannot drift apart.
 *
 * The class is read unfiltered (texelFetch): a filtered read would blend
 * two class numbers into a third at every border. Coverage and outlines
 * are read filtered, so edges stay smooth. Where the class changes from
 * one texel to the next an edge is drawn too, for pictures baked without
 * outlines.
 */

import * as THREE from 'three';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER, type LabelStyle } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';

/** [class, colour, fill opacity]: what the shader paints a class number with. */
export type PaletteEntry = readonly [number, number, number];

export const PALETTE_SIZE = 256;

export interface DrapeOptions {
  readonly name: string;
  /** Path under the app's public folder. */
  readonly picture: string;
  readonly palette: readonly PaletteEntry[];
  /** Over the other drapes: igneous provinces lie on the crust they erupted through. */
  readonly orderOffset: number;
  /** Names on the surface, most important first. */
  readonly labels?: readonly DrapeLabel[];
  readonly labelStyle?: LabelStyle;
}

export interface DrapeLabel {
  readonly text: string;
  readonly lon: number;
  readonly lat: number;
}

/** RGBA bytes of the palette: class i at texel i. Classes not listed are clear. */
export function paletteBytes(palette: readonly PaletteEntry[]): Uint8Array {
  const bytes = new Uint8Array(PALETTE_SIZE * 4);
  for (const [index, color, opacity] of palette) {
    if (!Number.isInteger(index) || index < 1 || index >= PALETTE_SIZE) throw new Error(`palette class ${String(index)} out of range`);
    bytes.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, Math.round(opacity * 255)], index * 4);
  }
  return bytes;
}

export const DRAPE_DECLARATIONS_GLSL = 'uniform sampler2D uPalette;';

/** Body of SurfaceShell's shade(texel, n, uv). */
export const DRAPE_SHADE_GLSL = `
    ivec2 size = textureSize(uMap, 0);
    ivec2 p = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
    int here = int(texelFetch(uMap, p, 0).r * 255.0 + 0.5);
    int east = int(texelFetch(uMap, ivec2((p.x + 1) % size.x, p.y), 0).r * 255.0 + 0.5);
    int north = int(texelFetch(uMap, ivec2(p.x, min(p.y + 1, size.y - 1)), 0).r * 255.0 + 0.5);
    vec4 fillColor = texelFetch(uPalette, ivec2(here, 0), 0);
    float cover = texel.b;
    // An edge: the baked outline, or a change of class with something on either side.
    float classEdge = (here != east || here != north) && here != 0 && east != 0 && north != 0 ? 1.0 : 0.0;
    // The rim of the coverage, where a polygon meets nothing.
    float rim = cover * (1.0 - smoothstep(0.55, 0.95, cover)) * 1.6;
    float edge = clamp(max(max(texel.g, classEdge), rim), 0.0, 1.0);
    vec3 lineColor = mix(fillColor.rgb, vec3(1.0), 0.55);
    float alpha = max(cover * fillColor.a, edge * 0.8 * step(0.004, fillColor.a + texel.g));
    vec3 color = mix(fillColor.rgb, lineColor, edge);
    return vec4(color, alpha);
`;

export async function createDrape(context: LayerContext, options: DrapeOptions): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl(options.picture));
  const palette = new THREE.DataTexture(paletteBytes(options.palette), PALETTE_SIZE, 1, THREE.RGBAFormat);
  palette.needsUpdate = true;
  const shell = new SurfaceShell(context.skyUniforms, {
    name: options.name,
    renderOrder: RENDER_ORDER.surfaceShell + options.orderOffset,
    declarationsGlsl: DRAPE_DECLARATIONS_GLSL,
    uniforms: { uPalette: { value: palette } },
    shadeGlsl: DRAPE_SHADE_GLSL,
  });
  shell.setTexture(texture);
  shell.object.visible = false;
  context.earthRoot.add(shell.object);
  const labels =
    options.labels && options.labelStyle
      ? context.addLabels({
          // With the geology, after the plates: names of the ground under the plates' names.
          rank: LABEL_KIND_ORDER.indexOf('plate') + 0.6,
          style: options.labelStyle,
          frame: 'earth',
          labels: options.labels.map((label, i) => ({ text: label.text, priority: i, position: ecefAtDepth(label.lon, label.lat, 0, new THREE.Vector3()) })),
        })
      : null;
  labels?.setVisible(false);
  return {
    setVisible(visible) {
      shell.object.visible = visible;
      labels?.setVisible(visible);
    },
    dispose() {
      labels?.remove();
      shell.dispose();
      texture.dispose();
      palette.dispose();
    },
  };
}

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** A legend of equal hard-edged bands, one per colour, left to right. */
export function bandsLegend(colors: readonly number[]): string {
  const step = 100 / colors.length;
  return `linear-gradient(to right, ${colors.map((color, i) => `${hex(color)} ${String(i * step)}% ${String((i + 1) * step)}%`).join(', ')})`;
}
