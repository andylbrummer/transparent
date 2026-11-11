import { HASTEROK_CREDIT } from '../geologic-provinces/layer';
import type { LayerDefinition } from '../types';
import { CRATON_LEGEND } from './classes';

const cratons: LayerDefinition = {
  id: 'cratons',
  label: 'Cratons: the oldest crust (Archean)',
  section: 'Surface',
  order: 65,
  legend: CRATON_LEGEND,
  caption:
    'crust with Archean basement, over 2.5 billion years old: the ancient cores of the continents · ' +
    'left to right: craton, shield, other province, then the same faint where later mountain-building reworked it · ' +
    'where the source has rock samples or knows of Archean basement; the craton groups are named',
  credits: [HASTEROK_CREDIT],
  load: async (context) => (await import('./cratons')).createCratonsLayer(context),
};

export default cratons;
