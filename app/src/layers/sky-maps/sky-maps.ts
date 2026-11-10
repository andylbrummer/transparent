/**
 * An all-sky map behind the stars, from app/public/sky/maps/
 * (tools/pipeline/generate_skymaps.py): the sky at a wavelength the eye
 * does not see.
 */

import * as THREE from 'three';
import { SkyMap } from '../../render/sky-map';
import type { LayerContext, LayerInstance } from '../types';
import type { SkyMapSpec } from './specs';

type LoadTexture = (url: string) => Promise<THREE.Texture>;

const loadWithThree: LoadTexture = (url) => new THREE.TextureLoader().loadAsync(url);

/**
 * The map's image is held only while its switch is on. A dozen maps at
 * 2048×1024 would be 100 MB of textures if each stayed after one look;
 * switched off, a map gives its 8 MB back, and the browser's cache makes
 * switching it on again quick.
 */
export async function createSkyMapLayer(
  context: LayerContext,
  spec: SkyMapSpec,
  loadTexture: LoadTexture = loadWithThree
): Promise<LayerInstance> {
  const map = new SkyMap(context.skyRoot, context.skyUniforms, { name: spec.id, frame: 'galactic', gain: spec.gain });
  // The quad fills the screen wherever it hangs; under the sky root it is hidden with the sky until a position fix.
  context.skyRoot.add(map.object);
  map.object.visible = false;

  let texture: THREE.Texture | null = null;
  let wanted = false;
  // Counts loads, so an image that arrives after its switch went off (or after a newer load began) is dropped.
  let generation = 0;
  let disposed = false;

  const release = (): void => {
    map.object.visible = false;
    texture?.dispose();
    texture = null;
  };

  const load = async (): Promise<void> => {
    const mine = ++generation;
    const loaded = await loadTexture(context.assetUrl(spec.file));
    if (disposed || mine !== generation || !wanted) {
      loaded.dispose();
      return;
    }
    // The JPEG holds display values; the shader adds them as they are.
    loaded.colorSpace = THREE.NoColorSpace;
    texture = loaded;
    map.setTexture(loaded);
    map.object.visible = true;
    context.setStatus(null);
  };

  const show = (): void => {
    if (texture) return;
    load().catch((error: unknown) => {
      console.error(`sky map "${spec.id}" failed to load`, error);
      context.setStatus('unavailable', 'error');
    });
  };

  // The first image is awaited so the manager's "loading…" chip covers it and a failure is reported.
  wanted = true;
  try {
    await load();
  } catch (error) {
    map.dispose();
    throw error;
  }

  return {
    setVisible(visible) {
      wanted = visible;
      if (visible) {
        show();
      } else {
        generation++;
        release();
      }
    },
    dispose() {
      disposed = true;
      release();
      map.dispose();
    },
  };
}
