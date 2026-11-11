/**
 * Caves with a known depth: a triangle per cave, coloured and sized by
 * depth, the caves half a kilometre deep and more named (see caves.ts).
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { caveLabelText, caveMarkers, namedCaves, type CaveData } from './caves';

const LABEL_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.31;

export async function createDeepCaveLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<CaveData>(context.assetUrl('geo/deep-caves.json'));
  const markers = new GeoMarkers('deep-caves', context.skyUniforms.uPixelRatio);
  markers.setMarkers(caveMarkers(data.caves));
  markers.object.visible = false;
  context.earthRoot.add(markers.object);
  const labels = context.addLabels({
    rank: LABEL_RANK,
    style: { fontPx: 11, color: '#ffd9c7', bold: true, offsetYPx: 12 },
    frame: 'earth',
    labels: namedCaves(data).map((row, i) => ({
      text: caveLabelText(row),
      priority: i,
      position: ecefAtAltitude(row[2], row[1], 0, new THREE.Vector3()),
    })),
  });
  labels.setVisible(false);

  return {
    setVisible(next) {
      markers.object.visible = next;
      labels.setVisible(next);
    },
    dispose() {
      labels.remove();
      markers.dispose();
    },
  };
}
