/**
 * Oil and gas fields draped on the surface: OGIM v3.0's outlines, coloured
 * by what the field holds, with the largest the data names labelled.
 * One 4096x2048 picture (about 70 kB), fetched when the layer is first on.
 */

import * as THREE from 'three';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { FIELDS_SHADE_GLSL, FLUID_COLORS, FLUIDS, fieldLabelText, type OilGasFieldsData } from './classes';

export async function createOilGasFieldsLayer(context: LayerContext): Promise<LayerInstance> {
  const [data, texture] = await Promise.all([
    context.fetchJson<OilGasFieldsData>(context.assetUrl('geo/oil-gas-fields.json')),
    new THREE.TextureLoader().loadAsync(context.assetUrl('geo/oil-gas-fields.png')),
  ]);
  const image = texture.image as { width: number; height: number };
  // The red channel is a class code: averaging codes into mipmaps would invent classes.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'oil-gas-fields',
    declarationsGlsl: 'uniform vec2 uSize; uniform vec3 uColors[4];',
    uniforms: {
      uSize: { value: new THREE.Vector2(image.width, image.height) },
      uColors: { value: FLUIDS.map((fluid) => new THREE.Color(FLUID_COLORS[fluid])) },
    },
    shadeGlsl: FIELDS_SHADE_GLSL,
    // Over the basins they lie in, when both are on.
    renderOrder: RENDER_ORDER.surfaceShell + 0.07,
  });
  shell.setTexture(texture);
  shell.object.visible = false;
  context.earthRoot.add(shell.object);
  const labels = context.addLabels({
    rank: LABEL_KIND_ORDER.indexOf('city') - 0.5,
    style: { fontPx: 10, color: '#ffe2b8' },
    frame: 'earth',
    labels: [...data.labels]
      .sort((a, b) => b.km2 - a.km2)
      .map((label, priority) => ({ text: fieldLabelText(label), priority, position: ecefAtAltitude(label.lon, label.lat, 0, new THREE.Vector3()) })),
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
