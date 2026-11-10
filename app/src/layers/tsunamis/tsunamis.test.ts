import { describe, it, expect } from 'vitest';
import {
  FEATURED_DEADLIEST,
  FEATURED_HIGHEST,
  heightText,
  pickFeatured,
  tsunamiDate,
  tsunamiDeaths,
  tsunamiLabelText,
  tsunamiMarkers,
  tsunamiSizePx,
  tsunamisBy,
  type Tsunami,
} from './tsunamis';
import tsunamis, { TSUNAMI_CAUSES } from './layer';

/** Real rows of app/public/geo/tsunamis.json (NOAA NCEI Global Historical Tsunami Database). */
const LITUYA: Tsunami = {
  id: 1880, y: 1958, m: 7, d: 10, lat: 58.37, lon: -136.665, cause: 'landslide',
  heightM: 524.6, deaths: 5, mag: 7.8, place: 'Lituya Bay, Alaska', country: 'USA',
};
const SUMATRA: Tsunami = {
  id: 2439, y: 2004, m: 12, d: 26, lat: 3.295, lon: 95.982, cause: 'earthquake',
  heightM: 50.9, deaths: 227899, mag: 9.1, place: 'Indian Ocean (Sumatra)', country: 'Indonesia',
};
const TOHOKU: Tsunami = {
  id: 5413, y: 2011, m: 3, d: 11, lat: 38.297, lon: 142.373, cause: 'earthquake',
  heightM: 39.26, deaths: 18423, mag: 9.1, place: 'Tōhoku, Japan', country: 'Japan',
};
const KRAKATAU: Tsunami = {
  id: 1142, y: 1883, m: 8, d: 27, lat: -6.102, lon: 105.423, cause: 'volcano',
  heightM: 41, deaths: 34417, mag: null, place: 'Krakatau', country: 'Indonesia',
};
const THERA: Tsunami = {
  id: 3, y: -1610, m: null, d: null, lat: 36.4, lon: 25.4, cause: 'volcano',
  heightM: 90, deaths: null, mag: null, place: 'Thera Island (Santorini)', country: 'Greece',
};
const SMALL: Tsunami = {
  id: 9, y: 1900, m: 5, d: null, lat: 1, lon: 2, cause: 'other',
  heightM: null, deaths: 3, mag: null, place: 'Somewhere', country: 'Nowhere',
};

describe('tsunami symbols', () => {
  it('are sized by the larger of run-up and deaths', () => {
    expect(tsunamiSizePx(LITUYA)).toBeCloseTo(6 + 4.5 * Math.log10(524.6));
    expect(tsunamiSizePx(LITUYA)).toBeGreaterThan(18);
    // 2004: 51 m alone would be 13.7 px; 228,000 dead make it as large as Lituya Bay.
    expect(tsunamiSizePx(SUMATRA)).toBeGreaterThan(17.5);
    expect(tsunamiSizePx(SMALL)).toBe(6);
    expect(tsunamiSizePx({ ...SMALL, heightM: 10 })).toBeCloseTo(10.5);
  });

  it('count the tsunami’s own dead, none where there is no figure', () => {
    expect(tsunamiDeaths(KRAKATAU)).toBe(34417);
    expect(tsunamiDeaths(SMALL)).toBe(3);
    expect(tsunamiDeaths(THERA)).toBe(0);
  });

  it('are crosses coloured by cause, the biggest drawn first', () => {
    const markers = tsunamiMarkers([SMALL, KRAKATAU, LITUYA]);
    expect(markers.every((m) => m.shape === 'cross')).toBe(true);
    expect(markers[0].lon).toBe(LITUYA.lon);
    expect(markers[0].color).toBe(TSUNAMI_CAUSES.find((c) => c.key === 'landslide')?.color);
    expect(markers[1].color).toBe(TSUNAMI_CAUSES.find((c) => c.key === 'volcano')?.color);
    expect(markers[2].lat).toBe(SMALL.lat);
  });
});

describe('tsunami labels', () => {
  it('date as far as the record does', () => {
    expect(tsunamiDate(LITUYA)).toBe('10 Jul 1958');
    expect(tsunamiDate(SMALL)).toBe('May 1900');
    expect(tsunamiDate({ ...SMALL, m: null })).toBe('1900');
    expect(tsunamiDate(THERA)).toBe('1610 BCE');
  });

  it('write heights to the decimetre', () => {
    expect(heightText(524.6)).toBe('524.6 m');
    expect(heightText(39.26)).toBe('39.3 m');
    expect(heightText(25)).toBe('25 m');
  });

  it('give place, date, height and deaths', () => {
    expect(tsunamiLabelText(LITUYA)).toBe('✚ Lituya Bay, Alaska · 10 Jul 1958 · 524.6 m · 5 dead');
    expect(tsunamiLabelText(SUMATRA)).toBe('✚ Indian Ocean (Sumatra) · 26 Dec 2004 · 50.9 m · 227,899 dead');
    expect(tsunamiLabelText(THERA)).toBe('✚ Thera Island (Santorini) · 1610 BCE · 90 m');
    expect(tsunamiLabelText(SMALL)).toBe('✚ Somewhere · May 1900 · 3 dead');
  });
});

describe('what is shown', () => {
  it('hides tsunamis later than the app clock’s year', () => {
    const all = [LITUYA, THERA, SUMATRA, TOHOKU];
    expect(tsunamisBy(all, 2026)).toEqual(all);
    expect(tsunamisBy(all, 2010)).toEqual([LITUYA, THERA, SUMATRA]);
    expect(tsunamisBy(all, 1900)).toEqual([THERA]);
  });

  it('features the highest and the deadliest, each once', () => {
    // Highest first, as the file is: twelve high but harmless, then the deadly ones lower down.
    const high = Array.from({ length: 12 }, (_, i): Tsunami => ({ ...SMALL, id: 100 + i, heightM: 300 - i, deaths: null }));
    const all = [LITUYA, ...high, SUMATRA, KRAKATAU, TOHOKU];
    const featured = pickFeatured(all);
    expect(featured.slice(0, FEATURED_HIGHEST)).toEqual(all.slice(0, FEATURED_HIGHEST));
    expect(featured).toContain(SUMATRA);
    expect(featured).toContain(KRAKATAU);
    expect(featured).toContain(TOHOKU);
    expect(new Set(featured).size).toBe(featured.length);
    expect(featured.length).toBeLessThanOrEqual(FEATURED_HIGHEST + FEATURED_DEADLIEST);
  });
});

describe('the layer definition', () => {
  it('is off by default with every cause in the caption', () => {
    expect(tsunamis.id).toBe('tsunamis');
    expect(tsunamis.defaultOn).toBeUndefined();
    for (const cause of TSUNAMI_CAUSES) expect(tsunamis.caption).toContain(cause.label);
  });
});
