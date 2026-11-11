/**
 * Permafrost: the four zones of the Northern Hemisphere's frozen ground
 * draped on the surface, the coldest deepest in colour (see zones.ts).
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import { glslColor } from '../ice/glaciers';
import type { LayerContext, LayerInstance } from '../types';
import { R_STEP, ZONE_COLORS, permafrostStatus, type PermafrostData } from './zones';

const SHADE = `
  float cover = texel.b;
  if (cover < 0.02) return vec4(0.0);
  float zone = clamp(texel.r * 255.0 / ${R_STEP.toFixed(1)}, 1.0, 4.0);
  vec3 color = mix(${glslColor(ZONE_COLORS.continuous)}, ${glslColor(ZONE_COLORS.discontinuous)}, clamp(zone - 1.0, 0.0, 1.0));
  color = mix(color, ${glslColor(ZONE_COLORS.sporadic)}, clamp(zone - 2.0, 0.0, 1.0));
  color = mix(color, ${glslColor(ZONE_COLORS.isolated)}, clamp(zone - 3.0, 0.0, 1.0));
  return vec4(color, cover * mix(0.85, 0.6, (zone - 1.0) / 3.0));
`;

export async function createPermafrostLayer(context: LayerContext): Promise<LayerInstance> {
  const [data, texture] = await Promise.all([
    context.fetchJson<PermafrostData>(context.assetUrl('geo/permafrost.json')),
    new THREE.TextureLoader().loadAsync(context.assetUrl('geo/permafrost.png')),
  ]);
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'permafrost',
    // Over the base map, under today's ice and the data overlays.
    renderOrder: RENDER_ORDER.surfaceShell + 0.015,
    shadeGlsl: SHADE,
  });
  shell.setTexture(texture);
  context.earthRoot.add(shell.object);
  context.setStatus(permafrostStatus(data));
  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    dispose() {
      shell.dispose();
    },
  };
}
