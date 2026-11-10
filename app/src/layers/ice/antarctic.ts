/**
 * Antarctica's ice in depth: how thick it is, and the land it hides.
 *
 * Both maps are Bedmap3 grids baked by tools/pipeline/generate_antarctic_ice.py
 * into a strip of the globe south of 58°S, a grey level per pixel standing
 * for metres. The colours are put on here, from the ramps in layer.ts that
 * also make the legends, so legend and map cannot drift apart.
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { glslColor } from './glaciers';
import { BED_RAMP, THICKNESS_RAMP, type RampStop } from './layer';

export type AntarcticField = 'thickness' | 'bed';

interface Extreme {
  readonly metres: number;
  readonly lon: number;
  readonly lat: number;
}

/** The shape of app/public/geo/antarctic-ice.json. */
export interface AntarcticIceData {
  readonly strip: { readonly width: number; readonly height: number; readonly latTop: number; readonly latBottom: number };
  /** metres = grey level (0..255) × stepM + offsetM. */
  readonly thickness: { readonly stepM: number; readonly offsetM: number };
  readonly bed: { readonly stepM: number; readonly offsetM: number };
  readonly thickestIce: Extreme;
  readonly deepestBedUnderGroundedIce: Extreme;
  readonly meanThicknessM: number;
}

/**
 * GLSL for `vec3 ramp(float v)`: the stops' colours, blended linearly
 * between neighbours and held beyond the ends.
 */
export function rampGlsl(stops: readonly RampStop[]): string {
  const lines = [`vec3 c = ${glslColor(stops[0][1])};`];
  for (let i = 1; i < stops.length; i++) {
    const [from] = stops[i - 1];
    const [to, color] = stops[i];
    lines.push(`c = mix(c, ${glslColor(color)}, clamp((v - ${from.toFixed(1)}) / ${(to - from).toFixed(1)}, 0.0, 1.0));`);
  }
  return `vec3 ramp(float v) {\n  ${lines.join('\n  ')}\n  return c;\n}`;
}

/** The same ramp evaluated on the CPU, 0..255 per channel: for the test that shader and legend agree. */
export function rampColor(stops: readonly RampStop[], value: number): [number, number, number] {
  const rgb = (css: string): [number, number, number] => {
    const hex = parseInt(css.slice(1), 16);
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  };
  let c = rgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const t = Math.min(Math.max((value - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]), 0), 1);
    const next = rgb(stops[i][1]);
    c = [c[0] + (next[0] - c[0]) * t, c[1] + (next[1] - c[1]) * t, c[2] + (next[2] - c[2]) * t];
  }
  return c;
}

/** "4,757 m", "−2,973 m": a true minus sign, thousands separated. */
export function metresText(metres: number): string {
  return `${metres < 0 ? '−' : ''}${Math.abs(Math.round(metres)).toLocaleString('en-US')} m`;
}

export function extremeLabel(field: AntarcticField, data: AntarcticIceData): { text: string; lon: number; lat: number } {
  if (field === 'thickness') {
    const { metres, lon, lat } = data.thickestIce;
    return { text: `Thickest ice · ${metresText(metres)}`, lon, lat };
  }
  const { metres, lon, lat } = data.deepestBedUnderGroundedIce;
  return { text: `Deepest bed under grounded ice · ${metresText(metres)}`, lon, lat };
}

const FIELDS: Readonly<Record<AntarcticField, { asset: string; ramp: readonly RampStop[] }>> = {
  thickness: { asset: 'geo/antarctic-ice-thickness.png', ramp: THICKNESS_RAMP },
  bed: { asset: 'geo/antarctic-bed.png', ramp: BED_RAMP },
};

export async function createAntarcticLayer(context: LayerContext, field: AntarcticField): Promise<LayerInstance> {
  const { asset, ramp } = FIELDS[field];
  const [data, texture] = await Promise.all([
    context.fetchJson<AntarcticIceData>(context.assetUrl('geo/antarctic-ice.json')),
    new THREE.TextureLoader().loadAsync(context.assetUrl(asset)),
  ]);
  const scale = data[field];
  const { latTop, latBottom } = data.strip;
  const shell = new SurfaceShell(context.skyUniforms, {
    name: `antarctic-${field}`,
    opacity: 0.95,
    // Over the land-ice mask, under the data overlays and the weather.
    renderOrder: RENDER_ORDER.surfaceShell + 0.025,
    declarationsGlsl: rampGlsl(ramp),
    // The texture is a strip of the globe: its rows run from latBottom (v = 0) to latTop (v = 1).
    shadeGlsl: `
      float latitude = degrees(asin(clamp(n.z, -1.0, 1.0)));
      if (latitude > ${latTop.toFixed(2)}) return vec4(0.0);
      vec4 s = texture2D(uMap, vec2(uv.x, (latitude - ${latBottom.toFixed(2)}) / ${(latTop - latBottom).toFixed(2)}));
      float metres = s.r * 255.0 * ${scale.stepM.toFixed(2)} + ${scale.offsetM.toFixed(2)};
      return vec4(ramp(metres), s.a);
    `,
  });
  shell.setTexture(texture);
  context.earthRoot.add(shell.object);

  const extreme = extremeLabel(field, data);
  // A cross on the spot: the name is centred under it.
  const marker = new GeoMarkers(`antarctic-${field}-extreme`, context.skyUniforms.uPixelRatio);
  marker.setMarkers([{ lon: extreme.lon, lat: extreme.lat, shape: 'cross', color: 0xffffff, sizePx: 11 }]);
  context.earthRoot.add(marker.object);
  const labels = context.addLabels({
    rank: LABEL_KIND_ORDER.indexOf('country') - 0.25,
    style: { fontPx: 11, color: '#f2fbff', bold: true, offsetYPx: 13 },
    frame: 'earth',
    labels: [{ text: extreme.text, priority: 0, position: ecefAtAltitude(extreme.lon, extreme.lat, 0, new THREE.Vector3()) }],
  });

  return {
    setVisible(visible) {
      shell.object.visible = visible;
      marker.object.visible = visible;
      labels.setVisible(visible);
    },
    dispose() {
      labels.remove();
      marker.dispose();
      // Disposes of the texture it holds, too.
      shell.dispose();
    },
  };
}
