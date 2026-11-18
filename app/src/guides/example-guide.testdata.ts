/**
 * The worked example of spec/guides.md §3.2, for the tests: real layer ids
 * and a real label name, so it is a guide the app can play.
 */

import type { Target } from '../view/actions';
import type { Guide } from './format';

/** Straight down, through the Earth. */
export const DOWN: Target = { kind: 'horizon', azDeg: 0, altDeg: -90 };


/** spec/guides.md §3.2, less what phase 1 does not play: the sponsor, the hotspot, the scene's place and time. */
export const EXAMPLE_GUIDE: Guide = {
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
        look: { target: DOWN, fovDeg: 60 },
      },
      steps: [
        {
          id: 'look-down',
          narration: { audio: 'audio/01-look-down.m4a', captions: 'audio/01-look-down.vtt' },
          cues: [
            { at: 0, do: 'look', target: DOWN },
            { at: 6, do: 'mark', target: DOWN, text: 'The far side · 12,742 km' },
          ],
          advance: 'gaze',
        },
        {
          id: 'shells',
          narration: { audio: 'audio/02-shells.m4a', captions: 'audio/02-shells.vtt' },
          cues: [
            { at: 0, do: 'mark', target: DOWN, text: null },
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
