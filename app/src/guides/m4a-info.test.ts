/**
 * The fixtures are real files, made once with ffmpeg 6 and checked in; the
 * tests never run ffmpeg. From app/src/guides/fixtures:
 *
 *   ffmpeg -f lavfi -i "sine=frequency=440:duration=2:sample_rate=22050" -ac 1 -c:a aac -b:a 24k \
 *     -map_metadata -1 -fflags +bitexact -flags:a +bitexact -movflags +faststart tone-mono.m4a
 *   ffmpeg -f lavfi -i "sine=frequency=440:duration=2:sample_rate=22050" -ac 2 -c:a aac -b:a 32k \
 *     -map_metadata -1 -fflags +bitexact -flags:a +bitexact -movflags +faststart tone-stereo.m4a
 *
 * ffprobe says both are AAC LC, 22050 Hz, 2.000000 s; tone-mono has one
 * channel, tone-stereo two. This ffmpeg has no HE-AAC encoder (that needs
 * libfdk_aac), so the file that is not AAC-LC is tone-mono with its
 * AudioSpecificConfig changed to object type 5 (withObjectType).
 */

import { describe, it, expect } from 'vitest';
import { readM4aInfo } from './m4a-info';
import { indexOfType, readFixture, withObjectType } from './m4a.testdata';

/** A box: a 32-bit size, a four-letter type, then its content. */
function box(type: string, ...content: Uint8Array[]): Uint8Array {
  const size = 8 + content.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const part of content) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** Big-endian unsigned integers of the given byte widths. */
function uint(width: 1 | 2 | 4 | 8, value: number | bigint): Uint8Array {
  const bytes = new Uint8Array(width);
  const view = new DataView(bytes.buffer);
  if (width === 1) view.setUint8(0, Number(value));
  else if (width === 2) view.setUint16(0, Number(value));
  else if (width === 4) view.setUint32(0, Number(value));
  else view.setBigUint64(0, BigInt(value));
  return bytes;
}

/** An esds descriptor: its tag, a one-byte length, its content. */
const descriptor = (tag: number, ...content: Uint8Array[]): Uint8Array => {
  const body = content.flatMap((part) => [...part]);
  return new Uint8Array([tag, body.length, ...body]);
};

/** Fields of the given bit widths, packed from the high bit, the last byte padded with zeros. */
function bits(...fields: [value: number, width: number][]): Uint8Array {
  const all = fields.map(([value, width]) => value.toString(2).padStart(width, '0')).join('');
  return new Uint8Array((all.padEnd(Math.ceil(all.length / 8) * 8, '0').match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
}
const join = (...parts: Uint8Array[]): Uint8Array => new Uint8Array(parts.flatMap((part) => [...part]));
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
/** AAC-LC, 22050 Hz, one channel. */
const LC_MONO = bits([2, 5], [7, 4], [1, 4]);
const FTYP = box('ftyp', ascii('M4A '), uint(4, 0));
/** Version 0: a timescale of 1000 and a length of `duration` in it. */
const mvhdOf = (timescale: number, duration: number): Uint8Array => box('mvhd', uint(4, 0), uint(4, 0), uint(4, 0), uint(4, timescale), uint(4, duration));
const decoderConfig = (asc: Uint8Array): Uint8Array => descriptor(4, uint(1, 0x40), uint(1, 0x15), new Uint8Array(11), descriptor(5, asc));
/** ES_ID 1 and no optional fields, unless `es` gives the ES descriptor's content whole. */
const esdsOf = (asc: Uint8Array = LC_MONO, es: Uint8Array = join(uint(2, 1), uint(1, 0), decoderConfig(asc))): Uint8Array =>
  box('esds', uint(4, 0), descriptor(3, es));
/** A sound sample entry's fixed fields, of QuickTime version 0, 1 or 2. */
const entryOf = (version: 0 | 1 | 2): Uint8Array => join(new Uint8Array(8), uint(2, version), new Uint8Array(18 + [0, 16, 36][version]));
/** The smallest file the reader takes: two seconds of mono AAC-LC by its header, each part replaceable. */
function file({
  mvhd = mvhdOf(1000, 2000),
  entry = entryOf(0),
  sound = esdsOf(),
  after = new Uint8Array(0),
}: { mvhd?: Uint8Array; entry?: Uint8Array; sound?: Uint8Array; after?: Uint8Array } = {}): Uint8Array {
  const stsd = box('stsd', uint(4, 0), uint(4, 1), box('mp4a', entry, sound));
  return join(FTYP, box('moov', mvhd, box('trak', box('mdia', box('minf', box('stbl', stsd))))), after);
}

describe('readM4aInfo', () => {
  it('reads a mono AAC-LC file', () => {
    const info = readM4aInfo(readFixture('tone-mono'));
    expect(info.durationS).toBeCloseTo(2, 1);
    expect(info.audioObjectType).toBe(2);
    expect(info.channels).toBe(1);
  });

  it('reads a stereo file as two channels', () => {
    expect(readM4aInfo(readFixture('tone-stereo')).channels).toBe(2);
  });

  it('reads an object type other than AAC-LC', () => {
    expect(readM4aInfo(withObjectType(readFixture('tone-mono'), 5)).audioObjectType).toBe(5);
  });

  it('reads a version 1 mvhd, whose length takes 64 bits', () => {
    const duration = 2n ** 32n + 500n;
    const mvhd = box('mvhd', uint(4, 0x01000000), uint(8, 0), uint(8, 0), uint(4, 1000), uint(8, duration));
    // ES_ID 1, no optional fields; MPEG-4 audio; AAC-LC, 22050 Hz, one channel.
    const esds = box(
      'esds',
      uint(4, 0),
      descriptor(3, uint(2, 1), uint(1, 0), descriptor(4, uint(1, 0x40), uint(1, 0x15), new Uint8Array(11), descriptor(5, new Uint8Array([0x13, 0x88])))),
    );
    const stsd = box('stsd', uint(4, 0), uint(4, 1), box('mp4a', new Uint8Array(28), esds));
    const file = new Uint8Array([
      ...box('ftyp', new TextEncoder().encode('M4A '), uint(4, 0)),
      ...box('moov', mvhd, box('trak', box('mdia', box('minf', box('stbl', stsd))))),
    ]);
    expect(readM4aInfo(file)).toEqual({ durationS: Number(duration) / 1000, audioObjectType: 2, channels: 1 });
  });

  const mono = readFixture('tone-mono');
  const renamed = (from: string, to: string): Uint8Array => {
    const copy = mono.slice();
    copy.set(new TextEncoder().encode(to), indexOfType(copy, from));
    return copy;
  };
  it.each<[string, Uint8Array, string]>([
    ['no bytes', new Uint8Array(0), 'not an MP4 file: no ftyp box'],
    ['text', new TextEncoder().encode('This is not a narration.'), 'not an MP4 file: no ftyp box'],
    ['half a file', mono.subarray(0, mono.length / 2), `box mdat at ${indexOfType(mono, 'mdat') - 4} runs past the end of the file`],
    ['a file with no moov box', renamed('moov', 'free'), 'no moov box'],
    ['a file with no mvhd box', renamed('mvhd', 'free'), 'no mvhd box'],
    ['a file whose track is not mp4a', renamed('mp4a', 'free'), 'no mp4a audio track'],
    ['an mp4a entry with no esds box', renamed('esds', 'free'), 'no esds box'],
  ])('refuses %s, saying what is missing', (_, bytes, message) => {
    expect(() => readM4aInfo(bytes)).toThrow(new Error(message));
  });

  it('refuses audio that is not MPEG-4 audio', () => {
    const copy = mono.slice();
    // The byte after the DecoderConfigDescriptor's header: tag 4, then a length padded to four bytes.
    const tag = copy.findIndex((byte, i) => i > indexOfType(copy, 'esds') && byte === 4 && copy[i + 1] === 0x80);
    copy[tag + 5] = 0x6b;
    expect(() => readM4aInfo(copy)).toThrow(new Error('not MPEG-4 audio: object type indication 0x6b'));
  });

  const twoSecondsMono = { durationS: 2, audioObjectType: 2, channels: 1 };
  it.each<[string, Uint8Array, object]>([
    ['the smallest file', file(), twoSecondsMono],
    ['a box whose size takes 64 bits', file({ mvhd: join(uint(4, 1), ascii('mvhd'), uint(8, 36), uint(4, 0), uint(4, 0), uint(4, 0), uint(4, 1000), uint(4, 2000)) }), twoSecondsMono],
    ['a last box that runs to the end of the file', file({ after: join(uint(4, 0), ascii('mdat'), new Uint8Array(40)) }), twoSecondsMono],
    ['a QuickTime version 1 sound entry', file({ entry: entryOf(1) }), twoSecondsMono],
    ['a QuickTime version 2 sound entry', file({ entry: entryOf(2) }), twoSecondsMono],
    [
      'an ES descriptor with every optional field',
      file({ sound: esdsOf(LC_MONO, join(uint(2, 1), uint(1, 0xe0), uint(2, 9), uint(1, 1), uint(1, 0x2f), uint(2, 9), decoderConfig(LC_MONO))) }),
      twoSecondsMono,
    ],
    ['an object type past 31, by its escape', file({ sound: esdsOf(bits([31, 5], [2, 6], [7, 4], [1, 4])) }), { ...twoSecondsMono, audioObjectType: 34 }],
    ['a sample rate written out before the channels', file({ sound: esdsOf(bits([2, 5], [15, 4], [22050, 24], [2, 4])) }), { ...twoSecondsMono, channels: 2 }],
  ])('reads %s', (_, bytes, info) => {
    expect(readM4aInfo(bytes)).toEqual(info);
  });

  it.each<[string, Uint8Array, string]>([
    ['a box smaller than its own header', file({ after: join(uint(4, 4), ascii('free')) }), `box free at ${file().length} is smaller than its header`],
    ['a timescale of 0', file({ mvhd: mvhdOf(0, 2000) }), 'mvhd has a timescale of 0'],
    ['a length of 0, as a fragmented file has', file({ mvhd: mvhdOf(1000, 0) }), 'mvhd does not give the length of the file'],
    ['a length that is not known', file({ mvhd: mvhdOf(1000, 0xffffffff) }), 'mvhd does not give the length of the file'],
    ['an mvhd cut short', file({ mvhd: box('mvhd', uint(4, 0)) }), `box mvhd at ${FTYP.length + 8} is too short for its fields`],
    ['a descriptor longer than its box', file({ sound: box('esds', uint(4, 0), new Uint8Array([3, 40, 0, 1, 0])) }), 'a descriptor in the esds box runs past its end'],
    [
      'a descriptor length of five bytes',
      file({ sound: box('esds', uint(4, 0), new Uint8Array([3, 0x80, 0x80, 0x80, 0x80, 0x03, 0, 1, 0])) }),
      'a descriptor in the esds box runs past its end',
    ],
    ['an audio specific config cut short', file({ sound: esdsOf(new Uint8Array([0x13])) }), 'the audio specific config is too short'],
    ['an ES descriptor with no decoder config', file({ sound: esdsOf(LC_MONO, join(uint(2, 1), uint(1, 0))) }), 'no decoder config in the esds box'],
  ])('refuses %s', (_, bytes, message) => {
    expect(() => readM4aInfo(bytes)).toThrow(new Error(message));
  });
});
