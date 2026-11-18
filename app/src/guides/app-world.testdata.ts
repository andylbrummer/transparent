/**
 * What the app knows that a guide refers to, as it ships, for the tests:
 * the registry's switches, the presets and the baked label files read from
 * app/public/geo. Nothing is mocked, so a guide is checked against the app.
 */

import { readFileSync } from 'node:fs';
import { LAYER_DEFINITIONS } from '../layers/registry';
import type { LabelData } from '../render/labels';
import { switchesWithLazyLayers } from '../ui/layers-panel';
import { defaultPreset, LAYER_PRESETS } from '../ui/presets';
import { indexLabels } from '../view/targets';
import type { GuideWorld } from './validate';

const switches = switchesWithLazyLayers(LAYER_DEFINITIONS);
const readLabels = (name: string): LabelData => JSON.parse(new TextDecoder().decode(readFileSync(`public/geo/${name}`))) as LabelData;

export const APP_WORLD: GuideWorld = {
  switches,
  presets: [defaultPreset(switches), ...LAYER_PRESETS],
  labels: indexLabels([readLabels('labels.json'), readLabels('geology.json'), readLabels('quakes.json')]),
};
