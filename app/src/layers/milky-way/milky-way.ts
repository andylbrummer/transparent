/**
 * The Milky Way behind the stars, from app/public/sky/milkyway.jpg
 * (tools/pipeline/generate_milkyway.py: NASA SVS Deep Star Maps 2020).
 */

import * as THREE from 'three';
import { SkyMap } from '../../render/sky-map';
import type { LayerContext, LayerInstance } from '../types';

/**
 * How much of the map's light is added to the view. The map is baked so
 * the bulge nears white; at this gain the band reads clearly against the
 * stars while the globe, seen through it below the horizon, keeps its
 * colours (there the shared below-horizon dimming applies on top).
 */
export const MILKY_WAY_GAIN = 0.7;

export async function createMilkyWayLayer(context: LayerContext): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl('sky/milkyway.jpg'));
  // The JPEG holds display values; the shader adds them as they are.
  texture.colorSpace = THREE.NoColorSpace;
  const map = new SkyMap(context.skyRoot, context.skyUniforms, { name: 'milky-way', frame: 'icrs', gain: MILKY_WAY_GAIN });
  map.setTexture(texture);
  // The quad fills the screen wherever it hangs; under the sky root it is hidden with the sky until a position fix.
  context.skyRoot.add(map.object);
  return {
    setVisible(visible) {
      map.object.visible = visible;
    },
    dispose() {
      map.dispose();
    },
  };
}
