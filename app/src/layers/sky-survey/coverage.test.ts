import { describe, it, expect } from 'vitest';
import { healpixUnitToNested } from '@transparent-earth/core';
import { Coverage, decodeCells, markerOpacity, mergeStatuses, parseCloseups } from './coverage';

describe('decodeCells', () => {
  it('turns differences from the cell before back into cells', () => {
    expect(decodeCells([5, 1, 10, 3])).toEqual([5, 6, 16, 19]);
    expect(decodeCells([])).toEqual([]);
  });

  it('refuses a list that is not strictly increasing', () => {
    expect(() => decodeCells([5, 0])).toThrow('increasing');
    expect(() => decodeCells([-1])).toThrow('increasing');
  });
});

describe('Coverage', () => {
  // Order 2: cells 17 and 18 (both children of order-1 cell 4, grandchildren of base cell 1) and 40 (base cell 2).
  const coverage = new Coverage(2, [17, 18, 40]);

  it('says a tile at its own order touches it only where a cell is', () => {
    expect(coverage.touches(2, 17)).toBe(true);
    expect(coverage.touches(2, 16)).toBe(false);
    expect(coverage.touches(2, 40)).toBe(true);
  });

  it('says a coarser tile touches it when any cell lies inside', () => {
    expect(coverage.touches(1, 4)).toBe(true);
    expect(coverage.touches(1, 5)).toBe(false);
    expect(coverage.touches(0, 1)).toBe(true);
    expect(coverage.touches(0, 2)).toBe(true);
    expect(coverage.touches(0, 0)).toBe(false);
  });

  it('says a finer tile touches it when the cell holding it does', () => {
    // Order 4 holds sixteen pixels per order-2 cell: 17 → 272..287.
    expect(coverage.touches(4, 272)).toBe(true);
    expect(coverage.touches(4, 287)).toBe(true);
    expect(coverage.touches(4, 288)).toBe(true); // in 18
    expect(coverage.touches(4, 271)).toBe(false);
  });

  it('works at orders whose pixel numbers pass 2^31, where bit shifts would wrap', () => {
    const deep = new Coverage(8, [786_431]); // the last cell of order 8
    const last14 = 12 * 4 ** 14 - 1; // 3,221,225,471
    expect(deep.touches(14, last14)).toBe(true);
    expect(deep.touches(14, last14 - 4 ** 6)).toBe(false);
  });

  it('gives the direction of each cell’s centre, in the cell', () => {
    const directions = coverage.centres();
    expect(directions).toHaveLength(9);
    for (let i = 0; i < 3; i++) {
      const d: [number, number, number] = [directions[3 * i], directions[3 * i + 1], directions[3 * i + 2]];
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      expect(healpixUnitToNested(2, d)).toBe([17, 18, 40][i]);
    }
  });
});

describe('parseCloseups', () => {
  const file = {
    generated: '2026-11-10',
    order: 8,
    frame: 'icrs',
    surveys: { hubble: { hips: 'https://x/HST/ACS', mocOrder: 14, areaDeg2: 24.6, cells: 2, deltas: [100, 5] } },
  };

  it('reads each survey’s cells at the file’s order', () => {
    const coverage = parseCloseups(file).get('hubble')!;
    expect(coverage.order).toBe(8);
    expect(coverage.touches(8, 105)).toBe(true);
    expect(coverage.touches(8, 101)).toBe(false);
  });

  it('refuses a file whose cell count disagrees with its cells, or that is not in ICRS', () => {
    expect(() => parseCloseups({ ...file, surveys: { hubble: { ...file.surveys.hubble, cells: 3 } } })).toThrow('hubble');
    expect(() => parseCloseups({ ...file, frame: 'galactic' })).toThrow('icrs');
  });
});

describe('markerOpacity', () => {
  it('shows the rings looking wide and hides them once the patch itself is big enough to see', () => {
    expect(markerOpacity(60)).toBe(1);
    expect(markerOpacity(8)).toBe(1);
    expect(markerOpacity(1)).toBe(0);
    expect(markerOpacity(0.2)).toBe(0);
    const between = markerOpacity(3);
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1);
    expect(markerOpacity(2)).toBeLessThan(markerOpacity(4));
  });
});

describe('mergeStatuses', () => {
  const none = { text: null, tone: 'info' } as const;
  const loading = { text: 'loading…', tone: 'info' } as const;
  const missing = { text: 'some tiles missing', tone: 'error' } as const;
  const offline = { text: 'no connection', tone: 'error' } as const;

  it('is quiet when every field is, and says loading while any is', () => {
    expect(mergeStatuses([none, none])).toEqual(none);
    expect(mergeStatuses([none, loading, none])).toEqual(loading);
  });

  it('says no connection only when every field that wants tiles has none', () => {
    expect(mergeStatuses([offline, none])).toEqual(offline);
    expect(mergeStatuses([offline, loading])).toEqual(loading);
    expect(mergeStatuses([offline, offline])).toEqual(offline);
  });

  it('reports missing tiles over loading, and over no connection when another field has tiles', () => {
    expect(mergeStatuses([missing, loading])).toEqual(missing);
    expect(mergeStatuses([offline, missing])).toEqual(missing);
  });
});
