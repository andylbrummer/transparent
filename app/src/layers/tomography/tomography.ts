/**
 * Seismic tomography: a depth slice of the mantle, coloured by how fast
 * shear waves travel there compared with the average for that depth. Slow
 * rock is, mostly, hot rock and fast rock cold: the slices show the keels
 * of the old continents, slabs on their way down, and the two great slow
 * provinces on the core under Africa and the Pacific.
 *
 * The images (app/public/geo/tomography/, from
 * tools/pipeline/generate_tomography.py) hold the anomaly itself, not
 * colours: grey 128 is zero and 1 and 255 are ∓ the shell's range. The
 * shader colours them by DVS_RAMP, the legend's ramp, and leaves small
 * anomalies clear, so both sides of the glass ball can be read at once.
 *
 * A bare coloured ball inside the Earth says nothing about where its
 * blobs are, so the coastlines are projected straight down onto it
 * (render/projected-coast.ts).
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DeepShell } from '../../render/deep-shell';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { type OutlineData } from '../../render/outlines';
import { ProjectedCoast } from '../../render/projected-coast';
import type { LayerContext, LayerInstance } from '../types';
import { rampStrip } from '../weather/ramps';
import { DVS_CLEAR_BELOW, DVS_FULL_FROM, DVS_RAMP, type TomographyShell } from './shells';

const RAMP_TEXELS = 128;
const SHELL_ORDER = RENDER_ORDER.outlines + 0.5;

/** The colouring; exported for the test that it decodes what the bake wrote. */
export const TOMOGRAPHY_SHADE_GLSL = `
    // Grey 128 is no anomaly; 1 and 255 are the ends of the scale.
    float v = clamp((texel.r * 255.0 - 128.0) / 127.0, -1.0, 1.0);
    vec3 color = texture2D(uRamp, vec2(v * 0.5 + 0.5, 0.5)).rgb;
    float strength = smoothstep(${DVS_CLEAR_BELOW.toFixed(2)}, ${DVS_FULL_FROM.toFixed(2)}, abs(v));
    return vec4(color, 0.86 * strength);
`;

/** "2,850 km · shear-wave speed (model)". */
export function shellLabelText(shell: TomographyShell): string {
  return `${shell.depthKm.toLocaleString('en-US')} km · shear-wave speed (model)`;
}

export async function createTomographyLayer(context: LayerContext, shell: TomographyShell): Promise<LayerInstance> {
  const radiusM = EARTH_RADIUS_M - shell.depthKm * 1000;
  const [texture, outlines] = await Promise.all([
    new THREE.TextureLoader().loadAsync(context.assetUrl(`geo/tomography/dvs-${shell.depthKm}.png`)),
    context.fetchJson<OutlineData>(context.assetUrl('geo/outlines.json')),
  ]);

  const ramp = new THREE.DataTexture(rampStrip(DVS_RAMP, RAMP_TEXELS), RAMP_TEXELS, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const deep = new DeepShell({
    name: `tomography-${shell.depthKm}`,
    radiusM,
    declarationsGlsl: 'uniform sampler2D uRamp;',
    uniforms: { uRamp: { value: ramp } },
    shadeGlsl: TOMOGRAPHY_SHADE_GLSL,
    renderOrder: SHELL_ORDER,
  });
  deep.setTexture(texture);

  const coast = new ProjectedCoast(outlines, radiusM, `tomography-${shell.depthKm}-coast`, SHELL_ORDER + 0.05);

  const group = new THREE.Group();
  group.add(deep.object, coast.object);
  context.earthRoot.add(group);

  // Named where the slice passes under the user's feet.
  const labelAt = new THREE.Vector3();
  const place = (): void => {
    const position = context.getPosition();
    if (position) ecefAtDepth(position.lon, position.lat, shell.depthKm, labelAt);
  };
  place();
  const labels = context.addLabels({
    // One line, and the only thing that says what the ball is: ahead of the country names.
    rank: LABEL_KIND_ORDER.indexOf('country') - 1,
    style: { fontPx: 11, color: '#f2efe6', italic: true },
    frame: 'earth',
    labels: [{ text: shellLabelText(shell), priority: 0, position: labelAt }],
  });

  return {
    setVisible(visible) {
      group.visible = visible;
      labels.setVisible(visible);
    },
    update: place,
    dispose() {
      labels.remove();
      group.removeFromParent();
      deep.dispose();
      coast.dispose();
      ramp.dispose();
    },
  };
}
