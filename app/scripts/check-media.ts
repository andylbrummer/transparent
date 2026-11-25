/**
 * Fetches every video the shipped guides and the media layer declare and fails on any that the media host does not
 * serve as declared (spec/guides.md §10.1). Needs the network, so it is not part of npm test: run it before a release
 * that adds or changes a video.
 *
 *   npm run guides:check-media
 */

import { fileURLToPath } from 'node:url';
import { checkMedia, declaredVideos } from './media-video';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const videos = declaredVideos(PUBLIC_DIR);
const problems = await checkMedia(videos, (url, init) => fetch(url, init));
for (const problem of problems) console.error(problem);
console.error(`${videos.length} video${videos.length === 1 ? '' : 's'} declared, ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
process.exitCode = problems.length === 0 ? 0 : 1;
