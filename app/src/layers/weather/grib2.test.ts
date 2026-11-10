import { describe, it, expect } from 'vitest';
import { decodeGrib2, splitGribMessages } from './grib2';
import { GRIB_COMPLEX, GRIB_SIMPLE, type GribFixture } from './grib2.fixture';

function bytes(fixture: GribFixture): Uint8Array {
  return Uint8Array.from(atob(fixture.base64), (c) => c.charCodeAt(0));
}

describe('decodeGrib2', () => {
  for (const [name, fixture] of [
    ['simple packing', GRIB_SIMPLE],
    ['complex packing with second-order spatial differencing', GRIB_COMPLEX],
  ] as const) {
    describe(name, () => {
      const field = decodeGrib2(bytes(fixture));

      it('reads what the field is: U wind at 250 hPa, three hours into the 12Z run', () => {
        expect(field.discipline).toBe(0);
        expect([field.category, field.number]).toEqual([2, 2]);
        expect([field.levelType, field.levelValue]).toEqual([100, 25000]);
        expect(field.referenceTime.toISOString()).toBe('2026-11-09T12:00:00.000Z');
        expect(field.forecastHours).toBe(3);
      });

      it('reads the grid: 41 × 41 at 1°, south to north from 20°N 120°E', () => {
        expect([field.ni, field.nj]).toEqual([41, 41]);
        expect([field.latFirst, field.latStep, field.lonFirst, field.lonStep]).toEqual([20, 1, 120, 1]);
        expect(field.values).toHaveLength(41 * 41);
      });

      it('matches ecCodes at the sample points', () => {
        for (const [index, expected] of Object.entries(fixture.picks)) {
          expect(field.values[Number(index)]).toBeCloseTo(expected, 4);
        }
      });

      it('matches ecCodes over the whole field', () => {
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        for (const value of field.values) {
          sum += value;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
        // Float32 values: a part in 1e7 each, over 1681 of them.
        expect(sum).toBeCloseTo(fixture.sum, 1);
        expect(min).toBeCloseTo(fixture.min, 4);
        expect(max).toBeCloseTo(fixture.max, 4);
      });
    });
  }

  it('refuses what is not a whole GRIB2 message', () => {
    const message = bytes(GRIB_COMPLEX);
    expect(() => decodeGrib2(new TextEncoder().encode('<html>Access denied</html>'))).toThrow('not a GRIB edition 2');
    expect(() => decodeGrib2(message.subarray(0, message.length - 10))).toThrow('cut short');
    const noEnd = message.slice();
    noEnd.set([0, 0, 0, 0], noEnd.length - 4);
    expect(() => decodeGrib2(noEnd)).toThrow('7777');
  });

  it('refuses a packing it does not implement rather than guess', () => {
    const message = bytes(GRIB_SIMPLE);
    // Section 5 follows sections 0 (16), 1, 3 and 4; its template number is at octets 10-11.
    let offset = 16;
    while (message[offset + 4] !== 5) offset += new DataView(message.buffer).getUint32(offset);
    message[offset + 10] = 40;
    expect(() => decodeGrib2(message)).toThrow('5.40 is not supported');
  });
});

describe('splitGribMessages', () => {
  it('splits messages laid end to end', () => {
    const a = bytes(GRIB_SIMPLE);
    const b = bytes(GRIB_COMPLEX);
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a);
    joined.set(b, a.length);
    const parts = splitGribMessages(joined);
    expect(parts.map((p) => p.length)).toEqual([a.length, b.length]);
    expect(decodeGrib2(parts[1]).values[840]).toBeCloseTo(GRIB_COMPLEX.picks[840], 4);
  });

  it('refuses a buffer that ends mid-message', () => {
    const a = bytes(GRIB_SIMPLE);
    expect(() => splitGribMessages(a.subarray(0, a.length - 1))).toThrow('cut short');
  });
});
