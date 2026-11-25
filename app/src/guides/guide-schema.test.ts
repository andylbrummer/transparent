import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import type { Credit } from '../layers/types';
import type { ViewAction } from '../view/actions';
import { DOWN, EXAMPLE_GUIDE as guide } from './example-guide.testdata';
import { GUIDE_FORMAT_VERSION, type Cue, type Guide } from './format';
import { GUIDE_SCHEMA, guideSchemaText } from './guide-schema';

const isGuide = new Ajv2020().compile(GUIDE_SCHEMA);

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
const HOTSPOT = `${STEP}/hotspots/0`;

const CREDIT = { what: 'Diagram', source: 'USGS', licence: 'public domain', url: 'https://www.usgs.gov/' };
const IMAGE_CLIP: Json = { kind: 'image', src: 'images/prem.webp', alt: 'The layers', caption: 'Seismic waves bend.', credit: CREDIT };
const AUDIO_CLIP: Json = { kind: 'audio', src: 'audio/prem.m4a', captions: 'audio/prem.vtt', credit: CREDIT };
const SHA256 = 'a1b2c3d4'.padEnd(64, '5');
const VIDEO_CLIP: Json = {
  kind: 'video',
  src: 'https://media.transparent.sbdev.io/guides/down-through-the-earth/prem.a1b2c3d4.mp4',
  captions: 'video/prem.vtt',
  poster: 'images/prem-poster.webp',
  video: { bytes: 18234567, sha256: SHA256, durationS: 94, width: 1280, height: 720 },
  credit: CREDIT,
};
const videoWith = (video: Json): Json => hotspot({ ...VIDEO_CLIP, video: { ...(VIDEO_CLIP.video as Json), ...video } });
/** A hotspot straight down with `clip`; JSON drops a field set to undefined, as the cases use to take one out. */
const hotspot = (clip: Json): Json => JSON.parse(JSON.stringify({ id: 'prem', title: 'How we know', anchor: DOWN, clip })) as Json;

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
    chapter(preset).scene = { preset: 'sky', look: { target: DOWN, fovDeg: 60 } };
    expect(isGuide(preset), JSON.stringify(isGuide.errors)).toBe(true);
  });

  it('takes a scene that says when it is, and a cue that runs the clock', () => {
    const g = copy();
    (chapter(g).scene as Json).time = { to: '2011-03-11T05:46:24Z' };
    (step(g).cues as Json[]).push({ at: 9, do: 'time', to: '2011-03-11T05:46:24+09:00', rate: 3600, until: '2011-03-12T05:46:24.5Z' });
    (step(g).cues as Json[]).push({ at: 9, do: 'time', to: 'now' });
    expect(isGuide(g), JSON.stringify(isGuide.errors)).toBe(true);
  });

  it('takes a scene that says where it stands, and a cue that moves it', () => {
    const g = copy();
    (chapter(g).scene as Json).place = { kind: 'at', lat: 90, lon: 0, name: 'North Pole' };
    (step(g).cues as Json[]).push({ at: 9, do: 'stand', place: { kind: 'antipode' } });
    expect(isGuide(g), JSON.stringify(isGuide.errors)).toBe(true);
  });

  it('takes hotspots with an image, an audio or a video clip, on a switch or not, and cues that play and stop them', () => {
    const g = copy();
    step(g).hotspots = [hotspot(IMAGE_CLIP), { ...hotspot(AUDIO_CLIP), id: 'listen', layer: 'shell-core' }, { ...hotspot(VIDEO_CLIP), id: 'watch' }];
    (step(g).cues as Json[]).push({ at: 30, do: 'clip', hotspot: 'prem' }, { at: 40, do: 'clip', hotspot: null });
    expect(isGuide(g), JSON.stringify(isGuide.errors)).toBe(true);
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
    ['a stand with no place', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'stand' })],
    ['a scene standing off the globe', `${SCENE}`, (g) => ((chapter(g).scene as Json).place = { kind: 'at', lat: 0, lon: 200, name: 'Nowhere' })],
    ['a time with no instant', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'time' })],
    ['a time at an instant with no offset', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'time', to: '2011-03-11T05:46' })],
    ['a time faster than a year a second', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'time', to: 'now', rate: 4e7, until: '2030-01-01T00:00Z' })],
    ['a scene time with no instant', SCENE, (g) => ((chapter(g).scene as Json).time = { rate: 1 })],
    ['a clip naming no hotspot', CUE, (g) => ((step(g).cues as Json[])[0] = { at: 0, do: 'clip' })],
    ['an unknown way to advance', `${STEP}/advance`, (g) => (step(g).advance = 'timer')],
    ['no chapters', '/chapters', (g) => (g.chapters = [])],
    ['no steps', '/chapters/0/steps', (g) => (chapter(g).steps = [])],
    ['no credits', '/credits', (g) => (g.credits = [])],
    ['no authors', '/authors', (g) => (g.authors = [])],
    ['an unknown topic', '/topics/0', (g) => (g.topics = ['cooking'])],
    ['a credit over plain http', '/credits/0/url', (g) => ((g.credits as Json[])[0].url = 'http://example.org')],
    ['a sponsor', '', (g) => (g.sponsor = null)],
    ['an empty list of hotspots', `${STEP}/hotspots`, (g) => (step(g).hotspots = [])],
    ['a hotspot with no clip', `${HOTSPOT}`, (g) => (step(g).hotspots = [{ ...hotspot(IMAGE_CLIP), clip: undefined }])],
    ['an image with no alt text', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...IMAGE_CLIP, alt: undefined })])],
    ['an image with no caption', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...IMAGE_CLIP, caption: undefined })])],
    ['an image that is a PNG', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...IMAGE_CLIP, src: 'images/x.png' })])],
    ['an audio clip with no captions', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...AUDIO_CLIP, captions: undefined })])],
    ['a clip with no credit', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...AUDIO_CLIP, credit: undefined })])],
    ['a video with no poster', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...VIDEO_CLIP, poster: undefined })])],
    ['a video with no captions', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...VIDEO_CLIP, captions: undefined })])],
    ['a video with nothing declared', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [hotspot({ ...VIDEO_CLIP, video: undefined })])],
    [
      'a video in the guide folder',
      `${HOTSPOT}/clip`,
      (g) => (step(g).hotspots = [hotspot({ ...VIDEO_CLIP, src: 'video/prem.a1b2c3d4.mp4' })]),
    ],
    [
      'a video on another host',
      `${HOTSPOT}/clip`,
      (g) => (step(g).hotspots = [hotspot({ ...VIDEO_CLIP, src: 'https://media.transparentXsbdev.io/media/prem.a1b2c3d4.mp4' })]),
    ],
    [
      'a video not named by its hash',
      `${HOTSPOT}/clip`,
      (g) => (step(g).hotspots = [hotspot({ ...VIDEO_CLIP, src: 'https://media.transparent.sbdev.io/media/prem.mp4' })]),
    ],
    ['a video over 200 MiB', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [videoWith({ bytes: 200 * 1024 * 1024 + 1 })])],
    ['a video wider than 1080p', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [videoWith({ width: 2560, height: 1440 })])],
    ['a video hash that is not one', `${HOTSPOT}/clip`, (g) => (step(g).hotspots = [videoWith({ sha256: 'A1B2' })])],
    ['a hotspot title too long for a marker', `${HOTSPOT}/title`, (g) => (step(g).hotspots = [{ ...hotspot(IMAGE_CLIP), title: 'x'.repeat(61) }])],
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
