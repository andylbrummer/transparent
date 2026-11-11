/**
 * Major mineral deposits as coloured dots, a few well-known ones named
 * (see deposits.ts for what is in the file and what is not).
 */

import * as THREE from 'three';
import { GeoMarkers, ecefAtAltitude } from '../../render/geo-markers';
import { LABEL_KIND_ORDER } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { depositLabelText, depositMarkers, featuredRows, type DepositData } from './deposits';

const LABEL_RANK = LABEL_KIND_ORDER.indexOf('volcano') - 0.3;

export async function createMineralDepositLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<DepositData>(context.assetUrl('geo/mineral-deposits.json'));
  const featured = featuredRows(data);
  const markers = new GeoMarkers('mineral-deposits', context.skyUniforms.uPixelRatio);
  markers.setMarkers(depositMarkers(data.deposits, featured));
  markers.object.visible = false;
  context.earthRoot.add(markers.object);
  const labels = context.addLabels({
    rank: LABEL_RANK,
    style: { fontPx: 11, color: '#f4e6c4', bold: true, offsetYPx: 12 },
    frame: 'earth',
    labels: featured.map((row, i) => ({
      text: depositLabelText(row),
      priority: i,
      position: ecefAtAltitude(row[3], row[2], 0, new THREE.Vector3()),
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
