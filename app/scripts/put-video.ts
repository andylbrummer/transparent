/**
 * Uploads a guide's video to the media host and prints the clip's `src` and `video` for its JSON (spec/guides.md §10).
 * Refuses without TRANSPARENT_MEDIA_BUCKET; see docs/guides/VIDEO.md.
 *
 *   npm run guides:put-video -- [--dry-run] <guide id | media> <file.mp4>
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { putVideo } from './media-video';

process.exitCode = putVideo(process.argv.slice(2), process.env, {
  readFile: (path) => new Uint8Array(readFileSync(path)),
  run: (command, args) => spawnSync(command, args, { stdio: 'inherit' }).status ?? 1,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
