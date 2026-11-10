import { describe, it, expect } from 'vitest';
import {
  fallSizePx,
  fallsBy,
  findSizePx,
  massText,
  meteoriteLabelText,
  meteoriteMarkers,
  type MeteoriteRow,
} from './meteorites';
import meteorites, { FALL_COLOR, FIND_COLOR } from './layer';

/** Real rows of app/public/geo/meteorites.json (Meteoritical Bulletin via NASA Open Data). */
const HOBA: MeteoriteRow = ['Hoba', 1920, -19.583, 17.917, 60000000, 'Iron, IVB'];
const SIKHOTE_ALIN: MeteoriteRow = ['Sikhote-Alin', 1947, 46.16, 134.653, 23000000, 'Iron, IIAB'];
const ALLENDE: MeteoriteRow = ['Allende', 1969, 26.967, -105.317, 2000000, 'CV3'];
const NOGATA: MeteoriteRow = ['Nogata', 860, 33.725, 130.75, 472, 'L6'];
const NARNI: MeteoriteRow = ['Narni', 920, 42.517, 12.517, null, 'Stone-uncl'];
const CHELYABINSK: MeteoriteRow = ['Chelyabinsk', 2013, 54.817, 61.117, 100000, 'LL5'];

describe('meteorite symbols', () => {
  it('size falls by mass between 1 kg and 10 t', () => {
    expect(fallSizePx(472)).toBe(5);
    expect(fallSizePx(1000)).toBe(5);
    expect(fallSizePx(100000)).toBeCloseTo(8.5);
    expect(fallSizePx(23000000)).toBe(12);
    expect(fallSizePx(null)).toBe(5);
  });

  it('size the great finds from a tonne to Hoba', () => {
    expect(findSizePx(1e6)).toBe(8);
    expect(findSizePx(60e6)).toBeCloseTo(14);
    expect(findSizePx(15.5e6)).toBeGreaterThan(11);
  });

  it('draw falls as pink diamonds over the finds’ steel squares', () => {
    const markers = meteoriteMarkers([ALLENDE, NOGATA], [HOBA]);
    expect(markers.map((m) => m.shape)).toEqual(['square', 'diamond', 'diamond']);
    expect(markers.map((m) => m.color)).toEqual([FIND_COLOR, FALL_COLOR, FALL_COLOR]);
    expect(markers[0].lon).toBe(17.917);
    expect(markers[0].lat).toBe(-19.583);
    expect(markers[1].lon).toBe(-105.317);
  });
});

describe('meteorite labels', () => {
  it('write mass to two figures in the fitting unit', () => {
    expect(massText(60000000)).toBe('60 t');
    expect(massText(1100000)).toBe('1.1 t');
    expect(massText(330000)).toBe('330 kg');
    expect(massText(472)).toBe('470 g');
    expect(massText(21)).toBe('21 g');
  });

  it('say whether it fell or was found, when, how heavy and what kind', () => {
    expect(meteoriteLabelText(HOBA, 'find')).toBe('■ Hoba · found 1920 · 60 t · Iron, IVB');
    expect(meteoriteLabelText(ALLENDE, 'fall')).toBe('◆ Allende · fell 1969 · 2 t · CV3');
    expect(meteoriteLabelText(SIKHOTE_ALIN, 'fall')).toBe('◆ Sikhote-Alin · fell 1947 · 23 t · Iron, IIAB');
    expect(meteoriteLabelText(NARNI, 'fall')).toBe('◆ Narni · fell 920 · Stone-uncl');
  });
});

describe('fallsBy', () => {
  it('hides falls later than the app clock’s year', () => {
    const all = [SIKHOTE_ALIN, ALLENDE, CHELYABINSK, NOGATA];
    expect(fallsBy(all, 2026)).toEqual(all);
    expect(fallsBy(all, 2012)).toEqual([SIKHOTE_ALIN, ALLENDE, NOGATA]);
    expect(fallsBy(all, 1950)).toEqual([SIKHOTE_ALIN, NOGATA]);
  });
});

describe('the layer definition', () => {
  it('is off by default and says the licence is not stated', () => {
    expect(meteorites.id).toBe('meteorite-falls');
    expect(meteorites.defaultOn).toBeUndefined();
    expect(meteorites.credits[0].licence).toContain('no licence stated');
  });
});
