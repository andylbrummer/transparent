import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUCKET_VARIABLE, checkMedia, declaredVideos, putVideo, SITE_ORIGINS, VIDEO_CACHE_CONTROL, type DeclaredVideo } from '../../scripts/media-video';
import { EXAMPLE_GUIDE } from './example-guide.testdata';
import { readMp4VideoInfo } from './m4a-info';

/** A box: a big-endian size, a four-letter type and its content. */
function box(type: string, ...content: Uint8Array[]): Uint8Array {
  const size = 8 + content.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const part of content) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
/** `count` bytes, the 32-bit words at the given byte offsets set. */
function fields(count: number, words: Record<number, number> = {}, text: Record<number, string> = {}): Uint8Array {
  const out = new Uint8Array(count);
  const view = new DataView(out.buffer);
  for (const [at, value] of Object.entries(words)) view.setUint32(Number(at), value);
  for (const [at, value] of Object.entries(text)) out.set(new TextEncoder().encode(value), Number(at));
  return out;
}
/** A track: its tkhd, its handler and one sample entry of `codec`, version 0 throughout. */
function trak(handler: string, codec: string, width = 0, height = 0): Uint8Array {
  const tkhd = box('tkhd', fields(84, { 76: width * 65536, 80: height * 65536 }));
  const hdlr = box('hdlr', fields(24, {}, { 8: handler }));
  const stsd = box('stsd', fields(8, { 4: 1 }), box(codec, fields(8)));
  return box('trak', tkhd, box('mdia', hdlr, box('minf', box('stbl', stsd))));
}
/** A small MP4 header: `seconds` long, one picture track of `codecs[0]` at width × height, then a sound track. */
function mp4(seconds = 94, width = 1280, height = 720, codecs: [string, string] = ['avc1', 'mp4a']): Uint8Array {
  const mvhd = box('mvhd', fields(100, { 12: 1000, 16: seconds * 1000 }));
  return new Uint8Array([...box('ftyp', fields(8, {}, { 0: 'isom' })), ...box('moov', mvhd, trak('vide', codecs[0], width, height), trak('soun', codecs[1]))]);
}

describe('readMp4VideoInfo', () => {
  it("reads a film's length, its picture's size and its tracks' codecs", () => {
    expect(readMp4VideoInfo(mp4())).toEqual({ durationS: 94, width: 1280, height: 720, codecs: ['avc1', 'mp4a'] });
  });

  it('refuses a file with no picture, and one that is not an MP4', () => {
    const soundOnly = new Uint8Array([...box('ftyp', fields(8)), ...box('moov', box('mvhd', fields(100, { 12: 1000, 16: 5000 })), trak('soun', 'mp4a'))]);
    expect(() => readMp4VideoInfo(soundOnly)).toThrow('no video track');
    expect(() => readMp4VideoInfo(new TextEncoder().encode('not a film at all'))).toThrow('not an MP4 file');
  });
});

/** putVideo against a fake file system and a fake uploader that answers `status`. */
function put(argv: string[], env: Record<string, string> = {}, file = mp4(), status = 0) {
  const ran: { command: string; args: readonly string[] }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const code = putVideo(argv, env, {
    readFile: () => file,
    run: (command, args) => (ran.push({ command, args }), status),
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, ran, out, err };
}
const BUCKET = { [BUCKET_VARIABLE]: 'transparent-media' };
const SHA = createHash('sha256').update(mp4()).digest('hex');

describe('guides:put-video', () => {
  it('refuses to upload without the bucket named, and runs nothing', () => {
    const t = put(['down-through-the-earth', 'film/Wave Paths.mp4']);
    expect(t.code).toBe(1);
    expect(t.ran).toEqual([]);
    expect(t.out).toEqual([]);
    expect(t.err.join('\n')).toContain(`set ${BUCKET_VARIABLE}`);
  });

  it('names the object by its hash in the guide folder, uploads it through devkey, and prints the block', () => {
    const t = put(['down-through-the-earth', 'film/Wave Paths.mp4'], BUCKET);
    const key = `guides/down-through-the-earth/wave-paths.${SHA.slice(0, 8)}.mp4`;
    expect(t.code).toBe(0);
    expect(t.ran).toEqual([
      {
        command: 'devkey',
        args: ['run', 'cloudflare', '--', 'npx', 'wrangler', 'r2', 'object', 'put', `transparent-media/${key}`, '--file', 'film/Wave Paths.mp4', '--content-type', 'video/mp4', '--cache-control', VIDEO_CACHE_CONTROL, '--remote'],
      },
    ]);
    expect(JSON.parse(t.out.join('\n'))).toEqual({
      src: `https://media.transparent.sbdev.io/${key}`,
      video: { bytes: mp4().length, sha256: SHA, durationS: 94, width: 1280, height: 720 },
    });
  });

  it('puts a media layer film under media/', () => {
    const t = put(['media', 'quake.mp4'], BUCKET);
    expect((JSON.parse(t.out.join('\n')) as { src: string }).src).toBe(`https://media.transparent.sbdev.io/media/quake.${SHA.slice(0, 8)}.mp4`);
  });

  it('prints the block and uploads nothing on a dry run, which needs no bucket', () => {
    const t = put(['--dry-run', 'down-through-the-earth', 'film.mp4']);
    expect(t.code).toBe(0);
    expect(t.ran).toEqual([]);
    expect(t.err.join('\n')).toContain('dry run, nothing uploaded');
    expect(JSON.parse(t.out.join('\n'))).toMatchObject({ video: { sha256: SHA } });
  });

  it('prints nothing for the guide when the upload fails', () => {
    const t = put(['down-through-the-earth', 'film.mp4'], BUCKET, mp4(), 2);
    expect(t.code).toBe(1);
    expect(t.out).toEqual([]);
    expect(t.err.join('\n')).toContain('exit status 2');
  });

  it.each<[string, string[], Uint8Array, string]>([
    ['no file named', ['down-through-the-earth'], mp4(), 'usage:'],
    ['a folder that is no guide id', ['../elsewhere', 'film.mp4'], mp4(), 'is not a guide id'],
    ['a film over 1080p', ['media', 'film.mp4'], mp4(94, 3840, 2160), '3840 × 2160 is over 1080p'],
    ['a film in another codec', ['media', 'film.mp4'], mp4(94, 1280, 720, ['hvc1', 'mp4a']), 'no H.264 (avc1) track: hvc1, mp4a'],
    ['a film with no sound track of AAC', ['media', 'film.mp4'], mp4(94, 1280, 720, ['avc1', 'opus']), 'no AAC (mp4a) track: avc1, opus'],
    ['a file that is no film', ['media', 'film.mp4'], new TextEncoder().encode('not a film'), 'film.mp4: not an MP4 file'],
  ])('refuses %s, uploading nothing', (_, argv, file, reason) => {
    const t = put(argv, BUCKET, file);
    expect(t.code).toBe(1);
    expect(t.ran).toEqual([]);
    expect(t.err.join('\n')).toContain(reason);
  });
});

const FILM = `https://media.transparent.sbdev.io/media/quake.${SHA.slice(0, 8)}.mp4`;
const declared = (sha256 = SHA, bytes = mp4().length): DeclaredVideo => ({
  where: 'media/hotspots.json /hotspots/0/clip',
  clip: {
    kind: 'video',
    src: FILM,
    captions: 'video/quake.vtt',
    poster: 'images/quake.webp',
    video: { bytes, sha256, durationS: 94, width: 1280, height: 720 },
    credit: EXAMPLE_GUIDE.credits[0],
  },
});

/** A media host serving the film: `headers` for every HEAD, the bytes for a GET; each request recorded. */
function host(headers: Record<string, string> = {}, status = 200) {
  const asked: string[] = [];
  const fetch = (url: string, init?: RequestInit): Promise<Response> => {
    const origin = new Headers(init?.headers).get('origin');
    asked.push(`${init?.method ?? 'GET'} ${url}${origin ? ` from ${origin}` : ''}`);
    const head = init?.method === 'HEAD';
    const served = { 'content-length': String(mp4().length), 'content-type': 'video/mp4', 'access-control-allow-origin': origin ?? '', ...headers };
    // mp4() is a fresh array over a buffer of its own length, so the buffer is the file.
    return Promise.resolve(new Response(head || status !== 200 ? null : (mp4().buffer as ArrayBuffer), { status, headers: served }));
  };
  return { fetch, asked };
}

describe('guides:check-media', () => {
  it('finds nothing wrong with a film served as declared, asking once for each site and once for the bytes', async () => {
    const h = host();
    expect(await checkMedia([declared()], h.fetch)).toEqual([]);
    expect(h.asked).toEqual([...SITE_ORIGINS.map((origin) => `HEAD ${FILM} from ${origin}`), `GET ${FILM}`]);
  });

  it.each<[string, DeclaredVideo, ReturnType<typeof host>, string]>([
    ['a film that is not there', declared(), host({}, 404), 'HEAD answered 404'],
    ['a length other than declared', declared(SHA, 12), host(), `${mp4().length} bytes served, 12 declared`],
    ['a film served as another type', declared(), host({ 'content-type': 'application/octet-stream' }), 'served as application/octet-stream, not video/mp4'],
    ['a host with no CORS for the site', declared(), host({ 'access-control-allow-origin': 'https://example.org' }), 'CORS does not allow https://transparent.sbdev.io'],
    ['bytes that hash to something else', declared('f'.repeat(64)), host(), `its sha256 is ${SHA}, not the declared ${'f'.repeat(64)}`],
  ])('reports %s', async (_, video, h, reason) => {
    const problems = await checkMedia([video], h.fetch);
    expect(problems.some((problem) => problem.startsWith(`media/hotspots.json /hotspots/0/clip: ${FILM}: `) && problem.includes(reason)),problems.join('\n')).toBe(true);
  });

  it('finds the videos the guides and the media layer declare', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-'));
    mkdirSync(join(root, 'guides', EXAMPLE_GUIDE.id), { recursive: true });
    mkdirSync(join(root, 'media'));
    const guide = JSON.parse(JSON.stringify(EXAMPLE_GUIDE)) as { chapters: { steps: { hotspots?: unknown[] }[] }[] };
    guide.chapters[0].steps[1].hotspots = [{ id: 'film', title: 'Watch', anchor: { kind: 'horizon', azDeg: 0, altDeg: 0 }, clip: declared().clip }];
    writeFileSync(join(root, 'guides', 'index.json'), JSON.stringify([EXAMPLE_GUIDE.id]));
    writeFileSync(join(root, 'guides', EXAMPLE_GUIDE.id, 'guide.json'), JSON.stringify(guide));
    writeFileSync(join(root, 'media', 'hotspots.json'), JSON.stringify({ formatVersion: 1, language: 'en', hotspots: [{ id: 'quake', title: 'Q', anchor: { kind: 'horizon', azDeg: 0, altDeg: 0 }, clip: declared().clip }] }));
    expect(declaredVideos(root).map((video) => video.where)).toEqual([`guides/${EXAMPLE_GUIDE.id}/guide.json /chapters/0/steps/1/hotspots/0/clip`, 'media/hotspots.json /hotspots/0/clip']);
  });

  it('finds no video in what ships today', () => {
    expect(declaredVideos('public')).toEqual([]);
  });
});
