/**
 * Wraps one of the screen-width line layers (render/outlines.ts,
 * render/interior.ts) as a lazy layer: fetch its baked file, build it, put
 * it on the Earth.
 */

import type * as THREE from 'three';
import type { LayerContext, LayerInstance } from './types';

interface LineLayer {
  getObject(): THREE.Object3D;
  setResolution(widthCss: number, heightCss: number): void;
  dispose(): void;
}

export async function createLineLayer<T>(context: LayerContext, assetPath: string, build: (data: T) => LineLayer): Promise<LayerInstance> {
  const layer = build(await context.fetchJson<T>(context.assetUrl(assetPath)));
  const object = layer.getObject();
  object.visible = false;
  context.earthRoot.add(object);
  return {
    setVisible(visible) {
      object.visible = visible;
    },
    setResolution(widthCss, heightCss) {
      layer.setResolution(widthCss, heightCss);
    },
    dispose() {
      object.removeFromParent();
      layer.dispose();
    },
  };
}
