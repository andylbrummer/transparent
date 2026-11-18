/**
 * What a narration file's MP4 header says: its length, its codec and its
 * channels. The guide validator needs these, and runs where there is no
 * ffprobe (CI and the Cloudflare build), so this reads the few boxes it
 * needs itself: ISO/IEC 14496-12 for the boxes, 14496-1 for the esds
 * descriptors and 14496-3 for the AudioSpecificConfig. Pure: it is given
 * the bytes.
 */

/** What a narration file's header says of it. */
export interface M4aInfo {
  readonly durationS: number;
  /** MPEG-4 audio object type: 2 is AAC-LC. */
  readonly audioObjectType: number;
  readonly channels: number;
}

/** A box: its four-letter type, where it starts, and where its content starts and ends. */
interface Box {
  readonly type: string;
  readonly offset: number;
  readonly start: number;
  readonly end: number;
}

/** objectTypeIndication for MPEG-4 audio (14496-1, table 5). */
const MPEG4_AUDIO = 0x40;
const ES_DESCRIPTOR = 3;
const DECODER_CONFIG = 4;
const DECODER_SPECIFIC_INFO = 5;

/** Read an .m4a file's header. Throws, saying what is missing, for bytes that are not one. */
export function readM4aInfo(bytes: Uint8Array): M4aInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // An MP4 file opens with its ftyp box; text or another format fails here rather than as a box of nonsense size.
  if (bytes.length < 8 || fourCc(view, 4) !== 'ftyp') throw new Error('not an MP4 file: no ftyp box');
  const top = boxesIn(view, 0, bytes.length);
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) throw new Error('no moov box');

  const mvhd = childOf(view, moov, 'mvhd');
  if (!mvhd) throw new Error('no mvhd box');
  const durationS = movieDuration(view, mvhd);

  const mp4a = audioEntry(view, moov);
  if (!mp4a) throw new Error('no mp4a audio track');
  const esds = childOf(view, mp4a, 'esds', sampleEntryHeader(view, mp4a));
  if (!esds) throw new Error('no esds box');
  const config = audioSpecificConfig(view, esds);
  return { durationS, ...config };
}

/** The boxes laid end to end from `from` to `to`, each checked to fit. */
function boxesIn(view: DataView, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let offset = from;
  while (offset < to) {
    if (offset + 8 > to) throw new Error(`box at ${offset} runs past the end of the file`);
    const type = fourCc(view, offset + 4);
    const size32 = view.getUint32(offset);
    let header = 8;
    let size: number;
    if (size32 === 1) {
      if (offset + 16 > to) throw new Error(`box ${type} at ${offset} runs past the end of the file`);
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size32 === 0) {
      size = to - offset;
    } else {
      size = size32;
    }
    // A size inside its own header would never move on.
    if (size < header) throw new Error(`box ${type} at ${offset} is smaller than its header`);
    if (offset + size > to) throw new Error(`box ${type} at ${offset} runs past the end of the file`);
    boxes.push({ type, offset, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

/** The first box of `type` inside `parent`, its children starting `skip` bytes into its content. */
function childOf(view: DataView, parent: Box, type: string, skip = 0): Box | undefined {
  return boxesIn(view, parent.start + skip, parent.end).find((box) => box.type === type);
}

/** Bytes of `box`'s content, checked to be there. */
function need(box: Box, bytes: number): void {
  if (box.end - box.start < bytes) throw new Error(`box ${box.type} at ${box.offset} is too short for its fields`);
}

/** mvhd: version 0 has 32-bit times, version 1 64-bit. */
function movieDuration(view: DataView, mvhd: Box): number {
  need(mvhd, 1);
  const version = view.getUint8(mvhd.start);
  let timescale: number;
  let duration: number;
  let allOnes: boolean;
  if (version === 1) {
    need(mvhd, 32);
    timescale = view.getUint32(mvhd.start + 20);
    const raw = view.getBigUint64(mvhd.start + 24);
    duration = Number(raw);
    allOnes = raw === 0xffffffffffffffffn;
  } else {
    need(mvhd, 20);
    timescale = view.getUint32(mvhd.start + 12);
    duration = view.getUint32(mvhd.start + 16);
    allOnes = duration === 0xffffffff;
  }
  if (timescale === 0) throw new Error('mvhd has a timescale of 0');
  // 0 is a fragmented file, whose length is not in this header; all ones means it is not known. Either would pass
  // every cue and any bit rate, so neither is a length.
  if (duration === 0 || allOnes) throw new Error('mvhd does not give the length of the file');
  return duration / timescale;
}

/** The first mp4a sample entry of any track: moov/trak/mdia/minf/stbl/stsd. */
function audioEntry(view: DataView, moov: Box): Box | undefined {
  for (const trak of boxesIn(view, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = childOf(view, trak, 'mdia');
    const minf = mdia && childOf(view, mdia, 'minf');
    const stbl = minf && childOf(view, minf, 'stbl');
    const stsd = stbl && childOf(view, stbl, 'stsd');
    if (!stsd) continue;
    // stsd: version and flags, then an entry count, then the entries as boxes.
    need(stsd, 8);
    const mp4a = childOf(view, stsd, 'mp4a', 8);
    if (mp4a) return mp4a;
  }
  return undefined;
}

/**
 * How far into an mp4a entry its child boxes start: 28 bytes of
 * AudioSampleEntry, plus 16 or 36 when a QuickTime-style sound
 * description says version 1 or 2.
 */
function sampleEntryHeader(view: DataView, mp4a: Box): number {
  need(mp4a, 28);
  const version = view.getUint16(mp4a.start + 8);
  const header = version === 1 ? 44 : version === 2 ? 64 : 28;
  need(mp4a, header);
  return header;
}

/** esds → ES_Descriptor → DecoderConfigDescriptor → DecoderSpecificInfo, the AudioSpecificConfig. */
function audioSpecificConfig(view: DataView, esds: Box): Pick<M4aInfo, 'audioObjectType' | 'channels'> {
  need(esds, 4);
  // After the esds box's version and flags.
  const es = descriptorIn(view, esds.start + 4, esds.end, ES_DESCRIPTOR);
  if (!es) throw new Error('no ES descriptor in the esds box');
  // ES_ID, then flags saying which optional fields follow.
  if (es.end - es.start < 3) throw new Error('the ES descriptor is too short for its fields');
  const flags = view.getUint8(es.start + 2);
  let at = es.start + 3;
  if (flags & 0x80) at += 2;
  if (flags & 0x40) {
    if (at >= es.end) throw new Error('the ES descriptor is too short for its fields');
    at += 1 + view.getUint8(at);
  }
  if (flags & 0x20) at += 2;
  const decoder = descriptorIn(view, at, es.end, DECODER_CONFIG);
  if (!decoder) throw new Error('no decoder config in the esds box');
  if (decoder.end - decoder.start < 13) throw new Error('the decoder config is too short for its fields');
  const objectType = view.getUint8(decoder.start);
  if (objectType !== MPEG4_AUDIO) throw new Error(`not MPEG-4 audio: object type indication 0x${objectType.toString(16)}`);
  // objectTypeIndication, streamType, bufferSizeDB, maxBitrate, avgBitrate: 13 bytes.
  const specific = descriptorIn(view, decoder.start + 13, decoder.end, DECODER_SPECIFIC_INFO);
  if (!specific) throw new Error('no audio specific config in the esds box');

  const bits = bitReader(view, specific.start, specific.end);
  let audioObjectType = bits(5);
  // 31 escapes to a six-bit extension.
  if (audioObjectType === 31) audioObjectType = 32 + bits(6);
  // A sampling frequency index of 15 means the rate follows, in 24 bits.
  if (bits(4) === 15) bits(24);
  return { audioObjectType, channels: bits(4) };
}

/** The first descriptor with `tag` among those from `from` to `to`: its content's start and end. */
function descriptorIn(view: DataView, from: number, to: number, tag: number): { start: number; end: number } | undefined {
  let at = from;
  while (at < to) {
    const found = view.getUint8(at);
    // The length: seven bits a byte, the high bit set while more follow; at most four bytes.
    let length = 0;
    let i = 0;
    let byte: number;
    do {
      at += 1;
      if (at >= to || i === 4) throw new Error('a descriptor in the esds box runs past its end');
      byte = view.getUint8(at);
      length = (length << 7) | (byte & 0x7f);
      i += 1;
    } while (byte & 0x80);
    const start = at + 1;
    if (start + length > to) throw new Error('a descriptor in the esds box runs past its end');
    if (found === tag) return { start, end: start + length };
    at = start + length;
  }
  return undefined;
}

/** Big-endian bits from `from` to `to`, refusing to read past `to`. */
function bitReader(view: DataView, from: number, to: number): (count: number) => number {
  let bit = 0;
  return (count) => {
    let value = 0;
    for (let i = 0; i < count; i++, bit++) {
      const byte = from + (bit >> 3);
      if (byte >= to) throw new Error('the audio specific config is too short');
      value = value * 2 + ((view.getUint8(byte) >> (7 - (bit & 7))) & 1);
    }
    return value;
  };
}

// A type that is not printable shows as question marks: the message goes to a log.
const fourCc = (view: DataView, offset: number): string =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)).replace(/[^\x20-\x7e]/g, '?');
