/**
 * Guide video on the R2 media host (spec/guides.md §10): what guides:put-video and guides:check-media do, apart from
 * the command line, so a test can run them against a fake uploader and a fake network.
 *
 * putVideo reads an .mp4, names it by its content, uploads it through devkey and wrangler, and prints the clip's
 * `src` and `video` block for the guide. It refuses to upload unless TRANSPARENT_MEDIA_BUCKET names the bucket: an
 * upload is a write to a public host, so it never happens by default. --dry-run does everything but the upload and
 * needs no configuration, so a contributor can write the block a maintainer will upload for.
 *
 * checkMedia fetches every video the shipped guides and the media layer declare, and fails on a size, a type, a
 * missing CORS header or a hash that is not what the guide says. It needs the network, so it is not in npm test.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Clip, Guide, MediaHotspots } from '../src/guides/format';
import { VIDEO_MAX_BYTES } from '../src/guides/guide-schema';
import { readMp4VideoInfo } from '../src/guides/m4a-info';
import { MEDIA_ORIGIN } from '../src/guides/media-origin';

/** The environment variable that must name the bucket before anything is uploaded. */
export const BUCKET_VARIABLE = 'TRANSPARENT_MEDIA_BUCKET';
/** Named by content, so cached for a year and never purged (spec/guides.md §10.1). */
export const VIDEO_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** The sites whose pages play the video: the media host's CORS has to allow both. */
export const SITE_ORIGINS = ['https://transparent.sbdev.io', 'https://andylbrummer.github.io'] as const;

type VideoClip = Extract<Clip, { kind: 'video' }>;

export interface PutVideoDeps {
  readFile(path: string): Uint8Array;
  /** Run a command, its output to the terminal; its exit status. */
  run(command: string, args: readonly string[]): number;
  log(line: string): void;
  error(line: string): void;
}

/**
 * `npm run guides:put-video -- [--dry-run] <guide id | media> <file.mp4>`. The exit status: 0 done, 1 refused or
 * failed, each reason said on the error stream.
 */
export function putVideo(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, deps: PutVideoDeps): number {
  const dryRun = argv.includes('--dry-run');
  const [folderName, file, ...rest] = argv.filter((arg) => arg !== '--dry-run');
  if (folderName === undefined || file === undefined || rest.length > 0) {
    deps.error('usage: npm run guides:put-video -- [--dry-run] <guide id | media> <file.mp4>');
    return 1;
  }
  if (folderName !== 'media' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(folderName)) {
    deps.error(`${folderName} is not a guide id or "media"`);
    return 1;
  }
  const bucket = env[BUCKET_VARIABLE];
  if (!dryRun && (bucket === undefined || bucket === '')) {
    deps.error(`refusing to upload: set ${BUCKET_VARIABLE} to the bucket's name (docs/guides/VIDEO.md), or pass --dry-run`);
    return 1;
  }

  let bytes: Uint8Array;
  let header: ReturnType<typeof readMp4VideoInfo>;
  try {
    bytes = deps.readFile(file);
    header = readMp4VideoInfo(bytes);
  } catch (error) {
    deps.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const problems = videoProblems(bytes.length, header);
  for (const problem of problems) deps.error(`${file}: ${problem}`);
  if (problems.length > 0) return 1;

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `${folderName === 'media' ? 'media' : `guides/${folderName}`}/${objectName(file)}.${sha256.slice(0, 8)}.mp4`;
  const block = {
    src: `${MEDIA_ORIGIN}/${key}`,
    video: { bytes: bytes.length, sha256, durationS: Math.round(header.durationS * 1000) / 1000, width: header.width, height: header.height },
  };
  const args = [
    'run',
    'cloudflare',
    '--',
    'npx',
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucket ?? '<bucket>'}/${key}`,
    '--file',
    file,
    '--content-type',
    'video/mp4',
    '--cache-control',
    VIDEO_CACHE_CONTROL,
    '--remote',
  ];
  if (dryRun) {
    // Quoted where it has a space, so the line can be pasted into a shell.
    const shown = args.map((arg) => (/[\s<>]/.test(arg) ? `'${arg}'` : arg)).join(' ');
    deps.error(`dry run, nothing uploaded; the upload would be: devkey ${shown}`);
  } else {
    const status = deps.run('devkey', args);
    if (status !== 0) {
      deps.error(`the upload failed (exit status ${status}); nothing to add to the guide`);
      return 1;
    }
  }
  // On stdout alone, so it can be piped: the clip's src and video, for the guide's JSON.
  deps.log(JSON.stringify(block, null, 2));
  return 0;
}

/** What spec/guides.md §9 asks of a video, that its header and size can say. */
export function videoProblems(bytes: number, header: ReturnType<typeof readMp4VideoInfo>): string[] {
  const problems: string[] = [];
  if (bytes > VIDEO_MAX_BYTES) problems.push(`${(bytes / 1024 / 1024).toFixed(1)} MiB is over the 200 MiB a video may be`);
  if (Math.max(header.width, header.height) > 1920 || Math.min(header.width, header.height) > 1080) {
    problems.push(`${header.width} × ${header.height} is over 1080p`);
  }
  if (!header.codecs.includes('avc1')) problems.push(`no H.264 (avc1) track: ${header.codecs.join(', ') || 'none'}`);
  if (!header.codecs.includes('mp4a')) problems.push(`no AAC (mp4a) track: ${header.codecs.join(', ') || 'none'}`);
  return problems;
}

/** The file's name as an object name's first part: lower case, hyphens for anything else, as a guide's ids. */
function objectName(file: string): string {
  const name = basename(file).replace(/\.mp4$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return name === '' ? 'video' : name;
}

/** A declared video, and where it is declared. */
export interface DeclaredVideo {
  /** As problems name it: the file, then the JSON pointer. */
  readonly where: string;
  readonly clip: VideoClip;
}

/** Every video clip the shipped guides and the media layer declare: under public/guides and public/media. */
export function declaredVideos(publicDir: string): DeclaredVideo[] {
  const found: DeclaredVideo[] = [];
  const add = (file: string, path: string, clip: Clip): void => {
    if (clip.kind === 'video') found.push({ where: `${file} ${path}`, clip });
  };
  const ids = JSON.parse(readFileSync(join(publicDir, 'guides', 'index.json'), 'utf8')) as string[];
  for (const id of ids) {
    const file = `guides/${id}/guide.json`;
    const guide = JSON.parse(readFileSync(join(publicDir, file), 'utf8')) as Guide;
    guide.chapters.forEach((chapter, c) =>
      chapter.steps.forEach((step, s) => step.hotspots?.forEach((hotspot, h) => add(file, `/chapters/${c}/steps/${s}/hotspots/${h}/clip`, hotspot.clip)))
    );
  }
  const media = JSON.parse(readFileSync(join(publicDir, 'media', 'hotspots.json'), 'utf8')) as MediaHotspots;
  media.hotspots.forEach((hotspot, h) => add('media/hotspots.json', `/hotspots/${h}/clip`, hotspot.clip));
  return found;
}

/**
 * Each way the media host fails a declared video: for each site, a HEAD that must answer 200 with the declared length,
 * video/mp4 and that site allowed by CORS; then one GET whose bytes must hash to the declared sha256.
 */
export async function checkMedia(videos: readonly DeclaredVideo[], fetch: (url: string, init?: RequestInit) => Promise<Response>): Promise<string[]> {
  const problems: string[] = [];
  for (const { where, clip } of videos) {
    const problem = (reason: string): void => void problems.push(`${where}: ${clip.src}: ${reason}`);
    let headed = true;
    for (const origin of SITE_ORIGINS) {
      const response = await fetch(clip.src, { method: 'HEAD', headers: { Origin: origin } });
      if (!response.ok) {
        problem(`HEAD answered ${response.status}`);
        headed = false;
        break;
      }
      const length = Number(response.headers.get('content-length'));
      if (length !== clip.video.bytes) problem(`${length} bytes served, ${clip.video.bytes} declared`);
      const type = response.headers.get('content-type');
      if (type !== 'video/mp4') problem(`served as ${type ?? 'no type'}, not video/mp4`);
      const allowed = response.headers.get('access-control-allow-origin');
      if (allowed !== '*' && allowed !== origin) problem(`CORS does not allow ${origin}: it cannot be a texture in the viewer there`);
    }
    if (!headed) continue;
    const response = await fetch(clip.src);
    if (!response.ok) {
      problem(`GET answered ${response.status}`);
      continue;
    }
    const sha256 = createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex');
    if (sha256 !== clip.video.sha256) problem(`its sha256 is ${sha256}, not the declared ${clip.video.sha256}`);
  }
  return problems;
}
