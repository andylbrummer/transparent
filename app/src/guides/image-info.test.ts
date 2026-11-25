import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readImageInfo } from './image-info';

// Made with Pillow: Image.new('RGB', (40, 24)) saved as JPEG, lossy WebP and lossless WebP, and an RGBA 33 x 17 as
// WebP, which Pillow writes as VP8X with an alpha chunk.
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(`src/guides/fixtures/${name}`));

describe('readImageInfo', () => {
  it.each([
    ['pic.jpg', 'jpeg', 40, 24],
    ['pic-lossy.webp', 'webp', 40, 24],
    ['pic-lossless.webp', 'webp', 40, 24],
    ['pic-alpha.webp', 'webp', 33, 17],
  ])('reads %s', (name, format, width, height) => {
    expect(readImageInfo(fixture(name))).toEqual({ format, width, height });
  });

  it('refuses what is neither', () => {
    expect(() => readImageInfo(new TextEncoder().encode('<svg></svg>'))).toThrow('not a JPEG or WebP file');
    expect(() => readImageInfo(fixture('tone-mono.m4a'))).toThrow('not a JPEG or WebP file');
  });

  it('refuses a JPEG cut off before its frame header', () => {
    const jpeg = fixture('pic.jpg');
    // The SOI and a first segment's marker, nothing more.
    expect(() => readImageInfo(jpeg.slice(0, 6))).toThrow('no JPEG frame header');
  });

  it('refuses a WebP with a chunk it does not know', () => {
    const webp = fixture('pic-lossy.webp').slice();
    webp.set(new TextEncoder().encode('XXXX'), 12);
    expect(() => readImageInfo(webp)).toThrow('unknown WebP chunk "XXXX"');
  });
});
