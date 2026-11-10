import { MantleFlowLayer, flowGradient, type MantleFlowData } from '../../render/interior';
import { createLineLayer } from '../line-layer';
import type { LayerDefinition } from '../types';

/**
 * Thousands of arrows through the whole interior: a layer to study, not to
 * start with, so its file is fetched only when asked for. The id is the
 * one the always-loaded switch had, so a saved choice carries over.
 */
const mantleFlow: LayerDefinition = {
  id: 'mantle-flow',
  label: 'Mantle flow (model)',
  section: 'Inside the Earth',
  order: 5,
  legend: flowGradient(),
  caption: 'sinking · level · rising · 300, 1450, 2750 km · arrow = 5 Myr',
  credits: [
    {
      what: 'Mantle flow (model)',
      source: 'hc (Hager & O’Connell 1981) driven by SEMUCB-WM1 (French & Romanowicz 2014)',
      licence: 'model output',
      url: 'https://github.com/geodynamics/hc',
    },
  ],
  load: (context) => createLineLayer<MantleFlowData>(context, 'geo/mantle-flow.json', (data) => new MantleFlowLayer(data)),
};

export default mantleFlow;
