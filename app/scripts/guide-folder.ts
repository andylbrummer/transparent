/**
 * The guides folder, app/public/guides, held to what the app can play:
 * index.json matches the folders, each guide passes the schema and the
 * rules of src/guides/validate.ts, and each folder holds the files its guide
 * uses, with none left over and none over budget.
 *
 * Node code (node:fs, node:path), used only by the validator's tests and
 * never bundled into the app. It lives in scripts/, the Node project, because
 * the lint keeps Node's modules and globals out of app/src; ajv is imported
 * here for the same reason. Its tests are in src/guides/.
 */

import { lstatSync, readdirSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import type { Guide } from '../src/guides/format';
import { GUIDE_SCHEMA } from '../src/guides/guide-schema';
import { guideProblems, type GuideWorld } from '../src/guides/validate';

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
    guide.chapters.forEach((chapter, c) =>
      chapter.steps.forEach((step, s) => {
        if (!('narration' in step)) return;
        for (const key of ['audio', 'captions'] as const) {
          const path = step.narration[key];
          used.add(path);
          if (!statOf(join(dir, path))?.isFile()) problem(guideFile, `/chapters/${c}/steps/${s}/narration/${key}`, `no file ${path}`);
        }
      }),
    );
    for (const file of files) {
      if (file.path !== 'guide.json' && !file.link && !used.has(file.path)) problem(`${folder}/${file.path}`, '', `${file.path} is not used by the guide`);
    }
  }

  // The budget holds whatever guide.json says, so it is checked even when the guide is not readable.
  for (const file of files) {
    if (file.path.endsWith('.m4a') && file.bytes > NARRATION_MAX_BYTES) {
      problem(`${folder}/${file.path}`, '', `${file.path} is ${mib(file.bytes)} MiB, over the 5 MiB a narration file may be`);
    }
  }
  const folderBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (folderBytes > GUIDE_FOLDER_MAX_BYTES) problem(folder, '', `the folder is ${mib(folderBytes)} MiB, over the 20 MiB a guide may be`);
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
