import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { LAYER_DEFINITIONS } from '../layers/registry';
import type { LabelData } from '../render/labels';
import { switchesWithLazyLayers, type LayerSwitch } from '../ui/layers-panel';
import { defaultPreset, LAYER_PRESETS } from '../ui/presets';
import { indexLabels } from '../view/targets';
import { DOWN, EXAMPLE_GUIDE } from './example-guide.testdata';
import type { Guide } from './format';
import { GUIDE_SCHEMA } from './guide-schema';
import { guideProblems, type GuideWorld } from './validate';

const isGuide = new Ajv2020().compile(GUIDE_SCHEMA);

const switches = switchesWithLazyLayers(LAYER_DEFINITIONS);
const readLabels = (name: string): LabelData => JSON.parse(new TextDecoder().decode(readFileSync(`public/geo/${name}`))) as LabelData;
/** The app as it ships: its switches, its presets and its baked labels. */
const world: GuideWorld = {
  switches,
  presets: [defaultPreset(switches), ...LAYER_PRESETS],
  labels: indexLabels([readLabels('labels.json'), readLabels('geology.json'), readLabels('quakes.json')]),
};

// Found in the app, not written here, so the tests follow the registry and the label files.
const groups = new Map<string, LayerSwitch[]>();
for (const layer of switches) if (layer.exclusiveGroup !== undefined) groups.set(layer.exclusiveGroup, [...(groups.get(layer.exclusiveGroup) ?? []), layer]);
const exclusive = [...groups.entries()].find(([, members]) => members.length >= 2);
const shared = [...world.labels.entries()].find(
  ([, places]) => places.length >= 2 && new Set(places.map((place) => place.kind)).size === places.length,
);

/** The example guide as plain JSON, to change one thing in. */
type Json = Record<string, unknown>;
const copy = (): Json => JSON.parse(JSON.stringify(EXAMPLE_GUIDE)) as Json;
const chapters = (g: Json): Json[] => g.chapters as Json[];
const scene = (g: Json): Json => chapters(g)[0].scene as Json;
const steps = (g: Json): Json[] => chapters(g)[0].steps as Json[];
const cues = (g: Json, step = 0): Json[] => steps(g)[step].cues as Json[];

/** The problems in a guide that passes the schema, which is what guideProblems is given. */
function problemsIn(g: Json): ReturnType<typeof guideProblems> {
  expect(isGuide(g), JSON.stringify(isGuide.errors)).toBe(true);
  return guideProblems(g as unknown as Guide, world);
}

const STEP = '/chapters/0/steps/0';

describe('guideProblems', () => {
  it('finds the real exclusive group and shared label name the tests use', () => {
    expect(exclusive, 'no exclusive group in the registry has two switches').toBeDefined();
    expect(shared, 'no label name in the baked files names places of different kinds').toBeDefined();
  });

  it('finds nothing wrong with the example guide, which passes the schema', () => {
    expect(problemsIn(copy())).toEqual([]);
  });

  it.each<[string, (g: Json) => void, string, string]>([
    [
      'a chapter id used twice',
      (g) => (g.chapters = [...chapters(g), { ...chapters(g)[0] }]),
      '/chapters/1/id',
      'chapter id the-way-down is used twice',
    ],
    ['a step id used twice in a chapter', (g) => (steps(g)[1].id = 'look-down'), `/chapters/0/steps/1/id`, 'step id look-down is used twice in chapter the-way-down'],
    [
      'an unknown preset in a scene',
      (g) => (chapters(g)[0].scene = { preset: 'nowhere', look: scene(g).look }),
      '/chapters/0/scene/preset',
      'no preset nowhere',
    ],
    ['an unknown preset in a cue', (g) => (cues(g, 1)[0] = { at: 0, do: 'preset', id: 'nowhere' }), '/chapters/0/steps/1/cues/0/id', 'no preset nowhere'],
    ['an unknown switch in a scene', (g) => ((scene(g).layers as string[])[1] = 'nothing'), '/chapters/0/scene/layers/1', 'no layer switch nothing'],
    ['an unknown switch turned on', (g) => (cues(g, 1)[2] = { at: 3, do: 'layers', on: ['nothing'] }), '/chapters/0/steps/1/cues/2/on/0', 'no layer switch nothing'],
    ['an unknown switch turned off', (g) => (cues(g, 1)[1] = { at: 0, do: 'layers', off: ['political', 'nothing'] }), '/chapters/0/steps/1/cues/1/off/1', 'no layer switch nothing'],
    [
      'two of an exclusive group in a scene',
      (g) => (scene(g).layers = [...(scene(g).layers as string[]), exclusive![1][0].id, exclusive![1][1].id]),
      '/chapters/0/scene/layers/5',
      `${exclusive![1][1].id} and ${exclusive![1][0].id} are both on, and only one of ${exclusive![0]} can be`,
    ],
    [
      'two of an exclusive group turned on together',
      (g) => (cues(g, 1)[2] = { at: 3, do: 'layers', on: [exclusive![1][0].id, exclusive![1][1].id] }),
      '/chapters/0/steps/1/cues/2/on/1',
      `${exclusive![1][1].id} and ${exclusive![1][0].id} are both on, and only one of ${exclusive![0]} can be`,
    ],
    [
      'a switch turned on and off at once',
      (g) => (cues(g, 1)[1] = { at: 0, do: 'layers', on: ['political'], off: ['political'] }),
      '/chapters/0/steps/1/cues/1/on/0',
      'political is turned both on and off',
    ],
    [
      'an unknown label in a look',
      (g) => (cues(g, 2)[1] = { at: 2, do: 'look', target: { kind: 'label', name: 'Atlantis' } }),
      '/chapters/0/steps/2/cues/1/target',
      'no label named Atlantis',
    ],
    [
      'a label naming places of more than one kind',
      (g) => (cues(g, 2)[1] = { at: 2, do: 'look', target: { kind: 'label', name: shared![0] } }),
      '/chapters/0/steps/2/cues/1/target',
      `label ${shared![0]} names ${shared![1].length} places: ${shared![1].map((place) => place.kind).join(', ')}`,
    ],
    [
      'an unknown label in a mark',
      (g) => (cues(g)[1] = { at: 6, do: 'mark', target: { kind: 'label', name: 'Atlantis' }, text: 'Here' }),
      `${STEP}/cues/1/target`,
      'no label named Atlantis',
    ],
    [
      "an unknown label in a scene's look",
      (g) => (scene(g).look = { target: { kind: 'label', name: 'Atlantis' }, fovDeg: 60 }),
      '/chapters/0/scene/look/target',
      'no label named Atlantis',
    ],
    ['a cue before the one ahead of it', (g) => (cues(g, 1)[3].at = 2), '/chapters/0/steps/1/cues/3/at', 'cue at 2 comes after one at 3'],
    [
      'a step that waits for the gaze with nothing to look at',
      (g) => (cues(g).splice(0, 1), (cues(g)[0].at = 0)),
      `${STEP}/advance`,
      'advance is gaze but the step has no look cue to wait for',
    ],
  ])('reports %s', (_, change, path, reason) => {
    const g = copy();
    change(g);
    expect(problemsIn(g)).toEqual([{ path, reason }]);
  });

  it.each<[string, (g: Json) => void]>([
    ['the same step id in two chapters', (g) => (g.chapters = [...chapters(g), { ...chapters(g)[0], id: 'again' }])],
    ['the default preset in a scene', (g) => (chapters(g)[0].scene = { preset: 'default', look: scene(g).look })],
    ['a real preset in a cue', (g) => (cues(g, 1)[0] = { at: 0, do: 'preset', id: LAYER_PRESETS[0].id })],
    ['a shared label name told apart by its kind', (g) => (cues(g, 2)[1] = { at: 2, do: 'look', target: { kind: 'label', name: shared![0], labelKind: shared![1][0].kind } })],
    ['two cues at the same time', (g) => (cues(g, 1)[3].at = 3)],
    ['a gaze step with a look', (g) => (steps(g)[1].advance = 'gaze', cues(g, 1).push({ at: 30, do: 'look', target: DOWN }))],
  ])('allows %s', (_, change) => {
    const g = copy();
    change(g);
    expect(problemsIn(g)).toEqual([]);
  });

  it('reports every problem, in the order of the file', () => {
    const g = copy();
    steps(g)[1].id = 'look-down';
    cues(g, 1)[2] = { at: 3, do: 'layers', on: ['nothing'] };
    cues(g, 2)[1] = { at: 2, do: 'look', target: { kind: 'label', name: 'Atlantis' } };
    expect(problemsIn(g)).toEqual([
      { path: '/chapters/0/steps/1/id', reason: 'step id look-down is used twice in chapter the-way-down' },
      { path: '/chapters/0/steps/1/cues/2/on/0', reason: 'no layer switch nothing' },
      { path: '/chapters/0/steps/2/cues/1/target', reason: 'no label named Atlantis' },
    ]);
  });
});
