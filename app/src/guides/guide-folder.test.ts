import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guidesProblems, type GuidesProblem } from '../../scripts/guide-folder';
import { APP_WORLD } from './app-world.testdata';
import { EXAMPLE_GUIDE } from './example-guide.testdata';

const ID = EXAMPLE_GUIDE.id;
const GUIDE_FILE = `${ID}/guide.json`;
const MIB = 1024 * 1024;

let root: string;
const at = (...parts: string[]): string => join(root, ...parts);
const writeGuide = (guide: unknown): void => writeFileSync(at(ID, 'guide.json'), JSON.stringify(guide));
/** A file of `bytes`, sparse: its size is all the checks read. */
const writeSized = (path: string, bytes: number): void => {
  writeFileSync(path, '');
  truncateSync(path, bytes);
};
const problems = (): GuidesProblem[] => guidesProblems(root, APP_WORLD);
/** The example guide as plain JSON, to change one thing in. */
const guideJson = (): Record<string, unknown> => JSON.parse(JSON.stringify(EXAMPLE_GUIDE)) as Record<string, unknown>;

/** A guides folder holding the example guide, with a few bytes in place of each narration file. */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'guides-'));
  writeFileSync(at('index.json'), JSON.stringify([ID]));
  mkdirSync(at(ID, 'audio'), { recursive: true });
  writeGuide(EXAMPLE_GUIDE);
  for (const chapter of EXAMPLE_GUIDE.chapters) {
    for (const step of chapter.steps) {
      if ('narration' in step) for (const path of [step.narration.audio, step.narration.captions]) writeFileSync(at(ID, path), 'stand-in');
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
      () => writeSized(at(ID, 'audio/01-look-down.m4a'), 6 * MIB),
      { file: `${ID}/audio/01-look-down.m4a`, path: '', reason: 'audio/01-look-down.m4a is 6.0 MiB, over the 5 MiB a narration file may be' },
    ],
    [
      'a folder over its budget',
      () => {
        // Each narration file at its cap and each captions file large: no one file is over, the folder is.
        for (const n of ['01-look-down', '02-shells', '03-deep-mantle']) {
          writeSized(at(ID, `audio/${n}.m4a`), 5 * MIB);
          writeSized(at(ID, `audio/${n}.vtt`), 2 * MIB);
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
