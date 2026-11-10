// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { heliocentricIcrsAu } from '@transparent-earth/core';
import { buildCloudBuffers, cloudPosition, decodeCloud, type CloudHeader } from './cloud';
import { heliocentricPosition } from './kepler';
import { CLOUD_CLASS_COLORS } from './layer';

const text = import.meta.glob('../../../public/sky/small-bodies-cloud.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const header = JSON.parse(Object.values(text)[0]) as CloudHeader;
// Vite has no loader for a .bin: it is read from disk (tests run from app/).
const bytes = readFileSync('public/sky/small-bodies-cloud.bin');
const elements = decodeCloud(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, header);
const buffers = buildCloudBuffers(elements, header);
const classOf = (key: string): CloudHeader['classes'][number] => {
  const cls = header.classes.find((c) => c.key === key);
  if (!cls) throw new Error(`no class ${key}`);
  return cls;
};

/** Ecliptic longitude, degrees, of an ICRS position. */
function eclipticLongitude(p: readonly number[]): number {
  const eps = (23.4392911 * Math.PI) / 180;
  const y = p[1] * Math.cos(eps) + p[2] * Math.sin(eps);
  return (Math.atan2(y, p[0]) * 180) / Math.PI;
}

describe('the small-body cloud', () => {
  it('has a colour for every class and classes that tile the file', () => {
    let next = 0;
    for (const cls of header.classes) {
      expect(CLOUD_CLASS_COLORS[cls.key]).toBeDefined();
      expect(cls.start).toBe(next);
      next += cls.count;
    }
    expect(next).toBe(header.count);
    expect(header.count).toBeGreaterThan(30000);
  });

  it('rejects a file of the wrong length', () => {
    expect(() => decodeCloud(new ArrayBuffer(10), header)).toThrow();
  });

  it('keeps each class where it belongs', () => {
    const range = (key: string): [number, number] => {
      const cls = classOf(key);
      const a = elements.a.subarray(cls.start, cls.start + cls.count);
      return [Math.min(...a), Math.max(...a)];
    };
    const [trojanMin, trojanMax] = range('trojan');
    expect(trojanMin).toBeGreaterThan(4.6);
    expect(trojanMax).toBeLessThan(5.6);
    const [hildaMin, hildaMax] = range('hilda');
    expect(hildaMin).toBeGreaterThan(3.7);
    expect(hildaMax).toBeLessThan(4.2);
    expect(range('tno')[0]).toBeGreaterThan(30);
    expect(range('main-belt')[1]).toBeLessThan(4.7);
  });

  it('matches the double-precision propagator for a sample of bodies', () => {
    const out: number[] = [];
    for (let k = 0; k < header.count; k += 997) {
      const a = elements.a[k];
      const e = elements.e[k];
      const n = (0.01720209895 * a ** -1.5 * 180) / Math.PI;
      const orbit = { q: a * (1 - e), e, i: elements.i[k], om: elements.om[k], w: elements.w[k], tp: header.epochJd - elements.ma[k] / n };
      for (const days of [-365, 0, 200]) {
        const exact = heliocentricPosition(orbit, header.epochJd + days);
        cloudPosition(buffers, k, days, out);
        const error = Math.hypot(out[0] - exact[0], out[1] - exact[1], out[2] - exact[2]);
        // Single-precision buffers: a few millionths of the orbit's size.
        expect(error / a).toBeLessThan(2e-4);
      }
    }
  });

  it('finds Jupiter’s Trojans in two clouds, 60° ahead of and behind the planet', () => {
    const cls = classOf('trojan');
    const out: number[] = [];
    for (const days of [-300, 0, 300]) {
      const jupiter = eclipticLongitude(heliocentricIcrsAu('jupiter', header.epochJd + days));
      let ahead = 0;
      let behind = 0;
      let elsewhere = 0;
      for (let k = cls.start; k < cls.start + cls.count; k++) {
        const offset = ((eclipticLongitude(cloudPosition(buffers, k, days, out)) - jupiter + 540) % 360) - 180;
        if (offset > 25 && offset < 110) ahead++;
        else if (offset < -25 && offset > -110) behind++;
        else elsewhere++;
      }
      // L4 (leading) is the richer camp; a handful librate far enough to stray.
      expect(ahead).toBeGreaterThan(2500);
      expect(behind).toBeGreaterThan(1200);
      expect(elsewhere).toBeLessThan(cls.count * 0.02);
    }
  });

  it('lays the main belt along the ecliptic', () => {
    const cls = classOf('main-belt');
    const inclinations = elements.i.subarray(cls.start, cls.start + cls.count);
    const low = inclinations.filter((i) => i < 20).length;
    expect(low / cls.count).toBeGreaterThan(0.85);
  });
});
