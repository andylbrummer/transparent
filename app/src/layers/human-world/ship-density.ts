/**
 * Where ships go: six years of ship position reports (January 2015 to
 * February 2021) summed into a density draped on the sea, on a
 * logarithmic scale (app/public/geo/ship-density.jpg,
 * tools/pipeline/generate_ship_density.py).
 *
 * The image holds a code, not a colour: 0 where next to nothing passed,
 * then five decades of density. The shader colours it with the legend's
 * ramp and lets the open sea, where little passes, stay nearly clear, so
 * the lanes stand out: Suez, Malacca, the Cape, the great-circle track
 * across the North Pacific.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { rampStrip } from '../weather/ramps';
import { SHIP_DENSITY_RAMP } from './styles';

const RAMP_TEXELS = 256;

/**
 * Strength, 0..1, of a pixel whose code is `t`: nothing at 0, faint over
 * the lowest decade and a half, nearly solid in the lanes. Exported for
 * the test that the open sea stays clear and a strait does not.
 */
export const shipDensityAlpha = (t: number): number => {
  const x = Math.min(1, Math.max(0, (t - 0.04) / 0.56));
  return 0.92 * x * x * (3 - 2 * x);
};

const SHADE_GLSL = `
  float t = texel.r;
  vec3 color = texture2D(uRamp, vec2(t, 0.5)).rgb;
  // The same curve as shipDensityAlpha.
  return vec4(color, 0.92 * smoothstep(0.04, 0.6, t));
`;

export async function createShipDensityLayer(context: LayerContext): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl('geo/ship-density.jpg'));
  const ramp = new THREE.DataTexture(rampStrip(SHIP_DENSITY_RAMP, RAMP_TEXELS), RAMP_TEXELS, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'ship-density',
    declarationsGlsl: 'uniform sampler2D uRamp;',
    uniforms: { uRamp: { value: ramp } },
    shadeGlsl: SHADE_GLSL,
    // Over the other draped images: this is the one just asked for.
    renderOrder: RENDER_ORDER.surfaceShell + 0.06,
  });
  shell.setTexture(texture);
  context.earthRoot.add(shell.object);
  context.setStatus('2015–2021', 'info');
  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    dispose() {
      shell.dispose();
      ramp.dispose();
    },
  };
}
