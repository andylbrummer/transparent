/**
 * The inner core, as seismology sees it: the ball of the inner core
 * (its rim only) with 5,129 rays through it, each coloured by how early
 * its wave arrived, and the Earth's axis through the middle. Rays near the
 * axis are blue: waves cross the inner core faster along the axis than
 * across it. See rays.ts.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DeepShell } from '../../render/deep-shell';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';
import { decodeRays, medianResidual, raySegments, type InnerCoreData } from './rays';

// Under everything else in the mantle and core: it is the deepest thing there is.
const ORDER = RENDER_ORDER.outlines + 0.4;

export async function createInnerCoreLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<InnerCoreData>(context.assetUrl('geo/inner-core.json'));
  const rays = decodeRays(data);
  const radiusM = data.innerCoreRadiusKm * 1000;

  // The ball: clear inside, so only its rim shows and the rays read through it.
  const ball = new DeepShell({
    name: 'inner-core-ball',
    radiusM,
    shadeGlsl: 'return vec4(0.0);',
    rimColor: 0xffd27a,
    rimOpacity: 0.7,
    renderOrder: ORDER,
  });

  const segments = raySegments(rays, data.innerCoreRadiusKm, EARTH_RADIUS_M / 1000);
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(segments.positions);
  geometry.setColors(segments.colors);
  const material = new LineMaterial({ vertexColors: true, linewidth: 1, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
  const lines = new LineSegments2(geometry, material);
  lines.name = 'inner-core-rays';
  lines.frustumCulled = false;
  lines.renderOrder = ORDER + 0.01;

  const group = new THREE.Group();
  group.name = 'inner-core';
  group.add(ball.object, lines);
  group.visible = false;
  context.earthRoot.add(group);

  const depthKm = EARTH_RADIUS_M / 1000 - data.innerCoreRadiusKm;
  const labels = context.addLabels({
    rank: LABEL_KIND_ORDER.indexOf('deep') - 0.3,
    style: { fontPx: 11, color: '#ffe2a8', italic: true, bold: true },
    frame: 'earth',
    labels: [
      { text: 'inner core · 1,221 km radius', priority: 0, position: ecefAtDepth(0, 0, depthKm, new THREE.Vector3()) },
      { text: 'north pole of the axis', priority: 1, position: ecefAtDepth(0, 90, depthKm, new THREE.Vector3()) },
    ],
  });
  const polar = medianResidual(rays, 0, 35);
  const equatorial = medianResidual(rays, 55, 91);
  const status = `${rays.length.toLocaleString('en')} rays · near the axis ${polar >= 0 ? '+' : ''}${polar.toFixed(1)} s early, along the equator ${equatorial >= 0 ? '+' : ''}${equatorial.toFixed(1)} s`;

  return {
    setVisible(visible) {
      group.visible = visible;
      labels.setVisible(visible);
      if (visible) context.setStatus(status, 'info');
      else context.setStatus(null);
    },
    setResolution(widthCss, heightCss) {
      material.resolution.set(widthCss, heightCss);
    },
    dispose() {
      labels.remove();
      group.removeFromParent();
      ball.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
