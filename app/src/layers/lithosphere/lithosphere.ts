/**
 * The thickness of the lithosphere, draped on the surface above it: how
 * far down the cold plate reaches before the mantle beneath flows. The
 * picture holds depths, not colours (ramp.ts); one 180 x 90 grey image,
 * 9 kB, a pixel per 2-degree cell of the model, blended between cells.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { rampStrip } from '../weather/ramps';
import { LITHOSPHERE_RAMP, LITHOSPHERE_SHADE_GLSL } from './ramp';

const RAMP_TEXELS = 256;

export async function createLithosphereLayer(context: LayerContext): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl('geo/lithosphere.png'));
  const ramp = new THREE.DataTexture(rampStrip(LITHOSPHERE_RAMP, RAMP_TEXELS), RAMP_TEXELS, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'lithosphere',
    declarationsGlsl: 'uniform sampler2D uRamp;',
    uniforms: { uRamp: { value: ramp } },
    shadeGlsl: LITHOSPHERE_SHADE_GLSL,
    // With the geophysical fields draped on the surface: over the imagery, under the lines.
    renderOrder: RENDER_ORDER.surfaceShell + 0.05,
  });
  shell.setTexture(texture);
  shell.object.visible = false;
  context.earthRoot.add(shell.object);

  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    dispose() {
      shell.dispose();
      ramp.dispose();
      texture.dispose();
    },
  };
}
