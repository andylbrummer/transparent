import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import type { Credit } from '../layers/types';
import type { ViewAction } from '../view/actions';
import type { Cue, Guide } from './format';
import { GUIDE_FORMAT_VERSION, GUIDE_SCHEMA, guideSchemaText } from './guide-schema';

const isGuide = new Ajv2020().compile(GUIDE_SCHEMA);

const down = { kind: 'horizon', azDeg: 0, altDeg: -90 } as const;

/** spec/guides.md §3.2, less what phase 1 does not play: the sponsor, the hotspot, the scene's place and time. */
const guide: Guide = {
  formatVersion: 1,
  id: 'down-through-the-earth',
  title: 'Down through the Earth',
  summary: 'From the ground under your feet to the inner core, 6,371 km straight down.',
  language: 'en',
  topics: ['geology'],
  authors: [{ name: 'Transparent Earth' }],
  licence: 'CC BY 4.0',
  credits: [
    {
      what: 'Script and narration',
      source: 'Transparent Earth contributors',
      licence: 'CC BY 4.0',
      url: 'https://github.com/andylbrummer/transparent',
    },
  ],
  chapters: [
    {
      id: 'the-way-down',
      title: 'The way down',
      scene: {
        layers: ['globe-surface', 'political', 'place-labels', 'depth-ladder'],
        look: { target: down, fovDeg: 60 },
      },
      steps: [
        {
          id: 'look-down',
          narration: { audio: 'audio/01-look-down.m4a', captions: 'audio/01-look-down.vtt' },
          cues: [
            { at: 0, do: 'look', target: down },
            { at: 6, do: 'mark', target: down, text: 'The far side · 12,742 km' },
          ],
          advance: 'gaze',
        },
        {
          id: 'shells',
          narration: { audio: 'audio/02-shells.m4a', captions: 'audio/02-shells.vtt' },
          cues: [
            { at: 0, do: 'mark', target: down, text: null },
            { at: 0, do: 'layers', off: ['political', 'place-labels'] },
            { at: 3, do: 'layers', on: ['shell-moho'] },
            { at: 11, do: 'layers', on: ['shell-670'] },
            { at: 19, do: 'layers', on: ['shell-core'] },
            { at: 27, do: 'layers', on: ['shell-inner-core', 'inner-core'] },
          ],
          advance: 'auto',
        },
        {
          id: 'the-deep-mantle',
          narration: { audio: 'audio/03-deep-mantle.m4a', captions: 'audio/03-deep-mantle.vtt' },
          cues: [
            { at: 0, do: 'layers', on: ['deep-labels', 'tomography-slow-bodies'], off: ['globe-surface'] },
            { at: 2, do: 'look', target: { kind: 'label', name: 'Tuzo (African LLSVP)' } },
          ],
          advance: 'gaze',
        },
      ],
    },
  ],
};

/** The guide as plain JSON, to change one thing in. */
type Json = Record<string, unknown>;
const copy = (): Json => JSON.parse(JSON.stringify(guide)) as Json;
const chapter = (g: Json): Json => (g.chapters as Json[])[0];
const step = (g: Json, i = 0): Json => (chapter(g).steps as Json[])[i];
const cue = (g: Json): Json => (step(g).cues as Json[])[0];

/** Whether ajv refuses `g` with an error at `path` or under it. */
function refusedAt(g: Json, path: string): boolean {
  if (isGuide(g)) return false;
  return isGuide.errors!.some((error) => error.instancePath === path || error.instancePath.startsWith(`${path}/`));
}

const STEP = '/chapters/0/steps/0';
const CUE = `${STEP}/cues/0`;
const SCENE = '/chapters/0/scene';

describe('the guide schema', () => {
  it('is what guide.schema.json holds', () => {
    const written = new TextDecoder().decode(readFileSync('public/guides/guide.schema.json'));
    expect(written === guideSchemaText(), 'guide.schema.json is out of date: run npm run guides:schema').toBe(true);
  });

  it('compiles under strict mode', () => {
    expect(() => new Ajv2020().compile(GUIDE_SCHEMA)).not.toThrow();
  });

  it('asks for the format version this app plays', () => {
    expect(GUIDE_SCHEMA.properties.formatVersion.const).toBe(GUIDE_FORMAT_VERSION);
  });

  it('takes a guide, with its $schema, a silent step and a preset scene', () => {
    expect(isGuide(guide), JSON.stringify(isGuide.errors)).toBe(true);
    expect(isGuide({ $schema: '../guide.schema.json', ...guide })).toBe(true);
    const silent = copy();
    delete step(silent).narration;
    step(silent).silenceS = 4;
    expect(isGuide(silent), JSON.stringify(isGuide.errors)).toBe(true);
    const preset = copy();
    chapter(preset).scene = { preset: 'sky', look: { target: down, fovDeg: 60 } };
    expect(isGuide(preset), JSON.stringify(isGuide.errors)).toBe(true);
  });

  it.each<[string, string, (g: Json) => void]>([
    ['an unknown field in the guide', '', (g) => (g.speed = 2)],
    ['an unknown field in a chapter', '/chapters/0', (g) => (chapter(g).speed = 2)],
    ['an unknown field in a step', STEP, (g) => (step(g).speed = 2)],
    ['an unknown field in a cue', CUE, (g) => (cue(g).speed = 2)],
    ['an unknown field in a scene', SCENE, (g) => ((chapter(g).scene as Json).speed = 2)],
    ['another format version', '/formatVersion', (g) => (g.formatVersion = 2)],
    ['a guide id with capitals', '/id', (g) => (g.id = 'Moho')],
    ['a chapter id with an underscore', '/chapters/0/id', (g) => (chapter(g).id = 'a_b')],
    ['an empty step id', `${STEP}/id`, (g) => (step(g).id = '')],
    ['a step with both narration and silence', STEP, (g) => (step(g).silenceS = 4)],
    ['a step with neither narration nor silence', STEP, (g) => delete step(g).narration],
    [
      'a silence of no time',
      `${STEP}/silenceS`,
      (g) => {
        delete step(g).narration;
        step(g).silenceS = 0;
      },
    ],
    ['narration without captions', `${STEP}/narration`, (g) => delete (step(g).narration as Json).captions],
    ['audio up out of the folder', `${STEP}/narration/audio`, (g) => ((step(g).narration as Json).audio = '../x.m4a')],
    ['audio from the root', `${STEP}/narration/audio`, (g) => ((step(g).narration as Json).audio = '/x.m4a')],
    ['audio from a URL', `${STEP}/narration/audio`, (g) => ((step(g).narration as Json).audio = 'https://x/y.m4a')],
    ['audio that is not .m4a', `${STEP}/narration/audio`, (g) => ((step(g).narration as Json).audio = 'audio/x.mp3')],
    ['a scene with both a preset and layers', SCENE, (g) => ((chapter(g).scene as Json).preset = 'sky')],
    ['a scene with neither a preset nor layers', SCENE, (g) => delete (chapter(g).scene as Json).layers],
    ['a scene look with no field of view', `${SCENE}/look`, (g) => delete ((chapter(g).scene as Json).look as Json).fovDeg],
    ['a cue with no time', CUE, (g) => delete cue(g).at],
    ['a cue before its step', `${CUE}/at`, (g) => (cue(g).at = -1)],
    ['a field of view too narrow without a target', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'fov', fovDeg: 29 })],
    ['an empty mark', `${STEP}/cues/1/text`, (g) => ((step(g).cues as Json[])[1].text = '')],
    ['layers naming no switch', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'layers' })],
    ['an unknown action', `${CUE}/do`, (g) => (cue(g).do = 'spin')],
    ['a stand, not yet played', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'stand' })],
    ['a time, not yet played', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'time' })],
    ['a clip, not yet played', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'clip' })],
    ['an unknown way to advance', `${STEP}/advance`, (g) => (step(g).advance = 'timer')],
    ['no chapters', '/chapters', (g) => (g.chapters = [])],
    ['no steps', '/chapters/0/steps', (g) => (chapter(g).steps = [])],
    ['no credits', '/credits', (g) => (g.credits = [])],
    ['no authors', '/authors', (g) => (g.authors = [])],
    ['an unknown topic', '/topics/0', (g) => (g.topics = ['cooking'])],
    ['a credit over plain http', '/credits/0/url', (g) => ((g.credits as Json[])[0].url = 'http://example.org')],
    ['a sponsor', '', (g) => (g.sponsor = null)],
    ['a hotspot', STEP, (g) => (step(g).hotspots = [])],
  ])('refuses %s', (_, path, change) => {
    const g = copy();
    change(g);
    expect(refusedAt(g, path), JSON.stringify(isGuide.errors)).toBe(true);
  });

  it('derives a cue as an action with its time, and credits as the app has them', () => {
    expectTypeOf<Cue>().toMatchTypeOf<ViewAction & { readonly at: number }>();
    expectTypeOf<ViewAction & { readonly at: number }>().toMatchTypeOf<Cue>();
    expectTypeOf<Guide['credits'][number]>().toMatchTypeOf<Credit>();
  });
});
