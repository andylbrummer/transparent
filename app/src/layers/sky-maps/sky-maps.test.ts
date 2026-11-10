import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { LayerContext } from '../types';
import { createSkyMapLayer } from './sky-maps';
import { SKY_MAP_SPECS } from './specs';

/** The baked images, by path under app/ (not loaded: the keys say which exist). */
const BAKED = import.meta.glob('/public/sky/maps/*.jpg');
const SPEC = SKY_MAP_SPECS[0];

function fakeContext(): { context: LayerContext; skyRoot: THREE.Group; setStatus: ReturnType<typeof vi.fn> } {
  const skyRoot = new THREE.Group();
  const setStatus = vi.fn();
  const context = {
    skyRoot,
    skyUniforms: {
      uObserverUp: { value: new THREE.Vector3(0, 0, 1) },
      uBelowHorizon: { value: 0.3 },
      uPixelRatio: { value: 1 },
    },
    assetUrl: (path: string) => `/base/${path}`,
    setStatus,
  } as unknown as LayerContext;
  return { context, skyRoot, setStatus };
}

/** A loader whose textures can be counted, and delivered when the test says so. */
function fakeLoader(): {
  load: (url: string) => Promise<THREE.Texture>;
  urls: string[];
  textures: { texture: THREE.Texture; disposed: boolean }[];
  pending: (() => void)[];
  hold: boolean;
} {
  const state = {
    urls: [] as string[],
    textures: [] as { texture: THREE.Texture; disposed: boolean }[],
    pending: [] as (() => void)[],
    hold: false,
    load(url: string): Promise<THREE.Texture> {
      state.urls.push(url);
      const texture = new THREE.Texture();
      const entry = { texture, disposed: false };
      texture.addEventListener('dispose', () => {
        entry.disposed = true;
      });
      state.textures.push(entry);
      if (!state.hold) return Promise.resolve(texture);
      return new Promise((resolvePromise) => state.pending.push(() => resolvePromise(texture)));
    },
  };
  return state;
}

const settle = (): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

describe('createSkyMapLayer', () => {
  it('shows the map once its image has loaded', async () => {
    const { context, skyRoot } = fakeContext();
    const loader = fakeLoader();
    const layer = await createSkyMapLayer(context, SPEC, loader.load);
    expect(loader.urls).toEqual([`/base/${SPEC.file}`]);
    expect(skyRoot.children).toHaveLength(1);
    expect(skyRoot.children[0].visible).toBe(true);
    layer.dispose();
    expect(skyRoot.children).toHaveLength(0);
    expect(loader.textures[0].disposed).toBe(true);
  });

  it('frees the texture when switched off and loads it again when switched on', async () => {
    const { context, skyRoot } = fakeContext();
    const loader = fakeLoader();
    const layer = await createSkyMapLayer(context, SPEC, loader.load);
    layer.setVisible(true);
    expect(loader.urls).toHaveLength(1);

    layer.setVisible(false);
    expect(skyRoot.children[0].visible).toBe(false);
    expect(loader.textures[0].disposed).toBe(true);

    layer.setVisible(true);
    await settle();
    expect(loader.urls).toHaveLength(2);
    expect(skyRoot.children[0].visible).toBe(true);
    expect(loader.textures[1].disposed).toBe(false);
  });

  it('drops an image that arrives after the switch went off again', async () => {
    const { context, skyRoot } = fakeContext();
    const loader = fakeLoader();
    const layer = await createSkyMapLayer(context, SPEC, loader.load);
    layer.setVisible(false);
    loader.hold = true;
    layer.setVisible(true);
    layer.setVisible(false);
    loader.pending[0]();
    await settle();
    expect(skyRoot.children[0].visible).toBe(false);
    expect(loader.textures[1].disposed).toBe(true);
  });

  it('says so when the image cannot be loaded again', async () => {
    const { context, setStatus } = fakeContext();
    const loader = fakeLoader();
    let fail = false;
    const layer = await createSkyMapLayer(context, SPEC, (url) => (fail ? Promise.reject(new Error('offline')) : loader.load(url)));
    layer.setVisible(false);
    fail = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    layer.setVisible(true);
    await settle();
    expect(setStatus).toHaveBeenCalledWith('unavailable', 'error');
    logged.mockRestore();
  });

  it('rejects, leaving nothing behind, when the first load fails', async () => {
    const { context, skyRoot } = fakeContext();
    await expect(createSkyMapLayer(context, SPEC, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(skyRoot.children).toHaveLength(0);
  });
});

describe('SKY_MAP_SPECS', () => {
  it('names a baked image for every map, with a legend and a caption', () => {
    const ids = SKY_MAP_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of SKY_MAP_SPECS) {
      expect(Object.keys(BAKED), spec.file).toContain(`/public/${spec.file}`);
      expect(spec.legend).toMatch(/^linear-gradient\(/);
      expect(spec.caption.length).toBeGreaterThan(40);
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.gain).toBeLessThanOrEqual(1);
      expect(spec.credits.length).toBeGreaterThan(0);
    }
  });
});
