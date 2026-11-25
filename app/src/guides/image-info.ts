/**
 * What an image clip's header says: its format and its size in pixels. The
 * guide validator holds images to a budget (spec/guides.md §9) and runs
 * where there is no image library, so this reads the few bytes it needs
 * itself: the JPEG frame header (ITU T.81, B.2.2) and the WebP canvas size
 * (RFC 9649). Pure: it is given the bytes.
 */

export interface ImageInfo {
  readonly format: 'jpeg' | 'webp';
  readonly width: number;
  readonly height: number;
}

/** Read a .jpg or .webp file's header. Throws, saying what is missing, for bytes that are neither. */
export function readImageInfo(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 2 && view.getUint16(0) === 0xffd8) return jpegInfo(view);
  if (bytes.length >= 12 && ascii(view, 0, 4) === 'RIFF' && ascii(view, 8, 4) === 'WEBP') return webpInfo(view);
  throw new Error('not a JPEG or WebP file');
}

/** The JPEG markers that start a frame and carry its size: SOF0 to SOF15, less DHT (C4), JPG (C8) and DAC (CC). */
const isFrameMarker = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegInfo(view: DataView): ImageInfo {
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) throw new Error(`no JPEG marker at byte ${at}`);
    const marker = view.getUint8(at + 1);
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // The start of the scan comes after the frame header: past it, there was none.
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(at + 2);
    if (isFrameMarker(marker)) {
      // Length, precision, then the height and the width.
      if (length < 7 || at + 9 > view.byteLength) throw new Error('the JPEG frame header is too short');
      return { format: 'jpeg', height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    at += 2 + length;
  }
  throw new Error('no JPEG frame header');
}

function webpInfo(view: DataView): ImageInfo {
  if (view.byteLength < 30) throw new Error('the WebP file is too short for its header');
  const chunk = ascii(view, 12, 4);
  const data = 20;
  switch (chunk) {
    case 'VP8 ': {
      // A frame tag of three bytes, then the start code 9d 01 2a, then 14-bit width and height.
      if (view.getUint8(data + 3) !== 0x9d || view.getUint8(data + 4) !== 0x01 || view.getUint8(data + 5) !== 0x2a) {
        throw new Error('no VP8 start code');
      }
      return { format: 'webp', width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
    }
    case 'VP8L': {
      if (view.getUint8(data) !== 0x2f) throw new Error('no VP8L signature');
      const bits = view.getUint32(data + 1, true);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case 'VP8X': {
      // Flags and reserved, four bytes; then the canvas's width and height less one, 24 bits each.
      const uint24 = (offset: number): number => view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
      return { format: 'webp', width: uint24(data + 4) + 1, height: uint24(data + 7) + 1 };
    }
    default:
      throw new Error(`unknown WebP chunk ${JSON.stringify(chunk)}`);
  }
}

const ascii = (view: DataView, offset: number, length: number): string => {
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
};
