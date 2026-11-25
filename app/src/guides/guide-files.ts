/**
 * A guide's files as the app fetches them (spec/guides.md §3): index.json, each guide.json, and the URL of a file in a
 * guide's folder. Also the deep link, ?guide=<id>&step=<chapter>/<step> (§4). Every failure is worded to be shown.
 *
 * A guide.json is not checked against the schema here. The validator (guides.test.ts) checks every guide before it is
 * merged, and ajv stays out of the app. At run time only the format version and the id are checked: a guide written
 * for a newer app says so (§5.5) rather than failing somewhere inside a step.
 */

import { GUIDE_FORMAT_VERSION, ID_PATTERN, type Guide } from './format';
import type { GuideListing } from './guide-list';

export interface GuideFilesDeps {
  /** As the browser's fetch. */
  fetch(url: string): Promise<Response>;
  /** import.meta.env.BASE_URL: ends with a slash. */
  readonly baseUrl: string;
}

/** Where a deep link starts a guide. Steps count from 0 here; the link counts from 1. */
export interface GuideLink {
  readonly id: string;
  readonly at: { readonly chapterIndex: number; readonly stepIndex: number } | null;
}

/** A guide id: its folder's name and what ?guide= names. */
const GUIDE_ID = new RegExp(ID_PATTERN);
/** A step in a link: chapter and step, each counted from 1. Four digits is far more than a guide has. */
const LINK_STEP = /^([1-9]\d{0,3})\/([1-9]\d{0,3})$/;
const INDEX_FILE = 'guides/index.json';

/** A file of a guide's folder, under the base URL: also how a failure names it. */
const guidePath = (id: string, path: string): string => `guides/${id}/${path}`;

/** The URL of a file in a guide's folder. */
export function guideFileUrl(baseUrl: string, guide: Pick<Guide, 'id'>, path: string): string {
  return baseUrl + guidePath(guide.id, path);
}

/** The guide ids index.json lists, in the order the guide list shows them. Rejects with an Error that names the file. */
export async function fetchGuideIds(deps: GuideFilesDeps): Promise<string[]> {
  const json = await fetchJson(deps, INDEX_FILE);
  if (!Array.isArray(json) || !json.every((id) => typeof id === 'string' && GUIDE_ID.test(id))) {
    throw new Error(`${INDEX_FILE}: is not a list of guide ids`);
  }
  return json as string[];
}

/**
 * Every guide index.json lists, in its order. A guide that cannot be fetched is listed with its problem rather than
 * failing the rest; only an unreadable index.json rejects.
 */
export async function fetchGuides(deps: GuideFilesDeps): Promise<GuideListing[]> {
  const ids = await fetchGuideIds(deps);
  return Promise.all(
    ids.map((id) =>
      fetchGuide(deps, id).then(
        (guide): GuideListing => ({ id, guide }),
        (error: unknown): GuideListing => ({ id, problem: error instanceof Error ? error.message : String(error) })
      )
    )
  );
}

/**
 * A guide's guide.json. Rejects with an Error to show the user: the file and why, or that the app is too old for it.
 * Not async on purpose: an id that is not a guide id is a wiring fault, since guideLink and fetchGuideIds check theirs,
 * so it throws at once.
 */
export function fetchGuide(deps: GuideFilesDeps, id: string): Promise<Guide> {
  if (!GUIDE_ID.test(id)) throw new Error(`not a guide id: ${JSON.stringify(id)}`);
  return fetchGuideFile(deps, id);
}

async function fetchGuideFile(deps: GuideFilesDeps, id: string): Promise<Guide> {
  const file = guidePath(id, 'guide.json');
  const json = await fetchJson(deps, file);
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error(`${file}: is not a guide`);
  const guide = json as Record<string, unknown>;
  const version = guide.formatVersion;
  if (version !== GUIDE_FORMAT_VERSION) {
    if (typeof version === 'number' && version > GUIDE_FORMAT_VERSION) throw new Error('This guide needs a newer version of the app.');
    throw new Error(`${file}: formatVersion ${JSON.stringify(version)} is not ${GUIDE_FORMAT_VERSION}`);
  }
  if (guide.id !== id) throw new Error(`${file}: its id is ${JSON.stringify(guide.id)}`);
  // The rest is as the schema has it: the validator saw to that before the guide was merged.
  return json as Guide;
}

/** `file`, under the base URL, read as JSON. Every failure names the file. */
async function fetchJson(deps: GuideFilesDeps, file: string): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetch(deps.baseUrl + file);
  } catch (error) {
    throw new Error(`${file}: could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${file}: is not JSON`);
  }
}

/**
 * ?guide=<id>[&step=<chapter>/<step>] of a location.search: null when it names no guide, a message when it cannot be
 * read. Whether the guide has that step is known only once it has been fetched, so it is not checked here.
 */
export function guideLink(search: string): GuideLink | { readonly problem: string } | null {
  const params = new URLSearchParams(search);
  const id = params.get('guide');
  if (id === null) return null;
  if (!GUIDE_ID.test(id)) return { problem: 'The link does not name a guide.' };
  const step = params.get('step');
  if (step === null) return { id, at: null };
  const counted = LINK_STEP.exec(step);
  if (!counted) return { problem: 'The link’s step should be <chapter>/<step>, counted from 1.' };
  return { id, at: { chapterIndex: Number(counted[1]) - 1, stepIndex: Number(counted[2]) - 1 } };
}
