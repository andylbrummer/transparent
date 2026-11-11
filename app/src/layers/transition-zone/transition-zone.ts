/**
 * One boundary of the mantle transition zone, the 410 or the 660, as a
 * glass ball at its average depth, coloured by how far it is raised or
 * pushed down there, with the coastlines projected onto it and its name
 * where it passes under the user. The picture is 512x256 grey, about 35 kB.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DeepShell } from '../../render/deep-shell';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { OutlineData } from '../../render/outlines';
import { ProjectedCoast } from '../../render/projected-coast';
import type { LayerContext, LayerInstance } from '../types';
import { rampStrip } from '../weather/ramps';
import { boundaryLabelText, boundaryOf, boundaryStatus, type TransitionZoneData } from './boundaries';
import { TRANSITION_ZONE_RAMP, TRANSITION_ZONE_SHADE_GLSL } from './shade';

const RAMP_TEXELS = 128;
// Between the core (deepest, drawn first) and the mantle slices; the 660 before the 410 above it.
const SHELL_ORDER = { '660': RENDER_ORDER.outlines + 0.47, '410': RENDER_ORDER.outlines + 0.48 } as const;

export async function createTransitionZoneLayer(context: LayerContext, id: '410' | '660'): Promise<LayerInstance> {
  const [data, outlines] = await Promise.all([
    context.fetchJson<TransitionZoneData>(context.assetUrl('geo/transition-zone.json')),
    context.fetchJson<OutlineData>(context.assetUrl('geo/outlines.json')),
  ]);
  const boundary = boundaryOf(data, id);
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl(boundary.file));
  const radiusM = EARTH_RADIUS_M - boundary.meanKm * 1000;

  const ramp = new THREE.DataTexture(rampStrip(TRANSITION_ZONE_RAMP, RAMP_TEXELS), RAMP_TEXELS, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const rampKm = TRANSITION_ZONE_RAMP[TRANSITION_ZONE_RAMP.length - 1][0];
  const deep = new DeepShell({
    name: `transition-zone-${id}`,
    radiusM,
    declarationsGlsl: 'uniform sampler2D uRamp; uniform float uScaleKm; uniform float uRampKm;',
    uniforms: { uRamp: { value: ramp }, uScaleKm: { value: data.scaleKm }, uRampKm: { value: rampKm } },
    shadeGlsl: TRANSITION_ZONE_SHADE_GLSL,
    renderOrder: SHELL_ORDER[id],
  });
  deep.setTexture(texture);
  const coast = new ProjectedCoast(outlines, radiusM, `transition-zone-${id}-coast`, SHELL_ORDER[id] + 0.005);

  const group = new THREE.Group();
  group.add(deep.object, coast.object);
  group.visible = false;
  context.earthRoot.add(group);

  // Named where the boundary passes under the user's feet.
  const labelAt = new THREE.Vector3();
  const place = (): void => {
    const position = context.getPosition();
    if (position) ecefAtDepth(position.lon, position.lat, boundary.meanKm, labelAt);
  };
  place();
  const labels = context.addLabels({
    rank: LABEL_KIND_ORDER.indexOf('country') - 1,
    style: { fontPx: 11, color: '#f2efe6', italic: true },
    frame: 'earth',
    labels: [{ text: boundaryLabelText(boundary), priority: 0, position: labelAt }],
  });

  return {
    setVisible(visible) {
      group.visible = visible;
      labels.setVisible(visible);
      context.setStatus(visible ? boundaryStatus(boundary) : null, 'info');
    },
    update: place,
    dispose() {
      labels.remove();
      group.removeFromParent();
      deep.dispose();
      coast.dispose();
      ramp.dispose();
      texture.dispose();
    },
  };
}
