/**
 * The guides folder, app/public/guides, held to what the app can play:
 * index.json matches the folders, each guide passes the schema and the
 * rules of src/guides/validate.ts, each folder holds the files its guide
 * uses, with none left over and none over budget, and each narration is mono
 * AAC-LC and long enough for its cues. Each captions file is read with the
 * app's own reader and held to its narration: in order, within its length,
 * short lines, and no long gaps. A hotspot's audio clip is held to the same
 * as a narration, and its image to a format and a size read from its header.
 *
 * Node code (node:fs, node:path), used only by the validator's tests and
 * never bundled into the app. It lives in scripts/, the Node project, because
 * the lint keeps Node's modules and globals out of app/src; ajv is imported
 * here for the same reason. Its tests are in src/guides/.
 */

import { lstatSync, readdirSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import type { Clip, Guide } from '../src/guides/format';
import { GUIDE_SCHEMA } from '../src/guides/guide-schema';
import { readImageInfo, type ImageInfo } from '../src/guides/image-info';
import { readM4aInfo, type M4aInfo } from '../src/guides/m4a-info';
import { guideProblems, type GuideWorld } from '../src/guides/validate';
import { parseVtt, type CaptionCue } from '../src/guides/vtt';

/** Something wrong under the guides folder: which file, where in it, and why. */
export interface GuidesProblem {
  /** Path from the guides folder, e.g. "down-through-the-earth/guide.json". */
  readonly file: string;
  /** JSON pointer into that file; '' for the file as a whole. */
  readonly path: string;
  readonly reason: string;
}

// Audio stays in git history for good, however often it is re-recorded (spec/guides.md §9), so the caps sit far under
// what the host would accept.
/** The most one narration file may weigh: a few minutes of speech at a low AAC bit rate. */
export const NARRATION_MAX_BYTES = 5 * 1024 * 1024;
/** The most one guide's folder may weigh, guide.json and every file with it. */
export const GUIDE_FOLDER_MAX_BYTES = 20 * 1024 * 1024;
/** The highest bit rate of a narration, the file's bits over its length: speech needs no more, mono (spec/guides.md §9). */
export const NARRATION_MAX_KBPS = 96;
/** MPEG-4 audio object type 2, AAC-LC: the one every target browser plays. */
const AAC_LC = 2;
/** The most lines one caption may have (spec/guides.md §9). */
export const CAPTION_MAX_LINES = 2;
/** The most characters in one line of a caption: what fits a 360 px phone unwrapped at the smallest caption type, 16 px. */
export const CAPTION_MAX_LINE_CHARS = 37;
/** The longest a narration may run between two captions: longer, and speech is likely going uncaptioned. */
export const CAPTION_MAX_GAP_S = 3;

/** The most an image clip may weigh, and the longest side it may have: more than a phone's screen shows (spec/guides.md §9). */
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const IMAGE_MAX_SIDE_PX = 2048;
const IMAGE_EXTENSION = /\.(webp|jpg)$/;

/** The files in the guides folder that are not guides. */
const ROOT_FILES = ['index.json', 'guide.schema.json'];

const isGuide = new Ajv2020().compile<Guide>(GUIDE_SCHEMA);
/** A guide id, as the schema has it: a folder name and nothing else. */
const GUIDE_ID = new RegExp(GUIDE_SCHEMA.properties.id.pattern);

/** Everything wrong with the guides under `root`: the index, each guide and its files. */
export function guidesProblems(root: string, world: GuideWorld): GuidesProblem[] {
  const problems: GuidesProblem[] = [];
  const problem = (file: string, path: string, reason: string): void => {
    problems.push({ file, path, reason });
  };

  const listed = readIndex(root, problem);
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ROOT_FILES.includes(entry.name)) continue;
    if (!entry.isDirectory()) problem(entry.name, '', `${entry.name} does not belong in the guides folder`);
    // With no readable index, every folder would be unlisted: the index's own problem says it all.
    else if (listed !== undefined && !listed.includes(entry.name)) problem(entry.name, '', `folder ${entry.name} is not listed in index.json`);
  }
  const guides = listed ?? [];
  guides.forEach((id, i) => {
    // A guide listed twice is reported by readIndex and checked once.
    if (guides.indexOf(id) !== i) return;
    // Checked before it is used as a folder name, so a listed path cannot lead out of the guides folder.
    if (!GUIDE_ID.test(id)) {
      problem('index.json', `/${i}`, `${id} is not a guide id`);
      return;
    }
    if (statOf(join(root, id))?.isDirectory()) checkGuide(root, id, world, problem);
    else problem('index.json', `/${i}`, `guide ${id} is listed but has no folder`);
  });
  return problems;
}

type Report = (file: string, path: string, reason: string) => void;

/** The guide ids index.json lists, in order; undefined when it is not a list of them. */
function readIndex(root: string, problem: Report): string[] | undefined {
  const path = join(root, 'index.json');
  let index: unknown;
  try {
    index = statOf(path) === undefined ? undefined : JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    // Only a parse error is the index's fault; a read that fails is not, and is thrown.
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (!Array.isArray(index) || !index.every((id): id is string => typeof id === 'string')) {
    problem('index.json', '', 'index.json is not a list of guide ids');
    return undefined;
  }
  index.forEach((id, i) => {
    if (index.indexOf(id) !== i) problem('index.json', `/${i}`, `guide ${id} is listed twice`);
  });
  return index;
}

/** One guide's folder: its guide.json, the files it names, and what the folder holds. */
function checkGuide(root: string, folder: string, world: GuideWorld, problem: Report): void {
  const dir = join(root, folder);
  const guideFile = `${folder}/guide.json`;
  const files = filesIn(dir);
  for (const file of files) if (file.link) problem(`${folder}/${file.path}`, '', `${file.path} is a link`);

  const guide = readGuide(dir, guideFile, problem);
  if (guide !== undefined) {
    if (guide.id !== folder) problem(guideFile, '/id', `id ${guide.id} is not its folder's name, ${folder}`);
    for (const found of guideProblems(guide, world)) problem(guideFile, found.path, found.reason);

    const used = new Set<string>();
    // Each narration file's length, read once however many steps use it; undefined when it cannot be read.
    const lengths = new Map<string, number | undefined>();
    // A captions file several steps share is checked once, against the narration of the first step that uses it.
    const captioned = new Set<string>();
    guide.chapters.forEach((chapter, c) =>
      chapter.steps.forEach((step, s) => {
        const stepPath = `/chapters/${c}/steps/${s}`;
        /** A cue past the step's end would never fire. */
        const checkCueTimes = (lengthS: number, what: string): void => {
          step.cues.forEach((cue, k) => {
            if (cue.at > lengthS) problem(guideFile, `${stepPath}/cues/${k}/at`, `cue at ${cue.at} is past the end of ${what}, ${lengthS} s`);
          });
        };
        if (!('narration' in step)) {
          checkCueTimes(step.silenceS, "the step's silence");
          return;
        }
        for (const key of ['audio', 'captions'] as const) {
          const path = step.narration[key];
          used.add(path);
          if (!statOf(join(dir, path))?.isFile()) problem(guideFile, `${stepPath}/narration/${key}`, `no file ${path}`);
        }
        const { audio, captions } = step.narration;
        if (!lengths.has(audio) && statOf(join(dir, audio))?.isFile()) lengths.set(audio, narrationLength(dir, folder, audio, problem));
        // Undefined when the audio is missing or unreadable, which is reported above: nothing is checked against it.
        const lengthS = lengths.get(audio);
        if (lengthS !== undefined) checkCueTimes(lengthS, 'the narration');
        if (!captioned.has(captions) && statOf(join(dir, captions))?.isFile()) {
          captioned.add(captions);
          checkCaptions(dir, folder, captions, lengthS, problem);
        }
      }),
    );
    const clips: ClipFiles = { dir, folder, file: guideFile, used, lengths, captioned, problem };
    guide.chapters.forEach((chapter, c) =>
      chapter.steps.forEach((step, s) => step.hotspots?.forEach((hotspot, h) => checkClip(clips, `/chapters/${c}/steps/${s}/hotspots/${h}/clip`, hotspot.clip))),
    );
    for (const file of files) {
      if (file.path !== 'guide.json' && !file.link && !used.has(file.path)) problem(`${folder}/${file.path}`, '', `${file.path} is not used by the guide`);
    }
  }

  // The budget holds whatever guide.json says, so it is checked even when the guide is not readable.
  checkFileBudgets(folder, files, problem);
  const folderBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (folderBytes > GUIDE_FOLDER_MAX_BYTES) problem(folder, '', `the folder is ${mib(folderBytes)} MiB, over the 20 MiB a guide may be`);
}

/** Each audio and image file held to its own budget, by its extension. */
function checkFileBudgets(folder: string, files: readonly FolderFile[], problem: Report): void {
  for (const file of files) {
    if (file.path.endsWith('.m4a') && file.bytes > NARRATION_MAX_BYTES) {
      problem(`${folder}/${file.path}`, '', `${file.path} is ${mib(file.bytes)} MiB, over the 5 MiB a narration file may be`);
    }
    if (IMAGE_EXTENSION.test(file.path) && file.bytes > IMAGE_MAX_BYTES) {
      problem(`${folder}/${file.path}`, '', `${file.path} is ${mib(file.bytes)} MiB, over the 1 MiB an image may be`);
    }
  }
}

/** Where a clip's files are checked: the folder they are in, the file that names them, and what is known already. */
interface ClipFiles {
  readonly dir: string;
  /** The folder's name, as problems give it. */
  readonly folder: string;
  /** The file that names the clips, as problems give it. */
  readonly file: string;
  readonly used: Set<string>;
  /** Each audio file's length, read once; undefined when it cannot be read. */
  readonly lengths: Map<string, number | undefined>;
  /** The captions files checked already. */
  readonly captioned: Set<string>;
  readonly problem: Report;
}

/** A clip's files: there, used, and each in a format and size the app can show (spec/guides.md §9). */
function checkClip(files: ClipFiles, path: string, clip: Clip): void {
  const { dir, folder, file, used, lengths, captioned, problem } = files;
  /** Whether the file at `key` is there; it is used either way. */
  const there = (key: string, at: string): boolean => {
    used.add(at);
    if (statOf(join(dir, at))?.isFile()) return true;
    problem(file, `${path}/${key}`, `no file ${at}`);
    return false;
  };
  if (clip.kind === 'image') {
    if (there('src', clip.src)) checkImage(dir, folder, clip.src, problem);
    return;
  }
  const audioThere = there('src', clip.src);
  const captionsThere = there('captions', clip.captions);
  if (audioThere && !lengths.has(clip.src)) lengths.set(clip.src, narrationLength(dir, folder, clip.src, problem));
  if (captionsThere && !captioned.has(clip.captions)) {
    captioned.add(clip.captions);
    checkCaptions(dir, folder, clip.captions, lengths.get(clip.src), problem);
  }
}

/** An image read from its header, held to its extension and to the size a phone shows without waste. */
function checkImage(dir: string, folder: string, path: string, problem: Report): void {
  const file = `${folder}/${path}`;
  let info: ImageInfo;
  try {
    info = readImageInfo(readFileSync(join(dir, path)));
  } catch (error) {
    // The reader throws only to say what the file lacks; that is the guide's problem, said where it is.
    if (!(error instanceof Error)) throw error;
    problem(file, '', `${path} is not an image the app can show: ${error.message}`);
    return;
  }
  const named = path.endsWith('.webp') ? 'webp' : 'jpeg';
  if (info.format !== named) problem(file, '', `${path} is a ${info.format.toUpperCase()} file, not what its name says`);
  const longSide = Math.max(info.width, info.height);
  if (longSide > IMAGE_MAX_SIDE_PX) problem(file, '', `${path} is ${info.width} × ${info.height} px; its long side is at most ${IMAGE_MAX_SIDE_PX}`);
}

/** A narration file's length from its header, each way its format is wrong a problem; undefined if it has no header. */
function narrationLength(dir: string, folder: string, path: string, problem: Report): number | undefined {
  const file = `${folder}/${path}`;
  const bytes = readFileSync(join(dir, path));
  let info: M4aInfo;
  try {
    info = readM4aInfo(bytes);
  } catch (error) {
    // The reader throws only to say what the file lacks; that is the guide's problem, said where it is.
    if (!(error instanceof Error)) throw error;
    problem(file, '', `${path} is not an .m4a the app can play: ${error.message}`);
    return undefined;
  }
  if (info.audioObjectType !== AAC_LC) problem(file, '', `${path} is not AAC-LC (audio object type ${info.audioObjectType})`);
  if (info.channels !== 1) problem(file, '', `${path} has ${info.channels} channels; narration is mono`);
  const kbps = (bytes.length * 8) / info.durationS / 1000;
  if (kbps > NARRATION_MAX_KBPS) problem(file, '', `${path} is ${kbps.toFixed(1)} kbit/s, over the ${NARRATION_MAX_KBPS} a narration may be`);
  return info.durationS;
}

/** A captions file read with the app's reader and held to its narration, `lengthS` when that is known; each way it fails a problem. */
function checkCaptions(dir: string, folder: string, path: string, lengthS: number | undefined, problem: Report): void {
  const file = `${folder}/${path}`;
  const text = readFileSync(join(dir, path), 'utf8');
  let cues: CaptionCue[];
  try {
    cues = parseVtt(text);
  } catch (error) {
    // The reader throws only to say what the file holds that the app cannot show; that is the guide's problem.
    if (!(error instanceof Error)) throw error;
    problem(file, '', `${path} is not captions the app can show: ${error.message}`);
    return;
  }
  if (cues.length === 0) problem(file, '', `${path} has no captions`);
  cues.forEach((cue, k) => {
    const n = k + 1;
    const before = k > 0 ? cues[k - 1] : undefined;
    // One rule for both order and overlap: a cue out of order starts before the one ahead of it ends.
    if (before !== undefined && cue.startS < before.endS) {
      problem(file, '', `caption ${n} starts at ${cue.startS} s, before caption ${n - 1} ends at ${before.endS} s`);
    }
    if (lengthS !== undefined && cue.endS > lengthS) problem(file, '', `caption ${n} ends at ${cue.endS} s, past the end of the narration, ${lengthS} s`);
    if (cue.lines.length > CAPTION_MAX_LINES) problem(file, '', `caption ${n} has ${cue.lines.length} lines; a caption has at most ${CAPTION_MAX_LINES}`);
    cue.lines.forEach((line, l) => {
      // Characters as a reader counts them, so a letter outside the BMP is one, not two UTF-16 units.
      const count = [...line].length;
      if (count > CAPTION_MAX_LINE_CHARS) problem(file, '', `caption ${n}, line ${l + 1} is ${count} characters; a line has at most ${CAPTION_MAX_LINE_CHARS}`);
    });
    // Only between captions: a narration may open and close on silence. An overlap was reported above.
    // In whole milliseconds, as the file writes times, so 4.001 - 1.001 is exactly 3.
    const gapMs = before === undefined ? 0 : Math.round((cue.startS - before.endS) * 1000);
    if (gapMs > CAPTION_MAX_GAP_S * 1000) {
      problem(file, '', `${gapMs / 1000} s with no caption before caption ${n}; a narration goes at most ${CAPTION_MAX_GAP_S} s without one`);
    }
  });
}

/** guide.json, if it is there, is JSON and passes the schema; each way it fails is a problem. */
function readGuide(dir: string, guideFile: string, problem: Report): Guide | undefined {
  const path = join(dir, 'guide.json');
  if (!statOf(path)?.isFile()) {
    problem(guideFile, '', 'no guide.json');
    return undefined;
  }
  let guide: unknown;
  try {
    guide = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    problem(guideFile, '', `guide.json is not JSON: ${error.message}`);
    return undefined;
  }
  if (isGuide(guide)) return guide;
  for (const error of isGuide.errors ?? []) problem(guideFile, error.instancePath, schemaReason(error));
  return undefined;
}

/** ajv's message, with the value it is about where ajv keeps that apart. */
function schemaReason(error: ErrorObject): string {
  const params: { additionalProperty?: string; allowedValues?: readonly unknown[]; allowedValue?: unknown } = error.params;
  if (params.additionalProperty !== undefined) return `${error.message}: ${params.additionalProperty}`;
  if (params.allowedValues !== undefined) return `${error.message}: ${params.allowedValues.join(', ')}`;
  if ('allowedValue' in params) return `${error.message}: ${String(params.allowedValue)}`;
  return error.message ?? error.keyword;
}

interface FolderFile {
  /** From the guide's folder, with forward slashes, as a guide names it. */
  readonly path: string;
  readonly bytes: number;
  readonly link: boolean;
}

/** Every file under `dir`, however deep. A link is listed but not followed, so nothing outside the folder is read. */
function filesIn(dir: string, prefix = ''): FolderFile[] {
  const files: FolderFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${prefix}${entry.name}`;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) files.push({ path, bytes: 0, link: true });
    else if (entry.isDirectory()) files.push(...filesIn(full, `${path}/`));
    else files.push({ path, bytes: lstatSync(full).size, link: false });
  }
  return files;
}

/** What is at `path` without following a link; undefined if nothing is. Any other failure to look is thrown. */
function statOf(path: string): Stats | undefined {
  return lstatSync(path, { throwIfNoEntry: false });
}

const mib = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);
