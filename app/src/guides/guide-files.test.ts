import { describe, expect, it } from 'vitest';
import { EXAMPLE_GUIDE } from './example-guide.testdata';
import { fetchGuide, fetchGuideIds, fetchGuides, guideFileUrl, guideLink, type GuideFilesDeps } from './guide-files';

const BASE = '/transparent/';
const GUIDE_FILE = `guides/${EXAMPLE_GUIDE.id}/guide.json`;

/** Each file a function, since a Response is read once: an Error is a fetch that rejects. */
type Files = Record<string, () => Response | Error>;

/** Deps serving `files` under BASE, recording each URL fetched. */
function setup(files: Files) {
  const fetched: string[] = [];
  const deps: GuideFilesDeps = {
    baseUrl: BASE,
    fetch(url) {
      fetched.push(url);
      const file = files[url]?.() ?? new Response('', { status: 404 });
      return file instanceof Error ? Promise.reject(file) : Promise.resolve(file);
    },
  };
  return { deps, fetched };
}

const json = (value: unknown) => () => new Response(JSON.stringify(value));
/** EXAMPLE_GUIDE with `changes` over it, as guide.json. */
const guideWith = (changes: Record<string, unknown>) => json({ ...EXAMPLE_GUIDE, ...changes });

describe('guideFileUrl', () => {
  it.each([
    ['/', '/guides/down-through-the-earth/audio/01-look-down.m4a'],
    ['/transparent/', '/transparent/guides/down-through-the-earth/audio/01-look-down.m4a'],
  ])('puts a file of the guide under base URL %s', (baseUrl, url) => {
    expect(guideFileUrl(baseUrl, EXAMPLE_GUIDE, 'audio/01-look-down.m4a')).toBe(url);
  });
});

describe('fetchGuideIds', () => {
  it('reads the ids index.json lists, in its order', async () => {
    const t = setup({ [`${BASE}guides/index.json`]: json(['second-guide', EXAMPLE_GUIDE.id]) });
    expect(await fetchGuideIds(t.deps)).toEqual(['second-guide', EXAMPLE_GUIDE.id]);
    expect(t.fetched).toEqual(['/transparent/guides/index.json']);
  });

  it.each<[string, () => Response | Error, string]>([
    ['it cannot be fetched', () => new TypeError('Failed to fetch'), 'guides/index.json: could not be fetched: Failed to fetch'],
    ['it is not found', () => new Response('', { status: 404 }), 'guides/index.json: HTTP 404'],
    ['it is not JSON', () => new Response('<!doctype html>'), 'guides/index.json: is not JSON'],
    ['it is not a list', json({ guides: [] }), 'guides/index.json: is not a list of guide ids'],
    ['it lists something other than an id', json([EXAMPLE_GUIDE.id, 7]), 'guides/index.json: is not a list of guide ids'],
    ['it lists a name that is not an id', json([EXAMPLE_GUIDE.id, '../secrets']), 'guides/index.json: is not a list of guide ids'],
  ])('rejects naming the file when %s', async (_, file, message) => {
    const t = setup({ [`${BASE}guides/index.json`]: file });
    await expect(fetchGuideIds(t.deps)).rejects.toThrow(new Error(message));
  });
});

describe('fetchGuides', () => {
  it('reads every guide the index lists, in its order, and lists one that fails with its problem', async () => {
    const t = setup({
      [`${BASE}guides/index.json`]: json(['second-guide', EXAMPLE_GUIDE.id]),
      [BASE + GUIDE_FILE]: json(EXAMPLE_GUIDE),
    });
    expect(await fetchGuides(t.deps)).toEqual([
      { id: 'second-guide', problem: 'guides/second-guide/guide.json: HTTP 404' },
      { id: EXAMPLE_GUIDE.id, guide: EXAMPLE_GUIDE },
    ]);
  });

  it('rejects when the index cannot be read', async () => {
    const t = setup({});
    await expect(fetchGuides(t.deps)).rejects.toThrow(new Error('guides/index.json: HTTP 404'));
  });
});

describe('fetchGuide', () => {
  it('reads guide.json from the guide\u2019s folder', async () => {
    const t = setup({ [BASE + GUIDE_FILE]: json(EXAMPLE_GUIDE) });
    expect(await fetchGuide(t.deps, EXAMPLE_GUIDE.id)).toEqual(EXAMPLE_GUIDE);
    expect(t.fetched).toEqual(['/transparent/guides/down-through-the-earth/guide.json']);
  });

  it.each<[string, () => Response | Error, string]>([
    ['it cannot be fetched', () => new TypeError('Failed to fetch'), `${GUIDE_FILE}: could not be fetched: Failed to fetch`],
    ['it is not found', () => new Response('', { status: 404 }), `${GUIDE_FILE}: HTTP 404`],
    ['it is not JSON', () => new Response('{"id":'), `${GUIDE_FILE}: is not JSON`],
    ['it is not an object', json([EXAMPLE_GUIDE]), `${GUIDE_FILE}: is not a guide`],
    ['it is null', json(null), `${GUIDE_FILE}: is not a guide`],
    ['it is for a newer app', guideWith({ formatVersion: 2 }), 'This guide needs a newer version of the app.'],
    ['its format version is older', guideWith({ formatVersion: 0 }), `${GUIDE_FILE}: formatVersion 0 is not 1`],
    ['its format version is not a number', guideWith({ formatVersion: '1' }), `${GUIDE_FILE}: formatVersion "1" is not 1`],
    ['its id is another guide\u2019s', guideWith({ id: 'another-guide' }), `${GUIDE_FILE}: its id is "another-guide"`],
  ])('rejects with the reason when %s', async (_, file, message) => {
    const t = setup({ [BASE + GUIDE_FILE]: file });
    await expect(fetchGuide(t.deps, EXAMPLE_GUIDE.id)).rejects.toThrow(new Error(message));
  });

  it('throws, fetching nothing, when asked for something that is not a guide id: the caller checks first', () => {
    const t = setup({});
    expect(() => fetchGuide(t.deps, '../index')).toThrow(new Error('not a guide id: "../index"'));
    expect(t.fetched).toEqual([]);
  });
});

describe('guideLink', () => {
  it.each<[string, string, ReturnType<typeof guideLink>]>([
    ['no guide', '?time=2026-11-18T12:00:00Z', null],
    ['no query at all', '', null],
    ['a guide', '?guide=down-through-the-earth', { id: 'down-through-the-earth', at: null }],
    ['a guide and a step, counted from 1', '?guide=down-through-the-earth&step=2/3', { id: 'down-through-the-earth', at: { chapterIndex: 1, stepIndex: 2 } }],
    ['a guide among other parameters', '?time=2026-11-18T12:00:00Z&guide=down-through-the-earth', { id: 'down-through-the-earth', at: null }],
    ['a name that is not a guide id', '?guide=Down%20Through', { problem: 'The link does not name a guide.' }],
    ['an empty guide', '?guide=', { problem: 'The link does not name a guide.' }],
    ['an encoded path', '?guide=..%2Fsecrets', { problem: 'The link does not name a guide.' }],
  ])('reads %s', (_, search, link) => {
    expect(guideLink(search)).toEqual(link);
  });

  it.each(['2', '0/1', '1/0', '2/3/4', 'a/b', '12345/1', '1/-1', '01/1', '+1/1', ''])('says how to write a step it cannot read: %j', (step) => {
    expect(guideLink(`?guide=down-through-the-earth&step=${encodeURIComponent(step)}`)).toEqual({
      problem: 'The link\u2019s step should be <chapter>/<step>, counted from 1.',
    });
  });
});
