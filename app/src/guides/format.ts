/**
 * The guide file format as the player reads it, and foldTo, the view a
 * guide has reached at any point. The types are derived from the schema
 * in guide-schema.ts, the one place the format is written; only types are
 * imported from it, so the schema itself stays out of the app. The two
 * values the app checks at run time, the format version and the id
 * pattern, are kept here instead, and the schema takes them from here.
 */

import type { FoldedView, Place, TimeSetting } from '../view/actions';
import type { SchemaType } from '../view/action-schema';
import { foldAction } from '../view/fold';
import type { GUIDE_SCHEMA } from './guide-schema';

/** The guide format this app plays. A guide says which it was written for. */
export const GUIDE_FORMAT_VERSION = 1;
/** Every id in a guide, its own included: lower-case words joined by hyphens. */
export const ID_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';

const HERE: Place = { kind: 'here' };
const LIVE: TimeSetting = { to: 'now' };

/** A guide file, as guide.schema.json describes it. */
export type Guide = SchemaType<typeof GUIDE_SCHEMA>;
export type Chapter = Guide['chapters'][number];
/** The whole view at a chapter's start. */
export type Scene = Chapter['scene'];
export type Step = Chapter['steps'][number];
/** A view action at a time in its step. */
export type Cue = Step['cues'][number];

/** The view at a chapter's start: its scene, whole. */
export function sceneView(scene: Scene): FoldedView {
  return {
    layers: 'preset' in scene ? { preset: scene.preset, on: [], off: [] } : { only: [...scene.layers] },
    // A scene is the whole view, so one that says nothing of the place stands here, and one that says nothing of the
    // time is now.
    place: scene.place ?? HERE,
    time: scene.time ?? LIVE,
    look: scene.look,
    marks: [],
  };
}

/**
 * The view a guide has reached `tS` seconds into a step: the chapter's
 * scene, then every cue of the steps before it, then this step's cues up
 * to `tS`. It never reaches back past the chapter's start, which is why
 * every chapter has a whole scene.
 */
export function foldTo(guide: Guide, chapterIndex: number, stepIndex: number, tS: number): FoldedView {
  // A bad index or time is the caller's mistake, not the guide's, so it throws rather than returning an outcome.
  const chapter = Number.isInteger(chapterIndex) ? guide.chapters[chapterIndex] : undefined;
  if (chapter === undefined) throw new RangeError(`guide ${guide.id} has no chapter ${chapterIndex}`);
  const step = Number.isInteger(stepIndex) ? chapter.steps[stepIndex] : undefined;
  if (step === undefined) throw new RangeError(`chapter ${chapter.id} of guide ${guide.id} has no step ${stepIndex}`);
  if (!Number.isFinite(tS) || tS < 0) throw new RangeError(`step time ${tS} is not a time`);

  let view = sceneView(chapter.scene);
  for (const before of chapter.steps.slice(0, stepIndex)) for (const cue of before.cues) view = foldAction(view, cue);
  // A cue at `tS` has fired: at a step's start, tS = 0 and its `at: 0` cues are done. The file's order is trusted
  // (the guide validator checks it, spec/guides.md §9), and a time past the narration's end takes every cue, since
  // only the audio knows how long it is.
  for (const cue of step.cues) if (cue.at <= tS) view = foldAction(view, cue);
  return view;
}
