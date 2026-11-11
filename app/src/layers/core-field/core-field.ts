/**
 * The magnetic field on the core's surface, 1900-2025: the radial field
 * IGRF gives when continued down to the core-mantle boundary, drawn as a
 * glass ball at 2,891 km with the coastlines projected onto it. The
 * deep-time control moves through the years; between two epochs the
 * pictures are blended in the shader, so the patches drift smoothly.
 * Each epoch's picture (512x256 grey, about 21 kB) is fetched when first
 * needed and kept.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DeepShell } from '../../render/deep-shell';
import { RENDER_ORDER } from '../../render/order';
import type { OutlineData } from '../../render/outlines';
import { ProjectedCoast } from '../../render/projected-coast';
import { TimeControl } from '../deep-time/time-control';
import type { FrameState, LayerContext, LayerInstance } from '../types';
import { rampStrip } from '../weather/ramps';
import { momentAt, momentDescription, momentStatus, positionFromLocation, yearText, yearsSpanned, type CoreFieldData, type CoreFieldEpoch } from './epochs';
import { CORE_FIELD_RAMP, CORE_FIELD_SHADE_GLSL } from './shade';

const RAMP_TEXELS = 128;
// Under the mantle slices: the core is the deepest thing down there.
const SHELL_ORDER = RENDER_ORDER.outlines + 0.45;

export async function createCoreFieldLayer(context: LayerContext): Promise<LayerInstance> {
  const [data, outlines] = await Promise.all([
    context.fetchJson<CoreFieldData>(context.assetUrl('geo/core-field.json')),
    context.fetchJson<OutlineData>(context.assetUrl('geo/outlines.json')),
  ]);
  const radiusM = data.radiusKm * 1000;
  // The coastlines sit a hair outside the ball, so they are never hidden in it.
  const coastRadiusM = radiusM + 0.002 * EARTH_RADIUS_M;

  const ramp = new THREE.DataTexture(rampStrip(CORE_FIELD_RAMP, RAMP_TEXELS), RAMP_TEXELS, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const next = { value: null as THREE.Texture | null };
  const mix = { value: 0 };
  const deep = new DeepShell({
    name: 'core-field',
    radiusM,
    declarationsGlsl: 'uniform sampler2D uRamp; uniform sampler2D uNext; uniform float uMix;',
    uniforms: { uRamp: { value: ramp }, uNext: next, uMix: mix },
    shadeGlsl: CORE_FIELD_SHADE_GLSL,
    renderOrder: SHELL_ORDER,
  });
  const coast = new ProjectedCoast(outlines, coastRadiusM, 'core-field-coast', SHELL_ORDER + 0.02);
  const group = new THREE.Group();
  group.add(deep.object, coast.object);
  group.visible = false;
  context.earthRoot.add(group);

  const loader = new THREE.TextureLoader();
  const textures = new Map<number, THREE.Texture>();
  const pending = new Set<number>();
  let failed = false;
  const want = (epoch: CoreFieldEpoch): THREE.Texture | undefined => {
    const held = textures.get(epoch.year);
    if (held || pending.has(epoch.year)) return held;
    pending.add(epoch.year);
    loader.loadAsync(context.assetUrl(epoch.file)).then(
      (texture) => {
        pending.delete(epoch.year);
        textures.set(epoch.year, texture);
        dirty = true;
      },
      () => {
        // Asked for again the next time it is wanted.
        pending.delete(epoch.year);
        failed = true;
        dirty = true;
      }
    );
    return undefined;
  };

  const control = new TimeControl(
    {
      id: 'core-field',
      title: 'Magnetic field on the core',
      max: yearsSpanned(data),
      step: 1,
      buttonStep: 5,
      playRate: 8,
      format: (position) => yearText(momentAt(data, position)),
      formatSpoken: (position) => `${yearText(momentAt(data, position))}`,
      describe: (position) => momentDescription(momentAt(data, position)),
    },
    positionFromLocation(window.location.search, data)
  );

  let visible = false;
  let dirty = true;
  let shownStatus = '';
  control.onChange(() => {
    dirty = true;
  });

  const apply = (): void => {
    if (!visible || !dirty) return;
    dirty = false;
    const moment = momentAt(data, control.value);
    const older = want(moment.older);
    const newer = want(moment.newer);
    // While a picture is on its way the nearer one held stands in for both.
    const first = older ?? newer;
    if (first) {
      deep.setTexture(first);
      next.value = newer ?? first;
      mix.value = older && newer ? moment.mix : 0;
      group.visible = true;
    }
    const status = failed && !first ? `${momentStatus(moment)} · picture failed to load` : momentStatus(moment);
    failed = false;
    if (status !== shownStatus) {
      shownStatus = status;
      context.setStatus(status, status.includes('failed') ? 'error' : 'info');
    }
  };

  return {
    setVisible(on) {
      visible = on;
      control.setVisible(on);
      if (!on) {
        group.visible = false;
        shownStatus = '';
        context.setStatus(null);
      }
      dirty = true;
      apply();
    },
    update(frame: FrameState) {
      control.tick(frame.deltaMs);
      apply();
    },
    dispose() {
      control.dispose();
      group.removeFromParent();
      deep.dispose();
      coast.dispose();
      ramp.dispose();
      for (const texture of textures.values()) texture.dispose();
    },
  };
}
