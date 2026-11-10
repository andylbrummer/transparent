import { describe, it, expect } from 'vitest';
import {
  PRODUCTS,
  activeRegionLabel,
  formatImageDate,
  formatImageTime,
  frameTimeMs,
  latestActiveRegions,
  magClassGreek,
  nearestFrame,
  parseDailySolarIndices,
  parseFrameIndex,
  solarRadiusPx,
  spaceWeatherSummary,
  type ProductId,
} from './products';

describe('frameTimeMs', () => {
  it('reads the three ways SWPC writes a frame’s time into its name', () => {
    expect(frameTimeMs('/images/animations/lasco-c3/20261109_2230_c3_512.jpg')).toBe(Date.UTC(2026, 10, 9, 22, 30));
    expect(frameTimeMs('/images/animations/sdo-hmii/20261109_234038_512_HMII.jpg')).toBe(Date.UTC(2026, 10, 9, 23, 40, 38));
    expect(
      frameTimeMs('/images/animations/suvi/primary/171/or_suvi-l2-ci171_g19_s20261110T001200Z_e20261110T001600Z_v1-0-2.png')
    ).toBe(Date.UTC(2026, 10, 10, 0, 12));
    expect(frameTimeMs('/images/animations/ccor1/20261110_0000_ccor1_1024by960.jpg')).toBe(Date.UTC(2026, 10, 10));
  });

  it('gives null for a name without a time', () => {
    expect(frameTimeMs('/images/animations/lasco-c3/latest.jpg')).toBeNull();
  });
});

describe('parseFrameIndex and nearestFrame', () => {
  const index = [
    { url: '/images/animations/lasco-c2/20261109_1200_c2_512.jpg' },
    { url: '/images/animations/lasco-c2/20261109_0012_c2_512.jpg' },
    { url: '/images/animations/lasco-c2/latest.jpg' },
    { nonsense: true },
    { url: '/images/animations/lasco-c2/20261109_2224_c2_512.jpg' },
  ];

  it('keeps the dated frames, oldest first, as absolute URLs', () => {
    const frames = parseFrameIndex(index);
    expect(frames.map((f) => new Date(f.timeMs).toISOString().slice(11, 16))).toEqual(['00:12', '12:00', '22:24']);
    expect(frames[0].url).toBe('https://services.swpc.noaa.gov/images/animations/lasco-c2/20261109_0012_c2_512.jpg');
  });

  it('survives an index that is not a list', () => {
    expect(parseFrameIndex({ error: 'nope' })).toEqual([]);
    expect(nearestFrame([], 0)).toBeNull();
  });

  it('picks the frame nearest the app clock, the newest when the clock is ahead', () => {
    const frames = parseFrameIndex(index);
    expect(nearestFrame(frames, Date.UTC(2026, 10, 9, 13))?.url).toContain('_1200_');
    expect(nearestFrame(frames, Date.UTC(2026, 10, 12))?.url).toContain('_2224_');
    expect(nearestFrame(frames, Date.UTC(2020, 0, 1))?.url).toContain('_0012_');
  });
});

describe('product geometry', () => {
  it('has every product looking where its frame holds data', () => {
    for (const id of Object.keys(PRODUCTS) as ProductId[]) {
      const product = PRODUCTS[id];
      expect(product.id).toBe(id);
      expect(product.outerRadii).toBeGreaterThan(product.innerRadii);
      // The outer edge of the useful field must lie inside the frame on its nearest side.
      const radiusPx = solarRadiusPx(product, 976);
      const nearestEdgePx = Math.min(product.centre[0], 1 - product.centre[0], product.centre[1], 1 - product.centre[1]) * product.widthPx;
      expect(product.outerRadii * radiusPx).toBeLessThan(nearestEdgePx);
    }
  });

  it('sizes the Sun in each frame as measured on 2026-11-09 (radius 968.5″ from Earth)', () => {
    expect(solarRadiusPx(PRODUCTS.hmi, 968.5)).toBeCloseTo(237.7, 0);
    // LASCO's drawn limb circles: 41.0 and 8.5 px.
    expect(solarRadiusPx(PRODUCTS['lasco-c2'], 968.5)).toBeCloseTo(41.1, 1);
    expect(solarRadiusPx(PRODUCTS['lasco-c3'], 968.5)).toBeCloseTo(8.7, 1);
    expect(solarRadiusPx(PRODUCTS['suvi-171'], 968.5)).toBeCloseTo(387.4, 1);
  });

  it('hands the corona from C2 to C3 without a gap', () => {
    expect(PRODUCTS['lasco-c3'].innerRadii).toBeLessThan(PRODUCTS['lasco-c2'].outerRadii);
  });
});

describe('formatImageTime', () => {
  it('writes UT, whatever the machine’s zone', () => {
    expect(formatImageTime(Date.UTC(2026, 10, 9, 22, 30))).toBe('9 Nov 22:30 UT');
    expect(formatImageTime(Date.UTC(2026, 0, 1, 0, 5))).toBe('1 Jan 00:05 UT');
    expect(formatImageDate(Date.UTC(2026, 10, 9, 22, 30))).toBe('9 Nov 2026');
  });
});

describe('active regions', () => {
  // Rows as SWPC's solar_regions.json gave them on 2026-11-10, trimmed to the fields read.
  const report = [
    { observed_date: '2026-11-08', region: 4566, latitude: -7, carrington_longitude: 148, area: 420, spot_class: 'Dkc', mag_class: 'BG' },
    { observed_date: '2026-11-09', region: 4566, latitude: -7, carrington_longitude: 148, area: 490, spot_class: 'Dkc', mag_class: 'BGD' },
    { observed_date: '2026-11-09', region: 4568, latitude: -8, carrington_longitude: 128, area: 10, spot_class: 'Bxo', mag_class: 'B' },
    { observed_date: '2026-11-09', region: 4570, latitude: -13, carrington_longitude: 107, area: null, spot_class: null, mag_class: null },
    { observed_date: '2026-11-09', region: 'bad' },
  ];

  it('keeps the latest day’s regions only', () => {
    const regions = latestActiveRegions(report);
    expect(regions.map((r) => r.region)).toEqual([4566, 4568, 4570]);
    expect(regions[0]).toMatchObject({ latDeg: -7, carringtonLonDeg: 148, area: 490, magClass: 'BGD' });
    expect(regions[2].area).toBeNull();
  });

  it('returns nothing for a report that is not a list', () => {
    expect(latestActiveRegions(null)).toEqual([]);
  });

  it('names a region by number and magnetic class', () => {
    const [big, small, plage] = latestActiveRegions(report);
    expect(activeRegionLabel(big)).toBe('AR 4566 βγδ');
    expect(activeRegionLabel(small)).toBe('AR 4568 β');
    expect(activeRegionLabel(plage)).toBe('AR 4570');
    expect(magClassGreek('a')).toBe('α');
  });
});

describe('space weather', () => {
  const indices = [
    ':Product: Daily Solar Data            DSD.txt',
    '#  Date     10.7cm Number  Hemis. Regions  Field    Bkgd    C  M  X  S  1  2  3',
    '2026 11 07  127     93      450      0    -999      *  26  3  0  9  0  0  0',
    '2026 11 08  128     72      600      1    -999      *  28  3  0 13  4  0  0',
    '',
  ].join('\n');

  it('reads the last day’s sunspot number from the daily indices', () => {
    expect(parseDailySolarIndices(indices)).toEqual({ sunspotNumber: 72, date: '2026-11-08' });
    expect(parseDailySolarIndices('no table here')).toBeNull();
  });

  it('skips a day whose number is the missing-value mark', () => {
    expect(parseDailySolarIndices(indices + '2026 11 09  129     -1      600      1    -999      *  28  3  0 13  4  0  0\n')).toEqual({
      sunspotNumber: 72,
      date: '2026-11-08',
    });
  });

  it('writes only the readings it has', () => {
    const all = { xrayClass: 'B7.6', f107: 129, windKmS: 646.4, sunspotNumber: 72, sunspotDate: '2026-11-08', timeMs: 0 };
    expect(spaceWeatherSummary(all)).toBe('X-ray B7.6 · sunspot no. 72 · F10.7 129 · wind 646 km/s');
    expect(spaceWeatherSummary({ ...all, xrayClass: null, windKmS: null })).toBe('sunspot no. 72 · F10.7 129');
    expect(spaceWeatherSummary({ xrayClass: null, f107: null, windKmS: null, sunspotNumber: null, sunspotDate: null, timeMs: null })).toBe('');
  });
});
