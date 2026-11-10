import { describe, it, expect } from 'vitest';
import { HEALPIX } from './healpix.fixture';
import {
  healpixAncestorWindow,
  healpixFaceXyToNested,
  healpixNestedToFaceXy,
  healpixPixelCount,
  healpixPixelPoint,
  healpixPixelsInDisc,
  healpixUnitToNested,
} from './healpix';

type V = readonly [number, number, number];
/** By the cross product: an arccosine loses half its digits for the small angles compared here. */
const angle = (a: V, b: V): number =>
  Math.atan2(
    Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]),
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  );

describe('healpixPixelCount', () => {
  it('is 12 at order 0 and four times more each order', () => {
    expect(healpixPixelCount(0)).toBe(12);
    expect(healpixPixelCount(3)).toBe(768);
    expect(healpixPixelCount(9)).toBe(3145728);
  });
});

describe('nested index and face coordinates', () => {
  it('round-trips', () => {
    for (const { order, ipix } of HEALPIX.pixels) {
      const { face, ix, iy } = healpixNestedToFaceXy(order, ipix);
      expect(face).toBeGreaterThanOrEqual(0);
      expect(face).toBeLessThan(12);
      expect(healpixFaceXyToNested(order, face, ix, iy)).toBe(ipix);
    }
  });

  it('interleaves x into the even bits and y into the odd ones', () => {
    expect(healpixNestedToFaceXy(1, 1)).toEqual({ face: 0, ix: 1, iy: 0 });
    expect(healpixNestedToFaceXy(1, 2)).toEqual({ face: 0, ix: 0, iy: 1 });
    expect(healpixNestedToFaceXy(2, 16 * 5 + 0b1101)).toEqual({ face: 5, ix: 0b11, iy: 0b10 });
  });
});

describe('healpixPixelPoint against healpy', () => {
  it.each(HEALPIX.pixels)('order $order pixel $ipix: centre and corners', ({ order, ipix, centre, north, west, south, east }) => {
    const tolerance = 1e-9;
    expect(angle(healpixPixelPoint(order, ipix, 0.5, 0.5), centre)).toBeLessThan(tolerance);
    // x runs toward the north-east edge, y toward the north-west one.
    expect(angle(healpixPixelPoint(order, ipix, 1, 1), north)).toBeLessThan(tolerance);
    expect(angle(healpixPixelPoint(order, ipix, 0, 0), south)).toBeLessThan(tolerance);
    expect(angle(healpixPixelPoint(order, ipix, 1, 0), east)).toBeLessThan(tolerance);
    expect(angle(healpixPixelPoint(order, ipix, 0, 1), west)).toBeLessThan(tolerance);
  });

  it('returns unit vectors everywhere on a pixel', () => {
    for (const { order, ipix } of HEALPIX.pixels.slice(0, 30)) {
      for (const [u, v] of [[0.25, 0.75], [0.9, 0.1], [0, 0.5], [1, 0.3]] as const) {
        expect(Math.hypot(...healpixPixelPoint(order, ipix, u, v))).toBeCloseTo(1, 12);
      }
    }
  });
});

describe('healpixUnitToNested against healpy', () => {
  it.each(HEALPIX.directions)('finds the pixel holding $direction at every order', ({ direction, pixels }) => {
    for (const [order, ipix] of Object.entries(pixels)) expect(healpixUnitToNested(Number(order), direction)).toBe(ipix);
  });

  it('puts a pixel’s own centre in it', () => {
    for (const { order, ipix, centre } of HEALPIX.pixels) expect(healpixUnitToNested(order, centre)).toBe(ipix);
  });
});

describe('healpixPixelsInDisc against healpy', () => {
  it.each(HEALPIX.discs)('order $order, $radiusDeg° about $direction', ({ direction, radiusDeg, order, overlapping, centresInside }) => {
    const got = healpixPixelsInDisc(order, direction, (radiusDeg * Math.PI) / 180);
    const set = new Set(got);
    expect(set.size).toBe(got.length);
    // Never misses a pixel whose centre is in the disc, nor the one under the disc's own centre.
    for (const ipix of centresInside) expect(set.has(ipix)).toBe(true);
    expect(set.has(healpixUnitToNested(order, direction))).toBe(true);
    // And is not wildly generous: healpy's inclusive list is itself a superset of the overlapping pixels.
    const inclusive = new Set<number>(overlapping);
    const extra = got.filter((ipix) => !inclusive.has(ipix)).length;
    expect(extra).toBeLessThanOrEqual(Math.max(8, overlapping.length));
  });

  it('stops at the limit it is given, nearest first', () => {
    const direction: V = [1, 0, 0];
    const all = healpixPixelsInDisc(5, direction, 0.3);
    const few = healpixPixelsInDisc(5, direction, 0.3, 10);
    expect(all.length).toBeGreaterThan(10);
    expect(few).toHaveLength(10);
    const farthestKept = Math.max(...few.map((ipix) => angle(healpixPixelPoint(5, ipix, 0.5, 0.5), direction)));
    const dropped = all.filter((ipix) => !few.includes(ipix));
    for (const ipix of dropped) expect(angle(healpixPixelPoint(5, ipix, 0.5, 0.5), direction)).toBeGreaterThanOrEqual(farthestKept - 1e-12);
  });
});

describe('healpixAncestorWindow', () => {
  it('is the whole of itself', () => {
    expect(healpixAncestorWindow(4, 1234, 4)).toEqual({ ipix: 1234, u0: 0, v0: 0, size: 1 });
  });

  it('finds where a pixel sits inside an ancestor', () => {
    for (const { order, ipix } of HEALPIX.pixels.filter((pixel) => pixel.order >= 3)) {
      const window = healpixAncestorWindow(order, ipix, order - 3);
      expect(window.ipix).toBe(Math.floor(ipix / 64));
      expect(window.size).toBe(1 / 8);
      // The pixel's corners are the same points of the sky read through the ancestor's window.
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]] as const) {
        const own = healpixPixelPoint(order, ipix, u, v);
        const through = healpixPixelPoint(order - 3, window.ipix, window.u0 + u * window.size, window.v0 + v * window.size);
        expect(angle(own, through)).toBeLessThan(1e-9);
      }
    }
  });
});
