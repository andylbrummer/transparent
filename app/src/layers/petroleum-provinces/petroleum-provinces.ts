/**
 * The USGS's petroleum provinces draped on the surface: every province
 * outlined, the assessed ones washed in their main commodity, the ones
 * with the most oil and gas found by 2000 named. One 2048x1024 picture
 * (about 160 kB), fetched when the layer is first on.
 */

import * as THREE from 'three';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { PROVINCE_COLORS, PROVINCES_SHADE_GLSL, provinceLabelText, type PetroleumProvincesData } from './classes';

export async function createPetroleumProvincesLayer(context: LayerContext): Promise<LayerInstance> {
  const [data, texture] = await Promise.all([
    context.fetchJson<PetroleumProvincesData>(context.assetUrl('geo/petroleum-provinces.json')),
    new THREE.TextureLoader().loadAsync(context.assetUrl('geo/petroleum-provinces.png')),
  ]);
  const image = texture.image as { width: number; height: number };
  // The red channel is a class code: averaging codes into mipmaps would invent classes.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const color = (css: string): THREE.Color => new THREE.Color(css);
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'petroleum-provinces',
    declarationsGlsl: 'uniform vec2 uSize; uniform vec3 uOil; uniform vec3 uGas; uniform vec3 uAssessed; uniform vec3 uOutline;',
    uniforms: {
      uSize: { value: new THREE.Vector2(image.width, image.height) },
      uOil: { value: color(PROVINCE_COLORS.oil) },
      uGas: { value: color(PROVINCE_COLORS.gas) },
      uAssessed: { value: color(PROVINCE_COLORS.assessed) },
      uOutline: { value: color(PROVINCE_COLORS.outline) },
    },
    shadeGlsl: PROVINCES_SHADE_GLSL,
    // Under the fields, when both are on.
    renderOrder: RENDER_ORDER.surfaceShell + 0.06,
  });
  shell.setTexture(texture);
  shell.object.visible = false;
  context.earthRoot.add(shell.object);
  const labels = context.addLabels({
    rank: LABEL_KIND_ORDER.indexOf('state') - 0.5,
    style: { fontPx: 11, color: '#ffd9a8', italic: true },
    frame: 'earth',
    labels: data.labels.map((label, priority) => ({
      text: provinceLabelText(label),
      priority,
      position: ecefAtAltitude(label.lon, label.lat, 0, new THREE.Vector3()),
    })),
  });
  labels.setVisible(false);
  return {
    setVisible(visible) {
      shell.object.visible = visible;
      labels.setVisible(visible);
    },
    dispose() {
      labels.remove();
      shell.dispose();
    },
  };
}
