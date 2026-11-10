/**
 * The northern ice sheets through the Quaternary, one published best
 * estimate per time-slice, draped on today's surface; the deep-time
 * control steps through the slices. Each slice's coverage picture
 * (2048x1024 grey, about 11 kB) is fetched when first shown and kept.
 *
 * Like the continents, this is deep time: the sky and the clock stay at now.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import { TimeControl } from '../deep-time/time-control';
import { glslColor } from '../ice/glaciers';
import { ICE_SHEET_COLOR } from '../ice-age/layer';
import type { FrameState, LayerContext, LayerInstance } from '../types';
import { positionFromLocation, sliceAt, sliceDescription, sliceSpoken, sliceStatus, sliceText, type IceSheetSlice, type IceSheetsData } from './slices';

const SHADE = `
  float ice = texel.r;
  if (ice < 0.02) return vec4(0.0);
  return vec4(${glslColor(ICE_SHEET_COLOR)}, ice * 0.9);
`;

export async function createIceSheetsTimeLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<IceSheetsData>(context.assetUrl('geo/ice-sheets.json'));
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'ice-sheets-time',
    // Where the LGM layer draws: over the base map and today's ice, under the data overlays and the weather.
    renderOrder: RENDER_ORDER.surfaceShell + 0.03,
    shadeGlsl: SHADE,
  });
  shell.object.visible = false;
  context.earthRoot.add(shell.object);

  const loader = new THREE.TextureLoader();
  const textures = new Map<string, Promise<THREE.Texture>>();
  const textureFor = (slice: IceSheetSlice): Promise<THREE.Texture> => {
    let texture = textures.get(slice.id);
    if (!texture) {
      texture = loader.loadAsync(context.assetUrl(slice.file));
      // A failed fetch is asked for again next time the slice is shown.
      texture.catch(() => textures.delete(slice.id));
      textures.set(slice.id, texture);
    }
    return texture;
  };

  const control = new TimeControl(
    {
      id: 'ice-sheets',
      title: 'Ice sheets through time',
      max: data.slices.length,
      step: 1,
      buttonStep: 1,
      playRate: 1.5,
      playFrom: data.slices.length,
      format: (position) => sliceText(sliceAt(data, position)),
      formatSpoken: (position) => sliceSpoken(sliceAt(data, position)),
      describe: (position) => sliceDescription(sliceAt(data, position)),
    },
    positionFromLocation(window.location.search, data)
  );

  let visible = false;
  let shownId: string | null | undefined;
  let request = 0;
  const apply = (): void => {
    const slice = sliceAt(data, control.value);
    if (!visible || (slice?.id ?? null) === shownId) return;
    shownId = slice?.id ?? null;
    context.setStatus(sliceStatus(slice), 'info');
    if (!slice) {
      shell.object.visible = false;
      return;
    }
    const ticket = ++request;
    textureFor(slice).then(
      (texture) => {
        // Only the latest choice is drawn: a slow picture must not replace a newer one.
        if (ticket !== request || !visible) return;
        shell.setTexture(texture);
        shell.object.visible = true;
      },
      () => {
        if (ticket === request) context.setStatus(`${sliceStatus(slice)} · picture failed to load`, 'error');
        shownId = undefined;
      }
    );
  };
  control.onChange(apply);

  return {
    setVisible(on) {
      visible = on;
      control.setVisible(on);
      if (!on) {
        shell.object.visible = false;
        shownId = undefined;
        context.setStatus(null);
      }
      apply();
    },
    update(frame: FrameState) {
      control.tick(frame.deltaMs);
    },
    dispose() {
      control.dispose();
      shell.dispose();
      for (const texture of textures.values()) texture.then((t) => t.dispose(), () => undefined);
    },
  };
}
