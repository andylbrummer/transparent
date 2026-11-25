import { describe, it, expect } from 'vitest';
import type { FoldedView, Target, ViewAction } from '../view/actions';
import { foldAction } from '../view/fold';
import { foldTo, type Guide } from './format';

const down: Target = { kind: 'horizon', azDeg: 0, altDeg: -90 };
const sun: Target = { kind: 'body', body: 'sun' };

const guide: Guide = {
  formatVersion: 1,
  id: 'fold-test',
  title: 'Fold test',
  summary: 'Two chapters to seek through.',
  language: 'en',
  topics: ['geology'],
  authors: [{ name: 'Transparent Earth' }],
  licence: 'CC BY 4.0',
  credits: [{ what: 'Script', source: 'Transparent Earth contributors', licence: 'CC BY 4.0', url: 'https://github.com/andylbrummer/transparent' }],
  chapters: [
    {
      id: 'the-way-down',
      title: 'The way down',
      scene: { layers: ['globe-surface', 'political'], look: { target: down, fovDeg: 60 } },
      steps: [
        {
          id: 'look-up',
          silenceS: 10,
          cues: [
            { at: 4.5, do: 'look', target: sun },
            // Past any time the tests seek to in this step.
            { at: 30, do: 'mark', target: down, text: 'Down' },
          ],
          advance: 'gaze',
        },
        {
          id: 'shells',
          narration: { audio: 'audio/shells.m4a', captions: 'audio/shells.vtt' },
          cues: [
            { at: 0, do: 'layers', on: ['shell-moho'], off: ['political'] },
            { at: 2, do: 'fov', fovDeg: 90 },
          ],
          advance: 'auto',
        },
        {
          id: 'clear',
          silenceS: 3,
          cues: [
            { at: 0, do: 'mark', target: down, text: null },
            { at: 1, do: 'preset', id: 'earth' },
          ],
          advance: 'continue',
        },
      ],
    },
    {
      id: 'the-sky',
      title: 'The sky',
      scene: { preset: 'sky', look: { target: sun, fovDeg: 40 } },
      steps: [{ id: 'stars', silenceS: 5, cues: [{ at: 0, do: 'layers', on: ['stars'] }], advance: 'continue' }],
    },
  ],
};

const chapterStart: FoldedView = { layers: { only: ['globe-surface', 'political'] }, place: { kind: 'here' }, time: { to: 'now' }, look: { target: down, fovDeg: 60 }, marks: [] };

describe('foldTo', () => {
  it("gives the scene at a chapter's start", () => {
    expect(foldTo(guide, 0, 0, 0)).toEqual(chapterStart);
  });

  it('takes a cue once the step time reaches it', () => {
    expect(foldTo(guide, 0, 1, 0).layers).toEqual({ only: ['globe-surface', 'shell-moho'] });
    expect(foldTo(guide, 0, 0, 4.49).look.target).toEqual(down);
    expect(foldTo(guide, 0, 0, 4.5).look.target).toEqual(sun);
  });

  it('takes every cue of the steps before, however late in them', () => {
    const view = foldTo(guide, 0, 1, 0);
    expect(view.look).toEqual({ target: sun, fovDeg: 60 });
    expect(view.marks).toEqual([{ target: down, text: 'Down' }]);
  });

  it('takes down a mark a later step clears', () => {
    expect(foldTo(guide, 0, 1, 100).marks).toEqual([{ target: down, text: 'Down' }]);
    expect(foldTo(guide, 0, 2, 0).marks).toEqual([]);
  });

  it("starts the next chapter from its own scene, with nothing of the last one's", () => {
    expect(foldTo(guide, 1, 0, 0)).toEqual({
      layers: { preset: 'sky', on: ['stars'], off: [] },
      place: { kind: 'here' },
      time: { to: 'now' },
      look: { target: sun, fovDeg: 40 },
      marks: [],
    });
  });

  it('stands where the scene says, here when it says nothing, and where a cue moves it', () => {
    const pole = { kind: 'at', lat: 90, lon: 0, name: 'North Pole' } as const;
    const moving: Guide = {
      ...guide,
      chapters: [
        {
          ...guide.chapters[0],
          scene: { ...guide.chapters[0].scene, place: pole },
          steps: [{ id: 'away', silenceS: 5, cues: [{ at: 2, do: 'stand', place: { kind: 'antipode' } }], advance: 'auto' }],
        },
        guide.chapters[1],
      ],
    };
    expect(foldTo(moving, 0, 0, 0).place).toEqual(pole);
    expect(foldTo(moving, 0, 0, 2).place).toEqual({ kind: 'antipode' });
    expect(foldTo(moving, 1, 0, 0).place).toEqual({ kind: 'here' });
  });

  it('runs the clock as the scene says, and live when it says nothing', () => {
    const quake: Guide = { ...guide, chapters: [{ ...guide.chapters[0], scene: { ...guide.chapters[0].scene, time: { to: '2011-03-11T05:46Z' } } }] };
    expect(foldTo(quake, 0, 0, 0).time).toEqual({ to: '2011-03-11T05:46Z' });
    expect(foldTo(guide, 0, 0, 0).time).toEqual({ to: 'now' });
    // A cue's own `at` is when it fired, not part of the clock's setting.
    const lapse: Guide = { ...guide, chapters: [{ ...guide.chapters[0], steps: [{ id: 'run', silenceS: 9, cues: [{ at: 3, do: 'time', to: 'now', rate: 2 }], advance: 'auto' }] }] };
    expect(foldTo(lapse, 0, 0, 3).time).toEqual({ to: 'now', rate: 2 });
  });

  it('starts from a listed scene as its list, and from a preset scene as the preset with nothing flipped', () => {
    expect(foldTo(guide, 0, 0, 0).layers).toEqual({ only: ['globe-surface', 'political'] });
    expect(foldTo(guide, 0, 2, 1).layers).toEqual({ preset: 'earth', on: [], off: [] });
  });

  it('is the cues so far, folded one by one', () => {
    const cues: ViewAction[] = [...guide.chapters[0].steps[0].cues, ...guide.chapters[0].steps[1].cues, guide.chapters[0].steps[2].cues[0]];
    expect(foldTo(guide, 0, 2, 0.5)).toEqual(cues.reduce(foldAction, chapterStart));
  });

  it.each<[string, () => unknown, string]>([
    ['a chapter past the last', () => foldTo(guide, 2, 0, 0), 'guide fold-test has no chapter 2'],
    ['a chapter before the first', () => foldTo(guide, -1, 0, 0), 'guide fold-test has no chapter -1'],
    ['a chapter between two', () => foldTo(guide, 0.5, 0, 0), 'guide fold-test has no chapter 0.5'],
    ['a step past the last', () => foldTo(guide, 0, 3, 0), 'chapter the-way-down of guide fold-test has no step 3'],
    ['a step between two', () => foldTo(guide, 1, 0.5, 0), 'chapter the-sky of guide fold-test has no step 0.5'],
    ['a time before the step', () => foldTo(guide, 0, 0, -1), 'step time -1 is not a time'],
    ['a time that is not a number', () => foldTo(guide, 0, 0, NaN), 'step time NaN is not a time'],
  ])('throws a RangeError for %s', (_, call, message) => {
    expect(call).toThrow(RangeError);
    expect(call).toThrow(message);
  });

  it('changes nothing in the guide', () => {
    const before = structuredClone(guide);
    for (const [chapter, step, tS] of [
      [0, 0, 5],
      [0, 1, 3],
      [0, 2, 3],
      [1, 0, 0],
    ] as const) {
      foldTo(guide, chapter, step, tS);
    }
    expect(guide).toEqual(before);
  });
});
