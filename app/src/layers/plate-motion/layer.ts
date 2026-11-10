import { OUTLINE_STYLES, OutlineLayer, type OutlineData } from '../../render/outlines';
import { createLineLayer } from '../line-layer';
import type { LayerDefinition } from '../types';

/**
 * Arrows over every ocean and continent: off by default, so its file is
 * fetched only when asked for. The id is the one the always-loaded switch
 * had, so a saved choice carries over.
 */
const plateMotion: LayerDefinition = {
  id: 'plate-motion',
  label: 'Plate motion',
  section: 'Surface lines',
  order: 30,
  legend: `#${OUTLINE_STYLES['plate-motion'].color.toString(16).padStart(6, '0')}`,
  caption: 'NNR-MORVEL56 · arrow = 3 Myr of travel',
  credits: [
    {
      what: 'Plate motion',
      source: 'Argus, Gordon & DeMets (2011), NNR-MORVEL56',
      licence: 'facts from the literature',
      url: 'https://doi.org/10.1029/2011GC003751',
    },
  ],
  load: (context) => createLineLayer<OutlineData>(context, 'geo/plate-motion.json', (data) => new OutlineLayer(data)),
};

export default plateMotion;
