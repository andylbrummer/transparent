/**
 * A geophysical field draped on the surface: the crust's magnetic
 * anomaly, the geoid, the depth of the Moho, sediment thickness, measured
 * heat flow. Things the solid Earth has and the surface does not show.
 *
 * The images hold values, not colours (see fields.ts): the shader looks
 * each pixel's code up in the field's ramp - the legend's ramp - and
 * takes its strength from the field's own rule, so that where a field has
 * nothing to say (no anomaly, no sediment, no measurement) the map under
 * it shows through.
 */

import * as THREE from 'three';
import { ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { rampStrip } from '../weather/ramps';
import type { EarthField } from './fields';

const RAMP_TEXELS = 256;

/** The colouring of a field; exported for the test that it reads the code as fields.ts defines it. */
export function fieldShadeGlsl(field: EarthField): string {
  const low = field.ramp[0][0];
  const high = field.ramp[field.ramp.length - 1][0];
  const contour =
    field.contourEvery === undefined
      ? ''
      : `
    // A darker line where the value crosses a multiple of the interval, a pixel wide, fading where lines would crowd.
    float interval = ${field.contourEvery.toFixed(6)};
    float perPixel = max(fwidth(t), 1.0e-6);
    float offset = t - ${(128 / 255).toFixed(6)};
    float distancePx = abs(mod(offset + 0.5 * interval, interval) - 0.5 * interval) / perPixel;
    float line = (1.0 - smoothstep(0.5, 1.5, distancePx)) * smoothstep(3.0, 8.0, interval / perPixel);
    color *= 1.0 - 0.4 * line;
    alpha = max(alpha, 0.75 * line);`;
  return `
    float t = texel.r;
    float s = clamp((t * 255.0 - 128.0) / 127.0, -1.0, 1.0);
    vec3 color = texture2D(uRamp, vec2(clamp((t - ${low.toFixed(6)}) / ${(high - low).toFixed(6)}, 0.0, 1.0), 0.5)).rgb;
    float alpha = ${field.alphaGlsl};${contour}
    return vec4(color, alpha${field.coverage ? ' * smoothstep(0.35, 0.65, texel.g)' : ''});
`;
}

export async function createEarthFieldLayer(context: LayerContext, field: EarthField): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl(`geo/fields/${field.file}`));
  const ramp = new THREE.DataTexture(rampStrip(field.ramp, RAMP_TEXELS), RAMP_TEXELS, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const shell = new SurfaceShell(context.skyUniforms, {
    name: field.id,
    opacity: field.opacity,
    declarationsGlsl: 'uniform sampler2D uRamp;',
    uniforms: { uRamp: { value: ramp } },
    shadeGlsl: fieldShadeGlsl(field),
    // Over the other draped images (seafloor age, imagery overlays): this is the one just asked for.
    renderOrder: RENDER_ORDER.surfaceShell + 0.05,
  });
  shell.setTexture(texture);
  if (field.nearest) {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
  }
  context.earthRoot.add(shell.object);

  const labels = field.labels
    ? context.addLabels({
        // The field's own extremes: ahead of the country names.
        rank: LABEL_KIND_ORDER.indexOf('country') - 0.5,
        style: { fontPx: 11, color: '#ffffff', bold: true },
        frame: 'earth',
        labels: field.labels.map((label, priority) => ({
          text: label.text,
          priority,
          position: ecefAtAltitude(label.lon, label.lat, 0, new THREE.Vector3()),
        })),
      })
    : null;

  return {
    setVisible(visible) {
      shell.object.visible = visible;
      labels?.setVisible(visible);
    },
    dispose() {
      labels?.remove();
      shell.dispose();
      ramp.dispose();
    },
  };
}
