/**
 * A small GRIB2 reader: just enough for NOAA GFS fields on a lat/lon grid.
 *
 * Decodes one message with grid template 3.0 (regular latitude/longitude)
 * and data representation 5.0 (simple packing), 5.2 (complex packing) or
 * 5.3 (complex packing with spatial differencing, which is how NCEP packs
 * the global files), with no bitmap and no missing values. Anything else
 * throws: a wrong field must never pass for a right one.
 *
 * Layout per WMO Manual on Codes I.2 (FM 92 GRIB edition 2) and NCEP's g2c
 * unpacker. tools/pipeline/grib2.py is the same reader in Python, checked
 * against ecCodes; the test beside this file uses the same fixture.
 */

export interface GribField {
  readonly discipline: number;
  readonly category: number;
  readonly number: number;
  /** Start of the model run. */
  readonly referenceTime: Date;
  readonly forecastHours: number;
  /** Type of the first fixed surface: 100 isobaric (Pa), 103 height above ground (m). */
  readonly levelType: number;
  readonly levelValue: number;
  readonly ni: number;
  readonly nj: number;
  readonly latFirst: number;
  readonly lonFirst: number;
  /** Degrees between rows: negative when the first row is the northernmost. */
  readonly latStep: number;
  readonly lonStep: number;
  /** Row-major: nj rows of ni, first row at latFirst. */
  readonly values: Float32Array;
}

/** GRIB's sign-and-magnitude integers: the top bit is the sign. */
function signed(value: number, bits: number): number {
  const sign = 2 ** (bits - 1);
  return value >= sign ? -(value - sign) : value;
}

/** Reads big-endian unsigned integers of any width up to 32 bits from a bit position. */
class BitReader {
  private bit: number;

  constructor(
    private readonly bytes: Uint8Array,
    byteOffset: number
  ) {
    this.bit = byteOffset * 8;
  }

  read(width: number): number {
    let value = 0;
    let remaining = width;
    while (remaining > 0) {
      const byte = this.bytes[this.bit >> 3];
      const available = 8 - (this.bit & 7);
      const take = Math.min(available, remaining);
      const chunk = (byte >> (available - take)) & ((1 << take) - 1);
      // Multiply, not shift: a 32-bit value must not turn negative.
      value = value * 2 ** take + chunk;
      this.bit += take;
      remaining -= take;
    }
    return value;
  }

  /** Skip to the next whole byte: each packed array starts on one. */
  align(): void {
    this.bit = (this.bit + 7) & ~7;
  }
}

function readSections(message: Uint8Array): Map<number, DataView> {
  const magic = String.fromCharCode(message[0], message[1], message[2], message[3]);
  if (magic !== 'GRIB' || message[7] !== 2) throw new Error('not a GRIB edition 2 message');
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const total = view.getUint32(8) * 2 ** 32 + view.getUint32(12);
  if (total > message.byteLength) throw new Error('GRIB message is cut short');
  const sections = new Map<number, DataView>([[0, new DataView(message.buffer, message.byteOffset, 16)]]);
  let offset = 16;
  while (offset < total - 4) {
    const length = view.getUint32(offset);
    const number = view.getUint8(offset + 4);
    if (sections.has(number)) throw new Error('more than one field in the GRIB message');
    if (length < 5 || offset + length > total) throw new Error('GRIB section runs past the message');
    sections.set(number, new DataView(message.buffer, message.byteOffset + offset, length));
    offset += length;
  }
  if (String.fromCharCode(...message.subarray(offset, offset + 4)) !== '7777') {
    throw new Error('GRIB message does not end in 7777');
  }
  return sections;
}

/** Templates 5.2 and 5.3: the integers before scaling. */
function unpackComplex(section5: DataView, section7: DataView, template: number, count: number): Float64Array {
  const nbits = section5.getUint8(19);
  if (section5.getUint8(22) !== 0) throw new Error('GRIB missing-value management is not supported');
  const groups = section5.getUint32(31);
  const widthRef = section5.getUint8(35);
  const widthBits = section5.getUint8(36);
  const lengthRef = section5.getUint32(37);
  const lengthInc = section5.getUint8(41);
  const lastLength = section5.getUint32(42);
  const lengthBits = section5.getUint8(46);
  const order = template === 3 ? section5.getUint8(47) : 0;
  const extraOctets = template === 3 ? section5.getUint8(48) : 0;

  const data = new Uint8Array(section7.buffer, section7.byteOffset, section7.byteLength);
  let position = 5;
  const initial: number[] = [];
  let minimum = 0;
  if (template === 3) {
    if ((order !== 1 && order !== 2) || extraOctets === 0 || extraOctets > 4) {
      throw new Error(`GRIB spatial differencing of order ${order} is not supported`);
    }
    const extra = new BitReader(data, position);
    for (let i = 0; i < order; i++) initial.push(signed(extra.read(extraOctets * 8), extraOctets * 8));
    minimum = signed(extra.read(extraOctets * 8), extraOctets * 8);
    position += (order + 1) * extraOctets;
  }

  const reader = new BitReader(data, position);
  const references = new Float64Array(groups);
  for (let g = 0; g < groups; g++) references[g] = reader.read(nbits);
  reader.align();
  const widths = new Uint8Array(groups);
  for (let g = 0; g < groups; g++) widths[g] = reader.read(widthBits) + widthRef;
  reader.align();
  const lengths = new Uint32Array(groups);
  for (let g = 0; g < groups; g++) lengths[g] = reader.read(lengthBits) * lengthInc + lengthRef;
  reader.align();
  // The last group's true length is stated outright; its packed length is not to be trusted.
  lengths[groups - 1] = lastLength;
  let total = 0;
  for (let g = 0; g < groups; g++) total += lengths[g];
  if (total !== count) throw new Error('GRIB group lengths do not add up to the number of points');

  const values = new Float64Array(count);
  let at = 0;
  for (let g = 0; g < groups; g++) {
    const width = widths[g];
    const reference = references[g];
    for (let i = 0; i < lengths[g]; i++) values[at++] = reference + (width === 0 ? 0 : reader.read(width));
  }

  if (template === 3) {
    if (order === 1) {
      values[0] = initial[0];
      for (let i = 1; i < count; i++) values[i] += minimum + values[i - 1];
    } else {
      values[0] = initial[0];
      values[1] = initial[1];
      for (let i = 2; i < count; i++) values[i] += minimum + 2 * values[i - 1] - values[i - 2];
    }
  }
  return values;
}

export function decodeGrib2(message: Uint8Array): GribField {
  const sections = readSections(message);
  const section = (number: number): DataView => {
    const found = sections.get(number);
    if (!found) throw new Error(`GRIB section ${number} is missing`);
    return found;
  };
  const [s0, s1, s3, s4, s5, s6, s7] = [0, 1, 3, 4, 5, 6, 7].map(section);

  const referenceTime = new Date(
    Date.UTC(s1.getUint16(12), s1.getUint8(14) - 1, s1.getUint8(15), s1.getUint8(16), s1.getUint8(17), s1.getUint8(18))
  );

  const gridTemplate = s3.getUint16(12);
  if (gridTemplate !== 0) throw new Error(`GRIB grid template 3.${gridTemplate} is not supported`);
  const ni = s3.getUint32(30);
  const nj = s3.getUint32(34);
  const latFirst = signed(s3.getUint32(46), 32) / 1e6;
  const lonFirst = signed(s3.getUint32(50), 32) / 1e6;
  const latLast = signed(s3.getUint32(55), 32) / 1e6;
  const lonLast = signed(s3.getUint32(59), 32) / 1e6;
  const scan = s3.getUint8(71);
  // Only rows of constant latitude scanned west to east; the row order comes from the latitudes.
  if (scan & 0b10110000) throw new Error(`GRIB scanning mode ${scan} is not supported`);

  const productTemplate = s4.getUint16(7);
  if (productTemplate !== 0 && productTemplate !== 8) {
    throw new Error(`GRIB product template 4.${productTemplate} is not supported`);
  }
  if (s4.getUint8(17) !== 1) throw new Error('GRIB forecast time is not in hours');

  const count = s5.getUint32(5);
  const template = s5.getUint16(9);
  if (count !== ni * nj || s6.getUint8(5) !== 255) throw new Error('GRIB bitmapped fields are not supported');
  const reference = s5.getFloat32(11);
  const binaryScale = 2 ** signed(s5.getUint16(15), 16);
  const decimalScale = 10 ** signed(s5.getUint16(17), 16);

  let packed: Float64Array;
  if (template === 0) {
    const nbits = s5.getUint8(19);
    const reader = new BitReader(new Uint8Array(s7.buffer, s7.byteOffset, s7.byteLength), 5);
    packed = new Float64Array(count);
    if (nbits > 0) for (let i = 0; i < count; i++) packed[i] = reader.read(nbits);
  } else if (template === 2 || template === 3) {
    packed = unpackComplex(s5, s7, template, count);
  } else {
    throw new Error(`GRIB data representation 5.${template} is not supported`);
  }
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) values[i] = (reference + packed[i] * binaryScale) / decimalScale;

  return {
    discipline: s0.getUint8(6),
    category: s4.getUint8(9),
    number: s4.getUint8(10),
    referenceTime,
    forecastHours: s4.getUint32(18),
    levelType: s4.getUint8(22),
    levelValue: signed(s4.getUint32(24), 32) / 10 ** s4.getUint8(23),
    ni,
    nj,
    latFirst,
    lonFirst,
    latStep: (latLast - latFirst) / (nj - 1),
    lonStep: ((((lonLast - lonFirst) % 360) + 360) % 360) / (ni - 1),
    values,
  };
}

/** Split a buffer of concatenated GRIB2 messages; each states its own length. */
export function splitGribMessages(buffer: Uint8Array): Uint8Array[] {
  const messages: Uint8Array[] = [];
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  while (offset + 16 <= buffer.byteLength) {
    const length = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
    if (length < 16 || offset + length > buffer.byteLength) throw new Error('GRIB message is cut short');
    messages.push(buffer.subarray(offset, offset + length));
    offset += length;
  }
  return messages;
}
