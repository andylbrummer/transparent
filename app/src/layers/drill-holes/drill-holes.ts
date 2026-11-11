/**
 * Scientific ocean drilling: a dot per cored hole, a ring and a name for
 * the holes reopened cruise after cruise (see holes.ts).
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { holeLabelText, holeMarkers, revisitedHoles, type HoleData } from './holes';

const LABEL_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.32;

export async function createDrillHoleLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<HoleData>(context.assetUrl('geo/drill-holes.json'));
  const markers = new GeoMarkers('drill-holes', context.skyUniforms.uPixelRatio);
  markers.setMarkers(holeMarkers(data.holes));
  markers.object.visible = false;
  context.earthRoot.add(markers.object);
  const labels = context.addLabels({
    rank: LABEL_RANK,
    style: { fontPx: 11, color: '#d6efff', bold: true, offsetYPx: 12 },
    frame: 'earth',
    labels: revisitedHoles(data).map((row, i) => ({
      text: holeLabelText(row),
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
