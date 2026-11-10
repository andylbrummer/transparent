/**
 * The age of the ocean floor, draped on the surface: the one dataset that
 * shows a spreading ridge as the structure it is - a band of new crust
 * with older crust in matching stripes to either side, out to the
 * 180-million-year-old floor about to go down the trenches.
 *
 * The image (app/public/geo/seafloor-age.png, from
 * tools/pipeline/generate_seafloor_age.py; Seton et al. 2020) holds the
 * age itself, not colours: red is 255 * sqrt(age / AGE_MAX_MYR), green is
 * how much of the pixel is ocean crust. The shader colours it by AGE_RAMP,
 * so the picture and the legend cannot drift apart, and rules a line every
 * ISOCHRON_MYR.
 */

import * as THREE from 'three';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { ISOCHRON_MYR } from './layer';
import { AGE_MAX_MYR, AGE_RAMP_GLSL } from './ramp';

/** Over the ocean the base image is near black, so the layer can be nearly opaque and still leave the land alone. */
const OPACITY = 0.85;

const SHADE_GLSL = `
    float myr = ${AGE_MAX_MYR.toFixed(1)} * texel.r * texel.r;
    vec3 color = ageRamp(myr);
    // Isochrons: a darker line where the age crosses a multiple of the
    // interval, one pixel wide, fading where the lines would crowd (at a
    // fracture zone the age jumps tens of Myr between two texels).
    float perPixel = max(fwidth(myr), 1.0e-4);
    float interval = ${ISOCHRON_MYR.toFixed(1)};
    float distancePx = abs(mod(myr + 0.5 * interval, interval) - 0.5 * interval) / perPixel;
    float line = (1.0 - smoothstep(0.5, 1.5, distancePx)) * smoothstep(3.0, 8.0, interval / perPixel);
    color *= 1.0 - 0.32 * line;
    return vec4(color, smoothstep(0.35, 0.65, texel.g));
`;

/** The shader's colouring, for the test that it reads the age the bake wrote. */
export const SEAFLOOR_AGE_SHADE_GLSL = SHADE_GLSL;

export async function createSeafloorAgeLayer(context: LayerContext): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl('geo/seafloor-age.png'));
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'seafloor-age',
    opacity: OPACITY,
    declarationsGlsl: AGE_RAMP_GLSL,
    shadeGlsl: SHADE_GLSL,
  });
  shell.setTexture(texture);
  context.earthRoot.add(shell.object);
  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    dispose() {
      shell.dispose();
    },
  };
}
