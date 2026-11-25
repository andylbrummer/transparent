import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guidesProblems, mediaProblems, type GuidesProblem } from '../../scripts/guide-folder';
import { APP_WORLD } from './app-world.testdata';
import { EXAMPLE_GUIDE } from './example-guide.testdata';
import { readFixture, withDuration, withObjectType } from './m4a.testdata';

const ID = EXAMPLE_GUIDE.id;
const GUIDE_FILE = `${ID}/guide.json`;
const MIB = 1024 * 1024;
/**
 * The example's narration: tone-mono, its header saying a minute, since the
 * example's cues run to 27 s and the tone lasts 2.
 */
const NARRATION_S = 60;
const narration = (bytes: Uint8Array = readFixture('tone-mono'), seconds = NARRATION_S): Uint8Array => withDuration(bytes, seconds);

/** A WebVTT file of these cues: [start, end, ...lines], times as written in the file. */
const vtt = (...cues: [start: string, end: string, ...lines: string[]][]): string =>
  ['WEBVTT', ...cues.map(([start, end, ...lines]) => `\n${start} --> ${end}\n${lines.join('\n')}`)].join('\n') + '\n';
/** Each step's captions: well within the minute, two cues adjoining and a 2 s gap before the third. */
const CAPTIONS = vtt(
  ['00:00.000', '00:02.500', 'Look down, through your feet,', 'to the far side of the Earth.'],
  ['00:02.500', '00:05.000', 'It is 12,742 km away.'],
  ['00:07.000', '00:09.000', 'Nothing in between is empty.'],
);

let root: string;
const at = (...parts: string[]): string => join(root, ...parts);
const writeGuide = (guide: unknown): void => writeFileSync(at(ID, 'guide.json'), JSON.stringify(guide));
/** Good captions of `bytes` in all, a note to fill them. Not sparse: the checks read captions. */
const writeCaptionsSized = (path: string, bytes: number): void => {
  const head = `${CAPTIONS}\nNOTE `;
  writeFileSync(path, head + 'x'.repeat(bytes - head.length));
};
/** A narration of `bytes` in all: the file and then a free box to fill it, left sparse. */
const writeNarrationSized = (path: string, seconds: number, bytes: number): void => {
  const audio = narration(undefined, seconds);
  const free = new Uint8Array(8);
  new DataView(free.buffer).setUint32(0, bytes - audio.length);
  free.set(new TextEncoder().encode('free'), 4);
  writeFileSync(path, new Uint8Array([...audio, ...free]));
  truncateSync(path, bytes);
};
const problems = (): GuidesProblem[] => guidesProblems(root, APP_WORLD);
/** The example guide as plain JSON, to change one thing in. */
const guideJson = (): Record<string, unknown> => JSON.parse(JSON.stringify(EXAMPLE_GUIDE)) as Record<string, unknown>;

/** A guides folder holding the example guide, each narration a real .m4a with good captions. */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'guides-'));
  writeFileSync(at('index.json'), JSON.stringify([ID]));
  mkdirSync(at(ID, 'audio'), { recursive: true });
  writeGuide(EXAMPLE_GUIDE);
  for (const chapter of EXAMPLE_GUIDE.chapters) {
    for (const step of chapter.steps) {
      if (!('narration' in step)) continue;
      writeFileSync(at(ID, step.narration.audio), narration());
      writeFileSync(at(ID, step.narration.captions), CAPTIONS);
    }
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('guidesProblems', () => {
  it('finds nothing wrong with a good guide, or with no guides', () => {
    expect(problems()).toEqual([]);
    rmSync(at(ID), { recursive: true });
    writeFileSync(at('index.json'), '[]');
    expect(problems()).toEqual([]);
  });

  it.each<[string, () => void, GuidesProblem]>([
    ['no index.json', () => rmSync(at('index.json')), { file: 'index.json', path: '', reason: 'index.json is not a list of guide ids' }],
    ['an index that is not a list', () => writeFileSync(at('index.json'), JSON.stringify({ guides: [ID] })), { file: 'index.json', path: '', reason: 'index.json is not a list of guide ids' }],
    ['a guide listed twice', () => writeFileSync(at('index.json'), JSON.stringify([ID, ID])), { file: 'index.json', path: '/1', reason: `guide ${ID} is listed twice` }],
    ['a guide listed with no folder', () => writeFileSync(at('index.json'), JSON.stringify([ID, 'gone'])), { file: 'index.json', path: '/1', reason: 'guide gone is listed but has no folder' }],
    ['a listed id that is a path', () => writeFileSync(at('index.json'), JSON.stringify([ID, '../x'])), { file: 'index.json', path: '/1', reason: '../x is not a guide id' }],
    ['a folder not listed', () => mkdirSync(at('stray')), { file: 'stray', path: '', reason: 'folder stray is not listed in index.json' }],
    ['a stray file beside the guides', () => writeFileSync(at('notes.txt'), 'x'), { file: 'notes.txt', path: '', reason: 'notes.txt does not belong in the guides folder' }],
    ['no guide.json', () => rmSync(at(ID, 'guide.json')), { file: GUIDE_FILE, path: '', reason: 'no guide.json' }],
    [
      'a guide.json that is not JSON',
      () => writeFileSync(at(ID, 'guide.json'), '{'),
      { file: GUIDE_FILE, path: '', reason: `guide.json is not JSON: ${parseMessage('{')}` },
    ],
    [
      'a guide the schema refuses, and nothing checked after it',
      () => {
        // A wrong id and a stray file too: neither is reported, since the guide's shape cannot be trusted.
        writeGuide({ ...guideJson(), speed: 2, id: 'other' });
        writeFileSync(at(ID, 'extra.png'), 'x');
      },
      { file: GUIDE_FILE, path: '', reason: 'must NOT have additional properties: speed' },
    ],
    ['an id that is not its folder', () => writeGuide({ ...guideJson(), id: 'other' }), { file: GUIDE_FILE, path: '/id', reason: `id other is not its folder's name, ${ID}` }],
    [
      'a layer the app does not have',
      () => {
        const guide = guideJson();
        const chapters = guide.chapters as { scene: { layers: string[] } }[];
        chapters[0].scene.layers[1] = 'nothing';
        writeGuide(guide);
      },
      { file: GUIDE_FILE, path: '/chapters/0/scene/layers/1', reason: 'no layer switch nothing' },
    ],
    [
      'a narration with no audio file',
      () => rmSync(at(ID, 'audio/01-look-down.m4a')),
      { file: GUIDE_FILE, path: '/chapters/0/steps/0/narration/audio', reason: 'no file audio/01-look-down.m4a' },
    ],
    [
      'a narration with no captions file',
      () => rmSync(at(ID, 'audio/02-shells.vtt')),
      { file: GUIDE_FILE, path: '/chapters/0/steps/1/narration/captions', reason: 'no file audio/02-shells.vtt' },
    ],
    ['a file the guide does not use', () => writeFileSync(at(ID, 'extra.png'), 'x'), { file: `${ID}/extra.png`, path: '', reason: 'extra.png is not used by the guide' }],
    [
      'a file the guide does not use, a folder down',
      () => writeFileSync(at(ID, 'audio/old.m4a'), 'x'),
      { file: `${ID}/audio/old.m4a`, path: '', reason: 'audio/old.m4a is not used by the guide' },
    ],
    [
      'a narration file over its budget',
      // Ten minutes long, so its bit rate is within the cap.
      () => writeNarrationSized(at(ID, 'audio/01-look-down.m4a'), 600, 6 * MIB),
      { file: `${ID}/audio/01-look-down.m4a`, path: '', reason: 'audio/01-look-down.m4a is 6.0 MiB, over the 5 MiB a narration file may be' },
    ],
    [
      'a folder over its budget',
      () => {
        // Each narration file at its cap and each captions file large: no one file is over, the folder is.
        for (const n of ['01-look-down', '02-shells', '03-deep-mantle']) {
          writeNarrationSized(at(ID, `audio/${n}.m4a`), 600, 5 * MIB);
          writeCaptionsSized(at(ID, `audio/${n}.vtt`), 2 * MIB);
        }
      },
      { file: ID, path: '', reason: 'the folder is 21.0 MiB, over the 20 MiB a guide may be' },
    ],
    [
      'a link',
      () => {
        writeFileSync(at('outside.m4a'), 'x');
        symlinkSync(at('outside.m4a'), at(ID, 'audio/link.m4a'));
        rmSync(at('outside.m4a'));
      },
      { file: `${ID}/audio/link.m4a`, path: '', reason: 'audio/link.m4a is a link' },
    ],
    [
      'a narration that is not an .m4a',
      () => writeFileSync(at(ID, 'audio/01-look-down.m4a'), 'This is not a narration.'),
      { file: `${ID}/audio/01-look-down.m4a`, path: '', reason: 'audio/01-look-down.m4a is not an .m4a the app can play: not an MP4 file: no ftyp box' },
    ],
    [
      'a narration that is not AAC-LC',
      () => writeFileSync(at(ID, 'audio/01-look-down.m4a'), narration(withObjectType(readFixture('tone-mono'), 5))),
      { file: `${ID}/audio/01-look-down.m4a`, path: '', reason: 'audio/01-look-down.m4a is not AAC-LC (audio object type 5)' },
    ],
    [
      'a narration in stereo',
      () => writeFileSync(at(ID, 'audio/01-look-down.m4a'), narration(readFixture('tone-stereo'))),
      { file: `${ID}/audio/01-look-down.m4a`, path: '', reason: 'audio/01-look-down.m4a has 2 channels; narration is mono' },
    ],
    [
      'a narration over its bit rate',
      // 750,000 bytes in 60 s is 100 kbit/s.
      () => writeNarrationSized(at(ID, 'audio/01-look-down.m4a'), NARRATION_S, 750_000),
      { file: `${ID}/audio/01-look-down.m4a`, path: '', reason: 'audio/01-look-down.m4a is 100.0 kbit/s, over the 96 a narration may be' },
    ],
    [
      'a cue past the end of its narration',
      () => {
        const guide = guideJson();
        const steps = (guide.chapters as { steps: { cues: { at: number }[] }[] }[])[0].steps;
        steps[0].cues[1].at = NARRATION_S + 1;
        writeGuide(guide);
      },
      { file: GUIDE_FILE, path: '/chapters/0/steps/0/cues/1/at', reason: `cue at ${NARRATION_S + 1} is past the end of the narration, ${NARRATION_S} s` },
    ],
    [
      "a cue past the end of its step's silence",
      () => {
        const guide = guideJson();
        const steps = (guide.chapters as { steps: Record<string, unknown>[] }[])[0].steps;
        // The last step, its narration taken out for a second's silence: its cues are at 0 and 2.
        delete steps[2].narration;
        steps[2].silenceS = 1;
        writeGuide(guide);
        rmSync(at(ID, 'audio/03-deep-mantle.m4a'));
        rmSync(at(ID, 'audio/03-deep-mantle.vtt'));
      },
      { file: GUIDE_FILE, path: '/chapters/0/steps/2/cues/1/at', reason: "cue at 2 is past the end of the step's silence, 1 s" },
    ],
  ])('reports %s', (_, change, expected) => {
    change();
    expect(problems()).toEqual([expected]);
  });
});

describe('guidesProblems on captions', () => {
  const CAPTIONS_PATH = 'audio/01-look-down.vtt';
  const CAPTIONS_FILE = `${ID}/${CAPTIONS_PATH}`;
  const captionsProblem = (reason: string): GuidesProblem => ({ file: CAPTIONS_FILE, path: '', reason });
  const ASTRAL = String.fromCodePoint(0x1f30d);

  it.each<[string, string, string[]]>([
    ['captions the reader refuses', 'stand-in', [`${CAPTIONS_PATH} is not captions the app can show: not a WebVTT file: the first line is not WEBVTT`]],
    ['captions with no cues', 'WEBVTT\n', [`${CAPTIONS_PATH} has no captions`]],
    ['a caption over the one before', vtt(['00:00.000', '00:02.000', 'a'], ['00:01.500', '00:03.000', 'b']), ['caption 2 starts at 1.5 s, before caption 1 ends at 2 s']],
    ['a caption before the one before', vtt(['00:05.000', '00:06.000', 'a'], ['00:00.000', '00:01.000', 'b']), ['caption 2 starts at 0 s, before caption 1 ends at 6 s']],
    [
      'two of three captions over the one before',
      vtt(['00:00.000', '00:02.000', 'a'], ['00:01.000', '00:03.000', 'b'], ['00:02.500', '00:04.000', 'c']),
      ['caption 2 starts at 1 s, before caption 1 ends at 2 s', 'caption 3 starts at 2.5 s, before caption 2 ends at 3 s'],
    ],
    [
      'a caption past the end of the narration',
      vtt(['00:57.000', '00:58.000', 'a'], ['00:58.000', '01:00.500', 'b']),
      [`caption 2 ends at 60.5 s, past the end of the narration, ${NARRATION_S} s`],
    ],
    ['a caption ending at the end of the narration', vtt(['00:57.000', '00:58.000', 'a'], ['00:58.000', '01:00.000', 'b']), []],
    ['a caption of three lines', vtt(['00:00.000', '00:01.000', 'a', 'b', 'c']), ['caption 1 has 3 lines; a caption has at most 2']],
    ['a line of 38 characters', vtt(['00:00.000', '00:01.000', 'x'.repeat(37), 'x'.repeat(38)]), ['caption 1, line 2 is 38 characters; a line has at most 37']],
    // Two characters outside the BMP: 39 UTF-16 units, 37 characters.
    ['a line of 37 characters, two of them astral', vtt(['00:00.000', '00:01.000', ASTRAL.repeat(2) + 'x'.repeat(35)]), []],
    ['a gap of 3.1 s', vtt(['00:00.000', '00:01.000', 'a'], ['00:04.100', '00:05.000', 'b']), ['3.1 s with no caption before caption 2; a narration goes at most 3 s without one']],
    ['a gap of 3 s', vtt(['00:00.000', '00:01.000', 'a'], ['00:04.000', '00:05.000', 'b']), []],
    // 4.001 - 1.001 is 3.0000000000000004 in floating point.
    ['a gap of 3 s that floating point makes longer', vtt(['00:00.000', '00:01.001', 'a'], ['00:04.001', '00:05.000', 'b']), []],
    ['a first caption 10 s in', vtt(['00:10.000', '00:11.000', 'a']), []],
  ])('reports %s', (_, captions, reasons) => {
    writeFileSync(at(ID, CAPTIONS_PATH), captions);
    expect(problems()).toEqual(reasons.map(captionsProblem));
  });

  it('checks captions against nothing when the narration has no length', () => {
    // Captions running past the minute the narration's header would give, so a length taken from anywhere would show.
    writeFileSync(at(ID, CAPTIONS_PATH), vtt(['01:58.000', '02:00.000', 'a']));
    writeFileSync(at(ID, 'audio/01-look-down.m4a'), 'This is not a narration.');
    expect(problems()).toEqual([
      { file: `${ID}/audio/01-look-down.m4a`, path: '', reason: 'audio/01-look-down.m4a is not an .m4a the app can play: not an MP4 file: no ftyp box' },
    ]);
    rmSync(at(ID, 'audio/01-look-down.m4a'));
    expect(problems()).toEqual([{ file: GUIDE_FILE, path: '/chapters/0/steps/0/narration/audio', reason: 'no file audio/01-look-down.m4a' }]);
  });

  it('checks captions two steps share once', () => {
    const guide = guideJson();
    const steps = (guide.chapters as { steps: { narration: { captions: string } }[] }[])[0].steps;
    steps[1].narration.captions = CAPTIONS_PATH;
    writeGuide(guide);
    rmSync(at(ID, 'audio/02-shells.vtt'));
    writeFileSync(at(ID, CAPTIONS_PATH), vtt(['00:00.000', '00:01.000', 'a', 'b', 'c']));
    expect(problems()).toEqual([captionsProblem('caption 1 has 3 lines; a caption has at most 2')]);
  });
});

describe('guidesProblems on clips', () => {
  const CREDIT = { what: 'Diagram', source: 'USGS', licence: 'public domain', url: 'https://www.usgs.gov/' };
  const IMAGE = { kind: 'image', src: 'images/prem.webp', alt: 'The layers of the Earth', caption: 'Seismic waves bend at each boundary.', credit: CREDIT };
  const AUDIO = { kind: 'audio', src: 'audio/prem.m4a', captions: 'audio/prem.vtt', credit: CREDIT };
  const image = (name = 'pic-lossy.webp'): Uint8Array => new Uint8Array(readFileSync(`src/guides/fixtures/${name}`));
  /** The example guide with an image hotspot and an audio one on its first step, their files written. */
  beforeEach(() => {
    const guide = guideJson();
    const steps = (guide.chapters as { steps: Record<string, unknown>[] }[])[0].steps;
    steps[0].hotspots = [
      { id: 'prem', title: 'How we know', anchor: { kind: 'horizon', azDeg: 0, altDeg: -90 }, clip: IMAGE },
      { id: 'waves', title: 'Listen', anchor: { kind: 'horizon', azDeg: 90, altDeg: 0 }, clip: AUDIO },
    ];
    writeGuide(guide);
    mkdirSync(at(ID, 'images'));
    writeFileSync(at(ID, IMAGE.src), image());
    writeFileSync(at(ID, AUDIO.src), narration());
    writeFileSync(at(ID, AUDIO.captions), CAPTIONS);
  });
  const CLIP = '/chapters/0/steps/0/hotspots';
  const VIDEO = {
    kind: 'video',
    src: `https://media.transparent.sbdev.io/guides/${ID}/prem.a1b2c3d4.mp4`,
    captions: 'video/prem.vtt',
    poster: 'images/poster.webp',
    video: { bytes: 1000, sha256: 'a1b2c3d4'.padEnd(64, '0'), durationS: 6, width: 1280, height: 720 },
    credit: CREDIT,
  };
  /** The guide with a video hotspot added, its poster and captions written: captions that run to 9 s, past its 6. */
  const addVideo = (): void => {
    const guide = JSON.parse(readFileSync(at(ID, 'guide.json'), 'utf8')) as { chapters: { steps: { hotspots: unknown[] }[] }[] };
    guide.chapters[0].steps[0].hotspots.push({ id: 'film', title: 'Watch', anchor: { kind: 'horizon', azDeg: 180, altDeg: 0 }, clip: VIDEO });
    writeGuide(guide);
    mkdirSync(at(ID, 'video'));
    writeFileSync(at(ID, VIDEO.poster), image());
    writeFileSync(at(ID, VIDEO.captions), CAPTIONS);
  };

  it('holds a video\'s poster and captions to its folder, and its captions to the length it declares', () => {
    addVideo();
    rmSync(at(ID, VIDEO.poster));
    expect(problems()).toEqual([
      { file: GUIDE_FILE, path: `${CLIP}/2/clip/poster`, reason: 'no file images/poster.webp' },
      { file: `${ID}/${VIDEO.captions}`, path: '', reason: expect.stringContaining('past the end of the narration') as string },
    ]);
  });

  it('finds nothing wrong with good clips', () => {
    expect(problems()).toEqual([]);
  });

  it.each<[string, () => void, GuidesProblem]>([
    ['an image clip with no file', () => rmSync(at(ID, IMAGE.src)), { file: GUIDE_FILE, path: `${CLIP}/0/clip/src`, reason: 'no file images/prem.webp' }],
    ['an audio clip with no file', () => rmSync(at(ID, AUDIO.src)), { file: GUIDE_FILE, path: `${CLIP}/1/clip/src`, reason: 'no file audio/prem.m4a' }],
    ['an audio clip with no captions', () => rmSync(at(ID, AUDIO.captions)), { file: GUIDE_FILE, path: `${CLIP}/1/clip/captions`, reason: 'no file audio/prem.vtt' }],
    [
      'an image that is not one',
      () => writeFileSync(at(ID, IMAGE.src), 'not a picture'),
      { file: `${ID}/${IMAGE.src}`, path: '', reason: `${IMAGE.src} is not an image the app can show: not a JPEG or WebP file` },
    ],
    [
      'an image whose name says another format',
      () => writeFileSync(at(ID, IMAGE.src), image('pic.jpg')),
      { file: `${ID}/${IMAGE.src}`, path: '', reason: `${IMAGE.src} is a JPEG file, not what its name says` },
    ],
    [
      'an image too wide',
      () => {
        // The fixture's VP8 header, its 14-bit width set to 3000.
        const wide = image();
        new DataView(wide.buffer).setUint16(26, 3000, true);
        writeFileSync(at(ID, IMAGE.src), wide);
      },
      { file: `${ID}/${IMAGE.src}`, path: '', reason: `${IMAGE.src} is 3000 × 24 px; its long side is at most 2048` },
    ],
    [
      'an image over its budget',
      () => {
        const path = at(ID, IMAGE.src);
        writeFileSync(path, image());
        truncateSync(path, 1.5 * MIB);
      },
      { file: `${ID}/${IMAGE.src}`, path: '', reason: `${IMAGE.src} is 1.5 MiB, over the 1 MiB an image may be` },
    ],
    [
      'an audio clip in stereo',
      () => writeFileSync(at(ID, AUDIO.src), narration(readFixture('tone-stereo'))),
      { file: `${ID}/${AUDIO.src}`, path: '', reason: `${AUDIO.src} has 2 channels; narration is mono` },
    ],
    [
      "an audio clip's captions past its end",
      () => writeFileSync(at(ID, AUDIO.captions), vtt(['00:58.000', '01:01.000', 'a'])),
      { file: `${ID}/${AUDIO.captions}`, path: '', reason: `caption 1 ends at 61 s, past the end of the narration, ${NARRATION_S} s` },
    ],
    ['an image the guide does not use', () => writeFileSync(at(ID, 'images/old.webp'), image()), { file: `${ID}/images/old.webp`, path: '', reason: 'images/old.webp is not used by the guide' }],
  ])('reports %s', (_, change, expected) => {
    change();
    expect(problems()).toEqual([expected]);
  });
});

/** The words JSON.parse uses for `text`, which differ between engines. */
function parseMessage(text: string): string {
  try {
    JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return error.message;
  }
  throw new Error(`${text} is JSON`);
}

describe('mediaProblems', () => {
  const CREDIT = { what: 'Diagram', source: 'USGS', licence: 'public domain', url: 'https://www.usgs.gov/' };
  const IMAGE = { kind: 'image', src: 'images/prem.webp', alt: 'The layers of the Earth', caption: 'Seismic waves bend at each boundary.', credit: CREDIT };
  const AUDIO = { kind: 'audio', src: 'audio/prem.m4a', captions: 'audio/prem.vtt', credit: CREDIT };
  const media = (): Record<string, unknown> => ({
    formatVersion: 1,
    language: 'en',
    hotspots: [
      { id: 'prem', title: 'How we know', anchor: { kind: 'horizon', azDeg: 0, altDeg: -90 }, clip: IMAGE },
      { id: 'waves', title: 'Listen', anchor: { kind: 'horizon', azDeg: 90, altDeg: 0 }, layer: 'shell-core', clip: AUDIO },
    ],
  });
  const dir = (...parts: string[]): string => at('media', ...parts);
  const writeMedia = (value: unknown): void => writeFileSync(dir('hotspots.json'), JSON.stringify(value));
  const found = (): GuidesProblem[] => mediaProblems(dir(), APP_WORLD);

  /** A media folder with an image hotspot and an audio one on a switch, their files written. */
  beforeEach(() => {
    mkdirSync(dir('images'), { recursive: true });
    mkdirSync(dir('audio'));
    writeMedia(media());
    writeFileSync(dir(IMAGE.src), new Uint8Array(readFileSync('src/guides/fixtures/pic-lossy.webp')));
    writeFileSync(dir(AUDIO.src), narration());
    writeFileSync(dir(AUDIO.captions), CAPTIONS);
  });

  it('finds nothing wrong with a good folder', () => {
    expect(found()).toEqual([]);
  });

  it.each<[string, () => void, GuidesProblem]>([
    ['no list', () => rmSync(dir('hotspots.json')), { file: 'hotspots.json', path: '', reason: 'no hotspots.json' }],
    ['a list that is not JSON', () => writeFileSync(dir('hotspots.json'), '{'), { file: 'hotspots.json', path: '', reason: expect.stringMatching(/^hotspots.json is not JSON/) as string }],
    ['a list of another format', () => writeMedia({ ...media(), formatVersion: 2 }), { file: 'hotspots.json', path: '/formatVersion', reason: 'must be equal to constant: 1' }],
    [
      'a hotspot on a switch the app does not have',
      () => writeMedia({ ...media(), hotspots: [(media().hotspots as object[])[0], { ...(media().hotspots as object[])[1], layer: 'no-such-layer' }] }),
      { file: 'hotspots.json', path: '/hotspots/1/layer', reason: 'no layer switch no-such-layer' },
    ],
    [
      'a hotspot id used twice',
      () => writeMedia({ ...media(), hotspots: [(media().hotspots as object[])[0], { ...(media().hotspots as object[])[1], id: 'prem' }] }),
      { file: 'hotspots.json', path: '/hotspots/1/id', reason: 'hotspot id prem is used twice' },
    ],
    ['an image clip with no file', () => rmSync(dir(IMAGE.src)), { file: 'hotspots.json', path: '/hotspots/0/clip/src', reason: 'no file images/prem.webp' }],
    ['an audio clip with no captions', () => rmSync(dir(AUDIO.captions)), { file: 'hotspots.json', path: '/hotspots/1/clip/captions', reason: 'no file audio/prem.vtt' }],
    [
      'an image that is not one',
      () => writeFileSync(dir(IMAGE.src), 'not a picture'),
      { file: IMAGE.src, path: '', reason: `${IMAGE.src} is not an image the app can show: not a JPEG or WebP file` },
    ],
    ['a file no clip uses', () => writeFileSync(dir('images', 'spare.webp'), 'x'), { file: 'images/spare.webp', path: '', reason: 'images/spare.webp is not used by hotspots.json' }],
    [
      'an image over budget',
      () => (writeFileSync(dir(IMAGE.src), new Uint8Array(readFileSync('src/guides/fixtures/pic-lossy.webp'))), truncateSync(dir(IMAGE.src), 2 * MIB)),
      { file: IMAGE.src, path: '', reason: `${IMAGE.src} is 2.0 MiB, over the 1 MiB an image may be` },
    ],
  ])('reports %s', (_, change, problem) => {
    change();
    expect(found()).toContainEqual(problem);
  });

  it('reports a link and does not follow it', () => {
    symlinkSync('/etc/passwd', dir('images', 'linked.webp'));
    expect(found()).toEqual([{ file: 'images/linked.webp', path: '', reason: 'images/linked.webp is a link' }]);
  });
});
