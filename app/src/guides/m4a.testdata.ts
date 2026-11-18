/**
 * The narration fixtures (fixtures/*.m4a, made with ffmpeg: see
 * m4a-info.test.ts) and the few header edits the tests make to them, so
 * that a case needs no fixture of its own.
 */

import { readFileSync } from 'node:fs';

/** A fixture's bytes, as a copy the test may change. */
export function readFixture(name: 'tone-mono' | 'tone-stereo'): Uint8Array {
  return new Uint8Array(readFileSync(`src/guides/fixtures/${name}.m4a`));
}

/** Where the four ASCII letters `type` first are: a box's type in these small files. */
export function indexOfType(bytes: Uint8Array, type: string): number {
  const code = [...type].map((letter) => letter.charCodeAt(0));
  const at = bytes.findIndex((_, i) => code.every((c, j) => bytes[i + j] === c));
  if (at < 0) throw new Error(`no ${type} in the fixture`);
  return at;
}

/** A copy whose mvhd says it lasts `seconds`. The fixtures' mvhd is version 0: timescale at 12, duration at 16. */
export function withDuration(bytes: Uint8Array, seconds: number): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const content = indexOfType(copy, 'mvhd') + 4;
  if (view.getUint8(content) !== 0) throw new Error('the fixture mvhd is not version 0');
  view.setUint32(content + 16, Math.round(seconds * view.getUint32(content + 12)));
  return copy;
}

/**
 * A copy whose AudioSpecificConfig gives `audioObjectType` (below 31). It is
 * the first byte after ffmpeg's DecoderSpecificInfo header in the esds box:
 * tag 5, then a length padded to four bytes.
 */
export function withObjectType(bytes: Uint8Array, audioObjectType: number): Uint8Array {
  const copy = bytes.slice();
  const esds = indexOfType(copy, 'esds');
  const tag = copy.findIndex((byte, i) => i > esds && byte === 5 && copy[i + 1] === 0x80 && copy[i + 2] === 0x80 && copy[i + 3] === 0x80);
  if (tag < 0) throw new Error('no DecoderSpecificInfo in the fixture');
  const config = tag + 5;
  copy[config] = (audioObjectType << 3) | (copy[config] & 0x07);
  return copy;
}
